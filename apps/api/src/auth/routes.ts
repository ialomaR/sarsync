import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { config, isProd } from '../config.js';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from './passwords.js';
import {
  signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken,
} from './tokens.js';
import { createResetToken, findValidResetToken, consumeResetToken } from './reset.js';
import { createVerificationToken, findValidVerificationToken, consumeVerificationToken } from './verification.js';
import {
  generateSecret, provisioningUri, verifyTotp,
  signChallengeToken, verifyChallengeToken,
  generateBackupCodes, hashBackupCodes, findBackupCodeHash,
} from './twofactor.js';
import { requireAuth } from './middleware.js';
import { toAuthUser, loadMembershipSummaries } from './serialize.js';
import QRCode from 'qrcode';

// ── Schemas ─────────────────────────────────────────────────────────────────

const SignUp = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  workspaceName: z.string().min(2).max(80),
});

const SignIn = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const Refresh = z.object({
  refreshToken: z.string().min(10),
});

const Forgot = z.object({
  email: z.string().email().max(254),
});

const ResetCheck = z.object({
  token: z.string().min(10).max(200),
});

const ResetPerform = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200),
});

const VerifyEmail = z.object({
  token: z.string().min(10).max(200),
});

const TwoFactorEnable = z.object({
  code: z.string().min(6).max(8),
});

const TwoFactorVerify = z.object({
  challengeToken: z.string().min(10),
  code: z.string().min(6).max(20),  // TOTP 6 digits OR backup code (with dash)
});

