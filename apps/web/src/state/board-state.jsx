import React from 'react';

// Board state — holds the lists/cards as React state so drag & drop can
// reorder + cross-column move.

export function useBoardState(initial) {
  const [lists, setLists] = React.useState(() => deepClone(initial.lists));

  const moveCard = React.useCallback((cardId, toListId, toIndex) => {
    setLists((prev) => {
      const next = prev.map((l) => ({ ...l, cards: [...l.cards] }));
      let card = null;
      for (const l of next) {
        const i = l.cards.findIndex((c) => c.id === cardId);
        if (i !== -1) { card = l.cards.splice(i, 1)[0]; break; }
      }
      if (!card) return prev;
      const tl = next.find((l) => l.id === toListId);
      if (!tl) return prev;
      const idx = Math.max(0, Math.min(toIndex, tl.cards.length));
      tl.cards.splice(idx, 0, card);
      return next;
    });
  }, []);

  const updateCard = React.useCallback((cardId, patch) => {
    setLists((prev) => prev.map((l) => ({
      ...l,
      cards: l.cards.map((c) => c.id === cardId
        ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) }
        : c),
    })));
  }, []);

  const addCard = React.useCallback((listId, title) => {
    setLists((prev) => prev.map((l) => l.id === listId
      ? { ...l, cards: [...l.cards, { id: 'n' + Date.now(), title, labels: [], members: [] }] }
      : l));
  }, []);

  const findCard = React.useCallback((id) => {
    for (const l of lists) {
      const c = l.cards.find((x) => x.id === id);
      if (c) return { card: c, list: l };
    }
    return null;
  }, [lists]);

  return { lists, moveCard, updateCard, addCard, findCard };
}

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

// Drag & drop manager — handles card moves AND list reordering.
//
// Two independent flows share the same context to keep callsites simple:
//   - Card drag: starts from a card surface, drops on a card or list end.
//   - List drag: starts from a list header, drops on another list slot.
// Each flow uses its own keys in `drag` / `over` so they never collide.
export const DragCtx = React.createContext(null);

export function DragProvider({ children, onMove, onMoveList }) {
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);
  // Mirror drag/over into refs so end() always reads the CURRENT values, even
  // when called through a stale api object captured earlier in a pointer-drag
  // gesture (mousedown captures the api once; without refs, end() would see
  // the null drag/over from that first render).
  const dragRef = React.useRef(null);
  const overRef = React.useRef(null);
  const putDrag = React.useCallback((v) => { dragRef.current = v; setDrag(v); }, []);
  const putOver = React.useCallback((v) => { overRef.current = v; setOver(v); }, []);

  const api = React.useMemo(() => ({
    drag, over,
    // Card flow
    start: (cardId, fromListId) => putDrag({ kind: 'card', cardId, fromListId }),
    enterCard: (listId, index) => putOver({ kind: 'card', listId, index }),
    enterListEnd: (listId, count) => putOver({ kind: 'card', listId, index: count }),
    // List flow
    startList: (listId, fromIndex) => putDrag({ kind: 'list', listId, fromIndex }),
    enterListSlot: (toIndex) => putOver({ kind: 'list', toIndex }),
    // Shared end — fires the right callback based on what was being dragged.
    // Reads from refs (current), not the memoized closure (possibly stale).
    end: () => {
      const d = dragRef.current;
      const o = overRef.current;
      if (d?.kind === 'card' && o?.kind === 'card') {
        onMove?.(d.cardId, o.listId, o.index);
      } else if (d?.kind === 'list' && o?.kind === 'list') {
        if (o.toIndex !== d.fromIndex && o.toIndex !== d.fromIndex + 1) {
          // toIndex is the destination among the OTHER lists. If we drop just
          // past our own slot it's a no-op visually, so skip it.
          const adjusted = o.toIndex > d.fromIndex ? o.toIndex - 1 : o.toIndex;
          onMoveList?.(d.listId, adjusted);
        }
      }
      putDrag(null); putOver(null);
    },
  }), [drag, over, onMove, onMoveList, putDrag, putOver]);

  return <DragCtx.Provider value={api}>{children}</DragCtx.Provider>;
}
