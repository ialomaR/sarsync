import { describe, it, expect } from 'vitest';
import { getApp, withCleanDb, signupUser, authHeader } from './helpers.js';

describe('auth', () => {
  withCleanDb();

  it('signup creates a user, workspace, and admin membership', async () => {
    const app = await getApp();
    const u = await signupUser(app, { firstName: 'Alice', workspace: 'Test Co' });
    expect(u.accessToken).toBeTruthy();
    expect(u.refreshToken).toBeTruthy();
    expect(u.membership.role).toBe('admin');
  });

  it('signin with the wrong password returns 401', async () => {
    const app = await getApp();
    const u = await signupUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signin',
      payload: { email: u.email, password: 'totally-wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('signin with an unknown email returns the same 401 (no enumeration)', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signin',
      payload: { email: 'nobody@example.com', password: 'anything' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('refresh rotates the refresh token', async () => {
    const app = await getApp();
    const u = await signupUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(u.refreshToken);
    // Old token must now fail
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('forgot-password silently ignores unknown emails', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.devUrl).toBeUndefined();
  });

  it('forgot-password returns a dev URL for known emails (in dev mode)', async () => {
    const app = await getApp();
    const u = await signupUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: u.email },
    });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.devUrl).toMatch(/\/auth\/reset\?token=/);
  });

  it('/auth/me returns boardAccessIds in the membership summary', async () => {
    const app = await getApp();
    const u = await signupUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeader(u.accessToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.memberships[0].boardAccessIds).toEqual([]);
  });
});
