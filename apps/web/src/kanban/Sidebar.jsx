import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { api } from '../lib/api.js';
import { activeMembership, canManageWorkspace } from '../state/permissions.js';
import { localizedName } from '../lib/i18n.js';
import { subscribeSocket } from '../lib/socket.js';

export function Sidebar({ theme, rtl }) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const onBoards = location.pathname === '/boards';
  const currentBoardId = location.pathname.startsWith('/b/') ? location.pathname.slice(3) : null;
  const currentDeptId = location.pathname.startsWith('/dept/') ? location.pathname.split('/')[2] : null;

  const m = activeMembership(auth);
  const workspaceId = m?.workspaceId;
  const isAdmin = canManageWorkspace(m);
  const userDeptId = m?.departmentId;
  const [boards, setBoards] = React.useState([]);
  const [depts, setDepts] = React.useState([]);
  const [unread, setUnread] = React.useState({}); // { [deptId]: count }
  const myUserId = auth.user?.id;

  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/workspaces/${workspaceId}/boards`);
        if (!cancelled) setBoards(r.boards || []);
      } catch {
        if (!cancelled) setBoards([]);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, location.pathname]);

  // Admins navigate across departments often — load the full list. Non-admins
  // only see their own dept link in the nav above; no need to fetch.
  React.useEffect(() => {
    if (!workspaceId || !isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/workspaces/${workspaceId}/departments`);
        if (!cancelled) setDepts(r.departments || []);
      } catch {
        if (!cancelled) setDepts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, isAdmin]);

  // Pull initial chat unread counts on mount + on dept-page transitions.
  // Socket events keep the counts live afterwards.
  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        const r = await api('/me/chat-unread');
        if (!cancelled) setUnread(r.counts || {});
      } catch {}
    };
    fetchUnread();
    return () => { cancelled = true; };
  }, [workspaceId, currentDeptId]);

  // Live unread updates: any chat message arriving in a dept that isn't the
  // currently-open one bumps the badge. Messages I author don't count.
  React.useEffect(() => {
    const unsub = subscribeSocket((evt) => {
      if (evt.type !== 'event' || evt.kind !== 'chat:message_added') return;
      const m = evt.payload;
      if (!m?.departmentId) return;
      if (m.authorId === myUserId) return;
      // If the user is currently looking at this dept's chat, don't bump.
      // (DeptChat marks it read on every arrival anyway, and our refetch on
      // currentDeptId change will reset.)
      if (currentDeptId === m.departmentId) return;
      setUnread((prev) => ({
        ...prev,
        [m.departmentId]: (prev[m.departmentId] || 0) + 1,
      }));
    });
    return () => unsub();
  }, [currentDeptId, myUserId]);

  // Build the navigation list dynamically based on what the user can see.
  const navItems = [
    { icon: 'board', label: rtl ? 'اللوحات' : 'Boards', to: '/boards', active: onBoards },
    { icon: 'check', label: rtl ? 'مهامي' : 'My work',  to: '/me',     active: location.pathname === '/me' },
  ];
  // Non-admins: single Department link to their own. Admins get the full
  // collapsible section below instead.
  if (userDeptId && !isAdmin) {
    navItems.push({
      icon: 'board', label: rtl ? 'قسمي' : 'My department',
      to: `/dept/${userDeptId}`, active: location.pathname.startsWith('/dept'),
      badge: unread[userDeptId] || 0,
    });
  }
  // Admin Console only for admins
  if (isAdmin) {
    navItems.push({
      icon: 'settings', label: rtl ? 'الإدارة' : 'Admin console',
      to: '/admin', active: location.pathname === '/admin',
    });
  }

  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: theme.sidebarBg,
      borderInlineEnd: `.5px solid ${theme.border}`,
      padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 4,
      fontSize: 13,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
        color: theme.mutedDim, padding: '8px 10px 6px', textTransform: 'uppercase',
      }}>{rtl ? 'مساحة عمل' : 'Workspace'}</div>
      {navItems.map((it) => {
        const I = Icon[it.icon];
        return (
          <button key={it.label} onClick={() => navigate(it.to)} style={{
            display: 'flex', alignItems: 'center', gap: 9,
            background: it.active ? theme.accentSoft : 'transparent',
            color: it.active ? theme.accent : theme.text,
            border: 'none', padding: '7px 10px', borderRadius: 6,
            fontSize: 13, fontWeight: it.active ? 600 : 500,
            cursor: 'pointer', textAlign: rtl ? 'right' : 'left',
            fontFamily: 'inherit',
          }}>
            <I size={14} />
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.badge > 0 && <UnreadBadge count={it.badge} />}
          </button>
        );
      })}
      {isAdmin && depts.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
            color: theme.mutedDim, padding: '14px 10px 6px', textTransform: 'uppercase',
          }}>{rtl ? 'الأقسام' : 'Departments'}</div>
          {depts.map((d) => {
            const active = currentDeptId === d.id;
            return (
              <button key={d.id} onClick={() => navigate('/dept/' + d.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: active ? theme.accentSoft : 'transparent',
                color: active ? theme.accent : theme.text,
                border: 'none', padding: '7px 10px', borderRadius: 6,
                fontSize: 12.5, fontWeight: active ? 600 : 500,
                cursor: 'pointer', textAlign: rtl ? 'right' : 'left',
                fontFamily: 'inherit',
              }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: `oklch(.78 .12 ${d.hue})`, color: `oklch(.32 .14 ${d.hue})`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>{d.icon || (d.name?.[0] || 'D').toUpperCase()}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {localizedName(d, rtl)}
                </span>
                {(unread[d.id] || 0) > 0 && <UnreadBadge count={unread[d.id]} />}
              </button>
            );
          })}
        </>
      )}
      {boards.length > 0 && (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
            color: theme.mutedDim, padding: '14px 10px 6px', textTransform: 'uppercase',
          }}>{rtl ? 'لوحاتك' : 'Your boards'}</div>
          {boards.slice(0, 5).map((b) => {
            const active = currentBoardId === b.id;
            return (
              <button key={b.id} onClick={() => navigate('/b/' + b.id)} style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: active ? theme.accentSoft : 'transparent',
                color: active ? theme.accent : theme.text,
                border: 'none', padding: '7px 10px', borderRadius: 6,
                fontSize: 12.5, fontWeight: active ? 600 : 500,
                cursor: 'pointer', textAlign: rtl ? 'right' : 'left',
                fontFamily: 'inherit',
              }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: `oklch(0.65 0.13 ${b.hue})`, flexShrink: 0,
                }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.title}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

function UnreadBadge({ count }) {
  return (
    <span style={{
      minWidth: 18, height: 18, borderRadius: 9,
      background: '#DC2626', color: '#fff',
      fontSize: 10, fontWeight: 700,
      padding: '0 5px',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontVariantNumeric: 'tabular-nums', flexShrink: 0,
    }}>{count > 99 ? '99+' : count}</span>
  );
}
