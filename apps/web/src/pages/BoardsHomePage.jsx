import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { buildTheme } from '../ui/theme.js';
import { Icon } from '../ui/Icon.jsx';
import { api, getAccessToken } from '../lib/api.js';
import { normalizeBoardSummary } from '../lib/normalize.js';
import { activeMembership, canCreateBoard } from '../state/permissions.js';
import { localizedName } from '../lib/i18n.js';

// Append access token so <img> requests can authenticate without an
// Authorization header (browsers don't send custom headers on image loads).
function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

export function BoardsHomePage() {
  return (
    <AppShell>
      <BoardsHomeContent />
    </AppShell>
  );
}

function BoardsHomeContent() {
  const s = useSettings();
  const auth = useAuth();
  const theme = buildTheme(s.themeName, s.accent);
  const navigate = useNavigate();
  const rtl = s.rtl;

  const m = activeMembership(auth);
  const workspaceId = m?.workspaceId;
  const canCreate = canCreateBoard(m);
  const [state, setState] = React.useState({ status: 'loading', boards: [], error: null });
  const [showCreate, setShowCreate] = React.useState(false);

  const refetch = React.useCallback(async () => {
    if (!workspaceId) {
      setState({ status: 'ready', boards: [], error: null });
      return;
    }
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const raw = await api(`/workspaces/${workspaceId}/boards`);
      setState({ status: 'ready', boards: raw.boards.map(normalizeBoardSummary), error: null });
    } catch (err) {
      setState({ status: 'error', boards: [], error: err });
    }
  }, [workspaceId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  const onOpen = (id) => navigate('/b/' + id);
  const onCreated = (board) => {
    setShowCreate(false);
    navigate('/b/' + board.id);
  };
  const starred = state.boards.filter((b) => b.starred);

  return (
    <div style={{
      flex: 1, padding: '24px 28px', overflowY: 'auto',
      background: theme.boardBg, color: theme.text,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: 22, fontWeight: 700,
            color: theme.text, letterSpacing: '-.02em',
          }}>{rtl ? 'لوحاتك' : 'Your boards'}</h1>
          <div style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>
            {state.status === 'loading'
              ? (rtl ? 'جاري التحميل…' : 'Loading…')
              : `${state.boards.length} ${rtl ? 'لوحات' : 'board' + (state.boards.length === 1 ? '' : 's')}`}
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: theme.accent, color: theme.accentText,
            border: 'none', padding: '8px 14px', borderRadius: 7,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            <Icon.plus /> {rtl ? 'لوحة جديدة' : 'New board'}
          </button>
        )}
      </div>

      {state.status === 'error' && (
        <div style={{
          padding: '12px 16px', background: '#FEE2E2', color: '#991B1B',
          borderRadius: theme.cardRadius, fontSize: 12.5, marginBottom: 16,
        }}>{rtl ? 'فشل تحميل اللوحات: ' : 'Failed to load boards: '}{state.error?.message}</div>
      )}

      {state.status === 'ready' && state.boards.length === 0 && (
        <div style={{
          padding: 40, textAlign: 'center', color: theme.muted, fontSize: 13.5,
          background: theme.surface, border: `.5px dashed ${theme.border}`,
          borderRadius: theme.radius,
        }}>
          {rtl ? 'لا توجد لوحات بعد. أنشئ لوحتك الأولى.' : 'No boards yet. Create your first one.'}
        </div>
      )}

      {starred.length > 0 && (
        <>
          <SectionHeader theme={theme} starred>{rtl ? 'مفضلة' : 'Starred'}</SectionHeader>
          <Grid>
            {starred.map((b) => (
              <BoardCard key={b.id} board={b} theme={theme} rtl={rtl} onOpen={onOpen} />
            ))}
          </Grid>
        </>
      )}

      {state.boards.length > 0 && (
        <DepartmentGroups
          boards={state.boards}
          theme={theme} rtl={rtl}
          onOpen={onOpen}
          canCreate={canCreate}
          onCreate={() => setShowCreate(true)}
        />
      )}

      {showCreate && (
        <NewBoardModal theme={theme} rtl={rtl}
          workspaceId={workspaceId}
          isAdmin={m?.role === 'admin'}
          onClose={() => setShowCreate(false)}
          onCreated={onCreated} />
      )}
    </div>
  );
}

