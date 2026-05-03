import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from './Icon.jsx';

// Spotlight-style command palette. Cmd/Ctrl+K opens it.

export function SearchPalette({ theme, rtl, open, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState({ boards: [], cards: [] });
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef(null);

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setQ(''); setResults({ boards: [], cards: [] }); setActiveIdx(0);
    }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults({ boards: [], cards: [] });
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api(`/search?q=${encodeURIComponent(q.trim())}`);
        setResults(r);
        setActiveIdx(0);
      } catch {
        setResults({ boards: [], cards: [] });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  // Flatten for keyboard navigation
  const flat = [
    ...results.boards.map((b) => ({ kind: 'board', id: b.id, label: b.title, sub: b.workspaceName, hue: b.hue, navTo: `/b/${b.id}` })),
    ...results.cards.map((c) => ({ kind: 'card', id: c.id, label: c.title, sub: `${c.boardTitle} · ${c.listTitle}`, hue: c.boardHue, navTo: `/b/${c.boardId}?card=${c.id}` })),
  ];

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flat[activeIdx]) { e.preventDefault(); navigate(flat[activeIdx].navTo); onClose(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 80,
      background: 'rgba(10,12,18,.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '15vh', padding: '15vh 20px 20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 600, maxWidth: '100%',
        boxShadow: '0 20px 80px rgba(0,0,0,.4)',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: `.5px solid ${theme.border}`,
        }}>
          <Icon.search size={16} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={rtl ? 'ابحث في كل اللوحات والبطاقات…' : 'Search across boards and cards…'}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 15, color: theme.text, fontFamily: 'inherit',
            }} />
          <span style={{
            fontSize: 10, padding: '2px 6px',
            background: theme.surface2, color: theme.muted,
            borderRadius: 4, fontFamily: 'ui-monospace, monospace',
          }}>ESC</span>
        </div>
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {q.trim().length < 2 && (
            <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'اكتب حرفين على الأقل للبدء' : 'Type at least 2 characters to search'}
            </div>
          )}
          {q.trim().length >= 2 && loading && (
            <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'جاري البحث…' : 'Searching…'}
            </div>
          )}
          {q.trim().length >= 2 && !loading && flat.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'لا توجد نتائج' : 'No matches'}
            </div>
          )}
          {results.boards.length > 0 && <SearchSection theme={theme} label={rtl ? 'لوحات' : 'Boards'} />}
          {flat.slice(0, results.boards.length).map((item, i) => (
            <SearchRow key={item.id} item={item} theme={theme} active={activeIdx === i}
              onClick={() => { navigate(item.navTo); onClose(); }} />
          ))}
          {results.cards.length > 0 && <SearchSection theme={theme} label={rtl ? 'بطاقات' : 'Cards'} />}
          {flat.slice(results.boards.length).map((item, idx) => {
            const i = results.boards.length + idx;
            return (
              <SearchRow key={item.id} item={item} theme={theme} active={activeIdx === i}
                onClick={() => { navigate(item.navTo); onClose(); }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchSection({ theme, label }) {
  return (
    <div style={{
      padding: '8px 18px 4px',
      fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
      color: theme.mutedDim, textTransform: 'uppercase',
    }}>{label}</div>
  );
}

function SearchRow({ item, theme, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 18px', width: '100%',
      background: active ? theme.accentSoft : 'transparent',
      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      textAlign: 'start',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: `linear-gradient(135deg, oklch(0.72 0.14 ${item.hue || 220}), oklch(0.55 0.18 ${(item.hue || 220) + 20}))`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: active ? theme.accent : theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.label}
        </div>
        <div style={{ fontSize: 11, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.kind === 'board' ? '📋 ' : '🗂 '}{item.sub}
        </div>
      </div>
      {active && <span style={{ fontSize: 11, color: theme.muted }}>↵</span>}
    </button>
  );
}
