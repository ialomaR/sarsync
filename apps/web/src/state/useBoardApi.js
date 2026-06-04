import React from 'react';
import { api, getAccessToken } from '../lib/api.js';
import { normalizeBoard, normalizeCard, normalizeList, formatDueDate } from '../lib/normalize.js';
import { subscribeSocket, emit } from '../lib/socket.js';

// Project a /cards/:id detail response down to the chip-shape that the
// board view stores. Position + listId stay where they are — those move
// only via the dedicated card:moved path.
function chipFromDetail(detail, prev) {
  const total = (detail.checklist || []).length;
  const done = (detail.checklist || []).filter((k) => k.done).length;
  const cover = detail.coverUrl
    ? { url: detail.coverUrl }
    : (detail.coverHue != null ? { hue: detail.coverHue, label: detail.coverLabel || '' } : null);
  return {
    ...prev,
    title: detail.title,
    labels: detail.labelIds || [],
    members: detail.memberIds || [],
    due: formatDueDate(detail.due),
    orderedBy: detail.orderedBy || null,
    checklist: total > 0 ? { done, total } : null,
    comments: (detail.comments || []).length,
    cover,
  };
}

// Fetches a board and exposes the same shape as the old useBoardState (lists,
// moveCard, addCard, findCard) but persists changes through the API with
// optimistic UI updates.

