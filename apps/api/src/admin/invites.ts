import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { loadMembership } from '../boards/auth.js';
import { hashPassword, validatePasswordStrength } from '../auth/passwords.js';
import { signAccessToken, issueRefreshToken, verifyAccessToken } from '../auth/tokens.js';
import { toAuthUser, loadMembershipSummaries } from '../auth/serialize.js';
import { sendEmail, brandedHtml, escapeHtml } from '../lib/email.js';
import { config, isProd } from '../config.js';
import { notify } from '../notifications/service.js';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Role hierarchy as numeric ranks so we can enforce that an inviter never
// grants a role at or above their own (admin → 4 … guest → 0).
const ROLE_RANK: Record<Role, number> = {
  [Role.admin]: 4,
  [Role.dept_manager]: 3,
  [Role.team_lead]: 2,
  [Role.member]: 1,
  [Role.guest]: 0,
};

const SendInvite = z.object({
  email: z.string().email().max(254),
  role: z.nativeEnum(Role).default(Role.member),
  departmentId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

const AcceptExisting = z.object({
  // For users already signed in — body just confirms
});

const AcceptNew = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
});

function generateInviteToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export async function inviteRoutes(app: FastifyInstance) {
  // ── Authenticated: send / list / revoke ─────────────────────────────────

  app.post<{ Params: { workspaceId: string }; Body: unknown }>('/workspaces/:workspaceId/invites',
    { preHandler: requireAuth },
    async (request, reply) => {
      await loadMembership(request, reply, request.params.workspaceId);
      if (reply.sent) return;
      const m = request.membership!;
      if (m.role !== Role.admin && m.role !== Role.dept_manager) {
        return reply.code(403).send({ error: 'forbidden', message: 'Admin or dept_manager required' });
      }

      const parsed = SendInvite.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

      // Role ceiling: an inviter can never grant a role at or above their own.
      // Admins are the one exception — they may invite anyone, including other
      // admins. Without this, a dept_manager could invite (and then accept) an
      // `admin` invite and escalate to full workspace control.
      if (m.role !== Role.admin && ROLE_RANK[parsed.data.role] >= ROLE_RANK[m.role]) {
        return reply.code(403).send({ error: 'role_too_high', message: 'You cannot invite a role at or above your own' });
      }

      // dept_manager invites are always scoped to their own department — they
      // must not create workspace-level (unscoped) or other-department
      // memberships. (The previous `&& parsed.data.departmentId` guard was
      // bypassable simply by omitting departmentId.)
      if (m.role === Role.dept_manager) {
        if (!m.departmentId) {
          return reply.code(400).send({ error: 'no_department', message: 'Your membership has no department — ask an admin to assign you to one.' });
        }
        if (parsed.data.departmentId && parsed.data.departmentId !== m.departmentId) {
          return reply.code(403).send({ error: 'forbidden', message: 'Cannot invite to other departments' });
        }
        parsed.data.departmentId = m.departmentId;
      }

      // Validate any dept/team belong to THIS workspace and are mutually
      // consistent, so the accepted membership can never reference another
      // tenant's dept/team or a team that lives outside the chosen department.
      if (parsed.data.departmentId) {
        const d = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
        if (!d || d.workspaceId !== m.workspaceId) {
          return reply.code(400).send({ error: 'invalid_dept', message: 'Department not in workspace' });
        }
      }
      if (parsed.data.teamId) {
        const t = await prisma.team.findUnique({ where: { id: parsed.data.teamId } });
        if (!t || t.workspaceId !== m.workspaceId) {
          return reply.code(400).send({ error: 'invalid_team', message: 'Team not in workspace' });
        }
        if (parsed.data.departmentId && t.departmentId !== parsed.data.departmentId) {
          return reply.code(400).send({ error: 'team_dept_mismatch', message: 'Team is not in that department' });
        }
        // A team-scoped invite with no explicit department inherits the team's.
        if (!parsed.data.departmentId) parsed.data.departmentId = t.departmentId;
      }

      const targetEmail = parsed.data.email.toLowerCase();

      // Block self-invite explicitly. The actor's own membership would also
      // be caught by the already_member check below, but a clearer error
      // helps the inviter understand what just happened.
      const me = await prisma.user.findUnique({
        where: { id: request.userId! }, select: { email: true },
      });
      if (me && me.email.toLowerCase() === targetEmail) {
        return reply.code(400).send({
          error: 'self_invite',
          message: 'You cannot invite your own email address',
        });
      }

      // If the target is already a member of this workspace, no-op.
      const existingUser = await prisma.user.findUnique({ where: { email: targetEmail } });
      if (existingUser) {
        const existingMs = await prisma.membership.findUnique({
          where: { userId_workspaceId: { userId: existingUser.id, workspaceId: m.workspaceId } },
        });
        if (existingMs) {
          return reply.code(409).send({ error: 'already_member', message: 'User is already in this workspace' });
        }
      }

      // Block duplicate pending invites for the same email + workspace.
      // The inviter probably forgot they sent one; we point them at the existing.
      const pending = await prisma.invite.findFirst({
        where: {
          workspaceId: m.workspaceId,
          email: targetEmail,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, expiresAt: true },
      });
      if (pending) {
        return reply.code(409).send({
          error: 'pending_invite',
          message: 'An invitation is already pending for this email',
          inviteId: pending.id,
          expiresAt: pending.expiresAt.toISOString(),
        });
      }

      const { token, tokenHash } = generateInviteToken();
      const invite = await prisma.invite.create({
        data: {
          workspaceId: m.workspaceId,
          email: parsed.data.email.toLowerCase(),
          role: parsed.data.role,
          departmentId: parsed.data.departmentId ?? null,
          teamId: parsed.data.teamId ?? null,
          invitedById: request.userId!,
          tokenHash,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });

      // Mail the invite link via SendGrid (or log it in dev when no key).
      // We also return the relative URL so the admin can copy it manually
      // if they prefer.
      const relUrl = `/invite/${token}`;
      const absUrl = `${config.WEB_ORIGIN}${relUrl}`;
      const inviter = await prisma.user.findUnique({
        where: { id: request.userId! },
        select: { firstName: true, lastName: true },
      });
      const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : 'A teammate';
      const wsName = (await prisma.workspace.findUnique({
        where: { id: m.workspaceId }, select: { name: true },
      }))?.name || 'a SarSync workspace';
      // Both are user-controlled and interpolated raw into the email HTML below.
      const inviterNameHtml = escapeHtml(inviterName);
      const wsNameHtml = escapeHtml(wsName);
      const roleLabel = parsed.data.role.replace('_', ' ');

      sendEmail({
        to: targetEmail,
        subject: `${inviterName} invited you to ${wsName} on SarSync`,
        text: `${inviterName} invited you to join "${wsName}" on SarSync as ${roleLabel}.\n\nAccept the invitation:\n${absUrl}\n\nThe link is valid for 14 days.`,
        html: brandedHtml({
          heading: `Join ${wsNameHtml}`,
          body: `<p><strong>${inviterNameHtml}</strong> invited you to collaborate on <strong>${wsNameHtml}</strong> as <em>${escapeHtml(roleLabel)}</em>.</p><p style="color:#6B7280;font-size:12.5px;">This invitation is valid for 14 days.</p>`,
          cta: { label: 'Accept invitation', url: absUrl },
        }),
        reason: 'workspace_invite',
        log: app.log,
      }).catch(() => {});

      return reply.code(201).send({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        inviteUrl: relUrl,
        // The raw token is the credential that grants workspace access — never
        // echo it back in production. In dev we return it so testers can share
        // the link manually when email isn't configured.
        ...(isProd ? {} : { token }),
      });
    });

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/invites',
    { preHandler: requireAuth },
    async (request, reply) => {
      await loadMembership(request, reply, request.params.workspaceId);
      if (reply.sent) return;
      if (request.membership!.role !== Role.admin && request.membership!.role !== Role.dept_manager) {
        return reply.code(403).send({ error: 'forbidden', message: 'Admin or dept_manager required' });
      }

      const invites = await prisma.invite.findMany({
        where: { workspaceId: request.params.workspaceId, acceptedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { invitedBy: { select: { firstName: true, lastName: true } } },
      });
      return reply.send({
        invites: invites.map((i) => ({
          id: i.id, email: i.email, role: i.role,
          departmentId: i.departmentId, teamId: i.teamId,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          invitedBy: i.invitedBy ? `${i.invitedBy.firstName} ${i.invitedBy.lastName}` : null,
          expired: i.expiresAt < new Date(),
        })),
      });
    });

  app.delete<{ Params: { id: string } }>('/invites/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const inv = await prisma.invite.findUnique({ where: { id: request.params.id } });
      if (!inv) return reply.code(404).send({ error: 'not_found', message: 'Invite not found' });
      await loadMembership(request, reply, inv.workspaceId);
      if (reply.sent) return;
      if (request.membership!.role !== Role.admin && request.membership!.role !== Role.dept_manager) {
        return reply.code(403).send({ error: 'forbidden', message: 'Admin or dept_manager required' });
      }
      await prisma.invite.delete({ where: { id: inv.id } });
      return reply.code(204).send();
    });

  // ── Public: invite info + accept (no auth) ─────────────────────────────

  app.get<{ Params: { token: string } }>('/invites/:token/info', async (request, reply) => {
    const tokenHash = crypto.createHash('sha256').update(request.params.token).digest('hex');
    const inv = await prisma.invite.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { id: true, name: true, slug: true, hue: true } },
        invitedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!inv) return reply.code(404).send({ error: 'not_found', message: 'Invite not found' });
    if (inv.acceptedAt) return reply.code(410).send({ error: 'already_accepted', message: 'Invite already accepted' });
    if (inv.expiresAt < new Date()) return reply.code(410).send({ error: 'expired', message: 'Invite expired' });

    const userExists = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });

    return reply.send({
      email: inv.email,
      role: inv.role,
      workspace: inv.workspace,
      invitedBy: inv.invitedBy ? `${inv.invitedBy.firstName} ${inv.invitedBy.lastName}` : null,
      userExists: !!userExists,
      expiresAt: inv.expiresAt.toISOString(),
    });
  });

  // Accept: works for both new users (provide name+password) and existing
  // users (must be authenticated as the invited email).
  app.post<{ Params: { token: string }; Body: unknown }>('/invites/:token/accept', async (request, reply) => {
    const tokenHash = crypto.createHash('sha256').update(request.params.token).digest('hex');
    const inv = await prisma.invite.findUnique({ where: { tokenHash } });
    if (!inv) return reply.code(404).send({ error: 'not_found', message: 'Invite not found' });
    if (inv.acceptedAt) return reply.code(410).send({ error: 'already_accepted', message: 'Invite already accepted' });
    if (inv.expiresAt < new Date()) return reply.code(410).send({ error: 'expired', message: 'Invite expired' });

    const existingUser = await prisma.user.findUnique({ where: { email: inv.email } });

    let user;
    // `true` only for a freshly-created account: that's the one case where the
    // accept response may carry session tokens. An existing account NEVER
    // receives fresh tokens from this (public) endpoint — see below.
    let isNewAccount = false;
    if (existingUser) {
      // The invited email already has an account. Possession of the invite
      // link alone must NOT yield a session for that account — otherwise
      // anyone who intercepts the link (or any inviter, who sees the token in
      // the create response) could take it over. Require the caller to already
      // be authenticated AS the invited user. We parse the bearer token
      // manually rather than using a requireAuth preHandler so the new-user
      // path below can stay public.
      let callerId: string | null = null;
      const header = request.headers.authorization;
      if (header && header.startsWith('Bearer ')) {
        try { callerId = verifyAccessToken(header.slice('Bearer '.length)).sub; } catch { callerId = null; }
      }
      if (callerId !== existingUser.id) {
        return reply.code(401).send({
          error: 'auth_required',
          message: `Sign in as ${inv.email} to accept this invitation.`,
        });
      }
      user = existingUser;
    } else {
      isNewAccount = true;
      const parsed = AcceptNew.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', message: 'firstName, lastName, password required' });
      }
      const pwError = validatePasswordStrength(parsed.data.password);
      if (pwError) return reply.code(400).send({ error: 'weak_password', message: pwError });
      const passwordHash = await hashPassword(parsed.data.password);
      user = await prisma.user.create({
        data: {
          email: inv.email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          passwordHash,
          emailVerified: new Date(), // invite implies verification
        },
      });
    }

    // Idempotent membership creation
    const existingMs = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: inv.workspaceId } },
    });
    if (!existingMs) {
      await prisma.membership.create({
        data: {
          userId: user.id,
          workspaceId: inv.workspaceId,
          role: inv.role,
          departmentId: inv.departmentId,
          teamId: inv.teamId,
        },
      });
    }

    await prisma.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });

    // Notify the inviter
    await notify({
      recipientId: inv.invitedById,
      actorId: user.id,
      workspaceId: inv.workspaceId,
      kind: 'invite_accepted',
      title: `accepted your invitation`,
      link: '/admin?tab=members',
      meta: { invitedEmail: inv.email },
    });

    const memberships = await loadMembershipSummaries(user.id);

    // Only a brand-new account gets a session minted here (there's no prior
    // session to use). An existing user accepted while authenticated as
    // themselves — they keep their current session; we just return the
    // refreshed membership list so the client can show the new workspace.
    if (isNewAccount) {
      const accessToken = signAccessToken(user);
      const { refreshToken } = await issueRefreshToken(user.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      return reply.send({
        accessToken, refreshToken,
        user: toAuthUser(user),
        memberships,
      });
    }

    return reply.send({
      user: toAuthUser(user),
      memberships,
    });
  });
}
