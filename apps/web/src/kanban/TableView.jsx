import React from 'react';
import { api } from '../lib/api.js';
import { formatDueDate } from '../lib/normalize.js';

// Spreadsheet-style view of a board: one row per card (across all lists),
// columns = Title + Stage (the card's list) + the board's custom fields. Rows
// align naturally — this is what tabular trackers (maintenance logs, etc.)
// actually want. Built on the Phase-1 field data; built-in due/members stay in
// the card modal. RTL: a real <table> with `direction: rtl` flips column order
// for free — no manual flipping (see CLAUDE.md).

export function TableView({ theme, rtl, lists, fields, peopleById, workspaceId, canEdit, onCardClick, onSetFieldValue, onMoveCard }) {
  const rows = React.useMemo(
    () => lists.flatMap((l) => l.cards.map((card) => ({ card, list: l }))),
    [lists],
  );

  // Person-field editors need the full assignable-member list (peopleById only
  // holds people already referenced on the board).
  const hasPerson = fields.some((f) => f.type === 'person');
  const [members, setMembers] = React.useState([]);
  React.useEffect(() => {
    if (!hasPerson || !workspaceId) return;
    let cancelled = false;
    api(`/workspaces/${workspaceId}/members`)
      .then((r) => { if (!cancelled) setMembers(r.members || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasPerson, workspaceId]);

  const th = {
    textAlign: 'start', padding: '9px 12px',
    fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
    color: theme.mutedDim, textTransform: 'uppercase',
    borderBottom: `1px solid ${theme.border}`,
    whiteSpace: 'nowrap', position: 'sticky', top: 0,
    background: theme.surface, zIndex: 1,
  };
  const td = {
    padding: '6px 10px', borderBottom: `.5px solid ${theme.border}`,
    fontSize: 13, color: theme.text, verticalAlign: 'middle',
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 24px 24px' }}>
      <table style={{
        borderCollapse: 'collapse', width: '100%', minWidth: 640,
        background: theme.surface, borderRadius: 10, overflow: 'hidden',
        border: `.5px solid ${theme.border}`,
      }}>
        <thead>
          <tr>
            <th style={{ ...th, minWidth: 240 }}>{rtl ? 'العنوان' : 'Title'}</th>
            <th style={{ ...th, minWidth: 150 }}>{rtl ? 'المرحلة' : 'Stage'}</th>
            {fields.map((f) => (
              <th key={f.id} style={{ ...th, minWidth: 150 }}>{f.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={{ ...td, color: theme.mutedDim }} colSpan={2 + fields.length}>
                {rtl ? 'لا توجد بطاقات.' : 'No cards yet.'}
              </td>
            </tr>
          )}
          {rows.map(({ card, list }) => (
            <tr key={card.id}>
              <td style={{ ...td, minWidth: 240 }}>
                <button onClick={() => onCardClick?.(card.id)} style={{
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  color: theme.text, fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                  textAlign: 'start', width: '100%',
                }} title={rtl ? 'فتح البطاقة' : 'Open card'}>
                  {card.title}
                </button>
              </td>
              <td style={td}>
                <StageCell theme={theme} rtl={rtl} canEdit={canEdit}
                  lists={lists} currentListId={list.id}
                  onMove={(toListId) => onMoveCard?.(card.id, toListId)} />
              </td>
              {fields.map((f) => (
                <td key={f.id} style={td}>
                  <FieldCell theme={theme} rtl={rtl} canEdit={canEdit && !!onSetFieldValue}
                    field={f} value={card.fieldValues?.[f.id]}
                    members={members} peopleById={peopleById}
                    onSet={(body) => onSetFieldValue?.(card.id, f.id, body)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The card's list, rendered as a dropdown that moves the card to the end of the
// chosen list (reuses the same move path as drag-and-drop).
function StageCell({ theme, rtl, canEdit, lists, currentListId, onMove }) {
  const cellInput = {
    width: '100%', padding: '5px 8px', borderRadius: 5,
    background: 'transparent', color: theme.text,
    border: `.5px solid transparent`,
    fontSize: 12.5, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  };
  if (!canEdit) {
    const l = lists.find((x) => x.id === currentListId);
    return <span style={{ fontSize: 12.5 }}>{l?.title || '—'}</span>;
  }
  return (
    <select value={currentListId} style={cellInput}
      onChange={(e) => { if (e.target.value !== currentListId) onMove(e.target.value); }}
      onFocus={(e) => { e.target.style.borderColor = theme.border; e.target.style.background = theme.surface2; }}
      onBlur={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; }}>
      {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
    </select>
  );
}

// One custom-field cell. Always-on inline editor (table UX); plain text when
// read-only. Mirrors the body convention from useBoardApi.setCardFieldValue.
function FieldCell({ theme, rtl, canEdit, field, value, members, peopleById, onSet }) {
  const base = {
    width: '100%', padding: '5px 8px', borderRadius: 5,
    background: 'transparent', color: theme.text,
    border: `.5px solid transparent`,
    fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
  };
  const focusable = {
    onFocus: (e) => { e.target.style.borderColor = theme.border; e.target.style.background = theme.surface2; },
    onBlur: (e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; },
  };

  if (!canEdit) {
    let display = '—';
    if (field.type === 'text') display = value?.valueText || '—';
    else if (field.type === 'number') display = value?.valueNumber != null ? String(value.valueNumber) : '—';
    else if (field.type === 'date') display = value?.valueDate ? formatDueDate(value.valueDate) : '—';
    else if (field.type === 'select') display = (field.options || []).find((o) => o.id === value?.valueOptionId)?.label || '—';
    else if (field.type === 'person') display = (peopleById?.[value?.valueUserId]?.name) || (members.find((m) => m.userId === value?.valueUserId)?.name) || '—';
    return <span style={{ color: display === '—' ? theme.mutedDim : theme.text }}>{display}</span>;
  }

  if (field.type === 'text') {
    return <CellText base={base} focusable={focusable} type="text"
      initial={value?.valueText ?? ''}
      onCommit={(v) => onSet({ text: v === '' ? null : v })} />;
  }
  if (field.type === 'number') {
    return <CellText base={base} focusable={focusable} type="number"
      initial={value?.valueNumber != null ? String(value.valueNumber) : ''}
      onCommit={(v) => onSet({ number: v === '' ? null : Number(v) })} />;
  }
  if (field.type === 'date') {
    const ymd = value?.valueDate ? new Date(value.valueDate).toISOString().slice(0, 10) : '';
    return <input type="date" value={ymd} style={{ ...base, cursor: 'pointer' }} {...focusable}
      onChange={(e) => onSet({ date: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })} />;
  }
  if (field.type === 'select') {
    return <select value={value?.valueOptionId || ''} style={{ ...base, cursor: 'pointer' }} {...focusable}
      onChange={(e) => onSet({ optionId: e.target.value || null })}>
      <option value="">{rtl ? '— لا شيء —' : '— None —'}</option>
      {(field.options || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>;
  }
  if (field.type === 'person') {
    return <select value={value?.valueUserId || ''} style={{ ...base, cursor: 'pointer' }} {...focusable}
      onChange={(e) => onSet({ userId: e.target.value || null })}>
      <option value="">{rtl ? '— لا أحد —' : '— Nobody —'}</option>
      {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
    </select>;
  }
  return null;
}

// Controlled text/number cell: commits on blur or Enter, reverts on Escape.
function CellText({ initial, type, base, focusable, onCommit }) {
  const [v, setV] = React.useState(initial);
  React.useEffect(() => { setV(initial); }, [initial]);
  return (
    <input type={type} value={v} style={base}
      onFocus={focusable.onFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={(e) => { focusable.onBlur(e); if (v !== initial) onCommit(typeof v === 'string' ? v.trim() : v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setV(initial); e.currentTarget.blur(); }
      }} />
  );
}
