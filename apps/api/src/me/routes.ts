import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Cards I'm a member of, across all my workspaces.
  app.get('/me/tasks', async (request, reply) => {
    const userId = request.userId!;
    const cards = await prisma.card.findMany({
      where: {
        archivedAt: null,
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
      const boards = await prisma.board.findMany({
        where: { workspaceId: m.workspaceId, archivedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, hue: true, departmentId: true, teamId: true },
        take: 20,
      });
      const visible = boards.filter((b) => {
        if (m.role === Role.admin) return true;
        if (m.role === Role.guest) return false;
        if (b.departmentId == null) return true;
        if (m.departmentId === b.departmentId) return true;
        return boardAccessIds.has(b.id);
      });
      result.push({
        workspace: m.workspace,
        role: m.role,
        boards: visible.map((b) => ({ ...b, starred: starredIds.has(b.id) })),
      });
    }

    return reply.send({ workspaces: result });
  });
}
