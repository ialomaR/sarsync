import React from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from './List.jsx';
import { Icon } from '../ui/Icon.jsx';
import { AvatarStack } from '../ui/Avatar.jsx';
import { useBoardData } from '../state/BoardDataContext.jsx';
import { iconBtn, pillBtn } from '../ui/theme.js';
import { Popover } from '../ui/Popover.jsx';
import { DragCtx } from '../state/board-state.jsx';

export function BoardSubBar({ theme, board, showAvatars, rtl, canEdit, canManage, onUpdateBoard, onToggleStar, onArchiveBoard, onRestoreBoard, onDeleteBoard, canDelete, onUploadCover, onRemoveCover, lists, onAddCard, filterText, onFilterChange }) {
  const ctx = useBoardData();
  const navigate = useNavigate();
  const memberIds = ctx?.peopleById ? Object.keys(ctx.peopleById) : [];
  const moreRef = React.useRef(null);
  const coverInputRef = React.useRef(null);
  const filterRef = React.useRef(null);
  const newCardRef = React.useRef(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [newCardOpen, setNewCardOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(board.title);
  const [uploadingCover, setUploadingCover] = React.useState(false);

  React.useEffect(() => { setName(board.title); }, [board.title]);

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadCover) return;
    setUploadingCover(true);
    try { await onUploadCover(file); }
    catch (err) { alert(err.message || 'Failed to upload cover'); }
    finally { setUploadingCover(false); }
  };
  const handleRemoveCover = async () => {
    if (!onRemoveCover) return;
    if (!confirm(rtl ? 'إزالة غلاف اللوحة؟' : 'Remove board cover?')) return;
    try { await onRemoveCover(); }
    catch (err) { alert(err.message || 'Failed to remove cover'); }
  };

  const onStar = async () => {
    try { await onToggleStar?.(); } catch (err) { alert(err.message); }
  };
  const submitRename = async () => {
    const t = name.trim();
    if (!t || t === board.title) { setRenaming(false); return; }
    try { await onUpdateBoard?.({ title: t }); } catch (err) { alert(err.message); }
    setRenaming(false);
  };
  const onArchive = async () => {
    if (!confirm(rtl ? 'أرشفة اللوحة؟ ستختفي من قائمة اللوحات.' : 'Archive this board? It will be hidden from the boards list.')) return;
    try {
      await onArchiveBoard?.();
      navigate('/boards');
    } catch (err) { alert(err.message); }
  };
  const onRestore = async () => {
    try {
      await onRestoreBoard?.();
    } catch (err) { alert(err.message); }
  };
  const onDelete = async () => {
    if (!confirm(rtl ? 'حذف اللوحة نهائيًا؟ لا يمكن التراجع.' : 'Permanently delete this board? This cannot be undone.')) return;
    try {
      await onDeleteBoard?.();
      navigate('/boards');
    } catch (err) { alert(err.message); }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 24px 12px', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {renaming && canManage ? (
          <input autoFocus value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              if (e.key === 'Escape') { setName(board.title); setRenaming(false); }
            }}
            style={{
              fontSize: 20, fontWeight: 700, color: theme.text,
              background: theme.surface, border: `1px solid ${theme.accent}`,
              borderRadius: 4, padding: '2px 8px', outline: 'none',
              fontFamily: 'inherit', minWidth: 240,
            }} />
        ) : (
          <h2 onDoubleClick={() => canManage && setRenaming(true)}
            title={canManage ? (rtl ? 'انقر مرتين للتعديل' : 'Double-click to rename') : undefined}
            style={{
              margin: 0, fontSize: 20, fontWeight: 700, color: theme.text,
              letterSpacing: '-.015em',
              cursor: canManage ? 'text' : 'default',
              userSelect: 'none',
            }}>{board.title}</h2>
        )}
        <button onClick={onStar} style={{ ...iconBtn(theme), color: board.starred ? theme.accent : theme.muted }}
          title={board.starred ? (rtl ? 'إلغاء التفضيل' : 'Unstar') : (rtl ? 'تفضيل' : 'Star')}>
          <Icon.star filled={board.starred} size={16} />
        </button>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: theme.muted,
          background: theme.surface2,
          padding: '3px 8px', borderRadius: 5,
          border: `.5px solid ${theme.border}`,
        }}>{rtl ? 'مرئي للفريق' : 'Team visible'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showAvatars && memberIds.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', marginInlineEnd: 6 }}>
            <AvatarStack ids={memberIds} size={26} max={5} ringColor={theme.boardBg} />
          </div>
        )}
        <button ref={filterRef} onClick={() => setFilterOpen((v) => !v)} style={{
          ...pillBtn(theme),
          ...(filterText ? { background: theme.accentSoft, color: theme.accent, borderColor: theme.accent } : null),
        }}>
          <Icon.filter /> {rtl ? 'تصفية' : 'Filter'}
          {filterText && <span style={{ fontSize: 10, fontWeight: 700 }}>·</span>}
        </button>
        <Popover anchorRef={filterRef} open={filterOpen} onClose={() => setFilterOpen(false)} theme={theme} width={260} align="end">
          <div style={{ padding: 4 }}>
            <input autoFocus value={filterText || ''}
              onChange={(e) => onFilterChange?.(e.target.value)}
              placeholder={rtl ? 'بحث في عناوين البطاقات…' : 'Search card titles…'}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 5,
                background: theme.surface2, color: theme.text,
                border: `.5px solid ${theme.border}`,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
              }} />
            {filterText && (
              <button onClick={() => onFilterChange?.('')} style={{
                marginTop: 6, width: '100%', padding: '6px 8px', borderRadius: 5,
                background: 'transparent', border: `.5px solid ${theme.border}`,
                color: theme.muted, fontSize: 12, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{rtl ? 'مسح الفلتر' : 'Clear filter'}</button>
            )}
          </div>
        </Popover>
        {(canManage || canDelete) && (
          <button ref={moreRef} onClick={() => setMenuOpen((v) => !v)} style={pillBtn(theme)}>
            <Icon.more />
          </button>
        )}
        {canEdit && onAddCard && lists?.length > 0 && (
          <>
            <button ref={newCardRef} onClick={() => setNewCardOpen((v) => !v)} style={{
              ...pillBtn(theme),
              background: theme.accent, color: theme.accentText, border: 'none', fontWeight: 600,
            }}>
              <Icon.plus /> {rtl ? 'بطاقة جديدة' : 'New card'}
            </button>
            <Popover anchorRef={newCardRef} open={newCardOpen} onClose={() => setNewCardOpen(false)} theme={theme} width={280} align="end">
              <NewCardForm theme={theme} rtl={rtl} lists={lists}
                onSubmit={(listId, title) => {
                  onAddCard(listId, title);
                  setNewCardOpen(false);
                }}
                onCancel={() => setNewCardOpen(false)} />
            </Popover>
          </>
        )}
        <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverFile} />
        <Popover anchorRef={moreRef} open={menuOpen} onClose={() => setMenuOpen(false)} theme={theme} width={230} align="end">
          {board.createdBy && (
            <div style={{
              padding: '6px 10px 8px',
              borderBottom: `.5px solid ${theme.border}`,
              marginBottom: 4,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: theme.mutedDim, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                {rtl ? 'أُنشئت بواسطة' : 'Created by'}
              </div>
              <div style={{ fontSize: 12.5, color: theme.text, marginTop: 2 }}>
                {board.createdBy.name}
              </div>
            </div>
          )}
          {canManage && (
            <MenuItem theme={theme} onClick={() => { setMenuOpen(false); setRenaming(true); }}>
              {rtl ? 'تعديل الاسم' : 'Rename board'}
            </MenuItem>
          )}
          {canManage && onUploadCover && (
            <MenuItem theme={theme} onClick={() => { setMenuOpen(false); coverInputRef.current?.click(); }}>
              {uploadingCover
                ? (rtl ? 'جاري الرفع…' : 'Uploading…')
                : (board.coverUrl
                    ? (rtl ? 'تغيير الغلاف' : 'Change cover')
                    : (rtl ? 'إضافة غلاف' : 'Add cover'))}
            </MenuItem>
          )}
          {canManage && onRemoveCover && board.coverUrl && (
            <MenuItem theme={theme} onClick={() => { setMenuOpen(false); handleRemoveCover(); }}>
              {rtl ? 'إزالة الغلاف' : 'Remove cover'}
            </MenuItem>
          )}
          {canManage && (
            board.archivedAt ? (
              <MenuItem theme={theme} onClick={() => { setMenuOpen(false); onRestore(); }}>
                {rtl ? 'استعادة من الأرشيف' : 'Restore from archive'}
              </MenuItem>
            ) : (
              <MenuItem theme={theme} onClick={() => { setMenuOpen(false); onArchive(); }}>
                {rtl ? 'أرشفة' : 'Archive board'}
              </MenuItem>
            )
          )}
          {canDelete && (
            <MenuItem theme={theme} danger onClick={() => { setMenuOpen(false); onDelete(); }}>
              {rtl ? 'حذف نهائي' : 'Delete permanently'}
            </MenuItem>
          )}
        </Popover>
      </div>
    </div>
  );
}

function NewCardForm({ theme, rtl, lists, onSubmit, onCancel }) {
  const [listId, setListId] = React.useState(lists[0]?.id || '');
  const [title, setTitle] = React.useState('');
  const submit = () => {
    if (!title.trim() || !listId) return;
    onSubmit(listId, title.trim());
  };
  return (
    <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: theme.muted, display: 'block', marginBottom: 4 }}>
          {rtl ? 'القائمة' : 'List'}
        </label>
        <select value={listId} onChange={(e) => setListId(e.target.value)} style={{
          width: '100%', padding: '6px 8px', borderRadius: 5,
          background: theme.surface2, color: theme.text,
          border: `.5px solid ${theme.border}`,
          fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
        }}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: theme.muted, display: 'block', marginBottom: 4 }}>
          {rtl ? 'العنوان' : 'Title'}
        </label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={rtl ? 'اكتب عنوان البطاقة…' : 'Enter a card title…'}
          style={{
            width: '100%', padding: '7px 9px', borderRadius: 5,
            background: theme.surface2, color: theme.text,
            border: `.5px solid ${theme.border}`,
            fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }} />
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{
          background: 'transparent', color: theme.muted, border: `.5px solid ${theme.border}`,
          padding: '5px 10px', borderRadius: 5, fontSize: 12, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
        <button onClick={submit} disabled={!title.trim() || !listId} style={{
          background: theme.accent, color: theme.accentText, border: 'none',
          padding: '5px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600,
          cursor: title.trim() ? 'pointer' : 'default',
          opacity: title.trim() ? 1 : 0.6,
          fontFamily: 'inherit',
        }}>{rtl ? 'إضافة' : 'Add'}</button>
      </div>
    </div>
  );
}

