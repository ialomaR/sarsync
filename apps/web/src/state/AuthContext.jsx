import React from 'react';
import { fetchMe, signIn as apiSignIn, signUp as apiSignUp, signOut as apiSignOut, getRefreshToken } from '../lib/api.js';

const AuthCtx = React.createContext(null);
const ACTIVE_WS_KEY = 'sarsync:activeWorkspaceId';

export function AuthProvider({ children }) {
  const [state, setState] = React.useState({
    status: 'loading', // 'loading' | 'authed' | 'guest'
    user: null,
    memberships: [],
    activeWorkspaceId: null,
  });

  // Pick a sensible default active workspace: persisted choice (if still valid) else the first one
  const pickActive = React.useCallback((memberships) => {
    if (!memberships?.length) return null;
    let stored = null;
    try { stored = localStorage.getItem(ACTIVE_WS_KEY); } catch {}
    if (stored && memberships.some((m) => m.workspaceId === stored)) return stored;
    return memberships[0].workspaceId;
  }, []);

  // On mount: if we have a refresh token, hydrate via /auth/me (which will
  // trigger an automatic refresh if the access token is missing/expired).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getRefreshToken()) {
        if (!cancelled) setState({ status: 'guest', user: null, memberships: [], activeWorkspaceId: null });
        return;
      }
      try {
        const me = await fetchMe();
        if (!cancelled) setState({
          status: 'authed', user: me.user, memberships: me.memberships,
          activeWorkspaceId: pickActive(me.memberships),
        });
      } catch {
        if (!cancelled) setState({ status: 'guest', user: null, memberships: [], activeWorkspaceId: null });
      }
    })();
    return () => { cancelled = true; };
  }, [pickActive]);

  const signIn = React.useCallback(async (email, password) => {
    const data = await apiSignIn(email, password);
    setState({
      status: 'authed', user: data.user, memberships: data.memberships,
      activeWorkspaceId: pickActive(data.memberships),
    });
    return data;
  }, [pickActive]);

  const signUp = React.useCallback(async (payload) => {
    const data = await apiSignUp(payload);
    setState({
      status: 'authed', user: data.user, memberships: data.memberships,
      activeWorkspaceId: pickActive(data.memberships),
    });
    return data;
  }, [pickActive]);

  const signOut = React.useCallback(async () => {
    await apiSignOut();
    try { localStorage.removeItem(ACTIVE_WS_KEY); } catch {}
    setState({ status: 'guest', user: null, memberships: [], activeWorkspaceId: null });
  }, []);

  const switchWorkspace = React.useCallback((workspaceId) => {
    setState((s) => {
      if (!s.memberships.some((m) => m.workspaceId === workspaceId)) return s;
      try { localStorage.setItem(ACTIVE_WS_KEY, workspaceId); } catch {}
      return { ...s, activeWorkspaceId: workspaceId };
    });
  }, []);

  const value = React.useMemo(() => ({
    ...state,
    activeMembership: state.memberships.find((m) => m.workspaceId === state.activeWorkspaceId) || state.memberships[0] || null,
    signIn, signUp, signOut, switchWorkspace,
  }), [state, signIn, signUp, signOut, switchWorkspace]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
