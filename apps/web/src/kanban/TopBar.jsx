import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon.jsx';
import { iconBtn } from '../ui/theme.js';
import { useAuth } from '../state/AuthContext.jsx';
import { useNotifications } from '../state/useNotifications.js';
import { NotificationsDropdown } from '../ui/NotificationsDropdown.jsx';
import { api } from '../lib/api.js';
import { subscribeSocket } from '../lib/socket.js';

export function TopBar({ theme, board, rtl, onOpenSettings, onOpenSearch, showMenuButton, onOpenMenu }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const wrapperRef = React.useRef(null);
  const bellRef = React.useRef(null);
  const notifs = useNotifications();

  React.useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const u = auth.user;
  const initials = u ? (u.firstName?.[0] || '') + (u.lastName?.[0] || '') : '';
  const ws = auth.activeMembership || auth.memberships[0];
  const wsRef = React.useRef(null);
  const [wsMenuOpen, setWsMenuOpen] = React.useState(false);
  React.useEffect(() => {
    if (!wsMenuOpen) return;
    const onClick = (e) => {
      if (wsRef.current && !wsRef.current.contains(e.target)) setWsMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [wsMenuOpen]);

  const onSignOut = async () => {
    setMenuOpen(false);
    await auth.signOut();
    navigate('/auth/signin', { replace: true });
  };

  return (
    <div style={{
      height: 52, flexShrink: 0,
      background: theme.headerBg,
      borderBottom: `.5px solid ${theme.border}`,
      display: 'flex', alignItems: 'center',
      padding: '0 12px', gap: 10,
    }}>
      {showMenuButton && (
        <button onClick={onOpenMenu} aria-label="Open menu" style={{
          ...iconBtn(theme), padding: 7,
          fontSize: 16, lineHeight: 1,
        }}>☰</button>
      )}
      <Link to="/boards" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 14, fontWeight: 700, color: theme.text,
        letterSpacing: '-.01em', textDecoration: 'none',
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: theme.accent, color: theme.accentText,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>S</span>
        <span>SarSync</span>
      </Link>
      {(board || ws) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          color: theme.muted, fontSize: 13, marginInlineStart: 12,
        }}>
          <div ref={wsRef} style={{ position: 'relative' }}>
            <button onClick={() => setWsMenuOpen((v) => !v)} disabled={(auth.memberships?.length ?? 0) < 2} style={{
              background: 'transparent', border: 'none', cursor: (auth.memberships?.length ?? 0) < 2 ? 'default' : 'pointer',
              color: theme.muted, fontSize: 13, padding: '2px 6px', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { if ((auth.memberships?.length ?? 0) >= 2) e.currentTarget.style.background = theme.surface2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <span>{ws?.workspaceName || 'Workspace'}</span>
              {(auth.memberships?.length ?? 0) >= 2 && <span style={{ fontSize: 9, opacity: .6 }}>▾</span>}
            </button>
            {wsMenuOpen && (
              <div style={{
                position: 'absolute', insetInlineStart: 0, top: 28, zIndex: 40,
                minWidth: 220, padding: 6,
                background: theme.surface, color: theme.text,
                border: `.5px solid ${theme.border}`, borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,.18)',
              }}>
                <div style={{
                  padding: '6px 10px',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                  color: theme.mutedDim, textTransform: 'uppercase',
                }}>{rtl ? 'مساحات العمل' : 'Workspaces'}</div>
                {auth.memberships.map((m) => {
                  const active = m.workspaceId === ws?.workspaceId;
                  return (
                    <button key={m.id} onClick={() => {
                      auth.switchWorkspace(m.workspaceId);
                      setWsMenuOpen(false);
                      navigate('/boards');
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '8px 10px', borderRadius: 5,
                      background: active ? theme.accentSoft : 'transparent',
                      border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: active ? 600 : 500,
                      color: active ? theme.accent : theme.text,
                      textAlign: 'start', fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.surface2; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 5,
                        background: `oklch(.86 .14 ${m.workspaceHue})`, flexShrink: 0,
                        color: `oklch(.32 .16 ${m.workspaceHue})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                      }}>{m.workspaceName[0]}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.workspaceName}</div>
                        <div style={{ fontSize: 10.5, color: theme.muted }}>{m.role.replace('_', ' ')}</div>
                      </div>
                      {active && <span style={{ fontSize: 12 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {board && (
            <>
              <span style={{ opacity: .5 }}>/</span>
              <span style={{ color: theme.text, fontWeight: 600 }}>{board.title}</span>
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <button onClick={onOpenSearch}
        className="topbar-search"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: theme.name === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)',
          padding: '6px 10px', borderRadius: 7, color: theme.muted, fontSize: 12.5,
          width: 220, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          textAlign: 'start',
        }}>
        <Icon.search />
        <span className="topbar-search-text" style={{ flex: 1 }}>{rtl ? 'ابحث…' : 'Search…'}</span>
        <span className="topbar-search-kbd" style={{
          fontSize: 10, padding: '1px 5px',
          background: theme.name === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
          borderRadius: 3, fontFamily: 'ui-monospace, monospace',
        }}>⌘K</span>
      </button>
      <DeptShortcut theme={theme} rtl={rtl} kind="chat" />
      <DeptShortcut theme={theme} rtl={rtl} kind="media" />
      <button style={{ ...iconBtn(theme), padding: 7 }} onClick={onOpenSettings} title="Settings">
        <Icon.settings />
      </button>
      <div style={{ position: 'relative' }}>
        <button ref={bellRef} onClick={() => setNotifOpen((v) => !v)}
          style={{ ...iconBtn(theme), padding: 7 }}
          title={rtl ? 'الإشعارات' : 'Notifications'}>
          <Icon.bell />
        </button>
        {notifs.unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, insetInlineEnd: 2,
            minWidth: 16, height: 16, padding: '0 4px',
            background: '#DC2626', color: '#fff',
            borderRadius: 8, fontSize: 9.5, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
            border: `1.5px solid ${theme.headerBg}`,
          }}>{notifs.unreadCount > 99 ? '99+' : notifs.unreadCount}</span>
        )}
      </div>
      <NotificationsDropdown theme={theme} rtl={rtl}
        anchorRef={bellRef}
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        items={notifs.items}
        unreadCount={notifs.unreadCount}
        onMarkRead={notifs.markRead}
        onMarkAllRead={notifs.markAllRead} />
      <div ref={wrapperRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Account menu"
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: u?.avatarColor || theme.accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: `2px solid ${theme.headerBg}`, padding: 0,
            fontFamily: 'inherit',
          }}>{initials}</button>
        {menuOpen && (
          <div style={{
            position: 'absolute', insetInlineEnd: 0, top: 38, zIndex: 40,
            minWidth: 220, padding: 6,
            background: theme.surface, color: theme.text,
            border: `.5px solid ${theme.border}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
          }}>
            <div style={{ padding: '8px 10px 10px', borderBottom: `.5px solid ${theme.border}`, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{u?.firstName} {u?.lastName}</div>
              <div style={{ fontSize: 11.5, color: theme.muted }}>{u?.email}</div>
            </div>
            {u?.id && (
              <button onClick={() => { setMenuOpen(false); navigate(`/u/${u.id}`); }} style={{
                width: '100%', padding: '8px 10px', borderRadius: 5,
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, color: theme.text,
                textAlign: rtl ? 'right' : 'left',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = theme.surface2}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                {rtl ? 'ملفي الشخصي' : 'My profile'}
              </button>
            )}
            <button onClick={onSignOut} style={{
              width: '100%', padding: '8px 10px', borderRadius: 5,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, color: theme.text,
              textAlign: rtl ? 'right' : 'left',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = theme.surface2}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              {rtl ? 'تسجيل الخروج' : 'Sign out'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Quick-access topbar button for the user's department chat / media library.
// Shown only when the user has a department (admins navigate via the sidebar).
// Chat variant carries a live unread badge driven by the same /me/chat-unread
// + chat:message_added signal as the sidebar.
function DeptShortcut({ theme, rtl, kind }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const m = auth.activeMembership;
  const deptId = m?.departmentId;
  const myUserId = auth.user?.id;
  const [unread, setUnread] = React.useState(0);

  React.useEffect(() => {
    if (!deptId || kind !== 'chat') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api('/me/chat-unread');
        if (!cancelled) setUnread(r.counts?.[deptId] || 0);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [deptId, kind]);

  React.useEffect(() => {
    if (!deptId || kind !== 'chat') return;
    const unsub = subscribeSocket((evt) => {
      if (evt.type !== 'event' || evt.kind !== 'chat:message_added') return;
      const msg = evt.payload;
      if (msg?.departmentId !== deptId) return;
      if (msg.authorId === myUserId) return;
      // If the user is on the dept chat tab right now, the chat itself is
      // marking-read — let the count reflect that on next focus.
      const onChatTab = window.location.pathname.startsWith('/dept/' + deptId)
        && new URLSearchParams(window.location.search).get('tab') === 'chat';
      if (onChatTab) return;
      setUnread((c) => c + 1);
    });
    return () => unsub();
  }, [deptId, myUserId, kind]);

  if (!deptId) return null;

  const tab = kind === 'chat' ? 'chat' : 'media';
  const title = kind === 'chat'
    ? (rtl ? 'شات القسم' : 'Department chat')
    : (rtl ? 'مكتبة الميديا' : 'Media library');
  const I = kind === 'chat' ? Icon.chat : Icon.folder;

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => { setUnread(0); navigate(`/dept/${deptId}?tab=${tab}`); }}
        style={{ ...iconBtn(theme), padding: 7 }}
        title={title}>
        <I />
      </button>
      {kind === 'chat' && unread > 0 && (
        <span style={{
          position: 'absolute', top: 2, insetInlineEnd: 2,
          minWidth: 16, height: 16, padding: '0 4px',
          background: '#DC2626', color: '#fff',
          borderRadius: 8, fontSize: 9.5, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontVariantNumeric: 'tabular-nums', pointerEvents: 'none',
          border: `1.5px solid ${theme.headerBg}`,
        }}>{unread > 99 ? '99+' : unread}</span>
      )}
    </div>
  );
}
