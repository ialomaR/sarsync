import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, AvatarStack } from '../ui/Avatar.jsx';
import { ROLES, PERMS } from '../data/org-data.js';
import { buildTheme } from '../ui/theme.js';
import { useAuth } from '../state/AuthContext.jsx';
import { api } from '../lib/api.js';
import { BoardDataProvider } from '../state/BoardDataContext.jsx';
import { formatRelative } from '../lib/normalize.js';
import { localizedName } from '../lib/i18n.js';
import { LoadingScreen, StateScreen } from '../ui/States.jsx';
import { MediaLibrary } from './dept/MediaLibrary.jsx';
import { DeptChat } from './dept/DeptChat.jsx';

// ── Shared atoms ───────────────────────────────────────────────────────────

export function RoleBadge({ role }) {
  const r = ROLES[role];
  if (!r) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
      textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 4,
      background: r.color + '18', color: r.color,
      border: `.5px solid ${r.color}33`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 5, background: r.color }} />
      {r.label}
    </span>
  );
}

function StatChip({ label, value, accent, theme }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, padding: '12px 14px',
      background: theme.surface, borderRadius: theme.radius,
      border: `.5px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: theme.muted, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || theme.text, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

// Inline state for tab panels — loader uses a spinner, error gets a soft
// red panel instead of just text. For full-page errors use StateScreen.
function CenterMsg({ theme, error, children }) {
  if (error) {
    return (
      <div style={{
        padding: '14px 16px', margin: '12px 0',
        background: theme.name === 'dark' ? '#7f1d1d33' : '#FEE2E2',
        color: theme.name === 'dark' ? '#FCA5A5' : '#991B1B',
        borderRadius: theme.cardRadius,
        fontSize: 12.5, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5h.01" />
        </svg>
        <span>{children}</span>
      </div>
    );
  }
  return (
    <div style={{
      padding: 30, color: theme.muted, fontSize: 13,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'sarsync-spin 1s linear infinite' }}>
        <path d="M12 3a9 9 0 0 1 9 9" />
        <style>{`@keyframes sarsync-spin { to { transform: rotate(360deg); } }`}</style>
      </svg>
      <span>{children}</span>
    </div>
  );
}

function PrimaryBtn({ theme, onClick, children, type, disabled }) {
  return (
    <button onClick={onClick} type={type} disabled={disabled} style={{
      padding: '6px 12px', borderRadius: 6,
      background: theme.accent, color: theme.accentText, border: 'none',
      fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function GhostBtn({ theme, onClick, children, danger }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 10px', borderRadius: 5,
      background: 'transparent', color: danger ? '#DC2626' : theme.muted,
      border: `.5px solid ${theme.border}`,
      fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
      fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function Modal({ theme, title, onClose, children, footer }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(10,12,18,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 480, maxWidth: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>{title}</h3>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: theme.muted,
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}>×</button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: `.5px solid ${theme.border}`,
            display: 'flex', justifyContent: 'flex-end', gap: 8,
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

function Field({ theme, label, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.text, marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

function TextInput({ theme, ...props }) {
  return (
    <input {...props} style={{
      width: '100%', padding: '8px 12px',
      background: theme.bg, color: theme.text,
      border: `1px solid ${theme.border}`, borderRadius: 6,
      fontSize: 13, fontFamily: 'inherit', outline: 'none',
    }} />
  );
}

function Select({ theme, children, ...props }) {
  return (
    <select {...props} style={{
      width: '100%', padding: '8px 12px',
      background: theme.bg, color: theme.text,
      border: `1px solid ${theme.border}`, borderRadius: 6,
      fontSize: 13, fontFamily: 'inherit', outline: 'none',
    }}>{children}</select>
  );
}

// ── Admin Console ──────────────────────────────────────────────────────────

export function AdminConsole({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const auth = useAuth();
  const workspaceId = auth.memberships[0]?.workspaceId;
  const myRole = auth.memberships[0]?.role;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || (searchParams.get('role') ? 'members' : 'dashboard');
  const [tab, setTab] = React.useState(initialTab);
  const roleFilter = searchParams.get('role');

  // If URL search params change (e.g. user clicks "View members" on Roles tab),
  // sync the active tab.
  React.useEffect(() => {
    const t = searchParams.get('tab');
    const role = searchParams.get('role');
    if (t) setTab(t);
    else if (role) setTab('members');
  }, [searchParams]);

  const tabs = [
    { id: 'dashboard',   label: rtl ? 'لوحة المراقبة' : 'Dashboard' },
    { id: 'departments', label: rtl ? 'الأقسام' : 'Departments' },
    { id: 'teams',       label: rtl ? 'الفرق' : 'Teams' },
    { id: 'members',     label: rtl ? 'الأعضاء' : 'Members' },
    { id: 'invites',     label: rtl ? 'الدعوات' : 'Invites' },
    { id: 'roles',       label: rtl ? 'الأدوار' : 'Roles & permissions' },
  ];

  if (!workspaceId) {
    return <CenterMsg theme={theme}>{rtl ? 'لا توجد مساحة عمل' : 'No workspace'}</CenterMsg>;
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      background: theme.bg, color: theme.text,
      direction: rtl ? 'rtl' : 'ltr',
      display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 22px',
        background: theme.headerBg,
        borderBottom: `.5px solid ${theme.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: theme.muted }}>
          <span>{rtl ? 'الإعدادات' : 'Settings'}</span>
          <span>›</span>
          <span style={{ color: theme.text, fontWeight: 600 }}>{rtl ? 'وحدة تحكم المسؤول' : 'Admin Console'}</span>
        </div>
        <RoleBadge role={myRole} />
      </div>

      <div className="admin-grid-2col" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', overflow: 'hidden', minHeight: 0 }}>
        <div style={{
          background: theme.sidebarBg,
          borderInlineEnd: `.5px solid ${theme.border}`,
          padding: '18px 14px', overflowY: 'auto',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
            color: theme.mutedDim, textTransform: 'uppercase',
            padding: '0 10px 8px',
          }}>{rtl ? 'الإدارة' : 'Manage'}</div>
          {tabs.map((tb) => (
            <div key={tb.id} onClick={() => setTab(tb.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 6,
                background: tab === tb.id ? theme.accentSoft : 'transparent',
                color: tab === tb.id ? theme.accent : theme.text,
                fontWeight: tab === tb.id ? 600 : 500,
                fontSize: 13, cursor: 'pointer', marginBottom: 2,
              }}>
              <span>{tb.label}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '22px 26px', overflowY: 'auto', minHeight: 0 }}>
          {tab === 'dashboard'   && <DashboardPanel    theme={theme} rtl={rtl} workspaceId={workspaceId} />}
          {tab === 'departments' && <DepartmentsPanel theme={theme} rtl={rtl} workspaceId={workspaceId} canEdit={myRole === 'admin'} />}
          {tab === 'teams'       && <TeamsPanel       theme={theme} rtl={rtl} workspaceId={workspaceId} canEdit={myRole === 'admin'} />}
          {tab === 'members'     && <MembersPanel     theme={theme} rtl={rtl} workspaceId={workspaceId} canEdit={myRole === 'admin'} initialFilter={roleFilter} />}
          {tab === 'invites'     && <InvitesPanel     theme={theme} rtl={rtl} workspaceId={workspaceId} canEdit={myRole === 'admin' || myRole === 'dept_manager'} />}
          {tab === 'roles'       && <RolesPanel       theme={theme} rtl={rtl} workspaceId={workspaceId} />}
        </div>
      </div>
    </div>
  );
}

// ── Departments panel ─────────────────────────────────────────────────────

// ── Dashboard panel (admin only) ───────────────────────────────────────────
// Workspace-wide monitoring: KPI strip, live activity feed, department
// breakdown. Every backend call is scoped to this workspace by the server.

