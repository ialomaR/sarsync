import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type Tx = Prisma.TransactionClient | typeof prisma;

// Password reset tokens. Same hash-and-store pattern as refresh tokens —
// the raw token only ever lives in the email link; the DB only sees sha256.
//
// TTL is short (15 min). On consume, we mark the token used AND revoke any
// other unused tokens for the same user, so a leaked email link is single-use.

const RESET_TTL_MS = 15 * 60 * 1000;

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createResetToken(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const { token, tokenHash } = generateResetToken();
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
  });
  return token;
}

export type ResetTokenLookup =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' };

export async function findValidResetToken(rawToken: string): Promise<ResetTokenLookup> {
  const tokenHash = hashResetToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  return { ok: true, userId: row.user.id, email: row.user.email };
}

// Mark this token used and invalidate every other outstanding token + refresh
// token for the user. Run inside the same transaction as the password update
// at the call site.
export async function consumeResetToken(rawToken: string, tx: Tx) {
  const tokenHash = hashResetToken(rawToken);
  const row = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row) throw new Error('reset_token_not_found');
  await tx.passwordResetToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  // Invalidate any other outstanding reset tokens for this user
  await tx.passwordResetToken.updateMany({
    where: { userId: row.userId, usedAt: null, id: { not: row.id } },
    data: { usedAt: new Date() },
  });
  // Revoke all refresh tokens — force re-login everywhere after a reset
  await tx.refreshToken.updateMany({
    where: { userId: row.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return row.userId;
}
