import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// TOTP-based 2FA (RFC 6238). Compatible with Google Authenticator, Authy,
// 1Password, etc. — anything that scans a standard otpauth:// URI.
//
// Backup codes: 10 single-use codes generated when the user enables 2FA.
// They're hashed with bcrypt before storage; the user copies them once on
// enable and can regenerate after losing them.

export interface TwoFactorChallengePayload {
  sub: string;       // user id
  purpose: '2fa';
  iat?: number;
  exp?: number;
}

const CHALLENGE_TTL = '5m';

export function generateSecret(): string {
  // 20 random bytes encoded base32 — same length as Google Authenticator default.
  return otpGenerateSecret({ length: 20 });
}

// otpauth://totp/SarSync:user@example.com?secret=...&issuer=SarSync
export function provisioningUri(email: string, secret: string): string {
  return generateURI({ issuer: 'SarSync', label: email, secret });
}

// Allows ±30s of clock skew between server and authenticator app
// (epochTolerance is in seconds; default TOTP step is 30s).
export function verifyTotp(secret: string, code: string): boolean {
  try {
    const result = verifySync({ token: code.replace(/\s+/g, ''), secret, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

export function signChallengeToken(userId: string): string {
  return jwt.sign(
    { sub: userId, purpose: '2fa' } satisfies TwoFactorChallengePayload,
    config.JWT_SECRET,
    { expiresIn: CHALLENGE_TTL as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyChallengeToken(token: string): { userId: string } {
  const payload = jwt.verify(token, config.JWT_SECRET) as TwoFactorChallengePayload;
  if (payload.purpose !== '2fa' || !payload.sub) throw new Error('invalid_purpose');
  return { userId: payload.sub };
}

// Backup codes. We render them as 10 chunks of 5 base32 characters separated
// by a dash for legibility ("E3F4G-XK7HM"). Stored as bcrypt hashes.
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip 0/O/1/I
  for (let i = 0; i < count; i++) {
    const left = randChunk(alphabet, 5);
    const right = randChunk(alphabet, 5);
    codes.push(`${left}-${right}`);
  }
  return codes;
}

function randChunk(alphabet: string, len: number): string {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
}

// Tries each stored hash against the candidate. On match, returns the
// matched hash so the caller can remove it (single-use).
export async function findBackupCodeHash(stored: string[], candidate: string): Promise<string | null> {
  const cleaned = candidate.toUpperCase().replace(/\s+/g, '');
  for (const h of stored) {
    if (await bcrypt.compare(cleaned, h)) return h;
  }
  return null;
}
