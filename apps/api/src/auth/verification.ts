import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// Email verification tokens. Same hashed-token pattern as password reset:
// the raw token only ever lives in the email link; the DB only stores sha256.
//
// TTL is 24h (longer than reset since users sometimes verify days after
// signup). Single-use: any other unused tokens for the same user are
// invalidated when one is consumed.

const TTL_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient | typeof prisma;

export function generateVerificationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashVerificationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createVerificationToken(userId: string) {
  const { token, tokenHash } = generateVerificationToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return token;
}

export type VerificationLookup =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' };

export async function findValidVerificationToken(rawToken: string): Promise<VerificationLookup> {
  const tokenHash = hashVerificationToken(rawToken);
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, emailVerified: true } } },
  });
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  return { ok: true, userId: row.user.id, email: row.user.email };
}

export async function consumeVerificationToken(rawToken: string, tx: Tx) {
  const tokenHash = hashVerificationToken(rawToken);
  const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!row) throw new Error('verification_token_not_found');
  await tx.emailVerificationToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  // Mark any other unused tokens for this user used too — single-use semantics
  // when a user requests several "resend" links.
  await tx.emailVerificationToken.updateMany({
    where: { userId: row.userId, usedAt: null, id: { not: row.id } },
    data: { usedAt: new Date() },
  });
  return row.userId;
}
