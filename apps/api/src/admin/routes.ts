import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { loadMembership } from '../boards/auth.js';

// ── Role catalog (single source of truth) ──────────────────────────────────
// Mirrors logic in apps/api/src/boards/auth.ts and the role enum in schema.

const ROLE_CATALOG: Array<{
  id: Role; label: string; labelAr: string; desc: string; descAr: string; color: string;
}> = [
  { id: Role.admin,        label: 'Admin',        labelAr: 'مسؤول',         color: '#7C3AED', desc: 'Full org access',                    descAr: 'وصول كامل للمؤسسة' },
  { id: Role.dept_manager, label: 'Dept. Manager', labelAr: 'مدير قسم',     color: '#3B82F6', desc: 'Manages their department',           descAr: 'يدير قسمه فقط' },
  { id: Role.team_lead,    label: 'Team Lead',    labelAr: 'قائد فريق',     color: '#0E7C66', desc: "Manages their team's projects",      descAr: 'يدير مشاريع فريقه' },
  { id: Role.member,       label: 'Member',       labelAr: 'عضو',           color: '#6B7280', desc: 'Edits cards on team boards',         descAr: 'يعدّل البطاقات في لوحات فريقه' },
  { id: Role.guest,        label: 'Guest',        labelAr: 'ضيف',           color: '#A89478', desc: 'Read-only on shared boards',         descAr: 'للقراءة فقط على اللوحات' },
];

