import React from 'react';
import { DragCtx } from '../state/board-state.jsx';
import { CoverPlaceholder, LabelChip, LabelStripe } from '../ui/Label.jsx';
import { AvatarStack } from '../ui/Avatar.jsx';
import { Icon } from '../ui/Icon.jsx';

export function Card({ card, theme, density, showAvatars, onClick, listId, index, canDrag = true, rtl }) {
  const [hover, setHover] = React.useState(false);
  const dnd = React.useContext(DragCtx);
  const compact = density === 'compact';
  const padX = compact ? 10 : 12;
  const padY = compact ? 8 : 10;
  const gap = compact ? 6 : 8;

  // Overdue = the due day is before today. (The old `/Sep [12]/` test was a
  // leftover from the static prototype that matched the formatted string, not
  // the actual date.) Due dates are stored as UTC midnight, so compare against
  // today's UTC midnight to keep the day boundary consistent with entry.
  const isOverdue = (() => {
    if (!card.dueIso) return false;
    const d = new Date(card.dueIso);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  })();
  const cdone = card.checklist && card.checklist.done === card.checklist.total && card.checklist.total > 0;
  const isDragging = dnd && dnd.drag && dnd.drag.cardId === card.id;
  const showSlotAbove = dnd && dnd.over && dnd.over.listId === listId && dnd.over.index === index && !isDragging;

  return (
    <>
      {showSlotAbove && (
        <div style={{
          height: 60, borderRadius: theme.cardRadius,
          background: theme.name === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
          border: `1.5px dashed ${theme.accent}`,
        }} />
      )}
      <div
        draggable={canDrag}
        onDragStart={(e) => {
          if (!canDrag) { e.preventDefault(); return; }
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.id);
          if (dnd) dnd.start(card.id, listId);
        }}
        onDragEnd={() => dnd && dnd.end()}
        onDragEnter={(e) => {
          if (!canDrag) return;
          // Only react to card drags — during a list drag, cards must not
          // claim the drop target or the list-move detection breaks.
          if (dnd?.drag?.kind !== 'card') return;
          e.preventDefault();
          if (dnd.drag.cardId !== card.id) dnd.enterCard(listId, index);
        }}
        onDragOver={(e) => { if (canDrag && dnd?.drag?.kind === 'card') e.preventDefault(); }}
        onClick={() => onClick && onClick(card.id)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: hover ? theme.cardHover : theme.card,
          borderRadius: theme.cardRadius,
          boxShadow: theme.cardShadow,
          cursor: isDragging ? 'grabbing' : 'pointer',
          overflow: 'hidden',
          opacity: isDragging ? 0.35 : 1,
          transform: hover && theme.cardLift && !isDragging ? 'translateY(-1px)' : 'none',
          transition: 'transform .12s, background .12s, opacity .12s',
          border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
          // Lock natural height. The parent list is a flex column with
          // overflowY:auto — without flexShrink:0, the browser compresses
          // each card to fit the viewport and the title under the cover
          // gets squeezed out as the list fills up.
          flexShrink: 0,
        }}
      >
        {card.cover && (
          <CoverPlaceholder url={card.cover.url} hue={card.cover.hue} label={card.cover.label} height={compact ? 70 : 90} />
        )}
        <div style={{
          padding: `${padY}px ${padX}px`,
          display: 'flex', flexDirection: 'column', gap,
          background: theme.card,
        }}>
          {card.labels && card.labels.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {compact
                ? card.labels.map((l) => <LabelStripe key={l} id={l} />)
                : card.labels.map((l) => <LabelChip key={l} id={l} theme={theme} size="sm" />)}
            </div>
          )}
          <div style={{
            fontSize: compact ? 13 : 13.5, fontWeight: 500, lineHeight: 1.35,
            color: card.title ? theme.text : theme.mutedDim,
            fontStyle: card.title ? 'normal' : 'italic',
            textWrap: 'pretty',
            // Always reserve at least one line of title space so the title
            // never collapses to zero when both labels and footer are empty.
            minHeight: '1.35em',
            wordBreak: 'break-word',
          }}>{card.title || '(بلا عنوان)'}</div>
          {card.orderedBy && (
            <div style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 5,
              alignSelf: 'flex-start', maxWidth: '100%',
              fontSize: 11.5, fontWeight: 500,
              background: theme.name === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.045)',
              padding: '2px 7px', borderRadius: 5,
            }}>
              <span style={{ color: theme.muted, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {rtl ? 'الطلب من:' : 'Order By:'}
              </span>
              <span style={{ color: theme.accent, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.orderedBy}
              </span>
            </div>
          )}
          {(card.due || card.checklist || card.comments || (showAvatars && card.members)) && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 2, gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.muted, fontSize: 11.5, flexWrap: 'wrap' }}>
                {card.due && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: isOverdue ? '#FEE2E2' : 'transparent',
                    color: isOverdue ? '#B91C1C' : theme.muted,
                    padding: isOverdue ? '2px 6px' : 0,
                    borderRadius: 4, fontWeight: isOverdue ? 600 : 400,
                  }}>
                    <Icon.clock size={11} /> {card.due}
                  </span>
                )}
                {card.checklist && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    color: cdone ? '#0E7C66' : theme.muted,
                    background: cdone ? (theme.name === 'dark' ? '#0E7C6633' : '#D7F1E9') : 'transparent',
                    padding: cdone ? '2px 6px' : 0, borderRadius: 4,
                    fontWeight: cdone ? 600 : 400,
                  }}>
                    <Icon.check size={11} />
                    {card.checklist.done}/{card.checklist.total}
                  </span>
                )}
                {card.comments > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Icon.comment size={11} />{card.comments}
                  </span>
                )}
              </div>
              {showAvatars && card.members && card.members.length > 0 && (
                <AvatarStack ids={card.members} size={compact ? 18 : 20} ringColor={theme.card} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
