import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

// Visibility-filtered global search across the user's workspaces.
// Matches by board title and card title (case-insensitive substring).

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Querystring: { q?: string; limit?: string } }>('/search', async (request, reply) => {
    const q = (request.query.q || '').trim();
    const limit = Math.min(parseInt(request.query.limit || '12', 10), 30);
    if (q.length < 2) return reply.send({ boards: [], cards: [] });

    const memberships = await prisma.membership.findMany({
      where: { userId: request.userId! },
      select: { workspaceId: true, departmentId: true, role: true },
    });
    if (memberships.length === 0) return reply.send({ boards: [], cards: [] });

    // Boards the user has explicit cross-dept access to
    const boardAccess = await prisma.boardMember.findMany({
      where: { userId: request.userId! },
      select: { boardId: true },
    });
    const boardAccessIds = new Set(boardAccess.map((b) => b.boardId));

    // Flatten visibility scope: workspaces I'm in, plus admin-vs-dept restriction
    const wsIds = memberships.map((m) => m.workspaceId);

    const boards = await prisma.board.findMany({
      where: {
        workspaceId: { in: wsIds },
        archivedAt: null,
        title: { contains: q, mode: 'insensitive' },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { workspace: { select: { name: true, slug: true } } },
    });
    const visibleBoards = boards.filter((b) => {
      const m = memberships.find((x) => x.workspaceId === b.workspaceId);
      if (!m) return false;
      if (m.role === Role.admin) return true;
      if (m.role === Role.guest) return false;
      if (b.departmentId == null) return true;
      if (m.departmentId === b.departmentId) return true;
      return boardAccessIds.has(b.id);
    });

    const cards = await prisma.card.findMany({
      where: {
        archivedAt: null,
        title: { contains: q, mode: 'insensitive' },
        list: {
          board: { workspaceId: { in: wsIds }, archivedAt: null },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: {
        list: {
          include: {
            board: {
              select: {
                id: true, title: true, hue: true, departmentId: true, workspaceId: true,
                workspace: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    const visibleCards = cards.filter((c) => {
      const m = memberships.find((x) => x.workspaceId === c.list.board.workspaceId);
      if (!m) return false;
      if (m.role === Role.admin) return true;
      if (m.role === Role.guest) return false;
      if (c.list.board.departmentId == null) return true;
      if (m.departmentId === c.list.board.departmentId) return true;
      return boardAccessIds.has(c.list.board.id);
    });

    return reply.send({
      boards: visibleBoards.map((b) => ({
        id: b.id, title: b.title, hue: b.hue,
        workspaceName: b.workspace.name,
      })),
      cards: visibleCards.map((c) => ({
        id: c.id, title: c.title, listTitle: c.list.title,
        boardId: c.list.board.id, boardTitle: c.list.board.title, boardHue: c.list.board.hue,
        workspaceName: c.list.board.workspace.name,
      })),
    });
  });
}