function DashboardPanel({ theme, rtl, workspaceId }) {
  const navigate = useNavigate();
  const [overview, setOverview] = React.useState(null);
  const [overviewErr, setOverviewErr] = React.useState(null);

  const refetchOverview = React.useCallback(async () => {
    try {
      const r = await api(`/admin/workspaces/${workspaceId}/overview`);
      setOverview(r);
      setOverviewErr(null);
    } catch (err) {
      setOverviewErr(err);
    }
  }, [workspaceId]);

  React.useEffect(() => { refetchOverview(); }, [refetchOverview]);

  if (overviewErr) return <CenterMsg theme={theme} error>{overviewErr.message}</CenterMsg>;
  if (!overview)   return <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>;

  const c = overview.counts;
  const a = overview.activity;
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: '0 0 14px', letterSpacing: '-.01em' }}>
        {rtl ? 'لوحة المراقبة' : 'Workspace dashboard'}
      </h2>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18,
      }}>
        <KpiCard theme={theme} label={rtl ? 'لوحات نشطة' : 'Active boards'} value={c.boards.active} sub={`+${c.boards.archived} ${rtl ? 'مؤرشفة' : 'archived'}`} />
        <KpiCard theme={theme} label={rtl ? 'بطاقات نشطة' : 'Active cards'} value={c.cards.active} />
        <KpiCard theme={theme} label={rtl ? 'متأخرة' : 'Overdue'} value={c.cards.overdue} tone={c.cards.overdue > 0 ? '#DC2626' : null} />
        <KpiCard theme={theme} label={rtl ? 'مكتملة اليوم' : 'Completed today'} value={c.cards.completedToday} tone="#0E7C66" />
        <KpiCard theme={theme} label={rtl ? 'مكتملة الأسبوع' : 'Completed this week'} value={c.cards.completedThisWeek} />
        <KpiCard theme={theme} label={rtl ? 'متوسط الإنجاز يومياً' : 'Avg done / day'} value={overview.velocity.avgCompletionsPerDay} sub={rtl ? 'آخر 30 يوم' : 'last 30d'} />
        <KpiCard theme={theme} label={rtl ? 'الأعضاء' : 'Members'} value={c.members} sub={`${c.departments} ${rtl ? 'أقسام' : 'depts'}`} />
        <KpiCard theme={theme} label={rtl ? 'النشاط (24س)' : 'Activity (24h)'} value={a.last24h} sub={`${a.last7d}/${a.last30d} ${rtl ? 'أسبوع/شهر' : 'wk/mo'}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 14, alignItems: 'start' }}>
        <ActivityFeedPanel theme={theme} rtl={rtl} workspaceId={workspaceId}
          departments={overview.departments} />
        <DeptBreakdownPanel theme={theme} rtl={rtl} departments={overview.departments}
          onOpen={(id) => navigate(`/dept/${id}`)} />
      </div>
    </div>
  );
}

function KpiCard({ theme, label, value, sub, tone }) {
  return (
    <div style={{
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`,
      padding: '12px 14px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || theme.text, fontVariantNumeric: 'tabular-nums' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 10.5, color: theme.mutedDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ActivityFeedPanel({ theme, rtl, workspaceId, departments }) {
  const navigate = useNavigate();
  const [items, setItems] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState({ departmentId: '', verb: '' });

  const loadPage = React.useCallback(async (resetCursor) => {
    setLoading(true);
    const qs = new URLSearchParams();
    qs.set('limit', '40');
    if (filter.departmentId) qs.set('departmentId', filter.departmentId);
    if (filter.verb)         qs.set('verb', filter.verb);
    if (resetCursor && cursor) qs.set('before', cursor);
    try {
      const r = await api(`/admin/workspaces/${workspaceId}/activity?${qs.toString()}`);
      setItems((prev) => resetCursor ? [...prev, ...r.items] : r.items);
      setCursor(r.nextCursor);
    } catch {} finally { setLoading(false); }
  }, [workspaceId, filter, cursor]);

  React.useEffect(() => {
    setItems([]); setCursor(null);
    loadPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.departmentId, filter.verb]);

  const VERBS = [
    { id: '', label: rtl ? 'كل الأحداث' : 'All actions' },
    { id: 'board_created',  label: rtl ? 'إنشاء لوحة' : 'Board created' },
    { id: 'board_archived', label: rtl ? 'أرشفة لوحة' : 'Board archived' },
    { id: 'board_moved',    label: rtl ? 'نقل لوحة لقسم' : 'Board moved' },
    { id: 'card_created',   label: rtl ? 'إنشاء بطاقة' : 'Card created' },
    { id: 'card_moved',     label: rtl ? 'نقل بطاقة' : 'Card moved' },
    { id: 'card_deleted',   label: rtl ? 'حذف بطاقة' : 'Card deleted' },
    { id: 'comment_added',  label: rtl ? 'تعليق' : 'Comment' },
    { id: 'member_assigned',label: rtl ? 'تعيين عضو' : 'Member assigned' },
  ];

  return (
    <div style={{
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`,
      padding: 14, minHeight: 320,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: 0 }}>
          {rtl ? 'موجز النشاط' : 'Activity feed'}
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={filter.departmentId} onChange={(e) => setFilter((f) => ({ ...f, departmentId: e.target.value }))}
            style={selectStyle(theme)}>
            <option value="">{rtl ? 'كل الأقسام' : 'All departments'}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{localizedName(d, rtl)}</option>)}
          </select>
          <select value={filter.verb} onChange={(e) => setFilter((f) => ({ ...f, verb: e.target.value }))}
            style={selectStyle(theme)}>
            {VERBS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {items.length === 0 && !loading && (
        <div style={{ padding: 28, textAlign: 'center', color: theme.muted, fontSize: 12.5 }}>
          {rtl ? 'لا يوجد نشاط مطابق' : 'No matching activity'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => (
          <ActivityRow key={it.id} item={it} theme={theme} rtl={rtl}
            onOpen={() => {
              if (it.targetType === 'card') navigate(`/b/${it.board.id}?card=${it.targetId}`);
              else navigate(`/b/${it.board.id}`);
            }} />
        ))}
      </div>
      {cursor && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={() => loadPage(true)} disabled={loading} style={{
            background: theme.surface2, color: theme.text,
            border: `.5px solid ${theme.border}`, padding: '6px 14px',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}>{loading ? '…' : (rtl ? 'تحميل المزيد' : 'Load more')}</button>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item, theme, rtl, onOpen }) {
  const verbLabel = ACTIVITY_VERB_LABELS[item.verb]?.[rtl ? 'ar' : 'en'] || item.verb;
  const cardTitle = (item.meta && (item.meta.cardTitle || item.meta.boardTitle)) || '';
  return (
    <button onClick={onOpen} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px', borderRadius: 6,
      background: 'transparent', border: `.5px solid ${theme.border}`,
      cursor: 'pointer', textAlign: rtl ? 'right' : 'left',
      fontFamily: 'inherit', color: theme.text, width: '100%',
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = theme.surface2}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <Avatar id={item.actor.id} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.45 }}>
          <strong style={{ fontWeight: 600 }}>{item.actor.name}</strong>{' '}
          <span style={{ color: theme.muted }}>{verbLabel}</span>
          {cardTitle && <span style={{ color: theme.text }}> · {cardTitle}</span>}
        </div>
        <div style={{ fontSize: 11, color: theme.mutedDim, marginTop: 2 }}>
          {item.board.title}
          {item.board.department && ` · ${localizedName(item.board.department, rtl)}`}
          {' · '}{relTime(new Date(item.createdAt), rtl)}
        </div>
      </div>
    </button>
  );
}

function DeptBreakdownPanel({ theme, rtl, departments, onOpen }) {
  return (
    <div style={{
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`,
      padding: 14,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px' }}>
        {rtl ? 'توزيع الأقسام' : 'Department breakdown'}
      </h3>
      {departments.length === 0 && (
        <div style={{ padding: 14, textAlign: 'center', color: theme.muted, fontSize: 12 }}>
          {rtl ? 'لا توجد أقسام' : 'No departments yet'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {departments.map((d) => (
          <button key={d.id} onClick={() => onOpen(d.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 6,
            background: 'transparent', border: `.5px solid ${theme.border}`,
            cursor: 'pointer', textAlign: rtl ? 'right' : 'left',
            fontFamily: 'inherit', color: theme.text,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = theme.surface2}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <span style={{
              width: 22, height: 22, borderRadius: 5,
              background: `oklch(.78 .12 ${d.hue})`, color: `oklch(.32 .14 ${d.hue})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>{d.icon || (d.name?.[0] || 'D').toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {localizedName(d, rtl)}
              </div>
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                {d.memberCount} {rtl ? 'عضو' : 'members'} · {d.active} {rtl ? 'نشطة' : 'active'}
                {d.overdue > 0 && <span style={{ color: '#DC2626' }}> · {d.overdue} {rtl ? 'متأخرة' : 'overdue'}</span>}
                {' · '}{d.completedThisMonth} {rtl ? 'مكتملة الشهر' : 'done/mo'}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function selectStyle(theme) {
  return {
    padding: '5px 8px', borderRadius: 5,
    background: theme.surface2, color: theme.text,
    border: `.5px solid ${theme.border}`,
    fontSize: 11.5, fontFamily: 'inherit', outline: 'none',
  };
}

function relTime(date, rtl) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)        return rtl ? 'الآن' : 'just now';
  if (diff < 3600)      return rtl ? `قبل ${Math.floor(diff / 60)} د` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return rtl ? `قبل ${Math.floor(diff / 3600)} س` : `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return rtl ? `قبل ${Math.floor(diff / 86400)} يوم` : `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(rtl ? 'ar' : 'en');
}

const ACTIVITY_VERB_LABELS = {
  board_created:        { en: 'created a board',           ar: 'أنشأ لوحة' },
  board_archived:       { en: 'archived a board',          ar: 'أرشف لوحة' },
  board_restored:       { en: 'restored a board',          ar: 'استعاد لوحة' },
  board_moved:          { en: 'moved a board to a department', ar: 'نقل لوحة إلى قسم' },
  card_created:         { en: 'created a card',            ar: 'أنشأ بطاقة' },
  card_moved:           { en: 'moved a card',              ar: 'نقل بطاقة' },
  card_renamed:         { en: 'renamed a card',            ar: 'غيّر اسم بطاقة' },
  card_archived:        { en: 'archived a card',           ar: 'أرشف بطاقة' },
  card_deleted:         { en: 'deleted a card',            ar: 'حذف بطاقة' },
  card_described:       { en: 'updated a card',            ar: 'حدّث بطاقة' },
  card_due_set:         { en: 'set a due date',            ar: 'حدّد تاريخ استحقاق' },
  card_due_cleared:     { en: 'cleared a due date',        ar: 'مسح تاريخ استحقاق' },
  card_cover_set:       { en: 'set a cover',               ar: 'حدّد غلاف بطاقة' },
  card_cover_cleared:   { en: 'removed a cover',           ar: 'أزال غلاف بطاقة' },
  member_assigned:      { en: 'assigned a member',         ar: 'أضاف عضواً' },
  member_unassigned:    { en: 'unassigned a member',       ar: 'أزال عضواً' },
  label_added:          { en: 'added a label',             ar: 'أضاف وسماً' },
  label_removed:        { en: 'removed a label',           ar: 'أزال وسماً' },
  comment_added:        { en: 'commented',                 ar: 'علّق' },
  checklist_added:      { en: 'added a checklist item',    ar: 'أضاف مهمة فرعية' },
  checklist_completed:  { en: 'completed a checklist',     ar: 'أنجز مهمة فرعية' },
  checklist_uncompleted:{ en: 'reopened a checklist',      ar: 'أعاد فتح مهمة' },
  list_created:         { en: 'added a list',              ar: 'أضاف قائمة' },
  list_renamed:         { en: 'renamed a list',            ar: 'غيّر اسم قائمة' },
  list_archived:        { en: 'archived a list',           ar: 'أرشف قائمة' },
};

function DepartmentsPanel({ theme, rtl, workspaceId, canEdit }) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [showCreate, setShowCreate] = React.useState(false);
  const [editing, setEditing] = React.useState(null);

  const refetch = React.useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const r = await api(`/workspaces/${workspaceId}/departments`);
      setState({ status: 'ready', items: r.departments, error: null });
    } catch (err) {
      setState({ status: 'error', items: [], error: err });
    }
  }, [workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  const onDelete = async (id) => {
    if (!confirm(rtl ? 'حذف هذا القسم؟' : 'Delete this department?')) return;
    await api(`/departments/${id}`, { method: 'DELETE' });
    await refetch();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.01em' }}>
          {rtl ? 'الأقسام' : 'Departments'} <span style={{ color: theme.muted, fontWeight: 500, fontSize: 14 }}>· {state.items.length}</span>
        </h2>
        {canEdit && <PrimaryBtn theme={theme} onClick={() => setShowCreate(true)}>+ {rtl ? 'قسم جديد' : 'New department'}</PrimaryBtn>}
      </div>

      {state.status === 'loading' && <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>}
      {state.status === 'error' && <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>}
      {state.status === 'ready' && (
        <div style={{
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`, overflow: 'hidden',
        }}>
          {state.items.map((d, i) => (
            <div key={d.id} style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 130px 80px 80px 140px',
              alignItems: 'center', gap: 12, padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `.5px solid ${theme.border}`,
              fontSize: 13,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `oklch(.92 .07 ${d.hue})`, color: `oklch(.4 .14 ${d.hue})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700,
              }}>{d.icon}</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>{localizedName(d, rtl)}</div>
                <div style={{ fontSize: 11, color: theme.muted }}>
                  {d.head ? (rtl ? 'يقود ' : 'Led by ') + d.head.name : (rtl ? 'بدون قائد' : 'No head')}
                </div>
              </div>
              <div style={{ fontSize: 12, color: theme.muted }}>{d.memberCount} {rtl ? 'عضو' : 'members'}</div>
              <div style={{ fontSize: 12, color: theme.muted }}>{d.teamCount} {rtl ? 'فرق' : 'teams'}</div>
              <div style={{ fontSize: 12, color: theme.muted }}>{d.projectCount} {rtl ? 'مشاريع' : 'boards'}</div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <GhostBtn theme={theme} onClick={() => setEditing(d)}>{rtl ? 'تعديل' : 'Edit'}</GhostBtn>
                  <GhostBtn theme={theme} onClick={() => onDelete(d.id)} danger>{rtl ? 'حذف' : 'Delete'}</GhostBtn>
                </div>
              )}
            </div>
          ))}
          {state.items.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'لا توجد أقسام بعد' : 'No departments yet'}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <DeptForm theme={theme} rtl={rtl}
          onClose={() => setShowCreate(false)}
          onSave={async (data) => {
            await api(`/workspaces/${workspaceId}/departments`, { method: 'POST', body: data });
            setShowCreate(false);
            await refetch();
          }} />
      )}
      {editing && (
        <DeptForm theme={theme} rtl={rtl} initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await api(`/departments/${editing.id}`, { method: 'PATCH', body: data });
            setEditing(null);
            await refetch();
          }} />
      )}
    </div>
  );
}

function DeptForm({ theme, rtl, initial, onClose, onSave }) {
  const [name, setName] = React.useState(initial?.name || '');
  const [nameAr, setNameAr] = React.useState(initial?.nameAr || '');
  const [icon, setIcon] = React.useState(initial?.icon || '◇');
  const [hue, setHue] = React.useState(initial?.hue ?? 220);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        name: name.trim(),
        nameAr: nameAr.trim() || null,
        icon, hue: Number(hue),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal theme={theme} onClose={onClose}
      title={initial ? (rtl ? 'تعديل القسم' : 'Edit department') : (rtl ? 'قسم جديد' : 'New department')}
      footer={<>
        <GhostBtn theme={theme} onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</GhostBtn>
        <PrimaryBtn theme={theme} onClick={submit} disabled={saving || !name.trim()}>
          {saving ? '…' : (rtl ? 'حفظ' : 'Save')}
        </PrimaryBtn>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field theme={theme} label={rtl ? 'الاسم بالإنجليزية' : 'Name (English)'}
          hint={rtl ? 'مطلوب' : 'Required'}>
          <TextInput theme={theme} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Engineering" dir="ltr" />
        </Field>
        <Field theme={theme} label={rtl ? 'الاسم بالعربية' : 'Name (Arabic)'}
          hint={rtl ? 'اختياري' : 'Optional'}>
          <TextInput theme={theme} value={nameAr} onChange={(e) => setNameAr(e.target.value)}
            placeholder="الهندسة" dir="rtl" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field theme={theme} label={rtl ? 'الأيقونة' : 'Icon'}>
          <TextInput theme={theme} value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
        </Field>
        <Field theme={theme} label={rtl ? 'اللون (Hue 0-360)' : 'Color (hue 0-360)'}>
          <TextInput theme={theme} type="number" value={hue} onChange={(e) => setHue(e.target.value)} min={0} max={360} />
        </Field>
      </div>
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

// ── Teams panel ────────────────────────────────────────────────────────────

function TeamsPanel({ theme, rtl, workspaceId, canEdit }) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [departments, setDepartments] = React.useState([]);
  const [showCreate, setShowCreate] = React.useState(false);
  const [editing, setEditing] = React.useState(null);

  const refetch = React.useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const [t, d] = await Promise.all([
        api(`/workspaces/${workspaceId}/teams`),
        api(`/workspaces/${workspaceId}/departments`),
      ]);
      setState({ status: 'ready', items: t.teams, error: null });
      setDepartments(d.departments);
    } catch (err) {
      setState({ status: 'error', items: [], error: err });
    }
  }, [workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  const onDelete = async (id) => {
    if (!confirm(rtl ? 'حذف هذا الفريق؟' : 'Delete this team?')) return;
    await api(`/teams/${id}`, { method: 'DELETE' });
    await refetch();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.01em' }}>
          {rtl ? 'كل الفرق' : 'All teams'} <span style={{ color: theme.muted, fontWeight: 500, fontSize: 14 }}>· {state.items.length}</span>
        </h2>
        {canEdit && <PrimaryBtn theme={theme} onClick={() => setShowCreate(true)}>+ {rtl ? 'فريق جديد' : 'New team'}</PrimaryBtn>}
      </div>

      {state.status === 'loading' && <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>}
      {state.status === 'error' && <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>}
      {state.status === 'ready' && (
        <div style={{
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`, overflow: 'hidden',
        }}>
          {state.items.map((t, i) => {
            const peopleById = Object.fromEntries(t.members.map((m) => [m.id, {
              id: m.id, name: m.name, color: m.avatarColor,
              initials: m.name.split(' ').map((p) => p[0]).slice(0, 2).join(''),
            }]));
            return (
              <div key={t.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px 130px 100px 140px',
                alignItems: 'center', gap: 12, padding: '12px 16px',
                borderTop: i === 0 ? 'none' : `.5px solid ${theme.border}`,
                fontSize: 13,
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: theme.text }}>{localizedName(t, rtl)}</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{rtl ? 'القسم: ' : 'Dept: '}{localizedName(t.department, rtl)}</div>
                </div>
                <div style={{ fontSize: 12, color: theme.text }}>
                  {t.lead ? t.lead.name : <span style={{ color: theme.mutedDim }}>—</span>}
                </div>
                <div>
                  <BoardDataProvider peopleById={peopleById}>
                    {t.members.length > 0
                      ? <AvatarStack ids={t.members.map((m) => m.id)} size={22} ringColor={theme.surface} />
                      : <span style={{ color: theme.mutedDim, fontSize: 12 }}>—</span>}
                  </BoardDataProvider>
                </div>
                <div style={{ fontSize: 12, color: theme.muted, fontVariantNumeric: 'tabular-nums' }}>{t.projectCount} {rtl ? 'مشاريع' : 'boards'}</div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <GhostBtn theme={theme} onClick={() => setEditing(t)}>{rtl ? 'تعديل' : 'Edit'}</GhostBtn>
                    <GhostBtn theme={theme} onClick={() => onDelete(t.id)} danger>{rtl ? 'حذف' : 'Delete'}</GhostBtn>
                  </div>
                )}
              </div>
            );
          })}
          {state.items.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'لا توجد فرق بعد' : 'No teams yet'}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <TeamForm theme={theme} rtl={rtl} departments={departments}
          onClose={() => setShowCreate(false)}
          onSave={async (data) => {
            await api(`/workspaces/${workspaceId}/teams`, { method: 'POST', body: data });
            setShowCreate(false);
            await refetch();
          }} />
      )}
      {editing && (
        <TeamForm theme={theme} rtl={rtl} departments={departments} initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await api(`/teams/${editing.id}`, { method: 'PATCH', body: data });
            setEditing(null);
            await refetch();
          }} />
      )}
    </div>
  );
}

function TeamForm({ theme, rtl, departments, initial, onClose, onSave }) {
  const [name, setName] = React.useState(initial?.name || '');
  const [nameAr, setNameAr] = React.useState(initial?.nameAr || '');
  const [departmentId, setDepartmentId] = React.useState(initial?.department?.id || departments[0]?.id || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async () => {
    if (!name.trim() || !departmentId) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        name: name.trim(),
        nameAr: nameAr.trim() || null,
        departmentId,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal theme={theme} onClose={onClose}
      title={initial ? (rtl ? 'تعديل الفريق' : 'Edit team') : (rtl ? 'فريق جديد' : 'New team')}
      footer={<>
        <GhostBtn theme={theme} onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</GhostBtn>
        <PrimaryBtn theme={theme} onClick={submit} disabled={saving || !name.trim() || !departmentId}>
          {saving ? '…' : (rtl ? 'حفظ' : 'Save')}
        </PrimaryBtn>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field theme={theme} label={rtl ? 'الاسم بالإنجليزية' : 'Name (English)'}
          hint={rtl ? 'مطلوب' : 'Required'}>
          <TextInput theme={theme} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Mobile Apps" dir="ltr" />
        </Field>
        <Field theme={theme} label={rtl ? 'الاسم بالعربية' : 'Name (Arabic)'}
          hint={rtl ? 'اختياري' : 'Optional'}>
          <TextInput theme={theme} value={nameAr} onChange={(e) => setNameAr(e.target.value)}
            placeholder="تطبيقات الجوال" dir="rtl" />
        </Field>
      </div>
      <Field theme={theme} label={rtl ? 'القسم' : 'Department'}>
        <Select theme={theme} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          {departments.map((d) => <option key={d.id} value={d.id}>{localizedName(d, rtl)}</option>)}
        </Select>
      </Field>
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

// ── Members panel ──────────────────────────────────────────────────────────

function MembersPanel({ theme, rtl, workspaceId, canEdit, initialFilter }) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [departments, setDepartments] = React.useState([]);
  const [teams, setTeams] = React.useState([]);
  const [filter, setFilter] = React.useState(initialFilter || 'all');
  const [editing, setEditing] = React.useState(null);

  const refetch = React.useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const [m, d, t] = await Promise.all([
        api(`/workspaces/${workspaceId}/members`),
        api(`/workspaces/${workspaceId}/departments`),
        api(`/workspaces/${workspaceId}/teams`),
      ]);
      setState({ status: 'ready', items: m.members, error: null });
      setDepartments(d.departments);
      setTeams(t.teams);
    } catch (err) {
      setState({ status: 'error', items: [], error: err });
    }
  }, [workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  const onRemove = async (id, name) => {
    if (!confirm(rtl ? `إزالة ${name} من المساحة؟` : `Remove ${name} from workspace?`)) return;
    try {
      await api(`/memberships/${id}`, { method: 'DELETE' });
      await refetch();
    } catch (err) {
      alert(err.message);
    }
  };

  const filtered = filter === 'all' ? state.items : state.items.filter((m) => m.role === filter);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.01em' }}>
          {rtl ? 'الأعضاء' : 'Members'} <span style={{ color: theme.muted, fontWeight: 500, fontSize: 14 }}>· {state.items.length}</span>
        </h2>
        <div style={{
          display: 'flex', background: theme.surface, padding: 2, borderRadius: 6,
          border: `.5px solid ${theme.border}`,
        }}>
          {[
            { id: 'all', label: rtl ? 'الكل' : 'All' },
            { id: 'admin', label: rtl ? 'مسؤول' : 'Admin' },
            { id: 'dept_manager', label: rtl ? 'مدير' : 'Manager' },
            { id: 'member', label: rtl ? 'موظف' : 'Member' },
          ].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px',
              background: filter === f.id ? theme.bg : 'transparent',
              color: filter === f.id ? theme.text : theme.muted,
              border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {state.status === 'loading' && <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>}
      {state.status === 'error' && <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>}
      {state.status === 'ready' && (
        <div style={{
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`, overflow: 'hidden',
        }}>
          {filtered.map((m, i) => {
            const peopleById = { [m.userId]: { id: m.userId, name: m.name, color: m.avatarColor, initials: m.name.split(' ').map((p) => p[0]).slice(0, 2).join('') } };
            return (
              <div key={m.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px 130px 110px 140px',
                gap: 12, alignItems: 'center', padding: '10px 16px',
                borderTop: i === 0 ? 'none' : `.5px solid ${theme.border}`,
                fontSize: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <BoardDataProvider peopleById={peopleById}>
                    <Avatar id={m.userId} size={28} />
                  </BoardDataProvider>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: theme.text }}>{m.name}</div>
                    <div style={{ fontSize: 10.5, color: theme.muted }}>{m.email}</div>
                  </div>
                </div>
                <div><RoleBadge role={m.role} /></div>
                <div style={{ fontSize: 12, color: theme.text }}>
                  {m.department ? localizedName(m.department, rtl) : <span style={{ color: theme.mutedDim }}>—</span>}
                </div>
                <div style={{ fontSize: 12, color: theme.muted }}>
                  {m.team ? localizedName(m.team, rtl) : <span style={{ color: theme.mutedDim }}>—</span>}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <GhostBtn theme={theme} onClick={() => setEditing(m)}>{rtl ? 'تعديل' : 'Edit'}</GhostBtn>
                    <GhostBtn theme={theme} onClick={() => onRemove(m.id, m.name)} danger>{rtl ? 'إزالة' : 'Remove'}</GhostBtn>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'لا يوجد أعضاء' : 'No members'}
            </div>
          )}
        </div>
      )}

      {editing && (
        <MemberForm theme={theme} rtl={rtl} member={editing} departments={departments} teams={teams}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await api(`/memberships/${editing.id}`, { method: 'PATCH', body: data });
            setEditing(null);
            await refetch();
          }} />
      )}
    </div>
  );
}

function MemberForm({ theme, rtl, member, departments, teams, onClose, onSave }) {
  const [role, setRole] = React.useState(member.role);
  const [departmentId, setDepartmentId] = React.useState(member.department?.id || '');
  const [teamId, setTeamId] = React.useState(member.team?.id || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const filteredTeams = departmentId ? teams.filter((t) => t.department.id === departmentId) : teams;

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      await onSave({
        role,
        departmentId: departmentId || null,
        teamId: teamId && filteredTeams.find((t) => t.id === teamId) ? teamId : null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal theme={theme} onClose={onClose}
      title={rtl ? `تعديل ${member.name}` : `Edit ${member.name}`}
      footer={<>
        <GhostBtn theme={theme} onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</GhostBtn>
        <PrimaryBtn theme={theme} onClick={submit} disabled={saving}>
          {saving ? '…' : (rtl ? 'حفظ' : 'Save')}
        </PrimaryBtn>
      </>}>
      <Field theme={theme} label={rtl ? 'الدور' : 'Role'}>
        <Select theme={theme} value={role} onChange={(e) => setRole(e.target.value)}>
          {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Field>
      <Field theme={theme} label={rtl ? 'القسم' : 'Department'}>
        <Select theme={theme} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setTeamId(''); }}>
          <option value="">— {rtl ? 'بدون' : 'None'} —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{localizedName(d, rtl)}</option>)}
        </Select>
      </Field>
      <Field theme={theme} label={rtl ? 'الفريق' : 'Team'}>
        <Select theme={theme} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">— {rtl ? 'بدون' : 'None'} —</option>
          {filteredTeams.map((t) => <option key={t.id} value={t.id}>{localizedName(t, rtl)}</option>)}
        </Select>
      </Field>
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

// ── Invites panel ──────────────────────────────────────────────────────────

function InvitesPanel({ theme, rtl, workspaceId, canEdit }) {
  const [state, setState] = React.useState({ status: 'loading', items: [], error: null });
  const [departments, setDepartments] = React.useState([]);
  const [teams, setTeams] = React.useState([]);
  const [showSend, setShowSend] = React.useState(false);
  const [lastInviteUrl, setLastInviteUrl] = React.useState(null);

  const refetch = React.useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const [inv, d, t] = await Promise.all([
        api(`/workspaces/${workspaceId}/invites`),
        api(`/workspaces/${workspaceId}/departments`),
        api(`/workspaces/${workspaceId}/teams`),
      ]);
      setState({ status: 'ready', items: inv.invites, error: null });
      setDepartments(d.departments);
      setTeams(t.teams);
    } catch (err) {
      setState({ status: 'error', items: [], error: err });
    }
  }, [workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  const onRevoke = async (id) => {
    if (!confirm(rtl ? 'إلغاء الدعوة؟' : 'Revoke this invite?')) return;
    await api(`/invites/${id}`, { method: 'DELETE' });
    await refetch();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.01em' }}>
          {rtl ? 'الدعوات المعلقة' : 'Pending invites'} <span style={{ color: theme.muted, fontWeight: 500, fontSize: 14 }}>· {state.items.length}</span>
        </h2>
        {canEdit && <PrimaryBtn theme={theme} onClick={() => setShowSend(true)}>+ {rtl ? 'دعوة عضو' : 'Send invite'}</PrimaryBtn>}
      </div>

      {lastInviteUrl && (
        <div style={{
          padding: 12, marginBottom: 14,
          background: theme.accentSoft, color: theme.accent,
          borderRadius: theme.cardRadius, fontSize: 12, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>{rtl ? 'رابط الدعوة:' : 'Invite link:'}</span>
          <code style={{ flex: 1, background: theme.surface, padding: '4px 8px', borderRadius: 4, fontSize: 11, wordBreak: 'break-all' }}>
            {window.location.origin}{lastInviteUrl}
          </code>
          <button onClick={() => navigator.clipboard.writeText(window.location.origin + lastInviteUrl)} style={{
            padding: '4px 10px', background: theme.accent, color: theme.accentText, border: 'none',
            borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{rtl ? 'نسخ' : 'Copy'}</button>
          <button onClick={() => setLastInviteUrl(null)} style={{ background: 'transparent', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
        </div>
      )}

      {state.status === 'loading' && <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>}
      {state.status === 'error' && <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>}
      {state.status === 'ready' && state.items.length === 0 && (
        <div style={{
          padding: 24, textAlign: 'center', color: theme.muted, fontSize: 13,
          background: theme.surface, border: `.5px dashed ${theme.border}`, borderRadius: theme.cardRadius,
        }}>{rtl ? 'لا توجد دعوات معلقة' : 'No pending invites'}</div>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <div style={{
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px solid ${theme.border}`, overflow: 'hidden',
        }}>
          {state.items.map((inv, i) => (
            <div key={inv.id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 130px 130px 110px 90px',
              gap: 12, alignItems: 'center', padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `.5px solid ${theme.border}`,
              fontSize: 13,
            }}>
              <div>
                <div style={{ fontWeight: 600, color: theme.text }}>{inv.email}</div>
                <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                  {rtl ? 'من ' : 'from '}{inv.invitedBy || 'someone'}
                </div>
              </div>
              <div><RoleBadge role={inv.role} /></div>
              <div style={{ fontSize: 11.5, color: theme.muted }}>
                {inv.expired ? <span style={{ color: '#DC2626' }}>{rtl ? 'منتهية' : 'Expired'}</span> : formatRelative(inv.createdAt)}
              </div>
              <div style={{ fontSize: 11, color: theme.mutedDim }}>
                {rtl ? 'تنتهي ' : 'expires '}{formatRelative(inv.expiresAt)}
              </div>
              {canEdit && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <GhostBtn theme={theme} onClick={() => onRevoke(inv.id)} danger>{rtl ? 'إلغاء' : 'Revoke'}</GhostBtn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showSend && (
        <SendInviteForm theme={theme} rtl={rtl} departments={departments} teams={teams}
          onClose={() => setShowSend(false)}
          onSave={async (data) => {
            const r = await api(`/workspaces/${workspaceId}/invites`, { method: 'POST', body: data });
            setShowSend(false);
            setLastInviteUrl(r.inviteUrl);
            await refetch();
          }} />
      )}
    </div>
  );
}

function SendInviteForm({ theme, rtl, departments, teams, onClose, onSave }) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('member');
  const [departmentId, setDepartmentId] = React.useState('');
  const [teamId, setTeamId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const filteredTeams = departmentId ? teams.filter((t) => t.department.id === departmentId) : [];

  const submit = async () => {
    if (!email.trim()) return;
    setSaving(true); setError(null);
    try {
      await onSave({
        email: email.trim(),
        role,
        departmentId: departmentId || null,
        teamId: teamId || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal theme={theme} onClose={onClose}
      title={rtl ? 'دعوة عضو' : 'Invite member'}
      footer={<>
        <GhostBtn theme={theme} onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</GhostBtn>
        <PrimaryBtn theme={theme} onClick={submit} disabled={saving || !email.trim()}>
          {saving ? '…' : (rtl ? 'إرسال الدعوة' : 'Send invite')}
        </PrimaryBtn>
      </>}>
      <Field theme={theme} label={rtl ? 'البريد الإلكتروني' : 'Email'}>
        <TextInput theme={theme} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="newhire@company.com" />
      </Field>
      <Field theme={theme} label={rtl ? 'الدور' : 'Role'}>
        <Select theme={theme} value={role} onChange={(e) => setRole(e.target.value)}>
          {Object.entries(ROLES).filter(([k]) => k !== 'admin').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Field>
      <Field theme={theme} label={rtl ? 'القسم (اختياري)' : 'Department (optional)'}>
        <Select theme={theme} value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setTeamId(''); }}>
          <option value="">— {rtl ? 'بدون' : 'None'} —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{localizedName(d, rtl)}</option>)}
        </Select>
      </Field>
      {departmentId && filteredTeams.length > 0 && (
        <Field theme={theme} label={rtl ? 'الفريق (اختياري)' : 'Team (optional)'}>
          <Select theme={theme} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">— {rtl ? 'بدون' : 'None'} —</option>
            {filteredTeams.map((t) => <option key={t.id} value={t.id}>{localizedName(t, rtl)}</option>)}
          </Select>
        </Field>
      )}
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

// ── Roles panel (live data from API) ───────────────────────────────────────

function RolesPanel({ theme, rtl, workspaceId }) {
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', roles: [], permissions: [], error: null });

  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/workspaces/${workspaceId}/roles`);
        if (!cancelled) setState({ status: 'ready', roles: r.roles, permissions: r.permissions, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', roles: [], permissions: [], error: err });
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  if (state.status === 'loading') return <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>;
  if (state.status === 'error') return <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>;

  const totalMembers = state.roles.reduce((s, r) => s + r.memberCount, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.01em' }}>
          {rtl ? 'الأدوار والصلاحيات' : 'Roles & permissions'}
        </h2>
        <span style={{ fontSize: 12, color: theme.muted }}>
          {rtl ? `${totalMembers} عضو في المساحة` : `${totalMembers} members in workspace`}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 0 16px' }}>
        {rtl ? 'ما يستطيع كل دور رؤيته وفعله، مع عدد الأعضاء الفعلي لكل دور.' : 'What each role can see and do, with live member counts.'}
      </p>

      {/* Role cards with live counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 22 }}>
        {state.roles.map((r) => (
          <div key={r.id} style={{
            padding: '12px 14px',
            background: theme.surface, borderRadius: theme.cardRadius,
            border: `.5px solid ${theme.border}`,
            borderTop: `3px solid ${r.color}`,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>
                {rtl ? r.labelAr : r.label}
              </div>
              <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                {rtl ? r.descAr : r.desc}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: r.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' }}>
                {r.memberCount}
              </div>
              {r.members.length > 0 && (
                <BoardDataProvider peopleById={Object.fromEntries(r.members.map((m) => [m.id, {
                  id: m.id, name: m.name, color: m.color,
                  initials: m.name.split(' ').map((p) => p[0]).slice(0, 2).join(''),
                }]))}>
                  <AvatarStack ids={r.members.map((m) => m.id)} size={20} ringColor={theme.surface} />
                </BoardDataProvider>
              )}
            </div>
            {r.memberCount > 0 && (
              <button onClick={() => navigate(`/admin?role=${r.id}`)} style={{
                background: 'transparent', color: theme.accent,
                border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit',
                textAlign: 'start',
              }}>{rtl ? 'عرض الأعضاء →' : 'View members →'}</button>
            )}
          </div>
        ))}
      </div>

      {/* Permissions matrix */}
      <h3 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px', letterSpacing: '-.005em' }}>
        {rtl ? 'مصفوفة الصلاحيات' : 'Permissions matrix'}
      </h3>
      <div style={{
        background: theme.surface, borderRadius: theme.cardRadius,
        border: `.5px solid ${theme.border}`, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: `1fr repeat(${state.roles.length}, 100px)`,
          gap: 8, padding: '12px 16px',
          background: theme.bg, borderBottom: `.5px solid ${theme.border}`,
          fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: theme.muted,
        }}>
          <div>{rtl ? 'الصلاحية' : 'Permission'}</div>
          {state.roles.map((r) => (
            <div key={r.id} style={{ textAlign: 'center', color: r.color }}>
              {rtl ? r.labelAr : r.label}
            </div>
          ))}
        </div>
        {state.permissions.map((perm) => (
          <div key={perm.key} style={{
            display: 'grid', gridTemplateColumns: `1fr repeat(${state.roles.length}, 100px)`,
            gap: 8, alignItems: 'center', padding: '11px 16px',
            borderTop: `.5px solid ${theme.border}`, fontSize: 13,
          }}>
            <div style={{ color: theme.text, fontWeight: 500 }}>
              {rtl ? perm.labelAr : perm.label}
            </div>
            {state.roles.map((r) => (
              <div key={r.id} style={{ textAlign: 'center' }}>
                {perm[r.id] ? (
                  <span style={{
                    display: 'inline-flex', width: 20, height: 20, borderRadius: 4,
                    background: r.color + '20', color: r.color,
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                  }}>✓</span>
                ) : <span style={{ color: theme.mutedDim, fontSize: 14 }}>·</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Department view ────────────────────────────────────────────────────────

export function DepartmentView({ themeName, accent, rtl, deptId }) {
  const theme = buildTheme(themeName, accent);
  const navigate = useNavigate();
  const auth = useAuth();
  const workspaceId = auth.memberships[0]?.workspaceId;
  const [state, setState] = React.useState({ status: 'loading', dept: null, error: null });
  const [defaultDeptId, setDefaultDeptId] = React.useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'projects';
  const setTab = (t) => {
    const next = new URLSearchParams(searchParams);
    if (t === 'projects') next.delete('tab'); else next.set('tab', t);
    setSearchParams(next, { replace: true });
  };

  React.useEffect(() => {
    if (deptId || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/workspaces/${workspaceId}/departments`);
        if (!cancelled && r.departments[0]) setDefaultDeptId(r.departments[0].id);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [deptId, workspaceId]);

  const id = deptId || defaultDeptId;

  const [kpis, setKpis] = React.useState(null);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setState({ status: 'loading', dept: null, error: null });
      setKpis(null);
      try {
        // Both in parallel — KPIs are best-effort; we still render even if
        // they fail.
        const [dept, kpisRes] = await Promise.all([
          api(`/departments/${id}/detail`),
          api(`/departments/${id}/kpis`).catch(() => null),
        ]);
        if (!cancelled) {
          setState({ status: 'ready', dept, error: null });
          if (kpisRes) setKpis(kpisRes);
        }
      } catch (err) {
        if (!cancelled) setState({ status: 'error', dept: null, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (state.status === 'loading') return <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>;
  if (state.status === 'error') return <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>;
  const dept = state.dept;
  if (!dept) return null;

  const peopleById = Object.fromEntries(
    [...dept.members, ...(dept.head ? [dept.head] : [])].map((m) => {
      const userId = m.userId || m.id;
      return [userId, {
        id: userId, name: m.name, color: m.avatarColor,
        initials: m.name.split(' ').map((p) => p[0]).slice(0, 2).join(''),
      }];
    }),
  );

  return (
    <BoardDataProvider peopleById={peopleById}>
      <div style={{
        width: '100%', height: '100%',
        background: theme.bg, color: theme.text,
        direction: rtl ? 'rtl' : 'ltr', overflow: 'auto',
      }}>
        <div style={{
          padding: '22px 28px 18px',
          background: `linear-gradient(135deg, oklch(.96 .04 ${dept.hue}) 0%, ${theme.bg} 80%)`,
          borderBottom: `.5px solid ${theme.border}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 4 }}>
            {rtl ? 'عرض القسم' : 'Department view'}{dept.head && ` · ${dept.head.name}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: `oklch(.88 .12 ${dept.hue})`, color: `oklch(.35 .16 ${dept.hue})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700,
            }}>{dept.icon}</div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: theme.text, letterSpacing: '-.02em', margin: 0 }}>{localizedName(dept, rtl)}</h1>
              <div style={{ fontSize: 12.5, color: theme.muted, marginTop: 2 }}>
                {dept.memberCount} {rtl ? 'عضو' : 'members'} · {dept.teamCount} {rtl ? 'فرق' : 'teams'} · {dept.projectCount} {rtl ? 'مشاريع' : 'boards'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatChip label={rtl ? 'مشاريع' : 'Boards'} value={kpis?.department.boardCount ?? dept.projectCount} accent={theme.accent} theme={theme} />
            <StatChip label={rtl ? 'الفرق' : 'Teams'} value={dept.teamCount} theme={theme} />
            <StatChip label={rtl ? 'الأعضاء' : 'Members'} value={dept.memberCount} theme={theme} />
            {kpis && (
              <>
                <StatChip label={rtl ? 'مهام نشطة' : 'Active tasks'} value={kpis.department.activeTotal} theme={theme} />
                <StatChip label={rtl ? 'متأخرة' : 'Overdue'}
                  value={kpis.department.overdueTotal}
                  accent={kpis.department.overdueTotal > 0 ? '#DC2626' : undefined}
                  theme={theme} />
                <StatChip label={rtl ? 'مكتملة (٧ أيام)' : 'Completed (7d)'} value={kpis.department.completedThisWeek} theme={theme} />
                <StatChip label={rtl ? 'مكتملة (٣٠ يوم)' : 'Completed (30d)'} value={kpis.department.completedThisMonth} theme={theme} />
              </>
            )}
          </div>
        </div>

        <DeptTabs theme={theme} rtl={rtl} tab={tab} setTab={setTab} />

        <div style={{ padding: '18px 28px 32px' }}>
          {tab === 'projects' && <DeptProjectsTab theme={theme} rtl={rtl} dept={dept} navigate={navigate}
            canManage={(() => {
              const m = auth.memberships[0];
              if (!m) return false;
              if (m.role === 'admin') return true;
              if (m.role === 'dept_manager' && m.departmentId === dept.id) return true;
              return false;
            })()}
            workspaceId={workspaceId}
            onTeamsChanged={() => {
              // Refetch the dept detail so the Teams section reflects edits.
              setState((s) => ({ ...s, status: 'loading' }));
              api(`/departments/${id}/detail`).then((d) => setState({ status: 'ready', dept: d, error: null }));
            }}
          />}
          {tab === 'members' && <DeptMembersTab theme={theme} rtl={rtl} dept={dept} kpis={kpis} />}
          {tab === 'media' && <MediaLibrary theme={theme} rtl={rtl} deptId={dept.id} />}
          {tab === 'chat' && <DeptChat theme={theme} rtl={rtl} deptId={dept.id} />}
        </div>
      </div>
    </BoardDataProvider>
  );
}

function DeptTabs({ theme, rtl, tab, setTab }) {
  const tabs = [
    { id: 'projects', label: rtl ? 'المشاريع' : 'Projects' },
    { id: 'members',  label: rtl ? 'الأعضاء' : 'Members' },
    { id: 'media',    label: rtl ? 'الميديا' : 'Media' },
    { id: 'chat',     label: rtl ? 'الشات' : 'Chat' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 2,
      padding: '0 28px',
      borderBottom: `.5px solid ${theme.border}`,
      background: theme.surface,
    }}>
      {tabs.map((t) => {
        const active = t.id === tab;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '11px 16px',
            background: 'transparent', border: 'none',
            borderBottom: `2px solid ${active ? theme.accent : 'transparent'}`,
            color: active ? theme.text : theme.muted,
            fontSize: 13, fontWeight: active ? 600 : 500,
            cursor: 'pointer', fontFamily: 'inherit',
            marginBottom: -1,
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

function DeptProjectsTab({ theme, rtl, dept, navigate, canManage, workspaceId, onTeamsChanged }) {
  const [editingTeam, setEditingTeam] = React.useState(null); // team object or 'new'

  const deleteTeam = async (team) => {
    if (!confirm(rtl ? `حذف الفريق "${team.name}"؟` : `Delete team "${team.name}"?`)) return;
    try {
      await api(`/teams/${team.id}`, { method: 'DELETE' });
      onTeamsChanged?.();
    } catch (err) { alert(err.message); }
  };
  return (
    <>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px' }}>{rtl ? 'مشاريع القسم' : 'Department boards'}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {dept.projects.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: theme.muted, textAlign: 'center', background: theme.surface, borderRadius: theme.cardRadius, border: `.5px dashed ${theme.border}` }}>
            {rtl ? 'لا توجد مشاريع في هذا القسم' : 'No boards in this department'}
          </div>
        )}
        {dept.projects.map((p) => (
          <div key={p.id} onClick={() => navigate(`/b/${p.id}`)} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 110px',
            alignItems: 'center', gap: 12, padding: '12px 14px',
            background: theme.surface, borderRadius: theme.cardRadius,
            border: `.5px solid ${theme.border}`, cursor: 'pointer',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `oklch(.72 .14 ${p.hue})`,
            }} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>{p.title}</div>
            <div style={{ fontSize: 11, color: theme.mutedDim, textAlign: 'end' }}>{formatRelative(p.updatedAt)}</div>
          </div>
        ))}
      </div>

      {(dept.teams.length > 0 || canManage) && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: 0 }}>{rtl ? 'الفرق' : 'Teams'}</h2>
            {canManage && (
              <button onClick={() => setEditingTeam('new')} style={{
                background: theme.accent, color: theme.accentText, border: 'none',
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>+ {rtl ? 'فريق جديد' : 'New team'}</button>
            )}
          </div>
          {dept.teams.length === 0 && canManage && (
            <div style={{
              padding: 18, background: theme.surface, borderRadius: theme.cardRadius,
              border: `.5px dashed ${theme.border}`, fontSize: 12.5, color: theme.muted, textAlign: 'center',
            }}>{rtl ? 'لا توجد فرق في هذا القسم بعد — أنشئ أول فريق.' : 'No teams in this department yet — create the first one.'}</div>
          )}
          {dept.teams.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {dept.teams.map((t) => (
                <div key={t.id} style={{
                  padding: '12px 14px',
                  background: theme.surface, borderRadius: theme.cardRadius,
                  border: `.5px solid ${theme.border}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{localizedName(t, rtl)}</div>
                    {t.members.length > 0 && (
                      <AvatarStack ids={t.members.map((m) => m.id)} size={20} ringColor={theme.surface} />
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 11, color: theme.muted }}>
                      {t.memberCount} {rtl ? 'أعضاء' : 'members'} · {t.projectCount} {rtl ? 'مشاريع' : 'boards'}
                    </div>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setEditingTeam(t)} style={teamMiniBtn(theme)}>{rtl ? 'تعديل' : 'Edit'}</button>
                        <button onClick={() => deleteTeam(t)} style={{ ...teamMiniBtn(theme), color: '#DC2626' }}>{rtl ? 'حذف' : 'Delete'}</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editingTeam && (
        <DeptTeamForm theme={theme} rtl={rtl} workspaceId={workspaceId}
          dept={dept}
          initial={editingTeam === 'new' ? null : editingTeam}
          onClose={() => setEditingTeam(null)}
          onSaved={() => { setEditingTeam(null); onTeamsChanged?.(); }}
        />
      )}
    </>
  );
}

function teamMiniBtn(theme) {
  return {
    background: 'transparent', border: `.5px solid ${theme.border}`,
    color: theme.text, padding: '3px 9px', borderRadius: 4,
    fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  };
}

function DeptTeamForm({ theme, rtl, workspaceId, dept, initial, onClose, onSaved }) {
  const [name, setName] = React.useState(initial?.name || '');
  const [nameAr, setNameAr] = React.useState(initial?.nameAr || '');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      if (initial) {
        await api(`/teams/${initial.id}`, {
          method: 'PATCH',
          body: { name: name.trim(), nameAr: nameAr.trim() || null },
        });
      } else {
        await api(`/workspaces/${workspaceId}/teams`, {
          method: 'POST',
          body: { name: name.trim(), nameAr: nameAr.trim() || null, departmentId: dept.id },
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal theme={theme} onClose={onClose}
      title={initial ? (rtl ? 'تعديل الفريق' : 'Edit team') : (rtl ? 'فريق جديد' : 'New team')}
      footer={<>
        <GhostBtn theme={theme} onClick={onClose}>{rtl ? 'إلغاء' : 'Cancel'}</GhostBtn>
        <PrimaryBtn theme={theme} onClick={submit} disabled={saving || !name.trim()}>
          {saving ? '…' : (rtl ? 'حفظ' : 'Save')}
        </PrimaryBtn>
      </>}>
      <div style={{ fontSize: 12, color: theme.muted, marginBottom: 12 }}>
        {rtl ? `الفريق سيُنشأ ضمن قسم ${localizedName(dept, rtl)}.` : `Team will be created under ${localizedName(dept, rtl)}.`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field theme={theme} label={rtl ? 'الاسم بالإنجليزية' : 'Name (English)'} hint={rtl ? 'مطلوب' : 'Required'}>
          <TextInput theme={theme} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Mobile Apps" dir="ltr" />
        </Field>
        <Field theme={theme} label={rtl ? 'الاسم بالعربية' : 'Name (Arabic)'} hint={rtl ? 'اختياري' : 'Optional'}>
          <TextInput theme={theme} value={nameAr} onChange={(e) => setNameAr(e.target.value)}
            placeholder="تطبيقات الجوال" dir="rtl" />
        </Field>
      </div>
      {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}

function DeptMembersTab({ theme, rtl, dept, kpis }) {
  const navigate = useNavigate();
  // KPIs come keyed by userId — merge with member rows so we can show
  // active/overdue/completed counts inline.
  const kpiByUser = React.useMemo(() => {
    const m = new Map();
    if (kpis?.members) for (const k of kpis.members) m.set(k.userId, k);
    return m;
  }, [kpis]);

  return (
    <>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px' }}>
        {rtl ? `أعضاء القسم (${dept.members.length})` : `Department members (${dept.members.length})`}
      </h2>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8,
      }}>
        {dept.members.map((m) => {
          const k = kpiByUser.get(m.userId);
          return (
            <button key={m.userId} onClick={() => navigate(`/u/${m.userId}`)} style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: '12px 14px', textAlign: rtl ? 'right' : 'left',
              background: theme.surface, borderRadius: theme.cardRadius,
              border: `.5px solid ${theme.border}`, cursor: 'pointer',
              fontFamily: 'inherit', alignItems: 'stretch',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar id={m.userId} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                </div>
                <RoleBadge role={m.role} />
              </div>
              {k && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
                  paddingTop: 8, borderTop: `.5px solid ${theme.border}`,
                }}>
                  <MiniStat theme={theme} value={k.active} label={rtl ? 'نشطة' : 'Active'} />
                  <MiniStat theme={theme} value={k.overdue} label={rtl ? 'متأخرة' : 'Overdue'}
                    color={k.overdue > 0 ? '#DC2626' : undefined} />
                  <MiniStat theme={theme} value={k.completedThisMonth} label={rtl ? 'هذا الشهر' : 'This month'}
                    color={k.completedThisMonth > 0 ? '#0E7C66' : undefined} />
                  <MiniStat theme={theme} value={k.completedTotal} label={rtl ? 'إجمالي' : 'Total done'} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function MiniStat({ theme, value, label, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || theme.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 9.5, color: theme.muted, marginTop: 2, letterSpacing: '.02em' }}>
        {label}
      </div>
    </div>
  );
}

function DeptComingSoon({ theme, rtl, kind }) {
  const titles = {
    media: rtl ? 'مكتبة الميديا' : 'Media library',
    chat:  rtl ? 'شات القسم' : 'Department chat',
  };
  const desc = {
    media: rtl ? 'مكان موحّد لرفع الملفات والصور وملفات التصميم لكل أعضاء القسم.' : 'A shared space for files, images and design assets across the whole department.',
    chat:  rtl ? 'محادثة جماعية لأعضاء القسم: نص، صور، ملفات، رسائل صوتية.' : 'A group conversation for the department: text, images, files, and voice messages.',
  };
  const icons = { media: '🗂', chat: '💬' };
  return (
    <div style={{
      padding: '60px 24px', textAlign: 'center',
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px dashed ${theme.border}`,
    }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icons[kind]}</div>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.text, margin: '0 0 6px' }}>{titles[kind]}</h3>
      <p style={{ fontSize: 12.5, color: theme.muted, margin: '0 auto', maxWidth: 380, lineHeight: 1.6 }}>
        {desc[kind]}
      </p>
      <span style={{
        display: 'inline-block', marginTop: 14,
        padding: '4px 10px', borderRadius: 999,
        background: theme.accentSoft, color: theme.accent,
        fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase',
      }}>{rtl ? 'قريبًا' : 'Coming soon'}</span>
    </div>
  );
}

// ── My Work view ───────────────────────────────────────────────────────────

export function MyWorkView({ themeName, accent, rtl }) {
  const theme = buildTheme(themeName, accent);
  const navigate = useNavigate();
  const auth = useAuth();
  const me = auth.user;
  const myMembership = auth.memberships[0];
  const [state, setState] = React.useState({ status: 'loading', tasks: [], stats: null, labelsById: {}, error: null });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('/me/tasks');
        if (!cancelled) setState({ status: 'ready', ...r, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', tasks: [], stats: null, labelsById: {}, error: err });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') return <CenterMsg theme={theme}>{rtl ? 'جاري التحميل…' : 'Loading…'}</CenterMsg>;
  if (state.status === 'error') return <CenterMsg theme={theme} error>{state.error?.message}</CenterMsg>;

  const now = Date.now();
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const today = state.tasks.filter((t) => t.due && new Date(t.due) <= todayEnd);
  const upcoming = state.tasks.filter((t) => !t.due || new Date(t.due) > todayEnd);

  const peopleById = me ? {
    [me.id]: {
      id: me.id, name: `${me.firstName} ${me.lastName}`, color: me.avatarColor,
      initials: (me.firstName?.[0] || '') + (me.lastName?.[0] || ''),
    },
  } : {};

  return (
    <BoardDataProvider peopleById={peopleById} labelsById={state.labelsById}>
      <div style={{
        width: '100%', height: '100%',
        background: theme.bg, color: theme.text,
        direction: rtl ? 'rtl' : 'ltr', overflow: 'auto',
        padding: '22px 28px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
          <Avatar id={me?.id || ''} size={46} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: theme.muted, marginBottom: 2 }}>
              {rtl ? 'مساحة عملي' : 'My work'}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: '-.02em' }}>
              {rtl ? `أهلًا، ${me?.firstName || ''}` : `Hi, ${me?.firstName || 'there'}`}
            </h1>
          </div>
          {myMembership && (
            <div style={{ marginInlineStart: 'auto' }}>
              <RoleBadge role={myMembership.role} />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 22 }}>
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: 0 }}>
                  {rtl ? 'اليوم' : 'Today'} <span style={{ color: theme.muted, fontWeight: 500 }}>· {today.length}</span>
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {today.length === 0 && (
                  <div style={{ padding: 14, fontSize: 12, color: theme.muted, textAlign: 'center', background: theme.surface, borderRadius: theme.cardRadius, border: `.5px dashed ${theme.border}` }}>
                    {rtl ? 'لا توجد مهام لليوم' : 'Nothing due today'}
                  </div>
                )}
                {today.map((task) => {
                  const overdue = task.due && new Date(task.due).getTime() < now;
                  return (
                    <div key={task.id} onClick={() => navigate(`/b/${task.boardId}?card=${task.id}`)} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px',
                      background: theme.surface, borderRadius: theme.cardRadius,
                      border: `.5px solid ${theme.border}`,
                      borderInlineStart: `3px solid ${overdue ? '#DC2626' : '#D97706'}`,
                      cursor: 'pointer',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>{task.title}</div>
                        <div style={{ fontSize: 11, color: theme.muted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>{task.boardTitle}</span>
                          <span>·</span>
                          <span>{task.listTitle}</span>
                          {task.checklistTotal > 0 && (
                            <><span>·</span><span>{task.checklistDone}/{task.checklistTotal} ✓</span></>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: overdue ? '#DC2626' : theme.muted, fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(task.due).toLocaleDateString(rtl ? 'ar' : 'en', { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {upcoming.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: '0 0 10px' }}>
                  {rtl ? 'قادم' : 'Upcoming'} <span style={{ color: theme.muted, fontWeight: 500 }}>· {upcoming.length}</span>
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {upcoming.map((task) => (
                    <div key={task.id} onClick={() => navigate(`/b/${task.boardId}?card=${task.id}`)} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px',
                      background: theme.surface, borderRadius: theme.cardRadius,
                      border: `.5px solid ${theme.border}`, cursor: 'pointer',
                    }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: theme.text, fontWeight: 500 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: theme.muted }}>{task.boardTitle}</div>
                      <div style={{ fontSize: 11, color: theme.mutedDim, fontVariantNumeric: 'tabular-nums', minWidth: 50, textAlign: 'end' }}>
                        {task.due ? new Date(task.due).toLocaleDateString(rtl ? 'ar' : 'en', { month: 'short', day: 'numeric' }) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {state.tasks.length === 0 && (
              <div style={{
                padding: 40, textAlign: 'center', color: theme.muted, fontSize: 13.5,
                background: theme.surface, border: `.5px dashed ${theme.border}`,
                borderRadius: theme.cardRadius,
              }}>
                {rtl ? 'لا توجد مهام مُسندة لك بعد' : 'No tasks assigned to you yet'}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              padding: '14px 16px',
              background: theme.surface, borderRadius: theme.cardRadius,
              border: `.5px solid ${theme.border}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: theme.text, marginBottom: 10 }}>{rtl ? 'هذا الأسبوع' : 'This week'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <StatChip label={rtl ? 'الكل' : 'Total'} value={state.stats?.total ?? 0} theme={theme} />
                <StatChip label={rtl ? 'متأخر' : 'Overdue'} value={state.stats?.overdue ?? 0} accent={(state.stats?.overdue ?? 0) > 0 ? '#DC2626' : null} theme={theme} />
                <StatChip label={rtl ? 'اليوم' : 'Today'} value={state.stats?.dueToday ?? 0} accent="#D97706" theme={theme} />
                <StatChip label={rtl ? 'مكتمل' : 'Done'} value={state.stats?.completedThisWeek ?? 0} accent="#0E7C66" theme={theme} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </BoardDataProvider>
  );
}
