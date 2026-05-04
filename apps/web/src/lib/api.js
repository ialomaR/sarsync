// API client with automatic token refresh.
//
// Token storage: access in memory (lost on refresh, refetched via refresh token)
//                refresh in localStorage (persists)
//
// This is a deliberate trade-off — refresh token in localStorage is vulnerable
// to XSS but simplifies the flow. We can move to httpOnly cookies later.

const REFRESH_KEY = 'sarsync:refresh:v1';
const BASE = '/api';

let accessToken = null;
let refreshInFlight = null;  // dedupe concurrent refresh attempts
const subscribers = new Set();

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
  subscribers.forEach((fn) => fn());
}

export function getRefreshToken() {
  try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
}

export function setRefreshToken(token) {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {}
}

export function clearTokens() {
  accessToken = null;
  setRefreshToken(null);
  subscribers.forEach((fn) => fn());
}

export function onAuthChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

async function rawRequest(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  // Only set Content-Type when we actually have a body — Fastify rejects
  // requests that declare application/json but send an empty body (e.g. DELETE).
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  // Tag the originating socket so the server can echo-skip this tab only.
  // Importing lazily to avoid a circular dep with lib/socket.js.
  try {
    const sid = (await import('./socket.js')).getSocketId?.();
    if (sid) headers['X-Socket-Id'] = sid;
  } catch {}
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'omit',
  });
  return res;
}

async function tryRefresh() {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        clearTokens();
        return null;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      return data;
    } catch {
      clearTokens();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api(path, opts = {}) {
  let res = await rawRequest(path, opts);
  if (res.status === 401 && opts._retried !== true) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawRequest(path, { ...opts, _retried: true });
    }
  }
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = { error: 'http_error', message: res.statusText }; }
    const err = new Error(body.message || 'Request failed');
    err.code = body.error;
    err.status = res.status;
    err.details = body.details;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Auth-specific helpers ───────────────────────────────────────────────────

export async function signIn(email, password) {
  const data = await api('/auth/signin', { method: 'POST', body: { email, password } });
  // 2FA-enabled accounts get a challenge token instead of access tokens; the
  // caller is expected to redirect to the OTP screen.
  if (!data.requires2FA) {
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
  }
  return data;
}

export async function signUp(payload) {
  const data = await api('/auth/signup', { method: 'POST', body: payload });
  setAccessToken(data.accessToken);
  setRefreshToken(data.refreshToken);
  return data;
}

export async function signOut() {
  const refreshToken = getRefreshToken();
  try {
    await api('/auth/signout', { method: 'POST', body: { refreshToken: refreshToken || '' } });
  } catch {}
  clearTokens();
}

export async function fetchMe() {
  return api('/auth/me');
}

export async function forgotPassword(email) {
  return api('/auth/forgot-password', { method: 'POST', body: { email } });
}

export async function checkResetToken(token) {
  return api(`/auth/reset-password/check?token=${encodeURIComponent(token)}`);
}

export async function resetPassword(token, password) {
  return api('/auth/reset-password', { method: 'POST', body: { token, password } });
}

export async function verifyEmail(token) {
  return api('/auth/verify-email', { method: 'POST', body: { token } });
}

export async function resendVerificationEmail() {
  return api('/auth/verify-email/resend', { method: 'POST' });
}

// ── 2FA ─────────────────────────────────────────────────────────────────────

export async function setup2FA() {
  return api('/auth/2fa/setup', { method: 'POST' });
}

export async function enable2FA(secret, code) {
  return api('/auth/2fa/enable', { method: 'POST', body: { secret, code } });
}

export async function disable2FA(code) {
  return api('/auth/2fa/disable', { method: 'POST', body: { code } });
}

export async function verify2FA(challengeToken, code) {
  // No bearer header needed — challenge token is the credential here.
  const data = await api('/auth/2fa/verify', { method: 'POST', body: { challengeToken, code } });
  setAccessToken(data.accessToken);
  setRefreshToken(data.refreshToken);
  return data;
}

export async function regenerateBackupCodes() {
  return api('/auth/2fa/backup-codes/regenerate', { method: 'POST' });
}

export async function changePassword(currentPassword, newPassword) {
  const data = await api('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  // Server revokes all refresh tokens and issues a new one for THIS session.
  if (data.refreshToken) setRefreshToken(data.refreshToken);
  return data;
}

// ── Platform admin (isSystemAdmin only) ───────────────────────────────────
export async function fetchSystemStats() {
  return api('/system/stats');
}
export async function fetchSystemWorkspaces() {
  return api('/system/workspaces');
}
export async function issueResetForUser(email) {
  return api('/system/users/issue-reset', { method: 'POST', body: { email } });
}
export async function deleteSystemWorkspace(id) {
  return api(`/system/workspaces/${id}`, { method: 'DELETE' });
}

export async function saveChatAttachmentToMedia(attachmentId) {
  return api(`/chat/attachments/${attachmentId}/save-to-media`, { method: 'POST' });
}

export async function fetchSystemUsers() {
  return api('/system/users');
}
export async function suspendUser(id) {
  return api(`/system/users/${id}/suspend`, { method: 'POST' });
}
export async function unsuspendUser(id) {
  return api(`/system/users/${id}/unsuspend`, { method: 'POST' });
}

export async function fetchDeptKpis(deptId) {
  return api(`/departments/${deptId}/kpis`);
}
