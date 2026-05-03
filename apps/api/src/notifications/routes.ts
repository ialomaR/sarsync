import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // List recent notifications + unread count
  app.get<{ Querystring: { limit?: string } }>('/me/notifications', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit || '30', 10), 100);
    const userId = request.userId!;

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
        },
      }),
      prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ]);

    return reply.send({
      notifications: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.link,
        meta: n.meta,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
        actor: n.actor ? {
          id: n.actor.id,
          name: `${n.actor.firstName} ${n.actor.lastName}`,
          color: n.actor.avatarColor,
        } : null,
      })),
      unreadCount,
    });
  });

  // Mark a single notification as read
  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (request, reply) => {
    const userId = request.userId!;
    const n = await prisma.notification.findUnique({ where: { id: request.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found', message: 'Notification not found' });
    if (n.recipientId !== userId) return reply.code(403).send({ error: 'forbidden', message: 'Not yours' });
    if (!n.readAt) {
      await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    }
    return reply.send({ ok: true });
  });

  // Mark all as read
  app.post('/me/notifications/read-all', async (request, reply) => {
    await prisma.notification.updateMany({
      where: { recipientId: request.userId!, readAt: null },
      data: { readAt: new Date() },
    });
    return reply.send({ ok: true });
  });

  // Delete (clear) a notification
  app.delete<{ Params: { id: string } }>('/notifications/:id', async (request, reply) => {
    const n = await prisma.notification.findUnique({ where: { id: request.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found', message: 'Notification not found' });
    if (n.recipientId !== request.userId) return reply.code(403).send({ error: 'forbidden', message: 'Not yours' });
    await prisma.notification.delete({ where: { id: n.id } });
    return reply.code(204).send();
  });
}
