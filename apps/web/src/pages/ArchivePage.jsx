import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { buildTheme } from '../ui/theme.js';
import { Icon } from '../ui/Icon.jsx';
import { api, getAccessToken } from '../lib/api.js';
import { localizedName } from '../lib/i18n.js';

function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

export function ArchivePage() {
  return (
    <AppShell>
      <ArchiveContent />
    </AppShell>
  );
}

function ArchiveContent() {
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  const rtl = s.rtl;
  const navigate = useNavigate();

  const [state, setState] = React.useState({ status: 'loading', boards: [], error: null });
  const [busyId, setBusyId] = React.useState(null);

  const refetch = React.useCallback(async () => {
    setState((p) => ({ ...p, status: 'loading' }));
    try {
      const r = await api('/me/archived-boards');
      setState({ status: 'ready', boards: r.boards || [], error: null });
    } catch (err) {
      setState({ status: 'error', boards: [], error: err });
    }
  }, []);

  React.useEffect(() => { refetch(); }, [refetch]);

  const restore = async (b) => {
    setBusyId(b.id);
    try {
      await api(`/boards/${b.id}/archive`, { method: 'DELETE' });
      setState((p) => ({ ...p, boards: p.boards.filter((x) => x.id !== b.id) }));
    } catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const remove = async (b) => {
    if (!confirm(rtl
      ? `حذف اللوحة "${b.title}" نهائياً؟ لا يمكن التراجع.`
      : `Permanently delete "${b.title}"? This cannot be undone.`)) return;
    setBusyId(b.id);
    try {
      await api(`/boards/${b.id}`, { method: 'DELETE' });
      setState((p) => ({ ...p, boards: p.boards.filter((x) => x.id !== b.id) }));
    } catch (err) { alert(err.message); }
    finally { setBusyId(null); }
  };

  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'auto',
      background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr',
    }}>
      <div style={{ padding: '28px 28px 40px', maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>
            {rtl ? 'مساحة العمل' : 'Workspace'}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', margin: 0, color: theme.text }}>
            {rtl ? 'الأرشيف' : 'Archive'}
          </h1>
          <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
            {rtl
              ? 'اللوحات المؤرشفة. استعدها لتظهر في القائمة الرئيسية أو احذفها نهائياً.'
              : 'Archived boards. Restore to send them back to the main list, or delete permanently.'}
          </div>
        </div>

        {state.status === 'loading' && (
          <div style={{ padding: 40, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
            {rtl ? 'جاري التحميل…' : 'Loading…'}
          </div>
        )}
        {state.status === 'error' && (
          <div style={{ padding: 40, textAlign: 'center', color: '#DC2626', fontSize: 13 }}>
            {state.error?.message || (rtl ? 'فشل التحميل' : 'Failed to load')}
          </div>
        )}
        {state.status === 'ready' && state.boards.length === 0 && (
          <div style={{
            padding: 60, textAlign: 'center', color: theme.muted,
            background: theme.surface, borderRadius: theme.radius,
            border: `.5px dashed ${theme.border}`,
          }}>
            <Icon.board size={28} />
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, color: theme.text }}>
              {rtl ? 'لا توجد لوحات مؤرشفة' : 'No archived boards'}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {rtl ? 'اللوحات اللي تؤرشفها ستظهر هنا.' : 'Boards you archive will show up here.'}
            </div>
          </div>
        )}
        {state.status === 'ready' && state.boards.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12,
          }}>
            {state.boards.map((b) => {
              const canManage = b.viewerRole === 'admin'
                || b.viewerRole === 'dept_manager'
                || b.viewerRole === 'team_lead';
              const canDelete = b.viewerRole === 'admin';
              const grad = `linear-gradient(135deg, oklch(0.72 0.14 ${b.hue}), oklch(0.55 0.18 ${b.hue + 20}))`;
              const busy = busyId === b.id;
              return (
                <div key={b.id} style={{
                  background: theme.surface, borderRadius: theme.radius,
                  boxShadow: theme.shadow, overflow: 'hidden',
                  border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
                  opacity: busy ? 0.55 : 1, transition: 'opacity .15s',
                }}>
                  <div style={{
                    height: 56, position: 'relative',
                    background: b.coverUrl
                      ? `url(${withToken(b.coverUrl)}) center/cover, ${grad}`
                      : grad,
                  }}>
                    <span style={{
                      position: 'absolute', insetInlineStart: 8, top: 8,
                      fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em',
                      color: 'rgba(255,255,255,.92)', textTransform: 'uppercase',
                      background: 'rgba(0,0,0,.32)', padding: '2px 7px', borderRadius: 4,
                    }}>{rtl ? 'مؤرشفة' : 'Archived'}</span>
                  </div>
                  <div style={{ padding: '10px 12px 12px' }}>
                    <div style={{
                      fontSize: 13.5, fontWeight: 600, color: theme.text,
                      letterSpacing: '-.005em', marginBottom: 2,
                    }}>{b.title}</div>
                    <div style={{ fontSize: 11.5, color: theme.muted, marginBottom: 10 }}>
                      {b.departmentId
                        ? localizedName({ name: b.departmentName, nameAr: b.departmentNameAr }, rtl)
                        : (rtl ? 'عام' : 'General')}
                      {' · '}
                      {rtl ? 'أرشفت ' : 'Archived '} {formatAgo(new Date(b.archivedAt), rtl)}
                      {b.createdBy && (
                        <div style={{ fontSize: 11, color: theme.mutedDim, marginTop: 2 }}>
                          {rtl ? 'بواسطة ' : 'by '}{b.createdBy.name}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {canManage && (
                        <button onClick={() => restore(b)} disabled={busy} style={{
                          flex: 1, background: theme.accent, color: theme.accentText,
                          border: 'none', padding: '7px 10px', borderRadius: 6,
                          fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                        }}>{rtl ? 'استعادة' : 'Restore'}</button>
                      )}
                      <button onClick={() => navigate(`/b/${b.id}`)} style={{
                        background: 'transparent', color: theme.muted,
                        border: `.5px solid ${theme.border}`, padding: '7px 10px', borderRadius: 6,
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}>{rtl ? 'فتح' : 'Open'}</button>
                      {canDelete && (
                        <button onClick={() => remove(b)} disabled={busy} style={{
                          background: 'transparent', color: '#DC2626',
                          border: `.5px solid ${theme.border}`, padding: '7px 10px', borderRadius: 6,
                          fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                        }} title={rtl ? 'حذف نهائي' : 'Delete permanently'}>×</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatAgo(date, rtl) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)        return rtl ? 'الآن' : 'just now';
  if (diff < 3600)      return rtl ? `قبل ${Math.floor(diff / 60)} د` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return rtl ? `قبل ${Math.floor(diff / 3600)} س` : `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return rtl ? `قبل ${Math.floor(diff / 86400)} يوم` : `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(rtl ? 'ar' : 'en');
}
