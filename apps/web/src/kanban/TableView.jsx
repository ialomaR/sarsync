import React from 'react';

// Spreadsheet-style ("Excel") view of a board: each LIST becomes a column and
// cards stack into rows by their position within the list. This matches how
// teams here build boards — lists used as columns — so an existing board turns
// into an aligned grid with no restructuring. Cells edit the card title inline;
// the ↗ button opens the full card. RTL: a real <table> with `direction: rtl`
// flips column order for free (see CLAUDE.md), matching the board's RTL order.
//
// Note on alignment: a "row" here is just the Nth card across columns — there's
// no relational link between cells. Where a list has fewer cards, its cells are
// blank. Reorder cards in Board view to line rows up.

export function TableView({ theme, rtl, lists, canEdit, onCardClick, onRenameCard }) {
  const columns = lists;
  const rowCount = columns.reduce((m, l) => Math.max(m, l.cards.length), 0);

  const th = {
    textAlign: 'start', padding: '9px 12px',
    fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
    color: theme.mutedDim, textTransform: 'uppercase',
    borderBottom: `1px solid ${theme.border}`,
    borderInlineEnd: `.5px solid ${theme.border}`,
    whiteSpace: 'nowrap', position: 'sticky', top: 0,
    background: theme.surface, zIndex: 1,
  };
  const td = {
    padding: 0, borderBottom: `.5px solid ${theme.border}`,
    borderInlineEnd: `.5px solid ${theme.border}`,
    verticalAlign: 'top',
  };
  const numCell = {
    padding: '8px 10px', borderBottom: `.5px solid ${theme.border}`,
    borderInlineEnd: `.5px solid ${theme.border}`,
    fontSize: 11, color: theme.mutedDim, textAlign: 'center',
    background: theme.surface2, fontVariantNumeric: 'tabular-nums',
    position: 'sticky', insetInlineStart: 0, zIndex: 1, width: 44,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 24px 24px' }}>
      {columns.length === 0 ? (
        <div style={{ fontSize: 13, color: theme.mutedDim, padding: 12 }}>
          {rtl ? 'لا توجد قوائم.' : 'No lists yet.'}
        </div>
      ) : (
        <table style={{
          borderCollapse: 'collapse', width: '100%',
          background: theme.surface, borderRadius: 10, overflow: 'hidden',
          border: `.5px solid ${theme.border}`, tableLayout: 'fixed',
        }}>
          <thead>
            <tr>
              <th style={{ ...th, ...numCell, color: theme.mutedDim }}>#</th>
              {columns.map((l) => (
                <th key={l.id} style={{ ...th, minWidth: 220, width: 260 }} title={l.title}>{l.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, r) => (
              <tr key={r}>
                <td style={numCell}>{r + 1}</td>
                {columns.map((l) => {
                  const card = l.cards[r];
                  return (
                    <td key={l.id} style={td}>
                      {card
                        ? <PivotCell theme={theme} rtl={rtl} canEdit={canEdit}
                            card={card}
                            onOpen={() => onCardClick?.(card.id)}
                            onRename={(t) => onRenameCard?.(card.id, t)} />
                        : <div style={{ minHeight: 34 }} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// One cell = one card. Title is inline-editable (commit on blur/Enter, revert on
// Escape or empty); the ↗ button opens the full card modal.
function PivotCell({ theme, rtl, canEdit, card, onOpen, onRename }) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(card.title);
  React.useEffect(() => { setText(card.title); }, [card.title]);

  const commit = () => {
    const t = text.trim();
    if (!t) { setText(card.title); setEditing(false); return; }
    if (t !== card.title) onRename(t);
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea autoFocus value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setText(card.title); setEditing(false); }
        }}
        style={{
          width: '100%', minHeight: 56, padding: '8px 10px', margin: 0,
          border: `1px solid ${theme.accent}`, borderRadius: 4,
          background: theme.surface, color: theme.text,
          fontSize: 12.5, lineHeight: 1.45, fontFamily: 'inherit',
          resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        }} />
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4, padding: '8px 10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={() => canEdit && setEditing(true)}
          title={canEdit ? (rtl ? 'انقر للتعديل' : 'Click to edit') : undefined}
          style={{
            fontSize: 12.5, lineHeight: 1.45,
            color: theme.text, cursor: canEdit ? 'text' : 'default',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{card.title}</div>
        {card.orderedBy && (
          <div style={{ marginTop: 4, fontSize: 11, fontWeight: 500, lineHeight: 1.3 }}>
            <span style={{ color: theme.accent, fontWeight: 700 }}>{rtl ? 'الطلب من: ' : 'Order By: '}</span>
            <span style={{ color: theme.muted }}>{card.orderedBy}</span>
          </div>
        )}
      </div>
      <button onClick={onOpen} title={rtl ? 'فتح البطاقة' : 'Open card'} style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 4, lineHeight: 1,
        background: 'transparent', color: theme.muted,
        border: `.5px solid ${theme.border}`, cursor: 'pointer',
        fontSize: 12, fontFamily: 'inherit',
      }}>↗</button>
    </div>
  );
}
