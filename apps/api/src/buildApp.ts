// Factory used by both server.ts (production) and the test suite.
// Tests call buildApp() and then app.inject() — no real port binding needed.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { config, isProd } from './config.js';
import { prisma } from './db.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { authRoutes } from './auth/routes.js';
import { boardsRoutes } from './boards/routes.js';
import { adminRoutes } from './admin/routes.js';
import { inviteRoutes } from './admin/invites.js';
import { meRoutes } from './me/routes.js';
import { searchRoutes } from './me/search.js';
import { userRoutes } from './users/routes.js';
import { attachmentRoutes } from './boards/attachments.js';
import { mediaRoutes } from './media/routes.js';
import { chatRoutes } from './chat/routes.js';
import { notificationRoutes } from './notifications/routes.js';
import { systemRoutes } from './system/routes.js';

export interface BuildOptions {
  silent?: boolean; // suppress log output in tests
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.silent
      ? false
      : (isProd
        ? true
        : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(sensible);
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });

  // Security headers on every response (defense in depth). The file-download
  // routes additionally force a safe content-type + attachment disposition;
  // `default-src 'none'` neuters any HTML/SVG that nonetheless reaches a browser.
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  });

  // Loose global per-IP backstop against request floods. Auth endpoints carry
  // their own tighter limiter (see auth/routes.ts).
  app.addHook('onRequest', createRateLimiter('global', { windowMs: 60_000, max: 600 }));

  // Centralized error handler: log the full error server-side, but never leak
  // internal error text (Prisma/Zod/driver messages) to clients in production.
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      app.log.error(err);
      return reply.code(status).send(
        isProd
          ? { error: 'internal_error', message: 'Something went wrong.' }
          : { error: 'internal_error', message: err.message },
      );
    }
    return reply.code(status).send({ error: err.code ?? 'error', message: err.message });
  });

  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return reply.code(503).send({ ok: false });
    }
    return { ok: true, env: config.NODE_ENV, time: new Date().toISOString() };
  });
  app.get('/', async () => ({ name: 'SarSync API', version: '0.1.0' }));

  await app.register(authRoutes);
  await app.register(boardsRoutes);
  await app.register(adminRoutes);
  await app.register(inviteRoutes);
  await app.register(meRoutes);
  await app.register(searchRoutes);
  await app.register(userRoutes);
  await app.register(attachmentRoutes);
  await app.register(mediaRoutes);
  await app.register(chatRoutes);
  await app.register(notificationRoutes);
  await app.register(systemRoutes);

  return app;
}