const PERM_CATALOG: Array<{
  key: string; label: string; labelAr: string; admin: boolean; dept_manager: boolean; team_lead: boolean; member: boolean; guest: boolean;
}> = [
  { key: 'view_dept',   label: 'View department boards',  labelAr: 'عرض لوحات القسم',         admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'view_team',   label: 'View team boards',        labelAr: 'عرض لوحات الفريق',         admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'edit_team',   label: 'Edit team boards',        labelAr: 'تعديل لوحات الفريق',       admin: true,  dept_manager: true,  team_lead: true,  member: true,  guest: false },
  { key: 'create_proj', label: 'Create new boards',       labelAr: 'إنشاء لوحات جديدة',         admin: true,  dept_manager: true,  team_lead: true,  member: false, guest: false },
  { key: 'invite',      label: 'Invite members',          labelAr: 'دعوة أعضاء',                admin: true,  dept_manager: true,  team_lead: false, member: false, guest: false },
  { key: 'manage_dept', label: 'Manage departments/teams', labelAr: 'إدارة الأقسام والفرق',    admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
  { key: 'manage_org',  label: 'Manage organization',     labelAr: 'إدارة المؤسسة',             admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
  { key: 'billing',     label: 'Billing & invoices',      labelAr: 'الفوترة والفواتير',         admin: true,  dept_manager: false, team_lead: false, member: false, guest: false },
];

// ── Schemas ────────────────────────────────────────────────────────────────

const CreateDept = z.object({
  name: z.string().min(1).max(80),
  nameAr: z.string().max(80).nullable().optional(),
  icon: z.string().max(8).optional().default('◇'),
  hue: z.number().int().min(0).max(360).optional().default(220),
  headId: z.string().nullable().optional(),
});
const UpdateDept = z.object({
  name: z.string().min(1).max(80).optional(),
  nameAr: z.string().max(80).nullable().optional(),
  icon: z.string().max(8).optional(),
  hue: z.number().int().min(0).max(360).optional(),
  headId: z.string().nullable().optional(),
});

const CreateTeam = z.object({
  name: z.string().min(1).max(80),
  nameAr: z.string().max(80).nullable().optional(),
  departmentId: z.string().min(1),
  leadId: z.string().nullable().optional(),
});
const UpdateTeam = z.object({
  name: z.string().min(1).max(80).optional(),
  nameAr: z.string().max(80).nullable().optional(),
  departmentId: z.string().optional(),
  leadId: z.string().nullable().optional(),
});

const UpdateMembership = z.object({
  role: z.nativeEnum(Role).optional(),
  departmentId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

// ── Permission helpers ─────────────────────────────────────────────────────

function isAdmin(m: { role: Role }) { return m.role === Role.admin; }
function isAdminOrDeptManager(m: { role: Role }) {
  return m.role === Role.admin || m.role === Role.dept_manager;
}

async function requireWorkspaceAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
) {
  await loadMembership(request, reply, workspaceId);
  if (reply.sent) return false;
  if (!isAdmin(request.membership!)) {
    reply.code(403).send({ error: 'forbidden', message: 'Admin role required' });
    return false;
  }
  return true;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ── Departments ─────────────────────────────────────────────────────────

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/departments', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;

    const depts = await prisma.department.findMany({
      where: { workspaceId: request.params.workspaceId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { teams: true, boards: true, members: true } },
      },
    });
    // Resolve head (a Membership.id) → User
    const headMembershipIds = depts.map((d) => d.headId).filter(Boolean) as string[];
    const headMs = await prisma.membership.findMany({
      where: { id: { in: headMembershipIds } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    const headByMid = new Map(headMs.map((m) => [m.id, m.user]));

    return reply.send({
      departments: depts.map((d) => ({
        id: d.id, name: d.name, nameAr: d.nameAr, icon: d.icon, hue: d.hue,
        memberCount: d._count.members, teamCount: d._count.teams, projectCount: d._count.boards,
        head: d.headId
          ? (() => {
              const u = headByMid.get(d.headId!);
              return u ? { id: u.id, name: `${u.firstName} ${u.lastName}`, avatarColor: u.avatarColor } : null;
            })()
          : null,
      })),
    });
  });

  app.post<{ Params: { workspaceId: string }; Body: unknown }>('/workspaces/:workspaceId/departments', async (request, reply) => {
    if (!await requireWorkspaceAdmin(request, reply, request.params.workspaceId)) return;
    const parsed = CreateDept.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const d = await prisma.department.create({
      data: {
        workspaceId: request.params.workspaceId,
        name: parsed.data.name,
        nameAr: parsed.data.nameAr ?? null,
        icon: parsed.data.icon, hue: parsed.data.hue,
        headId: parsed.data.headId ?? null,
      },
    });
    return reply.code(201).send({ id: d.id, name: d.name, nameAr: d.nameAr, icon: d.icon, hue: d.hue });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/departments/:id', async (request, reply) => {
    const dept = await prisma.department.findUnique({ where: { id: request.params.id } });
    if (!dept) return reply.code(404).send({ error: 'not_found', message: 'Department not found' });
    if (!await requireWorkspaceAdmin(request, reply, dept.workspaceId)) return;

    const parsed = UpdateDept.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const updated = await prisma.department.update({ where: { id: dept.id }, data: parsed.data });
    return reply.send({ id: updated.id, name: updated.name, nameAr: updated.nameAr, icon: updated.icon, hue: updated.hue, headId: updated.headId });
  });

  app.delete<{ Params: { id: string } }>('/departments/:id', async (request, reply) => {
    const dept = await prisma.department.findUnique({ where: { id: request.params.id } });
    if (!dept) return reply.code(404).send({ error: 'not_found', message: 'Department not found' });
    if (!await requireWorkspaceAdmin(request, reply, dept.workspaceId)) return;

    await prisma.department.delete({ where: { id: dept.id } });
    return reply.code(204).send();
  });

  // Department detail (used by /dept/:id view)
  app.get<{ Params: { id: string } }>('/departments/:id/detail', async (request, reply) => {
    const dept = await prisma.department.findUnique({
      where: { id: request.params.id },
      include: {
        teams: {
          include: {
            _count: { select: { members: true, boards: true } },
            members: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } } },
          },
        },
        boards: { where: { archivedAt: null } },
        members: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true, email: true } } },
        },
      },
    });
    if (!dept) return reply.code(404).send({ error: 'not_found', message: 'Department not found' });
    await loadMembership(request, reply, dept.workspaceId);
    if (reply.sent) return;

    const onTrack = dept.boards.length; // we don't track status yet; placeholder

    return reply.send({
      id: dept.id, name: dept.name, nameAr: dept.nameAr, icon: dept.icon, hue: dept.hue,
      memberCount: dept.members.length,
      teamCount: dept.teams.length,
      projectCount: dept.boards.length,
      onTrackCount: onTrack,
      atRiskCount: 0,
      head: dept.headId
        ? (await prisma.membership.findUnique({
            where: { id: dept.headId },
            include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
          }).then((m) => m ? { id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`, avatarColor: m.user.avatarColor } : null))
        : null,
      teams: dept.teams.map((t) => ({
        id: t.id, name: t.name, nameAr: t.nameAr,
        memberCount: t._count.members, projectCount: t._count.boards,
        members: t.members.map((m) => ({
          id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`, avatarColor: m.user.avatarColor,
        })),
      })),
      projects: dept.boards.map((b) => ({
        id: b.id, title: b.title, hue: b.hue,
        updatedAt: b.updatedAt.toISOString(),
      })),
      members: dept.members.map((m) => ({
        membershipId: m.id, userId: m.user.id, role: m.role, teamId: m.teamId,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email, avatarColor: m.user.avatarColor,
      })),
    });
  });

  // ── Teams ───────────────────────────────────────────────────────────────

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/teams', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;

    const teams = await prisma.team.findMany({
      where: { workspaceId: request.params.workspaceId },
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true, nameAr: true } },
        _count: { select: { members: true, boards: true } },
        members: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } } },
      },
    });
    const leadIds = teams.map((t) => t.leadId).filter(Boolean) as string[];
    const leads = await prisma.membership.findMany({
      where: { id: { in: leadIds } },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    const leadByMid = new Map(leads.map((m) => [m.id, m.user]));

    return reply.send({
      teams: teams.map((t) => ({
        id: t.id, name: t.name, nameAr: t.nameAr,
        department: t.department,
        memberCount: t._count.members, projectCount: t._count.boards,
        members: t.members.map((m) => ({
          id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`, avatarColor: m.user.avatarColor,
        })),
        lead: t.leadId
          ? (() => {
              const u = leadByMid.get(t.leadId!);
              return u ? { id: u.id, name: `${u.firstName} ${u.lastName}`, avatarColor: u.avatarColor } : null;
            })()
          : null,
      })),
    });
  });

  app.post<{ Params: { workspaceId: string }; Body: unknown }>('/workspaces/:workspaceId/teams', async (request, reply) => {
    if (!await requireWorkspaceAdmin(request, reply, request.params.workspaceId)) return;
    const parsed = CreateTeam.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    // Verify dept belongs to this workspace
    const dept = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!dept || dept.workspaceId !== request.params.workspaceId) {
      return reply.code(400).send({ error: 'invalid_dept', message: 'Department not in workspace' });
    }

    const t = await prisma.team.create({
      data: {
        workspaceId: request.params.workspaceId,
        departmentId: parsed.data.departmentId,
        name: parsed.data.name,
        nameAr: parsed.data.nameAr ?? null,
        leadId: parsed.data.leadId ?? null,
      },
    });
    return reply.code(201).send({ id: t.id, name: t.name, nameAr: t.nameAr, departmentId: t.departmentId });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/teams/:id', async (request, reply) => {
    const team = await prisma.team.findUnique({ where: { id: request.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found', message: 'Team not found' });
    if (!await requireWorkspaceAdmin(request, reply, team.workspaceId)) return;

    const parsed = UpdateTeam.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const updated = await prisma.team.update({ where: { id: team.id }, data: parsed.data });
    return reply.send({ id: updated.id, name: updated.name, nameAr: updated.nameAr, departmentId: updated.departmentId, leadId: updated.leadId });
  });

  app.delete<{ Params: { id: string } }>('/teams/:id', async (request, reply) => {
    const team = await prisma.team.findUnique({ where: { id: request.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found', message: 'Team not found' });
    if (!await requireWorkspaceAdmin(request, reply, team.workspaceId)) return;

    await prisma.team.delete({ where: { id: team.id } });
    return reply.code(204).send();
  });

  // ── Members (memberships) ───────────────────────────────────────────────

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/members', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;

    const members = await prisma.membership.findMany({
      where: { workspaceId: request.params.workspaceId },
      orderBy: { joinedAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarColor: true, email: true, locale: true } },
        department: { select: { id: true, name: true, nameAr: true } },
        team: { select: { id: true, name: true, nameAr: true } },
      },
    });
    return reply.send({
      members: members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        email: m.user.email,
        avatarColor: m.user.avatarColor,
        locale: m.user.locale,
        role: m.role,
        department: m.department,
        team: m.team,
        joinedAt: m.joinedAt.toISOString(),
      })),
    });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/memberships/:id', async (request, reply) => {
    const m = await prisma.membership.findUnique({ where: { id: request.params.id } });
    if (!m) return reply.code(404).send({ error: 'not_found', message: 'Membership not found' });
    if (!await requireWorkspaceAdmin(request, reply, m.workspaceId)) return;

    const parsed = UpdateMembership.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    // Validate FKs against this workspace
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
    }

    const updated = await prisma.membership.update({ where: { id: m.id }, data: parsed.data });
    return reply.send({
      id: updated.id, role: updated.role,
      departmentId: updated.departmentId, teamId: updated.teamId,
    });
  });

  app.delete<{ Params: { id: string } }>('/memberships/:id', async (request, reply) => {
    const m = await prisma.membership.findUnique({ where: { id: request.params.id } });
    if (!m) return reply.code(404).send({ error: 'not_found', message: 'Membership not found' });
    if (!await requireWorkspaceAdmin(request, reply, m.workspaceId)) return;
    if (m.userId === request.userId) {
      return reply.code(400).send({ error: 'cannot_remove_self', message: 'You cannot remove yourself' });
    }
    await prisma.membership.delete({ where: { id: m.id } });
    return reply.code(204).send();
  });

  // Labels moved to boards/routes.ts — they are board-scoped now.

  // ── Roles (live counts + permissions matrix) ───────────────────────────

  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/roles', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;

    // Live counts per role within this workspace
    const grouped = await prisma.membership.groupBy({
      by: ['role'],
      where: { workspaceId: request.params.workspaceId },
      _count: { _all: true },
    });
    const countByRole = new Map(grouped.map((g) => [g.role, g._count._all]));

    // Top 5 sample members per role for the avatar stack
    const allMembers = await prisma.membership.findMany({
      where: { workspaceId: request.params.workspaceId },
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    const samplesByRole = new Map<Role, typeof allMembers>();
    for (const m of allMembers) {
      const arr = samplesByRole.get(m.role) ?? [];
      if (arr.length < 5) arr.push(m);
      samplesByRole.set(m.role, arr);
    }

    return reply.send({
      roles: ROLE_CATALOG.map((r) => ({
        id: r.id,
        label: r.label,
        labelAr: r.labelAr,
        desc: r.desc,
        descAr: r.descAr,
        color: r.color,
        memberCount: countByRole.get(r.id) ?? 0,
        members: (samplesByRole.get(r.id) ?? []).map((m) => ({
          id: m.user.id,
          name: `${m.user.firstName} ${m.user.lastName}`,
          color: m.user.avatarColor,
        })),
      })),
      permissions: PERM_CATALOG,
    });
  });
}