function NewBoardModal({ theme, rtl, workspaceId, isAdmin, onClose, onCreated }) {
  const [title, setTitle] = React.useState('');
  const [hue, setHue] = React.useState(220);
  const [departmentId, setDepartmentId] = React.useState('');  // '' = workspace-wide
  const [departments, setDepartments] = React.useState(null);  // null until loaded
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Admins choose where the board lives. Other roles are auto-scoped server-side.
  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api(`/workspaces/${workspaceId}/departments`)
      .then((d) => { if (!cancelled) setDepartments(d.departments || []); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, [isAdmin, workspaceId]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setError(null);
    try {
      const body = { title: title.trim(), hue: Number(hue) };
      if (isAdmin && departmentId) body.departmentId = departmentId;
      const board = await api(`/workspaces/${workspaceId}/boards`, {
        method: 'POST',
        body,
      });
      onCreated(board);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const HUES = [220, 28, 280, 340, 160, 200, 50];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(10,12,18,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 440, maxWidth: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{rtl ? 'لوحة جديدة' : 'New board'}</h3>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none', color: theme.muted,
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}>×</button>
        </div>
        <div style={{ padding: '20px' }}>
          <div style={{
            height: 60, borderRadius: 8, marginBottom: 16,
            background: `linear-gradient(135deg, oklch(0.72 0.14 ${hue}), oklch(0.55 0.18 ${hue + 20}))`,
          }} />
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.text, marginBottom: 5 }}>{rtl ? 'العنوان' : 'Title'}</div>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={rtl ? 'مشروع جديد' : 'My new board'}
              style={{
                width: '100%', padding: '10px 12px',
                background: theme.bg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 6,
                fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
              }} />
          </label>
          {isAdmin && (
            <label style={{ display: 'block', marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.text, marginBottom: 5 }}>
                {rtl ? 'القسم' : 'Department'}
              </div>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                disabled={departments === null}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: theme.bg, color: theme.text,
                  border: `1px solid ${theme.border}`, borderRadius: 6,
                  fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
                  cursor: departments === null ? 'wait' : 'pointer',
                }}>
                <option value="">{rtl ? 'لكل المساحة (مرئية للجميع)' : 'Workspace-wide (visible to everyone)'}</option>
                {(departments || []).map((d) => (
                  <option key={d.id} value={d.id}>{rtl ? (d.nameAr || d.name) : d.name}</option>
                ))}
              </select>
              <div style={{ fontSize: 10.5, color: theme.muted, marginTop: 4 }}>
                {rtl
                  ? 'اختيار قسم يقصر اللوحة على أعضائه فقط.'
                  : 'Picking a department restricts the board to its members.'}
              </div>
            </label>
          )}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.text, marginBottom: 6 }}>{rtl ? 'لون اللوحة' : 'Background'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {HUES.map((h) => (
                <button key={h} type="button" onClick={() => setHue(h)} style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: `linear-gradient(135deg, oklch(0.72 0.14 ${h}), oklch(0.55 0.18 ${h + 20}))`,
                  border: hue === h ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
                  cursor: 'pointer', padding: 0,
                }} />
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 12 }}>{error}</div>}
        </div>
        <div style={{
          padding: '12px 20px', borderTop: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button type="button" onClick={onClose} style={{
            padding: '8px 14px', borderRadius: 6,
            background: 'transparent', color: theme.muted,
            border: `.5px solid ${theme.border}`,
            fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" disabled={saving || !title.trim()} style={{
            padding: '8px 14px', borderRadius: 6,
            background: theme.accent, color: theme.accentText, border: 'none',
            fontSize: 12.5, fontWeight: 600,
            cursor: saving ? 'default' : 'pointer', opacity: saving || !title.trim() ? 0.6 : 1,
            fontFamily: 'inherit',
          }}>{saving ? '…' : (rtl ? 'إنشاء اللوحة' : 'Create board')}</button>
        </div>
      </form>
    </div>
  );
}

function SectionHeader({ theme, starred, children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
      color: theme.mutedDim, textTransform: 'uppercase', marginBottom: 10, marginTop: 10,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {starred && <Icon.star filled size={12} />}
      {children}
    </div>
  );
}

function Grid({ children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 12, marginBottom: 24,
    }}>{children}</div>
  );
}

