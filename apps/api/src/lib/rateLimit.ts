import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

// Lightweight in-memory fixed-window rate limiter — no external dependency and
// no Redis. This is sufficient for the single-instance, self-hosted default.
//
// NOTE: counters live in this process only. For a multi-instance deployment
// (e.g. App Runner scaled > 1), swap this for @fastify/rate-limit backed by the
// Redis that already ships in docker-compose, otherwise each instance enforces
// the limit independently and the effective limit is N × max.
//
// Disabled entirely under NODE_ENV=test so the integration suite (which fires
// many auth requests from 127.0.0.1) isn't throttled.

interface Bucket { count: number; resetAt: number; }

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  // Builds the throttle key from the request. Defaults to the client IP.
  keyGenerator?: (req: FastifyRequest) => string;
}

export function createRateLimiter(name: string, opts: RateLimitOptions) {
  const { windowMs, max } = opts;
  const keyGen = opts.keyGenerator ?? ((req: FastifyRequest) => req.ip);
  const buckets = new Map<string, Bucket>();

  // Evict expired buckets periodically so memory can't grow without bound.
  // unref() keeps this timer from holding the process (or vitest) open.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, windowMs);
  sweeper.unref?.();

  return async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
    if (config.NODE_ENV === 'test') return; // never throttle the test suite

    const now = Date.now();
    const key = `${name}:${keyGen(req)}`;
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    reply.header('X-RateLimit-Limit', String(max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));

    if (b.count > max) {
      const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfter));
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many requests — please slow down and try again later.',
      });
    }
  };
}