const TwoFactorDisable = z.object({
  code: z.string().min(6).max(20),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}

async function uniqueWorkspaceSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/signup', async (request, reply) => {
    const parsed = SignUp.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid request', details: parsed.error.flatten() });
    }
    const { firstName, lastName, email, password, workspaceName } = parsed.data;

    const pwError = validatePasswordStrength(password);
    if (pwError) return reply.code(400).send({ error: 'weak_password', message: pwError });

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return reply.code(409).send({ error: 'email_taken', message: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const slug = await uniqueWorkspaceSlug(slugify(workspaceName));

    const { user } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          firstName,
          lastName,
        },
      });
      const ws = await tx.workspace.create({
        data: { slug, name: workspaceName, hue: 220 },
      });
      // Creator becomes admin of their new workspace
      await tx.membership.create({
        data: { userId: user.id, workspaceId: ws.id, role: Role.admin },
      });
      return { user };
    });

    const accessToken = signAccessToken(user);
    const { refreshToken } = await issueRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    const memberships = await loadMembershipSummaries(user.id);

    // Email verification: create a token and surface the link in dev so
    // testers can verify without running an SMTP server. Prod will mail it.
    const verifyToken = await createVerificationToken(user.id);
    const verifyUrl = `${config.WEB_ORIGIN}/auth/verify?token=${verifyToken}`;
    app.log.info({ email: user.email, url: verifyUrl }, 'email verification link generated');

    return reply.code(201).send({
      accessToken,
      refreshToken,
      user: toAuthUser(user),
      memberships,
      ...(isProd ? {} : { devVerifyUrl: verifyUrl }),
    });
  });

  app.post('/auth/signin', async (request, reply) => {
    const parsed = SignIn.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same response for unknown email vs wrong password to prevent enumeration
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect' });
    }

    // 2FA gate: if the user has TOTP enabled, the password is just step 1.
    // Issue a short-lived challenge token instead of access tokens. The
    // client posts it back to /auth/2fa/verify with the 6-digit code.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const challengeToken = signChallengeToken(user.id);
      return reply.send({ requires2FA: true, challengeToken });
    }

    const accessToken = signAccessToken(user);
    const { refreshToken } = await issueRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    const memberships = await loadMembershipSummaries(user.id);

    return reply.send({
      accessToken,
      refreshToken,
      user: toAuthUser(user),
      memberships,
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = Refresh.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });
    }
    try {
      const next = await rotateRefreshToken(parsed.data.refreshToken, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      const user = await prisma.user.findUnique({ where: { id: next.userId } });
      if (!user) return reply.code(401).send({ error: 'invalid_token', message: 'User no longer exists' });
      const accessToken = signAccessToken(user);
      const memberships = await loadMembershipSummaries(user.id);
      return reply.send({
        accessToken,
        refreshToken: next.refreshToken,
        user: toAuthUser(user),
        memberships,
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'invalid_token';
      return reply.code(401).send({ error: code, message: 'Refresh token invalid or expired' });
    }
  });

  app.post('/auth/signout', async (request, reply) => {
    const parsed = Refresh.safeParse(request.body);
    // Best effort — don't error if token is junk; still return ok.
    if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken);
    return reply.send({ ok: true });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'User not found' });
    const memberships = await loadMembershipSummaries(user.id);
    return reply.send({ user: toAuthUser(user), memberships });
  });

  // ── Password reset ────────────────────────────────────────────────────────
  // Always responds the same shape regardless of whether the email exists,
  // so attackers can't enumerate accounts. In dev we surface the URL inline
  // so the user can complete the flow without email infrastructure.

  app.post('/auth/forgot-password', async (request, reply) => {
    const parsed = Forgot.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });
    }
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    let devUrl: string | undefined;
    if (user) {
      const token = await createResetToken(user.id, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      const url = `${config.WEB_ORIGIN}/auth/reset?token=${token}`;
      // TODO: replace with real email send (SES) when wiring deploy.
      app.log.info({ email, url }, 'password reset link generated');
      if (!isProd) devUrl = url;
    } else {
      app.log.info({ email }, 'password reset requested for unknown email — silently ignored');
    }

    return reply.send({ ok: true, ...(devUrl ? { devUrl } : {}) });
  });

  // Lets the reset screen show whose account they're resetting before the
  // user types a new password — and gives a clean error state for expired
  // / already-used links.
  app.get<{ Querystring: { token?: string } }>('/auth/reset-password/check', async (request, reply) => {
    const parsed = ResetCheck.safeParse({ token: request.query.token });
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Missing or invalid token' });
    }
    const lookup = await findValidResetToken(parsed.data.token);
    if (!lookup.ok) {
      return reply.code(410).send({ error: lookup.reason, message: 'Reset link is invalid or has expired' });
    }
    return reply.send({ ok: true, email: lookup.email });
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const parsed = ResetPerform.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid request', details: parsed.error.flatten() });
    }
    const { token, password } = parsed.data;

    const pwError = validatePasswordStrength(password);
    if (pwError) return reply.code(400).send({ error: 'weak_password', message: pwError });

    const lookup = await findValidResetToken(token);
    if (!lookup.ok) {
      return reply.code(410).send({ error: lookup.reason, message: 'Reset link is invalid or has expired' });
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: lookup.userId }, data: { passwordHash } });
      await consumeResetToken(token, tx);
    });

    return reply.send({ ok: true });
  });

  // ── Email verification ───────────────────────────────────────────────────

  app.post('/auth/verify-email', async (request, reply) => {
    const parsed = VerifyEmail.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: 'Missing token' });
    }
    const lookup = await findValidVerificationToken(parsed.data.token);
    if (!lookup.ok) {
      return reply.code(410).send({ error: lookup.reason, message: 'Verification link is invalid or has expired' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: lookup.userId },
        data: { emailVerified: new Date() },
      });
      await consumeVerificationToken(parsed.data.token, tx);
    });
    return reply.send({ ok: true, email: lookup.email });
  });

  // Resend (auth required — only the authenticated user can ask for a new link)
  app.post('/auth/verify-email/resend', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (user.emailVerified) {
      return reply.send({ ok: true, alreadyVerified: true });
    }
    const token = await createVerificationToken(user.id);
    const url = `${config.WEB_ORIGIN}/auth/verify?token=${token}`;
    app.log.info({ email: user.email, url }, 'email verification link re-issued');
    return reply.send({ ok: true, ...(isProd ? {} : { devUrl: url }) });
  });

  // ── 2FA setup / enable / disable / verify ────────────────────────────────

  // Step 1: server generates a fresh secret + QR. The secret is NOT persisted
  // until the user confirms with a valid code via /enable.
  app.post('/auth/2fa/setup', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (user.twoFactorEnabled) {
      return reply.code(409).send({ error: 'already_enabled', message: '2FA is already enabled' });
    }
    const secret = generateSecret();
    const otpauth = provisioningUri(user.email, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 240 });
    return reply.send({ secret, otpauth, qrDataUrl });
  });

  // Step 2: confirm with a code generated by the auth app, plus the secret
  // we just handed out. We accept the secret via the body — the client never
  // gets a server-side draft, which avoids needing a "pending secret" column.
  app.post<{ Body: { secret?: string; code?: string } }>('/auth/2fa/enable', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (user.twoFactorEnabled) return reply.code(409).send({ error: 'already_enabled' });

    const secret = (request.body?.secret || '').trim();
    const code = (request.body?.code || '').trim();
    if (!secret || !code) {
      return reply.code(400).send({ error: 'validation_error', message: 'secret and code are required' });
    }
    if (!verifyTotp(secret, code)) {
      return reply.code(400).send({ error: 'invalid_code', message: 'The code is invalid. Try again.' });
    }

    // Generate backup codes; show them ONCE in the response.
    const backupCodes = generateBackupCodes(10);
    const hashes = await hashBackupCodes(backupCodes);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorBackupCodes: hashes as unknown as object,
      },
    });
    return reply.send({ ok: true, backupCodes });
  });

  // Disable: requires a valid code (or backup code) to prevent a stolen
  // session from turning off 2FA without the second factor.
  app.post('/auth/2fa/disable', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TwoFactorDisable.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return reply.code(409).send({ error: 'not_enabled' });
    }

    const code = parsed.data.code.trim();
    let ok = verifyTotp(user.twoFactorSecret, code);
    if (!ok && Array.isArray(user.twoFactorBackupCodes)) {
      const matched = await findBackupCodeHash(user.twoFactorBackupCodes as unknown as string[], code);
      ok = !!matched;
    }
    if (!ok) return reply.code(400).send({ error: 'invalid_code', message: 'Invalid code' });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null as unknown as object },
    });
    return reply.send({ ok: true });
  });

  // Step in the sign-in flow when the user has 2FA. Exchanges challenge +
  // TOTP code (or backup code) for real access/refresh tokens.
  app.post('/auth/2fa/verify', async (request, reply) => {
    const parsed = TwoFactorVerify.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });

    let userId: string;
    try {
      ({ userId } = verifyChallengeToken(parsed.data.challengeToken));
    } catch {
      return reply.code(401).send({ error: 'invalid_challenge', message: 'Challenge expired — sign in again' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return reply.code(409).send({ error: 'not_enabled' });
    }

    const code = parsed.data.code.trim();
    let ok = verifyTotp(user.twoFactorSecret, code);
    let usedBackup = false;
    let matchedHash: string | null = null;
    if (!ok && Array.isArray(user.twoFactorBackupCodes)) {
      matchedHash = await findBackupCodeHash(user.twoFactorBackupCodes as unknown as string[], code);
      if (matchedHash) { ok = true; usedBackup = true; }
    }
    if (!ok) return reply.code(401).send({ error: 'invalid_code', message: 'Invalid code' });

    // Consume the backup code so it can't be reused
    if (usedBackup && matchedHash) {
      const remaining = (user.twoFactorBackupCodes as unknown as string[]).filter((h) => h !== matchedHash);
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorBackupCodes: remaining as unknown as object },
      });
    }

    const accessToken = signAccessToken(user);
    const { refreshToken } = await issueRefreshToken(user.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    const memberships = await loadMembershipSummaries(user.id);
    return reply.send({
      accessToken, refreshToken,
      user: toAuthUser(user), memberships,
      ...(usedBackup ? { usedBackupCode: true } : {}),
    });
  });

  // Backup codes — list count + regenerate. Doesn't expose the codes; that
  // happens once on enable. Regenerate returns the new codes.
  app.post('/auth/2fa/backup-codes/regenerate', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId! } });
    if (!user || !user.twoFactorEnabled) return reply.code(409).send({ error: 'not_enabled' });
    const codes = generateBackupCodes(10);
    const hashes = await hashBackupCodes(codes);
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorBackupCodes: hashes as unknown as object },
    });
    return reply.send({ backupCodes: codes });
  });
}
