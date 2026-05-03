import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { requireSystemAdmin } from './middleware.js';
import { createResetToken } from '../auth/reset.js';

// Platform-admin endpoints. All routes require requireAuth + requireSystemAdmin.

export async function systemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireSystemAdmin);

  // Headline counters for the platform dashboard.
  app.get('/system/stats', async (_request, reply) => {
    const [users, workspaces, boards, cards, completedAll] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.board.count({ where: { archivedAt: null } }),
      prisma.card.count({ where: { archivedAt: null } }),
      prisma.card.count({ where: { completedAt: { not: null } } }),
    ]);
    const lastWeek = new Date(Date.now() - 7 * 24 * 3600_000);
    const [usersWeek, workspacesWeek] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: lastWeek } } }),
      prisma.workspace.count({ where: { createdAt: { gte: lastWeek } } }),
    ]);
    return reply.send({
      users, workspaces, boards, cards, completedAll,
      usersThisWeek: usersWeek,
      workspacesThisWeek: workspacesWeek,
    });
  });

  // Every workspace on the platform with member + board counts and the
  // earliest admin (treated as the owner).
  app.get('/system/workspaces', async (_request, reply) => {
    const ws = await prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { memberships: true, boards: true } },
        memberships: {
          where: { role: 'admin' },
          orderBy: { joinedAt: 'asc' },
          take: 1,
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
      },
    });
    return reply.send({
      workspaces: ws.map((w) => ({
        id: w.id,
        slug: w.slug,
        name: w.name,
        hue: w.hue,
        createdAt: w.createdAt.toISOString(),
        memberCount: w._count.memberships,
        boardCount: w._count.boards,
        owner: w.memberships[0]
          ? {
              id: w.memberships[0].user.id,
              email: w.memberships[0].user.email,
              name: `${w.memberships[0].user.firstName} ${w.memberships[0].user.lastName}`.trim(),
            }
          : null,
      })),
    });
  });

  // Generate a one-time reset link for an arbitrary user — for support cases
  // where a user is locked out. The link is returned in the response; the
  // platform admin shares it with the user out-of-band.
  const ResetForBody = z.object({
    email: z.string().email(),
  });
  app.post('/system/users/issue-reset', async (request, reply) => {
    const parsed = ResetForBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) return reply.code(404).send({ error: 'not_found', message: 'No user with that email' });
    const token = await createResetToken(user.id, {
      ip: request.ip, userAgent: request.headers['user-agent'],
    });
    const url = `${config.WEB_ORIGIN}/auth/reset?token=${token}`;
    return reply.send({ ok: true, email: user.email, url });
  });

  // Delete a workspace permanently. Cascades through Prisma to all its
  // boards / departments / teams / chat / media / etc.
  app.delete<{ Params: { id: string } }>('/system/workspaces/:id', async (request, reply) => {
    const ws = await prisma.workspace.findUnique({ where: { id: request.params.id } });
    if (!ws) return reply.code(404).send({ error: 'not_found' });
    await prisma.workspace.delete({ where: { id: ws.id } });
    return reply.code(204).send();
  });

  // ── Users management ─────────────────────────────────────────────────────

  app.get('/system/users', async (_request, reply) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        avatarColor: true, emailVerified: true,
        twoFactorEnabled: true, isSystemAdmin: true,
        suspendedAt: true, createdAt: true,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true, slug: true } },
            department: { select: { name: true, nameAr: true } },
          },
        },
      },
    });
    return reply.send({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: `${u.firstName} ${u.lastName}`.trim(),
        avatarColor: u.avatarColor,
        emailVerified: !!u.emailVerified,
        twoFactorEnabled: u.twoFactorEnabled,
        isSystemAdmin: u.isSystemAdmin,
        suspended: !!u.suspendedAt,
        suspendedAt: u.suspendedAt ? u.suspendedAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        memberships: u.memberships.map((m) => ({
          role: m.role,
          workspaceName: m.workspace.name,
          workspaceSlug: m.workspace.slug,
          department: m.department ? (m.department.nameAr || m.department.name) : null,
        })),
      })),
    });
  });

  // Suspend an account. Refuses to suspend other system admins (a system
  // admin can revoke their own admin via env, but can't take a peer down).
  app.post<{ Params: { id: string } }>('/system/users/:id/suspend', async (request, reply) => {
    if (request.params.id === request.userId) {
      return reply.code(400).send({ error: 'self_suspend', message: 'You cannot suspend your own account' });
    }
    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.isSystemAdmin) {
      return reply.code(403).send({ error: 'cannot_suspend_admin', message: 'Cannot suspend another platform admin. Remove them from SYSTEM_ADMIN_EMAILS first.' });
    }
    if (target.suspendedAt) return reply.send({ ok: true, alreadySuspended: true });

    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { suspendedAt: new Date() } }),
      // Revoke every outstanding refresh token so existing sessions can't
      // extend past the next ~15 minutes (access token TTL).
      prisma.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/system/users/:id/unsuspend', async (request, reply) => {
    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (!target.suspendedAt) return reply.send({ ok: true, alreadyActive: true });
    await prisma.user.update({ where: { id: target.id }, data: { suspendedAt: null } });
    return reply.send({ ok: true });
  });
}
