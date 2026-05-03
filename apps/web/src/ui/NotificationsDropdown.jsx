import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverHeader } from './Popover.jsx';
import { Icon } from './Icon.jsx';

const NOTIF_LABELS = {
  card_assigned:    { en: 'assigned you to', ar: 'عيّنك على' },
  comment_added:    { en: 'commented on',     ar: 'علّق على' },
  invite_accepted:  { en: 'joined the workspace', ar: 'انضم إلى المساحة' },
};

function formatAgo(iso, rtl) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return rtl ? 'الآن' : 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}${rtl ? 'د' : 'm'}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${rtl ? 'س' : 'h'}`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}${rtl ? 'ي' : 'd'}`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsDropdown({ theme, rtl, anchorRef, open, onClose, items, unreadCount, onMarkRead, onMarkAllRead }) {
  const navigate = useNavigate();

  const onClick = (n) => {
    if (!n.readAt) onMarkRead(n.id);
    if (n.link) navigate(n.link);
    onClose();
  };

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} theme={theme} width={360} align="end">
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: 8, borderBottom: `.5px solid ${theme.border}`, marginBottom: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
          {rtl ? 'الإشعارات' : 'Notifications'}
          {unreadCount > 0 && (
            <span style={{ marginInlineStart: 6, fontSize: 11, color: theme.accent, fontWeight: 600 }}>
              · {unreadCount}
            </span>
          )}
        </span>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: theme.accent, fontSize: 11, fontWeight: 600,
            padding: '2px 6px', fontFamily: 'inherit',
          }}>{rtl ? 'تعليم الكل كمقروء' : 'Mark all read'}</button>
        )}
      </div>

      <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {items.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
            {rtl ? 'لا توجد إشعارات بعد' : 'No notifications yet'}
          </div>
        )}
        {items.map((n) => {
          const lbl = NOTIF_LABELS[n.kind] || { en: n.kind, ar: n.kind };
          const verb = rtl ? lbl.ar : lbl.en;
          const isUnread = !n.readAt;
          return (
            <button key={n.id} onClick={() => onClick(n)} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 8px', borderRadius: 6,
              background: isUnread ? theme.accentSoft : 'transparent',
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'start',
              borderInlineStart: isUnread ? `3px solid ${theme.accent}` : '3px solid transparent',
            }}
            onMouseEnter={(e) => { if (!isUnread) e.currentTarget.style.background = theme.surface2; }}
            onMouseLeave={(e) => { if (!isUnread) e.currentTarget.style.background = 'transparent'; }}>
              {n.actor ? (
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: n.actor.color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>{n.actor.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
              ) : (
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: theme.surface2, color: theme.muted,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><Icon.bell size={13} /></div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.4 }}>
                  {n.actor && <strong style={{ fontWeight: 600 }}>{n.actor.name}</strong>}
                  {' '}<span>{verb}</span>{' '}
                  <strong style={{ fontWeight: 600 }}>{n.title.replace(/^(assigned you to |commented on |joined the workspace|عيّنك على |علّق على |انضم إلى المساحة)/, '')}</strong>
                </div>
                {n.body && (
                  <div style={{
                    fontSize: 11.5, color: theme.muted, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{n.body}</div>
                )}
                <div style={{ fontSize: 10.5, color: theme.mutedDim, marginTop: 3 }}>
                  {formatAgo(n.createdAt, rtl)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
