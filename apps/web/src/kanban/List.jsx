import React from 'react';
import { DragCtx } from '../state/board-state.jsx';
import { Card } from './Card.jsx';
import { Icon } from '../ui/Icon.jsx';
import { iconBtn, LIST_HUES } from '../ui/theme.js';
import { Popover } from '../ui/Popover.jsx';

export function List({ list, index, theme, density, showAvatars, canEdit, onCardClick, onAddCard, onRename, onDelete, rtl }) {
  const [adding, setAdding] = React.useState(false);
  const [text, setText] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(list.title);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef(null);
  const dnd = React.useContext(DragCtx);
  const hue = LIST_HUES[list.id] || 220;
  // Limit drop-zone state to the active drag kind so a list-drag doesn't
  // light up card slots (and vice versa).
  const isCardDragging = dnd?.drag?.kind === 'card';
  const isListDragging = dnd?.drag?.kind === 'list';
  const isSelfListDragging = isListDragging && dnd.drag.listId === list.id;
  const dragOverEnd = isCardDragging && dnd.over?.kind === 'card'
    && dnd.over.listId === list.id && dnd.over.index === list.cards.length;
  const submit = () => { if (text.trim()) { onAddCard && onAddCard(list.id, text.trim()); } setText(''); setAdding(false); };

  React.useEffect(() => { setName(list.title); }, [list.title]);

  const submitRename = async () => {
    const t = name.trim();
    if (!t || t === list.title) { setRenaming(false); return; }
    try { await onRename?.(list.id, t); } catch (err) { alert(err.message); }
    setRenaming(false);
  };
  const onDeleteList = async () => {
    setMenuOpen(false);
    if (list.cards.length > 0 && !confirm(rtl ? `الحذف سيمحو ${list.cards.length} بطاقة. متابعة؟` : `Delete will remove ${list.cards.length} cards. Continue?`)) return;
    if (list.cards.length === 0 && !confirm(rtl ? 'حذف القائمة؟' : 'Delete this list?')) return;
    try { await onDelete?.(list.id); } catch (err) { alert(err.message); }
  };

  const listRef = React.useRef(null);
  const [handleHover, setHandleHover] = React.useState(false);

  return (
    <div
      ref={listRef}
      style={{
        width: 290,
        flexShrink: 0,
        background: theme.list,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        display: 'flex', flexDirection: 'column',
        maxHeight: '100%',
        overflow: 'hidden',
        borderTop: theme.listAccent ? `3px solid oklch(0.7 0.16 ${hue})` : 'none',
        opacity: isSelfListDragging ? 0.35 : 1,
        transition: 'opacity .12s',
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px 8px',
        background: theme.listHd,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {canEdit && (
            <div
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'list:' + list.id);
                // Use the whole list as the floating drag preview so the
                // user sees what they're moving instead of a tiny dot icon.
                if (listRef.current) {
                  e.dataTransfer.setDragImage(listRef.current, 20, 20);
                }
                dnd?.startList(list.id, index);
              }}
              onDragEnd={() => dnd?.end()}
              onMouseEnter={() => setHandleHover(true)}
              onMouseLeave={() => setHandleHover(false)}
              title={rtl ? 'اسحب لإعادة الترتيب' : 'Drag to reorder'}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, flexShrink: 0, borderRadius: 4,
                cursor: 'grab', color: handleHover ? theme.text : theme.mutedDim,
                background: handleHover ? (theme.name === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)') : 'transparent',
                transition: 'background .12s, color .12s',
                userSelect: 'none', touchAction: 'none',
              }}>
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" style={{ pointerEvents: 'none' }}>
                <circle cx="2" cy="2" r="1.2" />
                <circle cx="2" cy="7" r="1.2" />
                <circle cx="2" cy="12" r="1.2" />
                <circle cx="8" cy="2" r="1.2" />
                <circle cx="8" cy="7" r="1.2" />
                <circle cx="8" cy="12" r="1.2" />
              </svg>
            </div>
          )}
          {theme.listAccent && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: `oklch(0.7 0.16 ${hue})`, flexShrink: 0,
            }} />
          )}
          {renaming && canEdit ? (
            <input autoFocus value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                if (e.key === 'Escape') { setName(list.title); setRenaming(false); }
              }}
              style={{
                fontSize: 13, fontWeight: 600, color: theme.text,
                background: theme.card, border: `1px solid ${theme.accent}`,
                borderRadius: 4, padding: '2px 6px', outline: 'none',
                fontFamily: 'inherit', flex: 1, minWidth: 0,
              }} />
          ) : (
            <span onDoubleClick={() => canEdit && setRenaming(true)}
              title={canEdit ? (rtl ? 'انقر مرتين للتعديل' : 'Double-click to rename') : undefined}
              style={{
                fontSize: 13, fontWeight: 600, color: theme.text, letterSpacing: '-.005em',
                cursor: canEdit ? 'text' : 'default',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                userSelect: 'none',
              }}>{list.title}</span>
          )}
          <span style={{
            fontSize: 11, color: theme.muted, fontWeight: 500,
            background: theme.name === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)',
            padding: '1px 7px', borderRadius: 999, flexShrink: 0,
          }}>{list.cards.length}</span>
        </div>
        {canEdit && (
          <>
            <button ref={moreRef} onClick={() => setMenuOpen((v) => !v)} style={iconBtn(theme)}>
              <Icon.more />
            </button>
            <Popover anchorRef={moreRef} open={menuOpen} onClose={() => setMenuOpen(false)} theme={theme} width={180} align="end">
              <button onClick={() => { setMenuOpen(false); setRenaming(true); }} style={menuItemStyle(theme)}>
                {rtl ? 'تعديل الاسم' : 'Rename'}
              </button>
              <button onClick={() => { setMenuOpen(false); setAdding(true); }} style={menuItemStyle(theme)}>
                {rtl ? 'إضافة بطاقة' : 'Add card'}
              </button>
              <button onClick={onDeleteList} style={menuItemStyle(theme, true)}>
                {rtl ? 'حذف القائمة' : 'Delete list'}
              </button>
            </Popover>
          </>
        )}
      </div>

      <div
        onDragOver={(e) => {
          if (isCardDragging) {
            e.preventDefault();
            if (!dnd.over || dnd.over.listId !== list.id) dnd.enterListEnd(list.id, list.cards.length);
          }
        }}
        onDragEnter={(e) => {
          if (isCardDragging && list.cards.length === 0) {
            e.preventDefault();
            dnd.enterListEnd(list.id, 0);
          }
        }}
        style={{
          padding: '2px 8px 8px',
          display: 'flex', flexDirection: 'column', gap: 8,
          overflowY: 'auto', minHeight: 0, flex: 1,
          background: isCardDragging ? (theme.name === 'dark' ? 'rgba(255,255,255,.02)' : 'rgba(0,0,0,.015)') : 'transparent',
          transition: 'background .12s',
        }}>
        {list.cards.map((c, i) => (
          <Card key={c.id} card={c} theme={theme} density={density} listId={list.id} index={i}
            canDrag={canEdit}
            showAvatars={showAvatars} onClick={onCardClick} />
        ))}
        {dragOverEnd && dnd.drag.fromListId !== list.id && (
          <div style={{
            height: 60, borderRadius: theme.cardRadius,
            background: theme.name === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
            border: `1.5px dashed ${theme.accent}`,
          }} />
        )}
        {!canEdit ? null : adding ? (
          <div style={{
            background: theme.card, borderRadius: theme.cardRadius, padding: 8,
            boxShadow: theme.cardShadow,
          }}>
            <textarea autoFocus placeholder="Enter a title for this card…"
              value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') { setText(''); setAdding(false); } }}
              style={{
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', color: theme.text,
                fontSize: 13, fontFamily: 'inherit', minHeight: 50,
              }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button onClick={submit} style={{
                background: theme.accent, color: theme.accentText, border: 'none',
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}>Add card</button>
              <button onClick={() => { setText(''); setAdding(false); }} style={{
                background: 'transparent', color: theme.muted, border: 'none',
                padding: '5px 8px', cursor: 'pointer', fontSize: 14,
              }}>×</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none',
            color: theme.muted, padding: '8px 6px',
            fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
            borderRadius: 6, textAlign: 'start',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = theme.name === 'dark' ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <Icon.plus size={12} /> {rtl ? 'إضافة بطاقة' : 'Add a card'}
          </button>
        )}
      </div>
    </div>
  );
}

function menuItemStyle(theme, danger) {
  return {
    width: '100%', padding: '8px 10px', borderRadius: 5,
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 500,
    color: danger ? '#DC2626' : theme.text,
    textAlign: 'start', fontFamily: 'inherit', display: 'block',
  };
}