// Drop target between lists during a list drag. Collapses to zero when
// no drag is active so layout never shifts at rest. When a list is being
// dragged, every slot widens enough to be a forgiving target; the hovered
// slot expands further into a clear placeholder showing exactly where the
// list will land.
function ListDropSlot({ index, active, dnd, theme }) {
  if (!active) return null;
  const isHere = dnd?.over?.kind === 'list' && dnd.over.toIndex === index;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); dnd?.enterListSlot(index); }}
      onDragEnter={(e) => { e.preventDefault(); dnd?.enterListSlot(index); }}
      style={{
        width: isHere ? 80 : 18, flexShrink: 0,
        alignSelf: 'stretch',
        background: isHere
          ? (theme.name === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)')
          : 'transparent',
        border: isHere ? `2px dashed ${theme.accent}` : '2px dashed transparent',
        borderRadius: 8,
        transition: 'width .14s ease, background .14s, border-color .14s',
      }} />
  );
}

function MenuItem({ theme, onClick, danger, children }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '8px 10px', borderRadius: 5,
      background: 'transparent', border: 'none', cursor: 'pointer',
      fontSize: 13, fontWeight: 500,
      color: danger ? '#DC2626' : theme.text,
      textAlign: 'start', fontFamily: 'inherit',
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = theme.surface2}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      {children}
    </button>
  );
}

