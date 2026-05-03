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
}
