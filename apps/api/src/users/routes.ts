import type { FastifyInstance } from 'fastify';
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

// Member profile + KPIs.
//
// Visibility:
//   - admin sees everyone in their workspace
//   - dept_manager sees their dept members
//   - team_lead sees their team members
//   - everyone sees their own profile
//
// All endpoints scope to the viewer's workspace (or the shared workspace
// when viewer + target overlap).

async function resolveSharedWorkspace(viewerId: string, targetUserId: string) {
  // The (viewer, target) pair must share at least one workspace, and
  // the viewer's role within that workspace must be high enough to see them.
  const viewerMs = await prisma.membership.findMany({ where: { userId: viewerId } });
  const targetMs = await prisma.membership.findMany({ where: { userId: targetUserId } });
  const targetByWs = new Map(targetMs.map((m) => [m.workspaceId, m]));

  for (const v of viewerMs) {
    const t = targetByWs.get(v.workspaceId);
    if (!t) continue;
    if (viewerId === targetUserId) return { workspaceId: v.workspaceId, viewer: v, target: t };
    if (v.role === Role.admin) return { workspaceId: v.workspaceId, viewer: v, target: t };
    if (v.role === Role.dept_manager && v.departmentId && v.departmentId === t.departmentId) {
      return { workspaceId: v.workspaceId, viewer: v, target: t };
    }
    if (v.role === Role.team_lead && v.teamId && v.teamId === t.teamId) {
      return { workspaceId: v.workspaceId, viewer: v, target: t };
    }
  }
  return null;
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Profile: identity + workspace context (role, dept, team, head, etc.)
  app.get<{ Params: { id: string } }>('/users/:id/profile', async (request, reply) => {
    const scope = await resolveSharedWorkspace(request.userId!, request.params.id);
    if (!scope) return reply.code(403).send({ error: 'forbidden', message: 'No access to this profile' });

    const [user, dept, team, ws] = await Promise.all([
      prisma.user.findUnique({
        where: { id: request.params.id },
        select: { id: true, email: true, firstName: true, lastName: true, avatarColor: true, locale: true, createdAt: true },
      }),
      scope.target.departmentId
        ? prisma.department.findUnique({ where: { id: scope.target.departmentId }, select: { id: true, name: true, nameAr: true, hue: true } })
        : Promise.resolve(null),
      scope.target.teamId
        ? prisma.team.findUnique({ where: { id: scope.target.teamId }, select: { id: true, name: true, nameAr: true } })
        : Promise.resolve(null),
      prisma.workspace.findUnique({ where: { id: scope.workspaceId }, select: { id: true, name: true, slug: true } }),
    ]);
    if (!user) return reply.code(404).send({ error: 'not_found', message: 'User not found' });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`.trim(),
        avatarColor: user.avatarColor,
        locale: user.locale,
        createdAt: user.createdAt.toISOString(),
      },
      role: scope.target.role,
      department: dept,
      team: team,
      workspace: ws,
      joinedAt: scope.target.joinedAt.toISOString(),
      isSelf: request.userId === request.params.id,
    });
  });

  // Tasks the target user is a member of, scoped to the shared workspace.
  // The viewer must already be permitted (resolveSharedWorkspace).
  app.get<{ Params: { id: string }; Querystring: { filter?: string } }>('/users/:id/tasks', async (request, reply) => {
    const scope = await resolveSharedWorkspace(request.userId!, request.params.id);
    if (!scope) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const filter = request.query.filter || 'active'; // 'active' | 'completed' | 'overdue' | 'all'
    const baseWhere: Prisma.CardWhereInput = {
      archivedAt: null,
      members: { some: { userId: request.params.id } },
      list: { board: { workspaceId: scope.workspaceId, archivedAt: null } },
    };

    let where: Prisma.CardWhereInput = baseWhere;
    if (filter === 'active')    where = { ...baseWhere, completedAt: null };
    if (filter === 'completed') where = { ...baseWhere, completedAt: { not: null } };
    if (filter === 'overdue')   where = { ...baseWhere, completedAt: null, due: { lt: new Date() } };

    const cards = await prisma.card.findMany({
      where,
      orderBy: filter === 'completed'
        ? [{ completedAt: 'desc' }]
        : [{ due: 'asc' }, { updatedAt: 'desc' }],
      include: {
        list: { include: { board: { select: { id: true, title: true, hue: true, departmentId: true } } } },
        labels: { select: { labelId: true } },
        _count: { select: { comments: true } },
        checklist: { select: { done: true } },
      },
      take: 200,
    });

    const labelIds = [...new Set(cards.flatMap((c) => c.labels.map((l) => l.labelId)))];
    const labels = await prisma.label.findMany({ where: { id: { in: labelIds } } });
    const labelsById: Record<string, { id: string; name: string; color: string; bg: string }> = {};
    labels.forEach((l) => { labelsById[l.id] = { id: l.id, name: l.name, color: l.color, bg: l.bg }; });

    return reply.send({
      tasks: cards.map((c) => {
        const total = c.checklist.length;
        const done = c.checklist.filter((k) => k.done).length;
        return {
          id: c.id,
          title: c.title,
          listId: c.listId,
          listTitle: c.list.title,
          boardId: c.list.boardId,
          boardTitle: c.list.board.title,
          boardHue: c.list.board.hue,
          due: c.due ? c.due.toISOString() : null,
          completedAt: c.completedAt ? c.completedAt.toISOString() : null,
          labelIds: c.labels.map((l) => l.labelId),
          commentCount: c._count.comments,
          checklistDone: done,
          checklistTotal: total,
        };
      }),
      labelsById,
    });
  });

  // KPI counters — Asana/Linear-style member dashboard.
  app.get<{ Params: { id: string } }>('/users/:id/kpis', async (request, reply) => {
    const scope = await resolveSharedWorkspace(request.userId!, request.params.id);
    if (!scope) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const userId = request.params.id;
    const wsScope = { list: { board: { workspaceId: scope.workspaceId, archivedAt: null } } } as const;
    const memberOf = { members: { some: { userId } } } as const;

    const now = new Date();
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7); // last 7 days rolling
    const startOfMonth = new Date(now); startOfMonth.setDate(now.getDate() - 30); // last 30 days rolling

    const [
      activeCount, overdueCount, completedThisWeek, completedThisMonth,
      cardsCreated, commentsThisMonth, completedSample,
    ] = await Promise.all([
      prisma.card.count({ where: { archivedAt: null, completedAt: null, ...wsScope, ...memberOf } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: null, due: { lt: now }, ...wsScope, ...memberOf } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: { gte: startOfWeek }, ...wsScope, ...memberOf } }),
      prisma.card.count({ where: { archivedAt: null, completedAt: { gte: startOfMonth }, ...wsScope, ...memberOf } }),
      prisma.card.count({ where: { archivedAt: null, createdById: userId, createdAt: { gte: startOfMonth }, ...wsScope } }),
      prisma.comment.count({ where: { authorId: userId, createdAt: { gte: startOfMonth }, card: wsScope } }),
      // last 50 completed cards by this user — for avg cycle time
      prisma.card.findMany({
        where: { archivedAt: null, completedAt: { not: null }, ...wsScope, ...memberOf },
        select: { createdAt: true, completedAt: true },
        orderBy: { completedAt: 'desc' },
        take: 50,
      }),
    ]);

    // Average cycle time (days from createdAt to completedAt) over recent samples
    const avgCycleDays = completedSample.length === 0 ? null
      : (completedSample.reduce((s, c) => s + (c.completedAt!.getTime() - c.createdAt.getTime()), 0)
          / completedSample.length / 86_400_000);

    // Last activity timestamp (most recent activity log entry)
    const lastActivity = await prisma.activity.findFirst({
      where: { actorId: userId, board: { workspaceId: scope.workspaceId } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return reply.send({
      activeCount,
      overdueCount,
      completedThisWeek,
      completedThisMonth,
      cardsCreatedThisMonth: cardsCreated,
      commentsThisMonth,
      avgCycleDays: avgCycleDays != null ? Number(avgCycleDays.toFixed(1)) : null,
      lastActivityAt: lastActivity?.createdAt.toISOString() ?? null,
    });
  });
}
