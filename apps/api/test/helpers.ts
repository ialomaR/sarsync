// Shared utilities for integration tests. Builds the Fastify app once per
// describe-block and truncates all user data before each test so each test
// starts with a clean DB.

import { afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../src/buildApp.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth/passwords.js';

let cachedApp: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;
  cachedApp = await buildApp({ silent: true });
  await cachedApp.ready();
  return cachedApp;
}

// Tear down the cached app after a test file finishes. Vitest runs setup
// hooks per file, so this is per-file scope.
export function withCleanDb() {
  beforeEach(async () => {
    // Truncate in dependency-safe order. Workspaces and users cascade most
    // child rows. Notifications + ChatRead + BoardStar are global enough
    // to truncate explicitly.
    await prisma.$transaction([
      prisma.notification.deleteMany({}),
      prisma.boardStar.deleteMany({}),
      prisma.chatRead.deleteMany({}),
      prisma.passwordResetToken.deleteMany({}),
      prisma.refreshToken.deleteMany({}),
      prisma.workspace.deleteMany({}),
      prisma.user.deleteMany({}),
    ]);
  });
  afterAll(async () => {
    if (cachedApp) await cachedApp.close();
    cachedApp = null;
    await prisma.$disconnect();
  });
}

// ── Fixture builders ─────────────────────────────────────────────────────

export interface FixtureUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  membership: { id: string; workspaceId: string; role: Role; departmentId: string | null; teamId: string | null };
}

let counter = 0;
function nextSlug(prefix: string) { return `${prefix}-${Date.now()}-${++counter}`; }

// Sign up a new user via the public endpoint — gives us a real workspace and
// admin membership in one call. Returns access/refresh tokens.
export async function signupUser(app: FastifyInstance, opts: { firstName?: string; workspace?: string } = {}): Promise<FixtureUser> {
  const email = `${nextSlug('u')}@test.local`;
  const password = 'TestPass2026!';
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {
      firstName: opts.firstName || 'Test',
      lastName: 'User',
      email, password,
      workspaceName: opts.workspace || `WS ${nextSlug('w')}`,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json() as { accessToken: string; refreshToken: string; user: { id: string }; memberships: Array<{ id: string; workspaceId: string; role: Role; departmentId: string | null; teamId: string | null }> };
  return {
    id: body.user.id,
    email, password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    membership: body.memberships[0],
  };
}

// Add a second user directly to the same workspace via DB (the real invite
// flow needs an email round-trip). Returns tokens via signin.
export async function addMember(app: FastifyInstance, workspaceId: string, opts: {
  role?: Role; departmentId?: string | null; teamId?: string | null; firstName?: string;
} = {}): Promise<FixtureUser> {
  const email = `${nextSlug('m')}@test.local`;
  const password = 'TestPass2026!';
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email, passwordHash,
      firstName: opts.firstName || 'Mate',
      lastName: 'Member',
    },
  });
  const ms = await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId,
      role: opts.role ?? Role.member,
      departmentId: opts.departmentId ?? null,
      teamId: opts.teamId ?? null,
    },
  });
  const signin = await app.inject({ method: 'POST', url: '/auth/signin', payload: { email, password } });
  const body = signin.json() as { accessToken: string; refreshToken: string };
  return {
    id: user.id,
    email, password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    membership: { id: ms.id, workspaceId, role: ms.role, departmentId: ms.departmentId, teamId: ms.teamId },
  };
}

// Auth header helper.
export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}
