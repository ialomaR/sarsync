import React from 'react';
import { Navigate } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { buildTheme } from '../ui/theme.js';
import {
  fetchSystemStats, fetchSystemWorkspaces,
  issueResetForUser, deleteSystemWorkspace,
} from '../lib/api.js';
import { formatRelative } from '../lib/normalize.js';
import { LoadingScreen } from '../ui/States.jsx';

export function SystemAdminPage() {
  const auth = useAuth();
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  const rtl = s.rtl;

  if (auth.status === 'loading') return null;
  if (!auth.user?.isSystemAdmin) return <Navigate to="/boards" replace />;

  return (
    <AppShell hideSidebar={false}>
      <SystemBody theme={theme} rtl={rtl} />
    </AppShell>
  );
}

function SystemBody({ theme, rtl }) {
  const [stats, setStats] = React.useState(null);
  const [workspaces, setWorkspaces] = React.useState(null);
  const [resetEmail, setResetEmail] = React.useState('');
  const [resetResult, setResetResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [s, w] = await Promise.all([fetchSystemStats(), fetchSystemWorkspaces()]);
    setStats(s);
    setWorkspaces(w.workspaces);
  }, []);

  React.useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const issueReset = async (e) => {
    e?.preventDefault();
    if (!resetEmail.trim() || busy) return;
    setBusy(true);
    setResetResult(null);
    try {
      const r = await issueResetForUser(resetEmail.trim());
      setResetResult({ ok: true, email: r.email, url: r.url });
    } catch (err) {
      setResetResult({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const deleteWorkspace = async (ws) => {
    const confirmation = window.prompt(
      rtl
        ? `حذف "${ws.name}" نهائيًا؟ كل لوحاتها وبياناتها ستُمسح.\nاكتب اسم المساحة للتأكيد:`
        : `Delete "${ws.name}" permanently? All its data will be erased.\nType the workspace name to confirm:`);
    if (confirmation !== ws.name) return;
    try {
      await deleteSystemWorkspace(ws.id);
      await refresh();
    } catch (err) { alert(err.message); }
  };

  if (!stats || !workspaces) return <LoadingScreen theme={theme} rtl={rtl} />;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr', overflow: 'auto',
    }}>
      <div style={{ padding: '24px 32px 16px', borderBottom: `.5px solid ${theme.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {rtl ? 'إدارة المنصة' : 'Platform admin'}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: theme.text, margin: 0 }}>
          {rtl ? 'لوحة النظام' : 'System dashboard'}
        </h1>
      </div>

      <div style={{ padding: '20px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
        <Stat label={rtl ? 'مستخدمين' : 'Users'} value={stats.users} delta={stats.usersThisWeek} theme={theme} rtl={rtl} />
        <Stat label={rtl ? 'مساحات عمل' : 'Workspaces'} value={stats.workspaces} delta={stats.workspacesThisWeek} theme={theme} rtl={rtl} />
        <Stat label={rtl ? 'لوحات نشطة' : 'Active boards'} value={stats.boards} theme={theme} rtl={rtl} />
        <Stat label={rtl ? 'كروت نشطة' : 'Active cards'} value={stats.cards} theme={theme} rtl={rtl} />
        <Stat label={rtl ? 'كروت مكتملة' : 'Cards completed'} value={stats.completedAll} theme={theme} rtl={rtl} />
      </div>

      {/* Issue password reset for any user */}
      <div style={{ padding: '8px 32px 0' }}>
        <div style={{
          padding: '14px 16px',
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
            {rtl ? 'إصدار رابط إعادة تعيين كلمة المرور' : 'Issue password reset link'}
          </div>
          <div style={{ fontSize: 11.5, color: theme.muted, marginBottom: 10 }}>
            {rtl
              ? 'لمساعدة مستخدم محبوس خارج الحساب. الرابط صالح ١٥ دقيقة وللاستخدام مرة واحدة.'
              : 'For locked-out users. The link is valid for 15 minutes and single-use.'}
          </div>
          <form onSubmit={issueReset} style={{ display: 'flex', gap: 6 }}>
            <input value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
              placeholder="user@example.com" type="email" required
              style={{
                flex: 1, padding: '8px 12px', fontSize: 13,
                background: theme.bg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 6,
                outline: 'none', fontFamily: 'inherit',
              }} />
            <button type="submit" disabled={busy} style={{
              padding: '8px 16px', borderRadius: 6,
              background: theme.accent, color: theme.accentText,
              border: 'none', fontSize: 12.5, fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}>{busy ? '…' : (rtl ? 'إصدار' : 'Issue link')}</button>
          </form>
          {resetResult && (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 6,
              fontSize: 11.5, lineHeight: 1.5,
              background: resetResult.ok ? '#D1FAE5' : '#FEE2E2',
              color: resetResult.ok ? '#065F46' : '#991B1B',
            }}>
              {resetResult.ok ? (
                <>
                  <div><strong>{rtl ? 'تم إصدار الرابط لـ' : 'Link issued for'}</strong> {resetResult.email}</div>
                  <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: 10.5, wordBreak: 'break-all' }}>
                    {resetResult.url}
                  </div>
                  <button onClick={() => navigator.clipboard?.writeText(resetResult.url)} style={{
                    marginTop: 6, padding: '3px 8px', fontSize: 11,
                    background: 'rgba(0,0,0,.06)', color: 'inherit',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>{rtl ? 'نسخ' : 'Copy'}</button>
                </>
              ) : <span>{resetResult.message}</span>}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '20px 32px 40px' }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px' }}>
          {rtl ? `كل المساحات (${workspaces.length})` : `All workspaces (${workspaces.length})`}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workspaces.map((w) => (
            <div key={w.id} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr auto auto',
              alignItems: 'center', gap: 12, padding: '10px 14px',
              background: theme.surface, borderRadius: theme.cardRadius,
              border: `.5px solid ${theme.border}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: `oklch(.78 .12 ${w.hue})`, color: `oklch(.32 .14 ${w.hue})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
              }}>{w.name?.[0]?.toUpperCase() || 'W'}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{w.name}</div>
                <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                  /{w.slug} · {w.memberCount} {rtl ? 'عضو' : 'members'} · {w.boardCount} {rtl ? 'لوحة' : 'boards'}
                  {w.owner && ` · ${rtl ? 'مالك:' : 'owner:'} ${w.owner.email}`}
                </div>
              </div>
              <div style={{ fontSize: 11, color: theme.mutedDim }}>{formatRelative(w.createdAt)}</div>
              <button onClick={() => deleteWorkspace(w)} style={{
                padding: '5px 10px', borderRadius: 5,
                background: 'transparent', color: '#DC2626',
                border: `.5px solid #FCA5A5`, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{rtl ? 'حذف' : 'Delete'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, delta, theme, rtl }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {typeof delta === 'number' && (
        <div style={{ fontSize: 10.5, color: delta > 0 ? '#0E7C66' : theme.muted, marginTop: 2 }}>
          {delta > 0 ? '+' : ''}{delta} {rtl ? 'هذا الأسبوع' : 'this week'}
        </div>
      )}
    </div>
  );
}
