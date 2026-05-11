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

  const api = React.useMemo(() => ({
    drag, over,
    // Card flow
    start: (cardId, fromListId) => setDrag({ kind: 'card', cardId, fromListId }),
    enterCard: (listId, index) => setOver({ kind: 'card', listId, index }),
    enterListEnd: (listId, count) => setOver({ kind: 'card', listId, index: count }),
    // List flow
    startList: (listId, fromIndex) => setDrag({ kind: 'list', listId, fromIndex }),
    enterListSlot: (toIndex) => setOver({ kind: 'list', toIndex }),
    // Shared end — fires the right callback based on what was being dragged.
    end: () => {
      if (drag?.kind === 'card' && over?.kind === 'card') {
        onMove?.(drag.cardId, over.listId, over.index);
      } else if (drag?.kind === 'list' && over?.kind === 'list') {
        if (over.toIndex !== drag.fromIndex && over.toIndex !== drag.fromIndex + 1) {
          // toIndex is the destination among the OTHER lists. If we drop just
          // past our own slot it's a no-op visually, so skip it.
          const adjusted = over.toIndex > drag.fromIndex ? over.toIndex - 1 : over.toIndex;
          onMoveList?.(drag.listId, adjusted);
        }
      }
      setDrag(null); setOver(null);
    },
  }), [drag, over, onMove, onMoveList]);

  return <DragCtx.Provider value={api}>{children}</DragCtx.Provider>;
}
