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

// Drag & drop manager
export const DragCtx = React.createContext(null);

export function DragProvider({ children, onMove }) {
  const [drag, setDrag] = React.useState(null);
  const [over, setOver] = React.useState(null);

  const api = React.useMemo(() => ({
    drag, over,
    start: (cardId, fromListId) => setDrag({ cardId, fromListId }),
    end: () => {
      if (drag && over) onMove(drag.cardId, over.listId, over.index);
      setDrag(null); setOver(null);
    },
    enterCard: (listId, index) => setOver({ listId, index }),
    enterListEnd: (listId, count) => setOver({ listId, index: count }),
  }), [drag, over, onMove]);

  return <DragCtx.Provider value={api}>{children}</DragCtx.Provider>;
}