export function KanbanBoard({ theme, lists, density, showAvatars, rtl, canEdit, onCardClick, onAddCard, onAddList, onRenameList, onDeleteList }) {
  const [adding, setAdding] = React.useState(false);
  const [text, setText] = React.useState('');
  const dnd = React.useContext(DragCtx);
  const isListDragging = dnd?.drag?.kind === 'list';

  const submit = async () => {
    const t = text.trim();
    if (!t) { setAdding(false); setText(''); return; }
    try {
      await onAddList?.(t);
      setText('');
      setAdding(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'flex', gap: 14,
      padding: '4px 24px 24px',
      overflowX: 'auto', overflowY: 'hidden',
      direction: rtl ? 'rtl' : 'ltr',
    }}>
      {lists.map((list, i) => (
        <React.Fragment key={list.id}>
          <ListDropSlot index={i} active={isListDragging} dnd={dnd} theme={theme} />
          <List list={list} index={i} theme={theme}
            density={density} showAvatars={showAvatars}
            canEdit={canEdit}
            onCardClick={onCardClick} onAddCard={onAddCard}
            onRename={onRenameList} onDelete={onDeleteList} rtl={rtl} />
        </React.Fragment>
      ))}
      <ListDropSlot index={lists.length} active={isListDragging} dnd={dnd} theme={theme} />
      {!canEdit ? null : adding ? (
        <div style={{
          flexShrink: 0, width: 290,
          background: theme.list, borderRadius: theme.radius,
          boxShadow: theme.shadow, padding: 10, alignSelf: 'flex-start',
        }}>
          <input
            autoFocus
            value={text}
            placeholder={rtl ? 'اسم القائمة' : 'List title'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setText(''); setAdding(false); }
            }}
            style={{
              width: '100%', padding: '8px 10px',
              background: theme.card, color: theme.text,
              border: `.5px solid ${theme.border}`, borderRadius: 6,
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={submit} style={{
              background: theme.accent, color: theme.accentText, border: 'none',
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}>{rtl ? 'إضافة' : 'Add list'}</button>
            <button onClick={() => { setText(''); setAdding(false); }} style={{
              background: 'transparent', color: theme.muted, border: 'none',
              padding: '5px 8px', cursor: 'pointer', fontSize: 14,
            }}>×</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          flexShrink: 0, width: 290,
          background: theme.name === 'dark' ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)',
          border: 'none', borderRadius: theme.radius,
          padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 6,
          color: theme.muted, fontSize: 13, fontWeight: 500,
          cursor: 'pointer', alignSelf: 'flex-start',
          fontFamily: 'inherit',
        }}>
          <Icon.plus /> {rtl ? 'إضافة قائمة' : 'Add another list'}
        </button>
      )}
    </div>
  );
}
