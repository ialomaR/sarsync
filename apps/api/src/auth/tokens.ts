import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';

export interface AccessTokenPayload {
  sub: string;       // user id
  email: string;
  iat?: number;
  exp?: number;
}

export function signAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email } satisfies AccessTokenPayload,
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
}

// Refresh tokens: opaque random strings, hashed in DB.
// We rotate on every refresh — the old token is revoked, a new one issued.
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function ttlToMs(ttl: string): number {
  // Accepts "30d", "12h", "15m", "60s"
  const m = ttl.match(/^(\d+)([dhms])$/);
  if (!m) throw new Error(`Bad TTL: ${ttl}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const factor = unit === 'd' ? 86400_000 : unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 1000;
  return n * factor;
}

export async function issueRefreshToken(userId: string, meta?: { userAgent?: string; ip?: string }) {
  const { token, tokenHash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + ttlToMs(config.JWT_REFRESH_TTL));
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    },
  });
  return { refreshToken: token, expiresAt };
}

export async function rotateRefreshToken(rawToken: string, meta?: { userAgent?: string; ip?: string }) {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) throw new Error('refresh_token_not_found');
  if (existing.revokedAt) throw new Error('refresh_token_revoked');
  if (existing.expiresAt < new Date()) throw new Error('refresh_token_expired');

  // Revoke old, issue new in a transaction.
  const next = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const { token, tokenHash: newHash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + ttlToMs(config.JWT_REFRESH_TTL));
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: newHash,
        expiresAt,
        userAgent: meta?.userAgent ?? null,
        ip: meta?.ip ?? null,
      },
    });
    return { userId: existing.userId, refreshToken: token, expiresAt };
  });
  return next;
}

export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