// Boards grouped under collapsible department headers — mirrors the sidebar
// pattern so users have a consistent mental model across the app. Expanded
// state persists in localStorage. Boards without a department fall under
// "General" at the bottom.
function DepartmentGroups({ boards, theme, rtl, onOpen, canCreate, onCreate }) {
  const groups = React.useMemo(() => {
    const byDept = new Map();
    for (const b of boards) {
      const key = b.departmentId || '__general__';
      if (!byDept.has(key)) {
        byDept.set(key, {
          id: key,
          name: b.departmentName,
          nameAr: b.departmentNameAr,
          hue: b.departmentHue,
          boards: [],
        });
      }
      byDept.get(key).boards.push(b);
    }
    const arr = [...byDept.values()];
    arr.sort((a, b) => {
      if (a.id === '__general__') return 1;
      if (b.id === '__general__') return -1;
      return localizedName(a, rtl).localeCompare(localizedName(b, rtl));
    });
    return arr;
  }, [boards, rtl]);

  const [expanded, setExpanded] = React.useState(() => {
    try {
      const raw = localStorage.getItem('sarsync:boardsHome:expandedDepts');
      // Default to all expanded if nothing stored; users want to see boards on first visit.
      return raw ? new Set(JSON.parse(raw)) : null;
    } catch { return null; }
  });

  // First-time: expand every group so the user sees everything.
  React.useEffect(() => {
    if (expanded === null && groups.length > 0) {
      setExpanded(new Set(groups.map((g) => g.id)));
    }
  }, [groups, expanded]);

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('sarsync:boardsHome:expandedDepts', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const isOpen = (id) => (expanded === null) ? true : expanded.has(id);
  const Chevron = Icon.chevron;

  // The "Create new board" tile only renders inside the dept the user belongs
  // to — or under General if they have no dept. Admins see it under General
  // since they have no single home dept.
  const createTileGroupId = '__general__';

  return (
    <>
      {groups.map((g) => {
        const open = isOpen(g.id);
        const label = g.id === '__general__'
          ? (rtl ? 'عام' : 'General')
          : localizedName(g, rtl);
        const swatch = g.id === '__general__'
          ? { background: theme.border, color: theme.muted }
          : { background: `oklch(.78 .12 ${g.hue})`, color: `oklch(.32 .14 ${g.hue})` };
        const tooltip = g.id === '__general__'
          ? (rtl ? 'لوحات عابرة للأقسام — يُنشئها الأدمن فقط' : 'Cross-functional boards — admin-created only')
          : undefined;
        return (
          <div key={g.id} style={{ marginBottom: 16 }}>
            <button onClick={() => toggle(g.id)} title={tooltip} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', background: 'transparent', border: 'none',
              padding: '8px 4px', cursor: 'pointer',
              color: theme.text, fontFamily: 'inherit',
              textAlign: rtl ? 'right' : 'left',
              marginBottom: open ? 8 : 0,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
                ...swatch,
              }}>{(label?.[0] || '·').toUpperCase()}</span>
              <span style={{
                fontSize: 13, fontWeight: 700, letterSpacing: '.04em',
                color: theme.text, textTransform: 'uppercase', flex: 1,
              }}>{label}</span>
              <span style={{ fontSize: 12, color: theme.muted, fontVariantNumeric: 'tabular-nums' }}>
                {g.boards.length}
              </span>
              <span style={{
                color: theme.muted, display: 'inline-flex',
                transform: rtl ? 'scaleX(-1)' : 'none',
              }}>
                <Chevron size={12} open={open} />
              </span>
            </button>
            {open && (
              <Grid>
                {g.boards.map((b) => (
                  <BoardCard key={b.id} board={b} theme={theme} rtl={rtl} onOpen={onOpen} />
                ))}
                {canCreate && g.id === createTileGroupId && (
                  <button onClick={onCreate} style={{
                    background: theme.name === 'dark' ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.03)',
                    border: `.5px dashed ${theme.border}`,
                    borderRadius: theme.radius,
                    minHeight: 110,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 6, color: theme.muted, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <Icon.plus size={18} />
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                      {rtl ? 'إنشاء لوحة' : 'Create new board'}
                    </span>
                  </button>
                )}
              </Grid>
            )}
          </div>
        );
      })}
    </>
  );
}

function BoardCard({ board, theme, rtl, onOpen }) {
  const [hover, setHover] = React.useState(false);
  const grad = `linear-gradient(135deg, oklch(0.72 0.14 ${board.hue}), oklch(0.55 0.18 ${board.hue + 20}))`;
  return (
    <div
      onClick={() => onOpen && onOpen(board.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: theme.surface, borderRadius: theme.radius,
        boxShadow: theme.shadow,
        overflow: 'hidden', cursor: 'pointer',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'transform .15s, box-shadow .15s',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
      }}>
      <div style={{
        height: 56, position: 'relative',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: 8,
        background: board.coverUrl
          ? `url(${withToken(board.coverUrl)}) center/cover, ${grad}`
          : grad,
      }}>
        {board.team && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.1em',
            color: 'rgba(255,255,255,.85)', textTransform: 'uppercase',
            background: 'rgba(0,0,0,.18)', padding: '2px 6px', borderRadius: 4,
          }}>{board.team}</span>
        )}
        {board.starred && (
          <span style={{ color: '#FFD56B', marginInlineStart: 'auto' }}><Icon.star filled size={12} /></span>
        )}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: theme.text,
          letterSpacing: '-.005em', marginBottom: 4,
          textWrap: 'balance',
        }}>{board.title}</div>
        <div style={{
          fontSize: 11.5, color: theme.muted,
          display: 'flex', gap: 10,
        }}>
          <span>{board.lists} {rtl ? 'قوائم' : 'lists'}</span>
          <span>{board.cards} {rtl ? 'بطاقة' : 'cards'}</span>
          <span style={{ marginInlineStart: 'auto' }}>{board.updated}</span>
        </div>
      </div>
    </div>
  );
}
