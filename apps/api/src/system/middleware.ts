import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

// Gate platform-admin endpoints. requireAuth must run before this (it sets
// request.userId). We reload the user fresh each time — the flag is too
// sensitive to trust a stale cache.
export async function requireSystemAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.userId) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const u = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { isSystemAdmin: true },
  });
  if (!u?.isSystemAdmin) {
    return reply.code(403).send({ error: 'forbidden', message: 'Platform admin only' });
  }
}
