import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { canViewBoard } from '../boards/auth.js';

export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Cards I'm a member of, across all my workspaces.
  app.get('/me/tasks', async (request, reply) => {
    const userId = request.userId!;
    const cards = await prisma.card.findMany({
      where: {
        archivedAt: null,
        list: { board: { archivedAt: null } },
        members: { some: { userId } },
      },
      orderBy: [{ due: 'asc' }, { updatedAt: 'desc' }],
      include: {
        list: { include: { board: { include: { workspace: { select: { id: true, name: true, slug: true } }, department: { select: { id: true, name: true, nameAr: true, hue: true } } } } } },
        labels: { select: { labelId: true } },
        _count: { select: { comments: true } },
        checklist: { select: { done: true } },
      },
      take: 100,
    });

    const labelIds = [...new Set(cards.flatMap((c) => c.labels.map((l) => l.labelId)))];
    const labels = await prisma.label.findMany({ where: { id: { in: labelIds } } });
    const labelsById: Record<string, { id: string; name: string; color: string; bg: string }> = {};
    labels.forEach((l) => { labelsById[l.id] = { id: l.id, name: l.name, color: l.color, bg: l.bg }; });

    const tasks = cards.map((c) => {
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
        workspaceId: c.list.board.workspace.id,
        workspaceName: c.list.board.workspace.name,
        departmentId: c.list.board.departmentId,
        departmentName: c.list.board.department?.name ?? null,
        departmentNameAr: c.list.board.department?.nameAr ?? null,
        labelIds: c.labels.map((l) => l.labelId),
        due: c.due ? c.due.toISOString() : null,
        commentCount: c._count.comments,
        checklistDone: done,
        checklistTotal: total,
      };
    });

    // Stats for the sidebar
    const now = Date.now();
    const overdue = tasks.filter((t) => t.due && new Date(t.due).getTime() < now).length;
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const dueToday = tasks.filter((t) => t.due && new Date(t.due) <= todayEnd && new Date(t.due).getTime() >= now).length;
    // Credit a card to the user if they were either assigned to it or were
    // the one who marked it complete. Without the OR, users who finish work
    // they weren't formally assigned to (common for solo creators) score 0.
    const completedThisWeek = await prisma.card.count({
      where: {
        completedAt: { gte: new Date(now - 7 * 24 * 3600_000) },
        list: { board: { archivedAt: null } },
        OR: [
          { members: { some: { userId } } },
          { completedById: userId },
        ],
      },
    });

    return reply.send({
      tasks,
      labelsById,
      stats: {
        total: tasks.length,
        overdue,
        dueToday,
        completedThisWeek,
      },
    });
  });

  // The boards I have visibility on, with my role per workspace.
  app.get('/me/boards', async (request, reply) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: request.userId! },
      include: {
        workspace: { select: { id: true, name: true, slug: true } },
      },
    });

    const boardAccess = await prisma.boardMember.findMany({
      where: { userId: request.userId! },
      select: { boardId: true },
    });
    const boardAccessIds = new Set(boardAccess.map((b) => b.boardId));

    // Per-user star set
    const stars = await prisma.boardStar.findMany({
      where: { userId: request.userId! },
      select: { boardId: true },
    });
    const starredIds = new Set(stars.map((s) => s.boardId));

    const result = [];
    for (const m of memberships) {
      // Guests see no boards in the "my boards" list.
      if (m.role === Role.guest) {
        result.push({ workspace: m.workspace, role: m.role, boards: [] });
        continue;
      }
      // Push the visibility predicate into the query so `take` caps VISIBLE
      // boards. (Filtering AFTER take could hide accessible boards behind 20
      // other-department boards in a busy workspace — they'd vanish from the
      // sidebar.) Mirrors canViewBoard: workspace-wide, own dept, own team, or
      // an explicit board grant.
      const where: Prisma.BoardWhereInput = { workspaceId: m.workspaceId, archivedAt: null };
      if (m.role !== Role.admin) {
        const or: Prisma.BoardWhereInput[] = [{ departmentId: null }];
        if (m.departmentId) or.push({ departmentId: m.departmentId });
        if (m.teamId) or.push({ teamId: m.teamId });
        if (boardAccessIds.size) or.push({ id: { in: [...boardAccessIds] } });
        where.OR = or;
      }
      const boards = await prisma.board.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, hue: true, departmentId: true, teamId: true },
        take: 20,
      });
      result.push({
        workspace: m.workspace,
        role: m.role,
        boards: boards.map((b) => ({ ...b, starred: starredIds.has(b.id) })),
      });
    }

    return reply.send({ workspaces: result });
  });

  // Archived boards across all my workspaces. Visibility follows canViewBoard
  // — admins see every workspace's archive, non-admins see only the boards
  // they would normally have access to (dept-based + explicit grants).
  app.get('/me/archived-boards', async (request, reply) => {
    const userId = request.userId!;
    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true } } },
    });
    if (memberships.length === 0) return reply.send({ boards: [] });

    const explicit = await prisma.boardMember.findMany({
      where: { userId },
      select: { boardId: true },
    });
    const boardAccessIds = new Set(explicit.map((e) => e.boardId));

    const boards = await prisma.board.findMany({
      where: {
        workspaceId: { in: memberships.map((m) => m.workspaceId) },
        archivedAt: { not: null },
      },
      include: {
        department: { select: { id: true, name: true, nameAr: true, hue: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
      },
      orderBy: { archivedAt: 'desc' },
    });

    const membershipByWs = new Map(memberships.map((m) => [m.workspaceId, m]));
    const visible = boards.filter((b) => {
      const m = membershipByWs.get(b.workspaceId);
      if (!m) return false;
      return canViewBoard(
        {
          role: m.role, departmentId: m.departmentId, teamId: m.teamId,
          boardAccessIds,
        },
        { id: b.id, departmentId: b.departmentId, teamId: b.teamId },
      );
    });

    return reply.send({
      boards: visible.map((b) => {
        const m = membershipByWs.get(b.workspaceId)!;
        return {
          id: b.id,
          title: b.title,
          subtitle: b.subtitle,
          hue: b.hue,
          coverUrl: b.coverImagePath ? `/api/boards/${b.id}/cover` : null,
          archivedAt: b.archivedAt!.toISOString(),
          workspaceId: b.workspaceId,
          workspaceName: m.workspace.name,
          departmentId: b.departmentId,
          departmentName: b.department?.name ?? null,
          departmentNameAr: b.department?.nameAr ?? null,
          departmentHue: b.department?.hue ?? null,
          createdBy: b.createdBy ? {
            id: b.createdBy.id,
            name: `${b.createdBy.firstName} ${b.createdBy.lastName}`.trim(),
            avatarColor: b.createdBy.avatarColor,
          } : null,
          viewerRole: m.role,
        };
      }),
    });
  });
}
