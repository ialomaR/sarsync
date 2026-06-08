import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { loadMembership } from '../boards/auth.js';
import { parseDateParam } from '../lib/dates.js';

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

// Admin OR the dept_manager of the target department. Used for actions that
// fall inside a department's scope (e.g. team management) — admins always
// pass; dept_managers pass only when the target dept is their own.
async function requireDeptScope(
  request: FastifyRequest,
  reply: FastifyReply,
  workspaceId: string,
  departmentId: string,
) {
  await loadMembership(request, reply, workspaceId);
  if (reply.sent) return false;
  const m = request.membership!;
  if (m.role === Role.admin) return true;
  if (m.role === Role.dept_manager && m.departmentId === departmentId) return true;
  reply.code(403).send({ error: 'forbidden', message: 'Department manager role required for this department' });
  return false;
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

  // ── Department KPIs ─────────────────────────────────────────────────────
  // Aggregate stats for the department + a per-member row with each
  // person's task counts. Used by the Department page header + Members tab.
  // Visible to anyone in the workspace (admin) or in the department.

  app.get<{ Params: { id: string } }>('/departments/:id/kpis', async (request, reply) => {
    const dept = await prisma.department.findUnique({
      where: { id: request.params.id },
      include: {
        members: {
          include: { user: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
        },
      },
    });
    if (!dept) return reply.code(404).send({ error: 'not_found' });
    await loadMembership(request, reply, dept.workspaceId);
    if (reply.sent) return;

    const now = new Date();
    const lastWeek  = new Date(now.getTime() - 7  * 24 * 3600_000);
    const lastMonth = new Date(now.getTime() - 30 * 24 * 3600_000);

    const userIds = dept.members.map((m) => m.user.id);
    const inDept  = { archivedAt: null, list: { board: { departmentId: dept.id, archivedAt: null } } } as const;

    // ── Department-wide totals ────────────────────────────────────────────
    const [activeTotal, overdueTotal, completedWeek, completedMonth, boardCount] = await Promise.all([
      prisma.card.count({ where: { ...inDept, completedAt: null } }),
      prisma.card.count({ where: { ...inDept, completedAt: null, due: { lt: now } } }),
      prisma.card.count({ where: { ...inDept, completedAt: { gte: lastWeek } } }),
      prisma.card.count({ where: { ...inDept, completedAt: { gte: lastMonth } } }),
      prisma.board.count({ where: { departmentId: dept.id, archivedAt: null } }),
    ]);

    // ── Per-member rollups ────────────────────────────────────────────────
    // Active/overdue stay on assignment (CardMember) because those represent
    // current workload. Completed counts use a richer rule: a user is credited
    // if they were either an assignee OR the person who marked the card
    // complete. Without that OR, users who finish work they weren't formally
    // assigned to (common for solo creators) end up scoring zero.
    type GB = Array<{ userId: string; _count: { _all: number } }>;
    const userIdSet = new Set(userIds);
    const [active, overdue, monthCompletedCards, allCompletedCards, last] = await Promise.all<GB | unknown>([
      prisma.cardMember.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, card: { ...inDept, completedAt: null } },
        _count: { _all: true },
      }),
      prisma.cardMember.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, card: { ...inDept, completedAt: null, due: { lt: now } } },
        _count: { _all: true },
      }),
      prisma.card.findMany({
        where: { ...inDept, completedAt: { gte: lastMonth } },
        select: { id: true, completedById: true, members: { select: { userId: true } } },
      }),
      prisma.card.findMany({
        where: { ...inDept, completedAt: { not: null } },
        select: { id: true, completedById: true, members: { select: { userId: true } } },
      }),
      // Last activity per user (across the whole workspace — easier and
      // more meaningful than scoping to dept)
      prisma.activity.groupBy({
        by: ['actorId'],
        where: { actorId: { in: userIds }, board: { workspaceId: dept.workspaceId } },
        _max: { createdAt: true },
      }),
    ]);

    const tally = (rows: unknown): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of rows as GB) m.set(r.userId, r._count._all);
      return m;
    };
    type CompletedCardLite = { id: string; completedById: string | null; members: Array<{ userId: string }> };
    const tallyCompleted = (rows: CompletedCardLite[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const c of rows) {
        // Use a Set so a user counted as both assignee and completer gets a
        // single credit per card.
        const credited = new Set<string>();
        for (const mem of c.members) if (userIdSet.has(mem.userId)) credited.add(mem.userId);
        if (c.completedById && userIdSet.has(c.completedById)) credited.add(c.completedById);
        for (const uid of credited) m.set(uid, (m.get(uid) ?? 0) + 1);
      }
      return m;
    };
    const activeMap   = tally(active);
    const overdueMap  = tally(overdue);
    const monthMap    = tallyCompleted(monthCompletedCards as CompletedCardLite[]);
    const totalMap    = tallyCompleted(allCompletedCards as CompletedCardLite[]);
    const lastMap     = new Map<string, string | null>();
    for (const r of last as Array<{ actorId: string; _max: { createdAt: Date | null } }>) {
      lastMap.set(r.actorId, r._max.createdAt ? r._max.createdAt.toISOString() : null);
    }

    return reply.send({
      department: {
        id: dept.id, name: dept.name, nameAr: dept.nameAr, hue: dept.hue,
        activeTotal, overdueTotal, completedThisWeek: completedWeek,
        completedThisMonth: completedMonth, boardCount,
        memberCount: userIds.length,
      },
      members: dept.members.map((m) => ({
        userId: m.user.id,
        name: `${m.user.firstName} ${m.user.lastName}`.trim(),
        avatarColor: m.user.avatarColor,
        role: m.role,
        active: activeMap.get(m.user.id) || 0,
        overdue: overdueMap.get(m.user.id) || 0,
        completedThisMonth: monthMap.get(m.user.id) || 0,
        completedTotal: totalMap.get(m.user.id) || 0,
        lastActiveAt: lastMap.get(m.user.id) || null,
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
    const parsed = CreateTeam.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    // Verify dept belongs to this workspace
    const dept = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!dept || dept.workspaceId !== request.params.workspaceId) {
      return reply.code(400).send({ error: 'invalid_dept', message: 'Department not in workspace' });
    }

    // Admin OR dept_manager of this specific department.
    if (!await requireDeptScope(request, reply, request.params.workspaceId, dept.id)) return;

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
    if (!await requireDeptScope(request, reply, team.workspaceId, team.departmentId)) return;

    const parsed = UpdateTeam.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    // Dept managers can't reassign a team to a different department — that
    // would let them move teams out from under another manager. Admins still
    // can (the schema allows it via UpdateTeam).
    if (parsed.data.departmentId && parsed.data.departmentId !== team.departmentId) {
      if (request.membership!.role !== Role.admin) {
        return reply.code(403).send({ error: 'forbidden', message: 'Only admins can move teams between departments' });
      }
    }

    const updated = await prisma.team.update({ where: { id: team.id }, data: parsed.data });
    return reply.send({ id: updated.id, name: updated.name, nameAr: updated.nameAr, departmentId: updated.departmentId, leadId: updated.leadId });
  });

  app.delete<{ Params: { id: string } }>('/teams/:id', async (request, reply) => {
    const team = await prisma.team.findUnique({ where: { id: request.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found', message: 'Team not found' });
    if (!await requireDeptScope(request, reply, team.workspaceId, team.departmentId)) return;

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

    // Last-admin guard: never let the only admin be demoted out of admin — that
    // would leave the workspace with no one able to manage org/members/billing,
    // unrecoverable without DB intervention.
    if (m.role === Role.admin && parsed.data.role !== undefined && parsed.data.role !== Role.admin) {
      const otherAdmins = await prisma.membership.count({
        where: { workspaceId: m.workspaceId, role: Role.admin, id: { not: m.id } },
      });
      if (otherAdmins === 0) {
        return reply.code(400).send({ error: 'last_admin', message: 'Promote another admin before changing this one — a workspace must keep at least one admin.' });
      }
    }

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
    // Last-admin guard: deleting the only admin orphans the workspace.
    if (m.role === Role.admin) {
      const otherAdmins = await prisma.membership.count({
        where: { workspaceId: m.workspaceId, role: Role.admin, id: { not: m.id } },
      });
      if (otherAdmins === 0) {
        return reply.code(400).send({ error: 'last_admin', message: 'Promote another admin before removing this one — a workspace must keep at least one admin.' });
      }
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

  // ── Dashboard (admin-only, workspace-scoped) ────────────────────────────
  // Every query in this section filters by workspaceId (directly or via
  // board.workspaceId on Activity). The requireWorkspaceAdmin gate ensures
  // only an admin of *this* workspace can hit these endpoints, so tenants
  // never see each other's data.

  app.get<{ Params: { workspaceId: string } }>('/admin/workspaces/:workspaceId/overview', async (request, reply) => {
    if (!await requireWorkspaceAdmin(request, reply, request.params.workspaceId)) return;
    const workspaceId = request.params.workspaceId;

    const now = new Date();
    const last24h  = new Date(now.getTime() - 24 * 3600_000);
    const last7d   = new Date(now.getTime() - 7  * 24 * 3600_000);
    const last30d  = new Date(now.getTime() - 30 * 24 * 3600_000);
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

    const wsBoards = { list: { board: { workspaceId } } } as const;

    const [
      boardsActive, boardsArchived,
      cardsActive, cardsCompleted, cardsOverdue, cardsCompletedToday, cardsCompletedThisWeek,
      memberCount, deptCount,
      activity24h, activity7d, activity30d,
      depts,
    ] = await Promise.all([
      prisma.board.count({ where: { workspaceId, archivedAt: null } }),
      prisma.board.count({ where: { workspaceId, archivedAt: { not: null } } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: null, ...wsBoards, list: { board: { workspaceId, archivedAt: null } } } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: { not: null }, ...wsBoards } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: null, due: { lt: now }, list: { board: { workspaceId, archivedAt: null } } } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: { gte: startOfDay }, ...wsBoards } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: { gte: last7d }, ...wsBoards } }),
      prisma.membership.count({ where: { workspaceId } }),
      prisma.department.count({ where: { workspaceId } }),
      prisma.activity.count({ where: { board: { workspaceId }, createdAt: { gte: last24h } } }),
      prisma.activity.count({ where: { board: { workspaceId }, createdAt: { gte: last7d } } }),
      prisma.activity.count({ where: { board: { workspaceId }, createdAt: { gte: last30d } } }),
      prisma.department.findMany({
        where: { workspaceId },
        select: { id: true, name: true, nameAr: true, hue: true, icon: true, _count: { select: { members: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Per-dept rollups in one query each (cards counts grouped by board.departmentId).
    const cardCountsByDept = await prisma.card.groupBy({
      by: ['listId'],
      where: { archivedAt: null, list: { board: { workspaceId, archivedAt: null } } },
      _count: { _all: true },
    });
    const listMap = await prisma.list.findMany({
      where: { board: { workspaceId } },
      select: { id: true, board: { select: { departmentId: true } } },
    });
    const listToDept = new Map(listMap.map((l) => [l.id, l.board.departmentId] as const));
    type DeptAgg = { active: number; overdue: number; completedMonth: number };
    const deptAgg = new Map<string, DeptAgg>();
    const bump = (dId: string | null, key: keyof DeptAgg, n: number) => {
      const k = dId || '__general__';
      const cur = deptAgg.get(k) ?? { active: 0, overdue: 0, completedMonth: 0 };
      cur[key] += n;
      deptAgg.set(k, cur);
    };
    for (const c of cardCountsByDept) {
      const dId = listToDept.get(c.listId) ?? null;
      bump(dId, 'active', c._count._all);
    }
    const overdueByList = await prisma.card.groupBy({
      by: ['listId'],
      where: { archivedAt: null, completedAt: null, due: { lt: now }, list: { board: { workspaceId, archivedAt: null } } },
      _count: { _all: true },
    });
    for (const c of overdueByList) bump(listToDept.get(c.listId) ?? null, 'overdue', c._count._all);
    const completedMonthByList = await prisma.card.groupBy({
      by: ['listId'],
      where: { archivedAt: null, completedAt: { gte: last30d }, list: { board: { workspaceId } } },
      _count: { _all: true },
    });
    for (const c of completedMonthByList) bump(listToDept.get(c.listId) ?? null, 'completedMonth', c._count._all);

    // Daily completion velocity: cards completed per day over last 30d.
    const completionsLast30d = await prisma.card.count({
      where: { archivedAt: null, completedAt: { gte: last30d }, ...wsBoards },
    });
    const avgCompletionsPerDay = +(completionsLast30d / 30).toFixed(1);

    return reply.send({
      workspaceId,
      counts: {
        boards: { active: boardsActive, archived: boardsArchived },
        cards:  { active: cardsActive, completed: cardsCompleted, overdue: cardsOverdue, completedToday: cardsCompletedToday, completedThisWeek: cardsCompletedThisWeek },
        members: memberCount,
        departments: deptCount,
      },
      activity: {
        last24h: activity24h,
        last7d:  activity7d,
        last30d: activity30d,
      },
      velocity: { avgCompletionsPerDay },
      departments: depts.map((d) => {
        const agg = deptAgg.get(d.id) ?? { active: 0, overdue: 0, completedMonth: 0 };
        return {
          id: d.id, name: d.name, nameAr: d.nameAr, hue: d.hue, icon: d.icon,
          memberCount: d._count.members,
          active: agg.active,
          overdue: agg.overdue,
          completedThisMonth: agg.completedMonth,
        };
      }),
    });
  });

  app.get<{
    Params: { workspaceId: string };
    Querystring: { limit?: string; before?: string; verb?: string; actorId?: string; departmentId?: string; boardId?: string; since?: string };
  }>('/admin/workspaces/:workspaceId/activity', async (request, reply) => {
    if (!await requireWorkspaceAdmin(request, reply, request.params.workspaceId)) return;
    const workspaceId = request.params.workspaceId;
    const limit = Math.min(parseInt(request.query.limit || '50', 10) || 50, 200);

    // Tenant isolation: every row must belong to a board in this workspace.
    const where: Prisma.ActivityWhereInput = {
      board: { workspaceId },
    };
    if (request.query.verb)        where.verb = request.query.verb;
    if (request.query.actorId)     where.actorId = request.query.actorId;
    if (request.query.boardId)     where.boardId = request.query.boardId;
    if (request.query.departmentId) {
      where.board = { workspaceId, departmentId: request.query.departmentId };
    }
    const before = parseDateParam(request.query.before);
    if (before) where.createdAt = { lt: before };
    const since = parseDateParam(request.query.since);
    if (since) where.createdAt = { ...(where.createdAt as object || {}), gte: since };

    const rows = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // peek one extra to know if there's a next page
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
        board: { select: { id: true, title: true, hue: true, departmentId: true, department: { select: { id: true, name: true, nameAr: true, hue: true } } } },
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((a) => ({
      id: a.id,
      verb: a.verb,
      targetType: a.targetType,
      targetId: a.targetId,
      meta: a.meta as Record<string, unknown> | null,
      createdAt: a.createdAt.toISOString(),
      actor: {
        id: a.actor.id,
        name: `${a.actor.firstName} ${a.actor.lastName}`.trim(),
        avatarColor: a.actor.avatarColor,
      },
      board: {
        id: a.board.id,
        title: a.board.title,
        hue: a.board.hue,
        department: a.board.department ? {
          id: a.board.department.id,
          name: a.board.department.name,
          nameAr: a.board.department.nameAr,
          hue: a.board.department.hue,
        } : null,
      },
    }));
    const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

    return reply.send({ items, nextCursor });
  });
}
