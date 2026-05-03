import React from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { subscribeSocket } from '../lib/socket.js';

// Lightweight polling hook for the bell dropdown.
// Until Socket.io is wired up, we refresh every 60s while signed in.
const POLL_INTERVAL = 60_000;

export function useNotifications() {
  const auth = useAuth();
  const [state, setState] = React.useState({ items: [], unreadCount: 0, loading: true });

  const refetch = React.useCallback(async () => {
    if (auth.status !== 'authed') return;
    try {
      const r = await api('/me/notifications?limit=30');
      setState({ items: r.notifications, unreadCount: r.unreadCount, loading: false });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [auth.status]);

  React.useEffect(() => {
    if (auth.status !== 'authed') {
      setState({ items: [], unreadCount: 0, loading: false });
      return;
    }
    refetch();
    const t = setInterval(refetch, POLL_INTERVAL);
    // Subscribe to live notifications via socket
    const unsub = subscribeSocket((evt) => {
      if (evt.type === 'event' && evt.kind === 'notification:new') {
        setState((s) => ({
          items: [evt.payload, ...s.items].slice(0, 30),
          unreadCount: s.unreadCount + 1,
          loading: false,
        }));
      }
    });
    return () => { clearInterval(t); unsub(); };
  }, [auth.status, refetch]);

  const markRead = React.useCallback(async (id) => {
    setState((s) => ({
      ...s,
      items: s.items.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
    try { await api(`/notifications/${id}/read`, { method: 'POST' }); } catch {}
  }, []);

  const markAllRead = React.useCallback(async () => {
    setState((s) => ({
      ...s,
      items: s.items.map((n) => n.readAt ? n : { ...n, readAt: new Date().toISOString() }),
      unreadCount: 0,
    }));
    try { await api('/me/notifications/read-all', { method: 'POST' }); } catch {}
  }, []);

  return {
    items: state.items,
    unreadCount: state.unreadCount,
    loading: state.loading,
    refetch, markRead, markAllRead,
  };
}