export function useBoardApi(boardId) {
  const [state, setState] = React.useState({
    status: 'loading',  // 'loading' | 'ready' | 'error'
    error: null,
    board: null,
    lists: [],
    peopleById: {},
    labelsById: {},
    fields: [],
    fieldsById: {},
  });

  const refetch = React.useCallback(async () => {
    if (!boardId) return;
    // Only show the loading state on the FIRST fetch. Subsequent refetches
    // happen silently in the background so the board doesn't blank out.
    setState((s) => s.board
      ? { ...s, error: null }
      : { ...s, status: 'loading', error: null });
    try {
      const raw = await api(`/boards/${boardId}`);
      const board = normalizeBoard(raw);
      setState({
        status: 'ready', error: null,
        board,
        lists: board.lists,
        peopleById: board.peopleById,
        labelsById: board.labelsById,
        fields: board.fields,
        fieldsById: board.fieldsById,
      });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err }));
    }
  }, [boardId]);

  React.useEffect(() => { refetch(); }, [refetch]);

  // Subscribe to board events for live updates
  React.useEffect(() => {
    if (!boardId) return;
    emit('board:join', boardId);
    const unsub = subscribeSocket((evt) => {
      if (evt.type !== 'event') return;
      if (evt.kind === 'card:moved') {
        const { cardId, listId, position } = evt.payload;
        setState((s) => {
          // Remove from any list, insert into target sorted by position
          const next = s.lists.map((l) => ({ ...l, cards: [...l.cards] }));
          let card = null;
          for (const l of next) {
            const i = l.cards.findIndex((c) => c.id === cardId);
            if (i !== -1) { card = l.cards.splice(i, 1)[0]; break; }
          }
          if (!card) return s;
          card = { ...card, listId, position };
          const tl = next.find((l) => l.id === listId);
          if (!tl) return s;
          // Insert at the position spot (sorted)
          let idx = tl.cards.findIndex((c) => c.position > position);
          if (idx === -1) idx = tl.cards.length;
          tl.cards.splice(idx, 0, card);
          return { ...s, lists: next };
        });
      } else if (evt.kind === 'card:added') {
        const { listId, card } = evt.payload;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => l.id === listId
            ? { ...l, cards: [...l.cards, normalizeCard(card)] }
            : l),
        }));
      } else if (evt.kind === 'card:updated') {
        const { id, title, due, orderedBy } = evt.payload;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => c.id === id
              ? { ...c, title, due: formatDueDate(due), orderedBy: orderedBy ?? null }
              : c),
          })),
        }));
      } else if (evt.kind === 'card:detail_changed') {
        // Members, checklist, comments, attachments, cover — refetch the
        // card detail and patch chip fields on the board so other users see
        // the change without opening the modal.
        const { cardId } = evt.payload || {};
        if (!cardId) return;
        api(`/cards/${cardId}`).then((detail) => {
          setState((s) => ({
            ...s,
            lists: s.lists.map((l) => ({
              ...l,
              cards: l.cards.map((c) => c.id === cardId ? chipFromDetail(detail, c) : c),
            })),
            // hydrate any new people referenced by the card
            peopleById: detail.peopleById
              ? { ...s.peopleById, ...detail.peopleById }
              : s.peopleById,
          }));
        }).catch(() => {});
      } else if (evt.kind === 'card:deleted') {
        const { id } = evt.payload;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => ({ ...l, cards: l.cards.filter((c) => c.id !== id) })),
        }));
      } else if (evt.kind === 'list:added') {
        const { list } = evt.payload;
        setState((s) => s.lists.find((l) => l.id === list.id)
          ? s
          : { ...s, lists: [...s.lists, normalizeList(list)] });
      } else if (evt.kind === 'list:updated') {
        const { id, title } = evt.payload;
        setState((s) => ({ ...s, lists: s.lists.map((l) => l.id === id ? { ...l, title } : l) }));
      } else if (evt.kind === 'list:moved') {
        // Another viewer reordered a list. We don't get the destination
        // index — only the new fractional position — so re-sort the local
        // lists by position to match the server.
        const { id, position } = evt.payload;
        setState((s) => {
          const lists = s.lists.map((l) => l.id === id ? { ...l, position } : l);
          lists.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          return { ...s, lists };
        });
      } else if (evt.kind === 'list:deleted') {
        const { id } = evt.payload;
        setState((s) => ({ ...s, lists: s.lists.filter((l) => l.id !== id) }));
      } else if (evt.kind === 'label:added') {
        const { label } = evt.payload;
        setState((s) => ({ ...s, labelsById: { ...s.labelsById, [label.id]: label } }));
      } else if (evt.kind === 'label:updated') {
        const { label } = evt.payload;
        setState((s) => ({ ...s, labelsById: { ...s.labelsById, [label.id]: label } }));
      } else if (evt.kind === 'label:deleted') {
        const { id } = evt.payload;
        setState((s) => ({
          ...s,
          labelsById: Object.fromEntries(Object.entries(s.labelsById).filter(([k]) => k !== id)),
          // Remove this label from any card that had it
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => ({
              ...c,
              labels: (c.labels || []).filter((x) => x !== id),
            })),
          })),
        }));
      } else if (evt.kind === 'card:label_added') {
        const { cardId, labelId } = evt.payload;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => c.id === cardId
              ? { ...c, labels: [...(c.labels || []), labelId] }
              : c),
          })),
        }));
      } else if (evt.kind === 'card:label_removed') {
        const { cardId, labelId } = evt.payload;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => c.id === cardId
              ? { ...c, labels: (c.labels || []).filter((x) => x !== labelId) }
              : c),
          })),
        }));
      } else if (evt.kind === 'field:added' || evt.kind === 'field:updated') {
        const { field } = evt.payload;
        setState((s) => {
          const fields = s.fields.filter((f) => f.id !== field.id).concat(field)
            .sort((a, b) => a.position - b.position);
          return { ...s, fields, fieldsById: { ...s.fieldsById, [field.id]: field } };
        });
      } else if (evt.kind === 'field:deleted') {
        const { id } = evt.payload;
        setState((s) => ({
          ...s,
          fields: s.fields.filter((f) => f.id !== id),
          fieldsById: Object.fromEntries(Object.entries(s.fieldsById).filter(([k]) => k !== id)),
          // Drop the value for this column off every card
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => {
              if (!c.fieldValues || !c.fieldValues[id]) return c;
              const fv = { ...c.fieldValues }; delete fv[id];
              return { ...c, fieldValues: fv };
            }),
          })),
        }));
      } else if (evt.kind === 'card:field_changed') {
        const { cardId, value } = evt.payload;
        if (!value) return;
        setState((s) => ({
          ...s,
          lists: s.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => c.id === cardId
              ? { ...c, fieldValues: { ...c.fieldValues, [value.fieldId]: value } }
              : c),
          })),
        }));
      }
    });
    return () => {
      emit('board:leave', boardId);
      unsub();
    };
  }, [boardId]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const moveCard = React.useCallback(async (cardId, toListId, toIndex) => {
    let prevSnapshot;
    setState((s) => {
      prevSnapshot = s.lists;
      const next = s.lists.map((l) => ({ ...l, cards: [...l.cards] }));
      let card = null;
      for (const l of next) {
        const i = l.cards.findIndex((c) => c.id === cardId);
        if (i !== -1) { card = l.cards.splice(i, 1)[0]; break; }
      }
      if (!card) return s;
      const tl = next.find((l) => l.id === toListId);
      if (!tl) return s;
      const idx = Math.max(0, Math.min(toIndex, tl.cards.length));
      tl.cards.splice(idx, 0, { ...card, listId: toListId });
      return { ...s, lists: next };
    });
    try {
      await api(`/cards/${cardId}/move`, {
        method: 'PATCH',
        body: { toListId, toIndex },
      });
    } catch (err) {
      // Revert on failure
      setState((s) => ({ ...s, lists: prevSnapshot }));
      throw err;
    }
  }, []);

  const moveList = React.useCallback(async (listId, toIndex) => {
    let prevSnapshot;
    setState((s) => {
      prevSnapshot = s.lists;
      const without = s.lists.filter((l) => l.id !== listId);
      const moving = s.lists.find((l) => l.id === listId);
      if (!moving) return s;
      const idx = Math.max(0, Math.min(toIndex, without.length));
      const next = [...without.slice(0, idx), moving, ...without.slice(idx)];
      return { ...s, lists: next };
    });
    try {
      await api(`/lists/${listId}/move`, {
        method: 'PATCH',
        body: { toIndex },
      });
    } catch (err) {
      setState((s) => ({ ...s, lists: prevSnapshot }));
      throw err;
    }
  }, []);

  const addCard = React.useCallback(async (listId, title) => {
    // Tentative card with temp id
    const tempId = 'tmp-' + Date.now();
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => l.id === listId
        ? { ...l, cards: [...l.cards, { id: tempId, listId, title, labels: [], members: [], comments: 0 }] }
        : l),
    }));
    try {
      const raw = await api(`/lists/${listId}/cards`, { method: 'POST', body: { title } });
      const real = normalizeCard(raw);
      setState((s) => ({
        ...s,
        lists: s.lists.map((l) => l.id === listId
          ? { ...l, cards: l.cards.map((c) => c.id === tempId ? real : c) }
          : l),
      }));
    } catch (err) {
      // Drop temp card
      setState((s) => ({
        ...s,
        lists: s.lists.map((l) => l.id === listId
          ? { ...l, cards: l.cards.filter((c) => c.id !== tempId) }
          : l),
      }));
      throw err;
    }
  }, []);

  const addList = React.useCallback(async (title) => {
    if (!boardId) return;
    const raw = await api(`/boards/${boardId}/lists`, { method: 'POST', body: { title } });
    const real = normalizeList(raw);
    setState((s) => ({ ...s, lists: [...s.lists, real] }));
  }, [boardId]);

  const findCard = React.useCallback((id) => {
    for (const l of state.lists) {
      const c = l.cards.find((x) => x.id === id);
      if (c) return { card: c, list: l };
    }
    return null;
  }, [state.lists]);

  // Local-only update used by the modal (e.g., when description changes — we
  // don't refetch the whole board, just patch the card in place).
  const patchLocalCard = React.useCallback((cardId, patch) => {
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) => c.id === cardId ? { ...c, ...patch } : c),
      })),
    }));
  }, []);

  const renameList = React.useCallback(async (listId, title) => {
    setState((s) => ({ ...s, lists: s.lists.map((l) => l.id === listId ? { ...l, title } : l) }));
    await api(`/lists/${listId}`, { method: 'PATCH', body: { title } });
  }, []);

  const deleteList = React.useCallback(async (listId) => {
    let prev;
    setState((s) => {
      prev = s.lists;
      return { ...s, lists: s.lists.filter((l) => l.id !== listId) };
    });
    try {
      await api(`/lists/${listId}`, { method: 'DELETE' });
    } catch (err) {
      setState((s) => ({ ...s, lists: prev }));
      throw err;
    }
  }, []);

  // Inline title edit (used by the table view's cells). Optimistic; the server
  // emits card:updated so other viewers reconcile.
  const renameCard = React.useCallback(async (cardId, title) => {
    const t = (title || '').trim();
    if (!t) return;
    let prev;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) => {
          if (c.id !== cardId) return c;
          prev = c.title;
          return { ...c, title: t };
        }),
      })),
    }));
    try {
      await api(`/cards/${cardId}`, { method: 'PATCH', body: { title: t } });
    } catch (err) {
      setState((s) => ({
        ...s,
        lists: s.lists.map((l) => ({
          ...l,
          cards: l.cards.map((c) => c.id === cardId ? { ...c, title: prev } : c),
        })),
      }));
      throw err;
    }
  }, []);

  const updateBoard = React.useCallback(async (patch) => {
    if (!state.board) return;
    setState((s) => ({ ...s, board: { ...s.board, ...patch } }));
    await api(`/boards/${state.board.id}`, { method: 'PATCH', body: patch });
  }, [state.board]);

  // Star is per-viewer — separate endpoint, no other clients need to be told.
  const toggleStar = React.useCallback(async () => {
    if (!state.board) return;
    const next = !state.board.starred;
    setState((s) => ({ ...s, board: { ...s.board, starred: next } }));
    try {
      await api(`/boards/${state.board.id}/star`, { method: next ? 'PUT' : 'DELETE' });
    } catch (err) {
      setState((s) => ({ ...s, board: { ...s.board, starred: !next } }));
      throw err;
    }
  }, [state.board]);

  const archiveBoard = React.useCallback(async () => {
    if (!state.board) return;
    await api(`/boards/${state.board.id}/archive`, { method: 'POST' });
    setState((s) => ({ ...s, board: { ...s.board, archivedAt: new Date().toISOString() } }));
  }, [state.board]);

  const restoreBoard = React.useCallback(async () => {
    if (!state.board) return;
    await api(`/boards/${state.board.id}/archive`, { method: 'DELETE' });
    setState((s) => ({ ...s, board: { ...s.board, archivedAt: null } }));
  }, [state.board]);

  const deleteBoard = React.useCallback(async () => {
    if (!state.board) return;
    await api(`/boards/${state.board.id}`, { method: 'DELETE' });
  }, [state.board]);

  const uploadCover = React.useCallback(async (file) => {
    if (!state.board || !file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/boards/${state.board.id}/cover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to upload cover');
    }
    const data = await res.json();
    // Bust the URL with a cachebuster so <img> reloads instead of using stale bytes
    const bustedUrl = data.coverUrl ? `${data.coverUrl}?v=${Date.now()}` : null;
    setState((s) => ({ ...s, board: { ...s.board, coverUrl: bustedUrl } }));
  }, [state.board]);

  const removeCover = React.useCallback(async () => {
    if (!state.board) return;
    await api(`/boards/${state.board.id}/cover`, { method: 'DELETE' });
    setState((s) => ({ ...s, board: { ...s.board, coverUrl: null } }));
  }, [state.board]);

  // ── Custom fields ──────────────────────────────────────────────────────
  // Server broadcasts field:* / card:field_changed events that update local
  // state, so these mutations don't optimistically duplicate that work — they
  // call the API and let the echo (or refetch fallback) reconcile.

  const createField = React.useCallback(async (input) => {
    if (!state.board) return null;
    const field = await api(`/boards/${state.board.id}/fields`, { method: 'POST', body: input });
    setState((s) => s.fieldsById[field.id]
      ? s
      : {
          ...s,
          fields: [...s.fields, field].sort((a, b) => a.position - b.position),
          fieldsById: { ...s.fieldsById, [field.id]: field },
        });
    return field;
  }, [state.board]);

  const updateField = React.useCallback(async (fieldId, patch) => {
    const field = await api(`/fields/${fieldId}`, { method: 'PATCH', body: patch });
    setState((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.id !== field.id).concat(field).sort((a, b) => a.position - b.position),
      fieldsById: { ...s.fieldsById, [field.id]: field },
    }));
    return field;
  }, []);

  const deleteField = React.useCallback(async (fieldId) => {
    await api(`/fields/${fieldId}`, { method: 'DELETE' });
    setState((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.id !== fieldId),
      fieldsById: Object.fromEntries(Object.entries(s.fieldsById).filter(([k]) => k !== fieldId)),
      lists: s.lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) => {
          if (!c.fieldValues || !c.fieldValues[fieldId]) return c;
          const fv = { ...c.fieldValues }; delete fv[fieldId];
          return { ...c, fieldValues: fv };
        }),
      })),
    }));
  }, []);

  // body: { text?, number?, date?, userId?, optionId? } — only the key matching
  // the field's type is honored server-side.
  const setCardFieldValue = React.useCallback(async (cardId, fieldId, body) => {
    const res = await api(`/cards/${cardId}/fields/${fieldId}`, { method: 'PUT', body });
    const value = {
      fieldId,
      valueText: res.valueText ?? null,
      valueNumber: res.valueNumber ?? null,
      valueDate: res.valueDate ?? null,
      valueUserId: res.valueUserId ?? null,
      valueOptionId: res.valueOptionId ?? null,
    };
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) => c.id === cardId
          ? { ...c, fieldValues: { ...c.fieldValues, [fieldId]: value } }
          : c),
      })),
    }));
    return value;
  }, []);

  return {
    status: state.status,
    error: state.error,
    board: state.board,
    lists: state.lists,
    peopleById: state.peopleById,
    labelsById: state.labelsById,
    fields: state.fields,
    fieldsById: state.fieldsById,
    moveCard, moveList, addCard, addList, findCard, patchLocalCard, refetch,
    renameList, deleteList, renameCard,
    updateBoard, archiveBoard, restoreBoard, deleteBoard, toggleStar,
    uploadCover, removeCover,
    createField, updateField, deleteField, setCardFieldValue,
  };
}
