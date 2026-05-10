import React from 'react';
import { CoverPlaceholder, LabelChip } from '../ui/Label.jsx';
import { Avatar, AvatarStack } from '../ui/Avatar.jsx';
import { Icon } from '../ui/Icon.jsx';
import { iconBtn } from '../ui/theme.js';
import { api, getAccessToken } from '../lib/api.js';
import { subscribeSocket } from '../lib/socket.js';

// Append the user's access token to attachment URLs so <img>/CSS background
// requests can authenticate (browsers won't send Authorization headers).
function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}
import { BoardDataProvider, useBoardData } from '../state/BoardDataContext.jsx';
import { formatDueDate } from '../lib/normalize.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Popover, PopoverHeader } from '../ui/Popover.jsx';

export function CardModal({ theme, rtl, onClose, cardId, listTitle, workspaceId, canEdit = true, onCardChanged, onRefetchBoard }) {
  const auth = useAuth();
  const [state, setState] = React.useState({ status: 'loading', card: null, error: null });
  const [editingDesc, setEditingDesc] = React.useState(false);
  const [desc, setDesc] = React.useState('');
  const [comment, setComment] = React.useState('');
  const [savingDesc, setSavingDesc] = React.useState(false);
  const [postingComment, setPostingComment] = React.useState(false);
  const [watching, setWatching] = React.useState(false);

  const [allMembers, setAllMembers] = React.useState([]);
  const [allLabels, setAllLabels] = React.useState([]);
  const [activity, setActivity] = React.useState([]);
  const [allLists, setAllLists] = React.useState([]);

  React.useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await api(`/workspaces/${workspaceId}/members`);
        if (cancelled) return;
        setAllMembers(m.members || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // Labels are now per-board — fetch them once we know the card's boardId
  React.useEffect(() => {
    if (!state.card?.boardId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/boards/${state.card.boardId}/labels`);
        if (!cancelled) setAllLabels(r.labels || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [state.card?.boardId]);

  // Load activity for the card
  const loadActivity = React.useCallback(async () => {
    if (!cardId || cardId.startsWith('tmp-')) return;
    try {
      const r = await api(`/cards/${cardId}/activity`);
      setActivity(r.activity || []);
    } catch {}
  }, [cardId]);

  React.useEffect(() => { loadActivity(); }, [loadActivity]);

  // Load all lists in this card's board (for Move popover)
  React.useEffect(() => {
    if (!state.card?.boardId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/boards/${state.card.boardId}`);
        if (!cancelled) setAllLists((r.lists || []).map((l) => ({ id: l.id, title: l.title })));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [state.card?.boardId]);

  // Track editingDesc via a ref so the live-refetch callback doesn't rebind
  // every time the user toggles the description editor.
  const editingDescRef = React.useRef(editingDesc);
  React.useEffect(() => { editingDescRef.current = editingDesc; }, [editingDesc]);

  // Load card detail. Used both for the initial open and for live refetches
  // when another user edits this card.
  const reloadCard = React.useCallback(async () => {
    if (!cardId || cardId.startsWith('tmp-')) return;
    try {
      const c = await api(`/cards/${cardId}`);
      setState((s) => {
        // If we're editing the description locally, keep the local draft —
        // overwriting mid-typing would be hostile.
        const next = s.card && editingDescRef.current
          ? { ...c, description: s.card.description }
          : c;
        return { status: 'ready', card: next, error: null };
      });
      if (!editingDescRef.current) setDesc(c.description || '');
    } catch (err) {
      setState((s) => s.card ? s : { status: 'error', card: null, error: err });
    }
  }, [cardId]);

  React.useEffect(() => { reloadCard(); }, [reloadCard]);

  // Listen for live updates from other clients on this same card. The server
  // emits `card:detail_changed` with cardId for any change (members, checklist,
  // comments, attachments). We refetch the card + activity to stay in sync.
  React.useEffect(() => {
    if (!cardId || cardId.startsWith('tmp-')) return;
    const unsub = subscribeSocket((evt) => {
      if (evt.type !== 'event') return;
      const isThisCard = evt.payload?.cardId === cardId
        || evt.payload?.id === cardId;
      if (!isThisCard) return;
      if (evt.kind === 'card:detail_changed' || evt.kind === 'card:updated'
          || evt.kind === 'card:label_added' || evt.kind === 'card:label_removed') {
        reloadCard();
        loadActivity();
      } else if (evt.kind === 'card:deleted') {
        // The card we're viewing was deleted by someone else
        onClose?.();
      }
    });
    return () => unsub();
  }, [cardId, reloadCard, loadActivity, onClose]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = state.card;

  const saveDesc = async () => {
    setSavingDesc(true);
    try {
      const updated = await api(`/cards/${cardId}`, { method: 'PATCH', body: { description: desc } });
      setState((s) => ({ ...s, card: { ...s.card, description: updated.description } }));
      setEditingDesc(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingDesc(false);
    }
  };

  const addChecklistItem = async (text) => {
    if (!text.trim() || !cardId || cardId.startsWith('tmp-')) return;
    try {
      const created = await api(`/cards/${cardId}/checklist`, { method: 'POST', body: { text: text.trim() } });
      setState((s) => {
        const list = [...s.card.checklist, created];
        return { ...s, card: { ...s.card, checklist: list } };
      });
      onCardChanged?.({ checklist: { done: c?.checklist?.filter((k) => k.done).length || 0, total: (c?.checklist?.length || 0) + 1 } });
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleCheck = async (item) => {
    setState((s) => ({
      ...s,
      card: { ...s.card, checklist: s.card.checklist.map((k) => k.id === item.id ? { ...k, done: !k.done } : k) },
    }));
    try {
      await api(`/checklist/${item.id}`, { method: 'PATCH', body: { done: !item.done } });
      const list = c.checklist.map((k) => k.id === item.id ? { ...k, done: !item.done } : k);
      const total = list.length;
      const done = list.filter((k) => k.done).length;
      onCardChanged?.({ checklist: total > 0 ? { done, total } : null });
    } catch {
      setState((s) => ({
        ...s,
        card: { ...s.card, checklist: s.card.checklist.map((k) => k.id === item.id ? { ...k, done: item.done } : k) },
      }));
    }
  };

  const renameChecklistItem = async (item, newText) => {
    const t = newText.trim();
    if (!t || t === item.text) return;
    setState((s) => ({
      ...s,
      card: { ...s.card, checklist: s.card.checklist.map((k) => k.id === item.id ? { ...k, text: t } : k) },
    }));
    try {
      await api(`/checklist/${item.id}`, { method: 'PATCH', body: { text: t } });
    } catch (err) {
      setState((s) => ({
        ...s,
        card: { ...s.card, checklist: s.card.checklist.map((k) => k.id === item.id ? { ...k, text: item.text } : k) },
      }));
      alert(err.message);
    }
  };

  const deleteChecklistItem = async (item) => {
    if (!confirm(rtl ? 'حذف هذه المهمة؟' : 'Delete this task?')) return;
    const prev = state.card.checklist;
    setState((s) => ({
      ...s,
      card: { ...s.card, checklist: s.card.checklist.filter((k) => k.id !== item.id) },
    }));
    try {
      await api(`/checklist/${item.id}`, { method: 'DELETE' });
      const list = prev.filter((k) => k.id !== item.id);
      const total = list.length;
      const done = list.filter((k) => k.done).length;
      onCardChanged?.({ checklist: total > 0 ? { done, total } : null });
    } catch (err) {
      setState((s) => ({ ...s, card: { ...s.card, checklist: prev } }));
      alert(err.message);
    }
  };

  const toggleMember = async (userId) => {
    const has = state.card.memberIds.includes(userId);
    setState((s) => ({
      ...s,
      card: { ...s.card, memberIds: has ? s.card.memberIds.filter((x) => x !== userId) : [...s.card.memberIds, userId] },
    }));
    try {
      if (has) {
        await api(`/cards/${cardId}/members/${userId}`, { method: 'DELETE' });
      } else {
        await api(`/cards/${cardId}/members`, { method: 'POST', body: { userId } });
        // hydrate user into peopleById
        const m = allMembers.find((x) => x.userId === userId);
        if (m) {
          setState((s) => ({
            ...s,
            card: {
              ...s.card,
              peopleById: {
                ...s.card.peopleById,
                [userId]: {
                  id: userId, name: m.name, color: m.avatarColor,
                  initials: m.name.split(' ').map((p) => p[0]).slice(0, 2).join(''),
                },
              },
            },
          }));
        }
      }
      onRefetchBoard?.();
    } catch (err) {
      setState((s) => ({
        ...s,
        card: { ...s.card, memberIds: has ? [...s.card.memberIds, userId] : s.card.memberIds.filter((x) => x !== userId) },
      }));
      alert(err.message);
    }
  };

  // labelData is optional — pass it for labels that may not yet be in allLabels
  // (e.g., a label that was just created in the popover; the closure here still
  // sees the old allLabels for the same render cycle).
  const toggleLabel = async (labelId, labelData) => {
    const has = state.card.labelIds.includes(labelId);
    setState((s) => {
      const next = { ...s.card, labelIds: has ? s.card.labelIds.filter((x) => x !== labelId) : [...s.card.labelIds, labelId] };
      if (!has) {
        const lbl = labelData || allLabels.find((l) => l.id === labelId);
        if (lbl) next.labelsById = { ...s.card.labelsById, [labelId]: lbl };
      }
      return { ...s, card: next };
    });
    try {
      if (has) {
        await api(`/cards/${cardId}/labels/${labelId}`, { method: 'DELETE' });
      } else {
        await api(`/cards/${cardId}/labels`, { method: 'POST', body: { labelId } });
      }
      onRefetchBoard?.();
    } catch (err) {
      setState((s) => ({
        ...s,
        card: { ...s.card, labelIds: has ? [...s.card.labelIds, labelId] : s.card.labelIds.filter((x) => x !== labelId) },
      }));
      alert(err.message);
    }
  };

  const setDue = async (iso) => {
    try {
      const updated = await api(`/cards/${cardId}`, { method: 'PATCH', body: { due: iso } });
      setState((s) => ({ ...s, card: { ...s.card, due: updated.due } }));
      onCardChanged?.({ due: formatDueDate(updated.due) });
    } catch (err) {
      alert(err.message);
    }
  };

  const archiveCard = async () => {
    if (!confirm(rtl ? 'حذف البطاقة؟' : 'Delete this card?')) return;
    try {
      await api(`/cards/${cardId}`, { method: 'DELETE' });
      onRefetchBoard?.();
      onClose();
    } catch (err) {
      alert(err.message);
    }
  };

  const moveToList = async (toListId) => {
    if (toListId === c.listId) return;
    try {
      await api(`/cards/${cardId}/move`, { method: 'PATCH', body: { toListId, toIndex: 0 } });
      onRefetchBoard?.();
      const newList = allLists.find((l) => l.id === toListId);
      setState((s) => ({ ...s, card: { ...s.card, listId: toListId, listTitle: newList?.title || s.card.listTitle } }));
      loadActivity();
    } catch (err) {
      alert(err.message);
    }
  };

  const uploadAttachment = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const tok = getAccessToken();
      const res = await fetch(`/api/cards/${cardId}/attachments`, {
        method: 'POST',
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        body: fd,
      });
      if (!res.ok) {
        let msg = 'Upload failed';
        try { msg = (await res.json()).message || msg; } catch {}
        throw new Error(msg);
      }
      const att = await res.json();
      setState((s) => ({ ...s, card: { ...s.card, attachments: [...s.card.attachments, att] } }));
      loadActivity();
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteAttachment = async (attId) => {
    if (!confirm(rtl ? 'حذف المرفق؟' : 'Delete attachment?')) return;
    try {
      await api(`/attachments/${attId}`, { method: 'DELETE' });
      setState((s) => ({
        ...s,
        card: {
          ...s.card,
          attachments: s.card.attachments.filter((a) => a.id !== attId),
          // If we just deleted the cover, clear cover state
          coverAttachmentId: s.card.coverAttachmentId === attId ? null : s.card.coverAttachmentId,
          coverUrl: s.card.coverAttachmentId === attId ? null : s.card.coverUrl,
        },
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const renameAttachment = async (attId, newName) => {
    if (!newName.trim()) return;
    try {
      const updated = await api(`/attachments/${attId}`, {
        method: 'PATCH', body: { filename: newName.trim() },
      });
      setState((s) => ({
        ...s,
        card: {
          ...s.card,
          attachments: s.card.attachments.map((a) => a.id === attId ? { ...a, filename: updated.filename } : a),
        },
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const setCover = async (attId) => {
    try {
      const updated = await api(`/cards/${cardId}`, { method: 'PATCH', body: { coverAttachmentId: attId } });
      const url = updated.id ? (attId ? `/api/attachments/${attId}` : null) : null;
      setState((s) => ({
        ...s,
        card: { ...s.card, coverAttachmentId: attId, coverUrl: url },
      }));
      onCardChanged?.({ cover: url ? { url } : null });
      onRefetchBoard?.();
    } catch (err) {
      alert(err.message);
    }
  };

  const submitComment = async () => {
    if (!comment.trim() || postingComment) return;
    setPostingComment(true);
    try {
      const created = await api(`/cards/${cardId}/comments`, { method: 'POST', body: { body: comment.trim() } });
      // Hydrate author from auth context (server doesn't echo author detail)
      setState((s) => {
        const next = { ...s.card };
        next.comments = [created, ...s.card.comments];
        // Add author to peopleById if missing
        if (!next.peopleById[created.authorId] && auth.user) {
          next.peopleById = {
            ...next.peopleById,
            [auth.user.id]: {
              id: auth.user.id,
              firstName: auth.user.firstName,
              lastName: auth.user.lastName,
              initials: (auth.user.firstName?.[0] || '') + (auth.user.lastName?.[0] || ''),
              name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
              color: auth.user.avatarColor,
            },
          };
        }
        return { ...s, card: next };
      });
      setComment('');
      onCardChanged?.({ comments: (c?.comments?.length ?? 0) + 1 });
    } catch (err) {
      console.error(err);
    } finally {
      setPostingComment(false);
    }
  };

  return (
    <div onClick={onClose} className="card-modal-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(10,12,18,.55)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto',
      direction: rtl ? 'rtl' : 'ltr',
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card-modal-card" style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 840, maxWidth: '100%',
        boxShadow: '0 20px 80px rgba(0,0,0,.4)',
        overflow: 'hidden',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
      }}>
        {state.status === 'loading' && (
          <div style={{ padding: 60, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
            {rtl ? 'جاري التحميل…' : 'Loading…'}
          </div>
        )}
        {state.status === 'error' && (
          <div style={{ padding: 60, textAlign: 'center', color: '#DC2626', fontSize: 13 }}>
            {rtl ? 'فشل تحميل البطاقة' : 'Failed to load card'} — {state.error?.message}
          </div>
        )}
        {state.status === 'ready' && c && (
          <BoardDataProvider peopleById={c.peopleById} labelsById={c.labelsById}>
            {(c.coverUrl || c.coverHue != null) && (
              <CoverPlaceholder url={c.coverUrl} hue={c.coverHue} label={c.coverLabel || ''} height={140} />
            )}
            <div style={{ padding: '20px 24px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.muted, fontSize: 12, marginBottom: 6 }}>
                    <Icon.board size={12} /> {rtl ? 'في قائمة' : 'in list'} <strong style={{ color: theme.text }}>{c.listTitle || listTitle}</strong>
                  </div>
                  <h2 style={{
                    margin: 0, fontSize: 19, fontWeight: 700,
                    color: theme.text, letterSpacing: '-.015em', textWrap: 'balance',
                    overflowWrap: 'anywhere',
                  }}>{c.title}</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {canEdit && (
                    <CompleteButton theme={theme} rtl={rtl} card={c} cardId={cardId}
                      onChange={(completedAt) => setState((s) => ({ ...s, card: { ...s.card, completedAt } }))} />
                  )}
                  <button onClick={onClose} style={{ ...iconBtn(theme), padding: 6, fontSize: 18, lineHeight: 1 }}>×</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
                <MetaBlock label={rtl ? 'الأعضاء' : 'Members'} theme={theme}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    {c.memberIds.length > 0
                      ? <AvatarStack ids={c.memberIds} size={26} ringColor={theme.surface} max={4} />
                      : <span style={{ fontSize: 12, color: theme.mutedDim }}>—</span>}
                    <button style={{
                      marginInlineStart: 6, width: 26, height: 26,
                      borderRadius: '50%', border: `1px dashed ${theme.border}`,
                      background: 'transparent', color: theme.muted, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><Icon.plus size={11} /></button>
                  </div>
                </MetaBlock>
                <MetaBlock label={rtl ? 'الوسوم' : 'Labels'} theme={theme}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {c.labelIds.length > 0
                      ? c.labelIds.map((l) => <LabelChip key={l} id={l} theme={theme} />)
                      : <span style={{ fontSize: 12, color: theme.mutedDim }}>—</span>}
                  </div>
                </MetaBlock>
                <MetaBlock label={rtl ? 'تاريخ الاستحقاق' : 'Due date'} theme={theme}>
                  {c.due ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: theme.surface2, padding: '5px 10px', borderRadius: 6,
                      fontSize: 12.5, fontWeight: 500, color: theme.text,
                      border: `.5px solid ${theme.border}`,
                    }}>
                      <Icon.clock /> {formatDueDate(c.due)}
                    </span>
                  ) : <span style={{ fontSize: 12, color: theme.mutedDim }}>—</span>}
                </MetaBlock>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: 28, marginTop: 24 }}>
                <div style={{ minWidth: 0 }}>
                  <Section icon="paper" title={rtl ? 'الوصف' : 'Description'} theme={theme}
                    trailing={canEdit && !editingDesc && (
                      <button onClick={() => { setDesc(c.description || ''); setEditingDesc(true); }} style={{
                        background: theme.surface2, border: `.5px solid ${theme.border}`,
                        color: theme.text, padding: '3px 10px', borderRadius: 5,
                        fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                      }}>{rtl ? 'تعديل' : 'Edit'}</button>
                    )}>
                    {editingDesc ? (
                      <div>
                        <textarea autoFocus value={desc} onChange={(e) => setDesc(e.target.value)}
                          style={{
                            width: '100%', minHeight: 100, padding: 10,
                            background: theme.surface2, color: theme.text,
                            border: `.5px solid ${theme.border}`, borderRadius: 6,
                            fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
                            lineHeight: 1.5,
                          }} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button onClick={saveDesc} disabled={savingDesc} style={{
                            background: theme.accent, color: theme.accentText, border: 'none',
                            padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                            cursor: 'pointer', fontFamily: 'inherit',
                          }}>{savingDesc ? '…' : (rtl ? 'حفظ' : 'Save')}</button>
                          <button onClick={() => { setDesc(c.description || ''); setEditingDesc(false); }} style={{
                            background: 'transparent', color: theme.muted, border: 'none',
                            padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                          }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
                        </div>
                      </div>
                    ) : (
                      <p style={{
                        margin: 0, fontSize: 13.5, lineHeight: 1.6,
                        color: c.description ? theme.text : theme.mutedDim, textWrap: 'pretty',
                      }}>{c.description || (rtl ? 'لا يوجد وصف بعد.' : 'No description yet.')}</p>
                    )}
                  </Section>

                  <AttachmentsSection theme={theme} rtl={rtl}
                    attachments={c.attachments}
                    coverAttachmentId={c.coverAttachmentId}
                    canEdit={canEdit}
                    cardId={cardId}
                    userDeptId={auth.user?.memberships?.find((mm) => mm.workspaceId === workspaceId)?.departmentId || null}
                    onUpload={canEdit ? uploadAttachment : null}
                    onAttachedFromMedia={canEdit ? ((att) => {
                      setState((s) => ({ ...s, card: { ...s.card, attachments: [...s.card.attachments, att] } }));
                    }) : null}
                    onDelete={canEdit ? deleteAttachment : null}
                    onRename={canEdit ? renameAttachment : null}
                    onSetCover={canEdit ? setCover : null} />

                  {(c.checklist.length > 0 || canEdit) && (
                    <ChecklistSection theme={theme} rtl={rtl} items={c.checklist}
                      onToggle={canEdit ? toggleCheck : null}
                      onAdd={canEdit ? addChecklistItem : null}
                      onRename={canEdit ? renameChecklistItem : null}
                      onDelete={canEdit ? deleteChecklistItem : null} />
                  )}

                  <Section icon="comment" title={rtl ? 'تعليقات' : 'Comments'} theme={theme}
                    trailing={<span style={{ fontSize: 11.5, color: theme.muted }}>{c.comments.length}</span>}>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        <Avatar id={auth.user?.id || ''} size={28} />
                        <div style={{ flex: 1 }}>
                          <textarea value={comment} onChange={(e) => setComment(e.target.value)}
                            placeholder={rtl ? 'اكتب تعليقًا…' : 'Write a comment…'}
                            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitComment(); } }}
                            style={{
                              width: '100%', minHeight: comment ? 60 : 36, padding: '8px 12px',
                              background: theme.surface2, color: theme.text,
                              border: `.5px solid ${theme.border}`, borderRadius: 8,
                              fontSize: 13, fontFamily: 'inherit', resize: 'none', outline: 'none',
                              transition: 'min-height .15s',
                            }} />
                          {comment && (
                            <button onClick={submitComment} disabled={postingComment} style={{
                              marginTop: 6, background: theme.accent, color: theme.accentText, border: 'none',
                              padding: '6px 14px', borderRadius: 5, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}>{postingComment ? '…' : (rtl ? 'إرسال' : 'Send')}</button>
                          )}
                        </div>
                      </div>
                    )}
                    {c.comments.map((m) => (
                      <CommentRow key={m.id} comment={m} theme={theme} />
                    ))}
                    {!canEdit && c.comments.length === 0 && (
                      <div style={{ padding: 14, fontSize: 12, color: theme.muted, textAlign: 'center' }}>
                        {rtl ? 'لا تعليقات بعد' : 'No comments yet'}
                      </div>
                    )}
                  </Section>

                  <ActivitySection theme={theme} rtl={rtl} activity={activity} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <button onClick={() => setWatching(!watching)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: watching ? theme.accent : theme.surface2,
                    color: watching ? theme.accentText : theme.text,
                    border: watching ? 'none' : `.5px solid ${theme.border}`,
                    padding: '8px 12px', borderRadius: 6,
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    textAlign: 'start', fontFamily: 'inherit',
                    marginBottom: 10,
                  }}>
                    <Icon.bell size={13} />
                    {watching ? (rtl ? 'تتم متابعتك' : 'Watching') : (rtl ? 'متابعة' : 'Watch')}
                  </button>
                  {canEdit && (
                    <>
                      <div style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                        color: theme.mutedDim, textTransform: 'uppercase', marginBottom: 4,
                      }}>{rtl ? 'إضافة إلى البطاقة' : 'Add to card'}</div>
                      <MembersButton theme={theme} rtl={rtl} card={c} allMembers={allMembers}
                        boardDepartmentId={c.boardDepartmentId}
                        onToggle={toggleMember} />
                      <LabelsButton theme={theme} rtl={rtl} card={c} allLabels={allLabels} onToggle={toggleLabel}
                        boardId={c.boardId}
                        onLabelCreated={(lbl) => {
                          setAllLabels((s) => [...s, lbl]);
                          // Pass the label object so toggle hydrates labelsById
                          // (the closure's allLabels doesn't see it yet).
                          toggleLabel(lbl.id, lbl);
                          onRefetchBoard?.();
                        }}
                        onLabelUpdated={(lbl) => {
                          setAllLabels((s) => s.map((l) => l.id === lbl.id ? lbl : l));
                          setState((s) => s.card?.labelsById?.[lbl.id]
                            ? { ...s, card: { ...s.card, labelsById: { ...s.card.labelsById, [lbl.id]: lbl } } }
                            : s);
                          onRefetchBoard?.();
                        }}
                        onLabelDeleted={(id) => {
                          setAllLabels((s) => s.filter((l) => l.id !== id));
                          setState((s) => ({
                            ...s,
                            card: {
                              ...s.card,
                              labelIds: s.card.labelIds.filter((x) => x !== id),
                              labelsById: Object.fromEntries(Object.entries(s.card.labelsById).filter(([k]) => k !== id)),
                            },
                          }));
                          onRefetchBoard?.();
                        }} />
                      <DueDateButton theme={theme} rtl={rtl} card={c} onSet={setDue} />
                      <div style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
                        color: theme.mutedDim, textTransform: 'uppercase', marginBottom: 4, marginTop: 14,
                      }}>{rtl ? 'إجراءات' : 'Actions'}</div>
                      <MoveCardButton theme={theme} rtl={rtl} card={c} lists={allLists} onMove={moveToList} />
                      <button onClick={archiveCard} style={{
                        background: theme.surface2, color: '#DC2626',
                        border: `.5px solid ${theme.border}`, padding: '7px 10px',
                        borderRadius: 6, fontSize: 12.5, fontWeight: 500,
                        cursor: 'pointer', textAlign: 'start',
                        fontFamily: 'inherit',
                      }}>{rtl ? 'حذف البطاقة' : 'Delete card'}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </BoardDataProvider>
        )}
      </div>
    </div>
  );
}

function MetaBlock({ label, theme, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
        color: theme.mutedDim, textTransform: 'uppercase', marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Section({ icon, title, trailing, theme, children }) {
  const I = Icon[icon];
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10, color: theme.text,
      }}>
        <I size={14} />
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-.005em', flex: 1 }}>{title}</h4>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function ChecklistSection({ theme, rtl, items, onToggle, onAdd, onRename, onDelete }) {
  const total = items.length;
  const done = items.filter((k) => k.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const [adding, setAdding] = React.useState(false);
  const [text, setText] = React.useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) { setText(''); setAdding(false); return; }
    onAdd?.(t);
    setText('');
  };
  return (
    <Section icon="check" title={rtl ? 'قائمة المهام' : 'Checklist'} theme={theme}
      trailing={total > 0
        ? <span style={{ fontSize: 11.5, color: theme.muted }}>{done}/{total}</span>
        : null}>
      {total > 0 && (
        <div style={{
          height: 4, background: theme.surface2, borderRadius: 2,
          overflow: 'hidden', marginBottom: 10,
        }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: pct === 100 ? '#0E7C66' : theme.accent,
            transition: 'width .25s',
          }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((k) => (
          <ChecklistRow key={k.id} item={k} theme={theme} rtl={rtl}
            onToggle={onToggle} onRename={onRename} onDelete={onDelete} />
        ))}
        {total === 0 && !adding && (
          <div style={{ fontSize: 12, color: theme.muted, padding: '4px 8px' }}>
            {rtl ? 'لا مهام بعد' : 'No tasks yet'}
          </div>
        )}
      </div>
      {onAdd && (adding ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder={rtl ? 'أضف مهمة…' : 'Add a task…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setText(''); setAdding(false); }
            }}
            style={{
              flex: 1, padding: '6px 10px',
              background: theme.bg, color: theme.text,
              border: `1px solid ${theme.border}`, borderRadius: 5,
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
          <button onClick={submit} disabled={!text.trim()} style={{
            padding: '6px 12px', borderRadius: 5,
            background: theme.accent, color: theme.accentText, border: 'none',
            fontSize: 12, fontWeight: 600,
            cursor: !text.trim() ? 'default' : 'pointer',
            opacity: !text.trim() ? 0.6 : 1, fontFamily: 'inherit',
          }}>{rtl ? 'إضافة' : 'Add'}</button>
          <button onClick={() => { setText(''); setAdding(false); }} style={{
            padding: '6px 8px', background: 'transparent',
            border: 'none', color: theme.muted, cursor: 'pointer', fontSize: 16,
          }}>×</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{
          marginTop: 8, padding: '6px 10px',
          background: 'transparent', color: theme.muted,
          border: `1px dashed ${theme.border}`, borderRadius: 5,
          fontSize: 12, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon.plus size={11} />
          {rtl ? 'إضافة مهمة' : 'Add a task'}
        </button>
      ))}
    </Section>
  );
}

function ChecklistRow({ item: k, theme, rtl, onToggle, onRename, onDelete }) {
  const [editing, setEditing] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [text, setText] = React.useState(k.text);
  React.useEffect(() => { setText(k.text); }, [k.text]);

  const saveRename = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== k.text) onRename?.(k, text.trim());
    else setText(k.text);
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
        <input type="checkbox" checked={k.done} disabled
          style={{ accentColor: theme.accent, width: 14, height: 14 }} />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onBlur={saveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
            if (e.key === 'Escape') { setText(k.text); setEditing(false); }
          }}
          style={{
            flex: 1, padding: '4px 8px',
            background: theme.bg, color: theme.text,
            border: `1px solid ${theme.accent}`, borderRadius: 4,
            fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }} />
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px', borderRadius: 5,
      }}>
      <input type="checkbox" checked={k.done}
        disabled={!onToggle}
        onChange={() => onToggle && onToggle(k)}
        style={{ accentColor: theme.accent, width: 14, height: 14, cursor: onToggle ? 'pointer' : 'default' }} />
      <span
        onClick={() => onRename && setEditing(true)}
        style={{
          flex: 1, fontSize: 13, color: k.done ? theme.muted : theme.text,
          textDecoration: k.done ? 'line-through' : 'none',
          cursor: onRename ? 'text' : 'default',
        }}>{k.text}</span>
      {hover && onRename && (
        <button onClick={() => setEditing(true)} title={rtl ? 'تعديل' : 'Edit'} style={{
          padding: '3px 6px', borderRadius: 4,
          background: 'transparent', border: 'none', color: theme.muted,
          cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
        }}>{rtl ? 'تعديل' : 'Edit'}</button>
      )}
      {hover && onDelete && (
        <button onClick={() => onDelete(k)} title={rtl ? 'حذف' : 'Delete'} style={{
          padding: '3px 6px', borderRadius: 4,
          background: 'transparent', border: 'none', color: '#DC2626',
          cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
        }}>×</button>
      )}
    </div>
  );
}

function CommentRow({ comment, theme }) {
  const ctx = useBoardData();
  const author = ctx?.peopleById?.[comment.authorId];
  const when = new Date(comment.createdAt);
  const ago = formatAgo(when);
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
      <Avatar id={comment.authorId} size={28} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, marginBottom: 3 }}>
          <strong style={{ color: theme.text }}>{author?.name || 'Unknown'}</strong>
          <span style={{ color: theme.muted, marginInlineStart: 8 }}>{ago}</span>
        </div>
        <div style={{
          background: theme.surface2, padding: '8px 12px',
          borderRadius: 8, fontSize: 13, color: theme.text,
          lineHeight: 1.5, textWrap: 'pretty',
          border: `.5px solid ${theme.border}`,
        }}>{comment.body}</div>
      </div>
    </div>
  );
}

function formatAgo(d) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SidebarBtn({ theme, icon, label, onClick, anchorRef }) {
  const I = Icon[icon];
  return (
    <button ref={anchorRef} onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: theme.surface2, color: theme.text,
      border: `.5px solid ${theme.border}`, padding: '7px 10px',
      borderRadius: 6, fontSize: 12.5, fontWeight: 500,
      cursor: 'pointer', textAlign: 'start',
      fontFamily: 'inherit',
    }}>
      <I size={12} />{label}
    </button>
  );
}

// Asana-style "Mark complete" toggle. Pill button at the top of the card.
// Sets/clears Card.completedAt — drives KPIs.
function CompleteButton({ theme, rtl, card, cardId, onChange }) {
  const [busy, setBusy] = React.useState(false);
  const completed = !!card.completedAt;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    // Optimistic
    onChange(completed ? null : new Date().toISOString());
    try {
      if (completed) {
        await api(`/cards/${cardId}/complete`, { method: 'DELETE' });
      } else {
        const r = await api(`/cards/${cardId}/complete`, { method: 'POST' });
        onChange(r.completedAt);
      }
    } catch (err) {
      // Revert
      onChange(completed ? card.completedAt : null);
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={toggle} disabled={busy} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px', borderRadius: 999,
      background: completed ? '#0E7C66' : 'transparent',
      color: completed ? '#fff' : '#0E7C66',
      border: `1.5px solid #0E7C66`,
      fontSize: 12.5, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
      fontFamily: 'inherit',
      opacity: busy ? 0.6 : 1,
      transition: 'background .12s, color .12s',
    }}>
      <span style={{ fontSize: 13, lineHeight: 1 }}>✓</span>
      {completed
        ? (rtl ? 'مكتملة' : 'Completed')
        : (rtl ? 'وضع علامة كمكتملة' : 'Mark complete')}
    </button>
  );
}

function MembersButton({ theme, rtl, card, allMembers, boardDepartmentId, onToggle }) {
  const ref = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const filtered = allMembers.filter((m) =>
    !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.email.toLowerCase().includes(filter.toLowerCase()),
  );
  // Sort: same-dept first, then others
  const sorted = [...filtered].sort((a, b) => {
    const aSame = a.department?.id === boardDepartmentId ? 0 : 1;
    const bSame = b.department?.id === boardDepartmentId ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <SidebarBtn theme={theme} anchorRef={ref} icon="plus"
        label={rtl ? 'الأعضاء' : 'Members'}
        onClick={() => setOpen((v) => !v)} />
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} theme={theme} width={300}>
        <PopoverHeader theme={theme} onClose={() => setOpen(false)}>
          {rtl ? 'تعيين أعضاء' : 'Assign members'}
        </PopoverHeader>
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder={rtl ? 'بحث…' : 'Search…'}
          style={{
            width: '100%', padding: '6px 10px',
            background: theme.bg, color: theme.text,
            border: `1px solid ${theme.border}`, borderRadius: 5,
            fontSize: 12, fontFamily: 'inherit', outline: 'none',
            marginBottom: 6,
          }} />
        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map((m) => {
            const checked = card.memberIds.includes(m.userId);
            const isOtherDept = boardDepartmentId && m.department && m.department.id !== boardDepartmentId;
            return (
              <button key={m.userId} onClick={() => onToggle(m.userId)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 5,
                background: checked ? theme.accentSoft : 'transparent',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'start',
              }}
              onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = theme.surface2; }}
              onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: m.avatarColor, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, flexShrink: 0,
                }}>{m.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: theme.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.name}
                    {isOtherDept && (
                      <span title={rtl
                          ? `من قسم آخر: ${m.department.name} — سيُمنح وصول للوحة عند الإضافة`
                          : `From ${m.department.name} — will get board access when added`}
                        style={{
                          fontSize: 9.5, fontWeight: 700,
                          padding: '1px 5px', borderRadius: 3,
                          background: theme.surface2, color: theme.muted,
                          border: `.5px solid ${theme.border}`,
                          letterSpacing: '.04em', textTransform: 'uppercase',
                        }}>
                        ↗ {m.department.name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: theme.muted }}>{m.email}</div>
                </div>
                {checked && <span style={{ color: theme.accent, fontSize: 14 }}>✓</span>}
              </button>
            );
          })}
          {sorted.length === 0 && (
            <div style={{ padding: 14, textAlign: 'center', color: theme.muted, fontSize: 11.5 }}>
              {rtl ? 'لا نتائج' : 'No matches'}
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}

const LABEL_PALETTE = [
  { color: '#3B82F6', bg: '#E0EBFF' },
  { color: '#DC2626', bg: '#FEE2E2' },
  { color: '#7C3AED', bg: '#EDE3FF' },
  { color: '#DB2777', bg: '#FCE4EF' },
  { color: '#0E7C66', bg: '#D7F1E9' },
  { color: '#B45309', bg: '#FEF0CC' },
  { color: '#0891B2', bg: '#CFFAFE' },
  { color: '#374151', bg: '#E5E7EB' },
];

function LabelsButton({ theme, rtl, card, allLabels, onToggle, boardId, onLabelCreated, onLabelUpdated, onLabelDeleted }) {
  const ref = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [name, setName] = React.useState('');
  const [palette, setPalette] = React.useState(LABEL_PALETTE[0]);
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState('');

  const reset = () => { setCreating(false); setEditingId(null); setName(''); setPalette(LABEL_PALETTE[0]); };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (editingId) {
        const updated = await api(`/labels/${editingId}`, {
          method: 'PATCH',
          body: { name: name.trim(), color: palette.color, bg: palette.bg },
        });
        onLabelUpdated?.(updated);
      } else {
        const created = await api(`/boards/${boardId}/labels`, {
          method: 'POST',
          body: { name: name.trim(), color: palette.color, bg: palette.bg },
        });
        onLabelCreated?.(created);
      }
      reset();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (l) => {
    setEditingId(l.id);
    setName(l.name);
    const p = LABEL_PALETTE.find((x) => x.color === l.color) || { color: l.color, bg: l.bg };
    setPalette(p);
    setCreating(true);
  };

  const onDelete = async (id) => {
    if (!confirm(rtl ? 'حذف الوسم نهائيًا؟ سيُزال من كل بطاقات هذه اللوحة.' : 'Delete this label? It will be removed from all cards on this board.')) return;
    try {
      await api(`/labels/${id}`, { method: 'DELETE' });
      onLabelDeleted?.(id);
    } catch (err) {
      alert(err.message);
    }
  };

  const filtered = allLabels.filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <SidebarBtn theme={theme} anchorRef={ref} icon="check"
        label={rtl ? 'الوسوم' : 'Labels'}
        onClick={() => setOpen((v) => !v)} />
      <Popover anchorRef={ref} open={open} onClose={() => { setOpen(false); reset(); }} theme={theme} width={300}>
        <PopoverHeader theme={theme} onClose={() => { setOpen(false); reset(); }}>
          {rtl ? 'وسوم اللوحة' : 'Board labels'}
        </PopoverHeader>

        {!creating && (
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder={rtl ? 'بحث…' : 'Search labels…'}
            style={{
              width: '100%', padding: '6px 10px',
              background: theme.bg, color: theme.text,
              border: `1px solid ${theme.border}`, borderRadius: 5,
              fontSize: 12, fontFamily: 'inherit', outline: 'none',
              marginBottom: 8,
            }} />
        )}

        {!creating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' }}>
            {filtered.map((l) => {
              const checked = card.labelIds.includes(l.id);
              return (
                <div key={l.id} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: 2, borderRadius: 5,
                  background: checked ? theme.accentSoft : 'transparent',
                }}
                onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = theme.surface2; }}
                onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}>
                  <button onClick={() => onToggle(l.id)} style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 6px', background: 'transparent', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
                  }}>
                    <span style={{
                      flex: 1, height: 22, borderRadius: 4, padding: '0 10px',
                      background: theme.name === 'dark' ? l.color + '33' : l.bg,
                      color: l.color, fontSize: 11.5, fontWeight: 600,
                      display: 'flex', alignItems: 'center',
                    }}>{l.name}</span>
                    {checked && <span style={{ color: theme.accent, fontSize: 14 }}>✓</span>}
                  </button>
                  <button onClick={() => startEdit(l)} title={rtl ? 'تعديل' : 'Edit'} style={iconMicroBtn(theme)}>✎</button>
                  <button onClick={() => onDelete(l.id)} title={rtl ? 'حذف' : 'Delete'} style={iconMicroBtn(theme, '#DC2626')}>×</button>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 14, textAlign: 'center', color: theme.muted, fontSize: 11.5 }}>
                {filter ? (rtl ? 'لا نتائج' : 'No matches') : (rtl ? 'لا توجد وسوم بعد' : 'No labels yet')}
              </div>
            )}
          </div>
        )}

        {creating && (
          <div>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={rtl ? 'اسم الوسم' : 'Label name'}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') reset(); }}
              style={{
                width: '100%', padding: '8px 10px',
                background: theme.bg, color: theme.text,
                border: `1px solid ${theme.border}`, borderRadius: 5,
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                marginBottom: 8,
              }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, color: theme.mutedDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {rtl ? 'اللون' : 'Color'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
              {LABEL_PALETTE.map((p) => (
                <button key={p.color} type="button" onClick={() => setPalette(p)} style={{
                  height: 26, borderRadius: 4,
                  background: theme.name === 'dark' ? p.color + '33' : p.bg,
                  color: p.color, fontSize: 11, fontWeight: 600,
                  border: palette.color === p.color ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{name || 'Aa'}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={submit} disabled={busy || !name.trim()} style={{
                flex: 1, padding: '6px 12px', borderRadius: 5,
                background: theme.accent, color: theme.accentText, border: 'none',
                fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                opacity: busy || !name.trim() ? 0.6 : 1, fontFamily: 'inherit',
              }}>{busy ? '…' : (editingId ? (rtl ? 'حفظ' : 'Save') : (rtl ? 'إضافة' : 'Create'))}</button>
              <button onClick={reset} style={{
                padding: '6px 12px', borderRadius: 5,
                background: 'transparent', color: theme.muted,
                border: `.5px solid ${theme.border}`,
                fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </div>
        )}

        {!creating && (
          <button onClick={() => setCreating(true)} style={{
            width: '100%', marginTop: 8, padding: '8px 10px',
            background: theme.surface2, color: theme.text,
            border: `1px dashed ${theme.border}`, borderRadius: 5,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>+ {rtl ? 'وسم جديد لهذه اللوحة' : 'Create label for this board'}</button>
        )}
      </Popover>
    </>
  );
}

function iconMicroBtn(theme, color) {
  return {
    width: 22, height: 22, padding: 0,
    background: 'transparent', border: 'none',
    color: color || theme.muted,
    cursor: 'pointer', fontSize: 13, lineHeight: 1,
    borderRadius: 3, fontFamily: 'inherit',
  };
}

function AttachmentsSection({ theme, rtl, attachments, coverAttachmentId, canEdit, cardId, userDeptId, onUpload, onAttachedFromMedia, onDelete, onRename, onSetCover }) {
  // Multiple inputs (rather than one with dynamic accept/capture) so each
  // mode triggers the native picker reliably without state-timing issues.
  const imageRef = React.useRef(null);
  const videoRef = React.useRef(null);
  const cameraRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // Selected attachment for the lightbox preview (image/video). null = closed.
  const [previewing, setPreviewing] = React.useState(null);

  const openPreview = (att) => setPreviewing(att);

  if (attachments.length === 0 && !canEdit) return null;

  const handleFile = (e) => { onUpload(e.target.files?.[0]); e.target.value = ''; };

  const addBtn = canEdit && (
    <div style={{ position: 'relative' }}>
      <input ref={imageRef}  type="file" accept="image/*"                        hidden onChange={handleFile} />
      <input ref={videoRef}  type="file" accept="video/*"                        hidden onChange={handleFile} />
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={handleFile} />
      <input ref={fileRef}   type="file"                                         hidden onChange={handleFile} />
      <button onClick={() => setMenuOpen((o) => !o)} style={{
        background: theme.surface2, border: `.5px solid ${theme.border}`,
        color: theme.text, padding: '4px 10px', borderRadius: 5,
        fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        <Icon.plus size={12} />
        {rtl ? 'إضافة' : 'Add'}
      </button>
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{
            position: 'absolute', top: '100%', insetInlineEnd: 0, marginTop: 4,
            background: theme.surface, border: `.5px solid ${theme.border}`,
            borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,.15)',
            zIndex: 80, minWidth: 200, padding: 4,
          }}>
            <button onClick={() => { setMenuOpen(false); imageRef.current?.click(); }} style={menuItemStyle(theme)}>
              <Icon.paper size={12} />
              {rtl ? 'صورة' : 'Photo'}
            </button>
            <button onClick={() => { setMenuOpen(false); videoRef.current?.click(); }} style={menuItemStyle(theme)}>
              <Icon.paper size={12} />
              {rtl ? 'فيديو' : 'Video'}
            </button>
            <button onClick={() => { setMenuOpen(false); cameraRef.current?.click(); }} style={menuItemStyle(theme)}>
              <Icon.paper size={12} />
              {rtl ? 'الكاميرا' : 'Camera'}
            </button>
            <button onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} style={menuItemStyle(theme)}>
              <Icon.paper size={12} />
              {rtl ? 'ملف من الجهاز' : 'File from device'}
            </button>
            <button onClick={() => { setMenuOpen(false); setPickerOpen(true); }}
              disabled={!userDeptId}
              title={!userDeptId ? (rtl ? 'لا توجد مكتبة ميديا متاحة' : 'No media library available') : ''}
              style={{ ...menuItemStyle(theme), opacity: userDeptId ? 1 : 0.5,
                cursor: userDeptId ? 'pointer' : 'not-allowed' }}>
              <Icon.folder size={12} />
              {rtl ? 'من الميديا' : 'Pick from media'}
            </button>
          </div>
        </>
      )}
      {pickerOpen && userDeptId && (
        <MediaPicker theme={theme} rtl={rtl} departmentId={userDeptId} cardId={cardId}
          onClose={() => setPickerOpen(false)}
          onAttached={(att) => { setPickerOpen(false); onAttachedFromMedia?.(att); }} />
      )}
    </div>
  );

  const lightbox = previewing && (
    <AttachmentLightbox theme={theme} rtl={rtl} attachment={previewing} onClose={() => setPreviewing(null)} />
  );

  if (attachments.length === 0) {
    return (
      <Section icon="paper" title={rtl ? 'المرفقات' : 'Attachments'} theme={theme} trailing={addBtn}>
        <div onClick={() => fileRef.current?.click()} style={{
          padding: 14, fontSize: 12, color: theme.muted, textAlign: 'center',
          background: theme.surface2, border: `.5px dashed ${theme.border}`,
          borderRadius: theme.cardRadius, cursor: canEdit ? 'pointer' : 'default',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <Icon.paper size={18} />
          {rtl ? 'لا توجد مرفقات بعد — انقر للرفع' : 'No attachments yet — click to upload'}
        </div>
        {lightbox}
      </Section>
    );
  }
  return (
    <Section icon="paper" title={rtl ? 'المرفقات' : 'Attachments'} theme={theme} trailing={addBtn}>
      {attachments.map((a) => (
        <AttachmentRow key={a.id} attachment={a} theme={theme} rtl={rtl}
          isCover={a.id === coverAttachmentId}
          onPreview={openPreview}
          onDelete={canEdit ? onDelete : null}
          onRename={canEdit ? onRename : null}
          onSetCover={canEdit ? onSetCover : null} />
      ))}
      {lightbox}
    </Section>
  );
}

function menuItemStyle(theme) {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 10px', borderRadius: 4,
    background: 'transparent', border: 'none',
    color: theme.text, fontSize: 12.5, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'inherit',
  };
}

function MediaPicker({ theme, rtl, departmentId, cardId, onClose, onAttached }) {
  const [items, setItems] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [attaching, setAttaching] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/departments/${departmentId}/media?limit=60`)
      .then((d) => { if (!cancelled) setItems(d.items || []); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [departmentId]);

  const attach = async (m) => {
    if (attaching) return;
    setAttaching(m.id);
    try {
      const att = await api(`/cards/${cardId}/attachments/from-media`, {
        method: 'POST', body: { mediaId: m.id },
      });
      onAttached?.(att);
    } catch (err) {
      alert(err.message);
    } finally {
      setAttaching(null);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(10,12,18,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 10, width: 720, maxWidth: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            {rtl ? 'اختيار ملف من الميديا' : 'Pick from media'}
          </h3>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: theme.muted,
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}>×</button>
        </div>
        <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: theme.muted }}>{rtl ? 'جاري التحميل…' : 'Loading…'}</div>}
          {error && <div style={{ padding: 16, color: '#DC2626', fontSize: 13 }}>{error}</div>}
          {items && items.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: theme.muted, fontSize: 13 }}>
              {rtl ? 'لا توجد ملفات في الميديا بعد.' : 'No media items yet.'}
            </div>
          )}
          {items && items.length > 0 && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10,
            }}>
              {items.map((m) => (
                <button key={m.id} onClick={() => attach(m)}
                  disabled={attaching !== null && attaching !== m.id}
                  style={{
                    background: theme.surface2, border: `.5px solid ${theme.border}`,
                    borderRadius: 7, padding: 0, overflow: 'hidden',
                    cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                    display: 'flex', flexDirection: 'column',
                    opacity: attaching && attaching !== m.id ? 0.5 : 1,
                  }}>
                  <div style={{
                    height: 100, background: theme.bg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: theme.mutedDim, overflow: 'hidden',
                  }}>
                    {m.isImage && m.thumbUrl ? (
                      <img src={withToken(m.thumbUrl)} alt={m.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 22, fontWeight: 700, color: theme.muted }}>
                        {(m.filename.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '6px 8px', textAlign: rtl ? 'right' : 'left' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: theme.text,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.title || m.filename}
                    </div>
                    <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>
                      {(m.sizeBytes / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  {attaching === m.id && (
                    <div style={{ padding: '4px 8px', fontSize: 10, color: theme.accent }}>
                      {rtl ? 'جاري الإرفاق…' : 'Attaching…'}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentRow({ attachment: a, theme, rtl, isCover, onPreview, onDelete, onRename, onSetCover }) {
  const isImage = a.mimeType?.startsWith('image/');
  const isVideo = a.mimeType?.startsWith('video/');
  const isMedia = isImage || isVideo;
  const ext = (a.filename.split('.').pop() || '').toUpperCase().slice(0, 4);
  const sizeKB = (a.sizeBytes / 1024).toFixed(a.sizeBytes < 100_000 ? 1 : 0);
  const sizeMB = (a.sizeBytes / 1024 / 1024).toFixed(2);
  const sizeStr = a.sizeBytes < 1_000_000 ? `${sizeKB} KB` : `${sizeMB} MB`;
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(a.filename);
  React.useEffect(() => { setName(a.filename); }, [a.filename]);
  const submitRename = () => {
    const t = name.trim();
    if (!t || t === a.filename) { setRenaming(false); setName(a.filename); return; }
    onRename?.(a.id, t);
    setRenaming(false);
  };
  const openMedia = (e) => { e.preventDefault(); onPreview?.(a); };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: 8,
      background: theme.surface2, border: `.5px solid ${theme.border}`,
      borderRadius: 6, marginBottom: 6,
    }}>
      <div onClick={isMedia ? openMedia : undefined} style={{
        position: 'relative',
        width: 44, height: 36, borderRadius: 4, flexShrink: 0,
        background: isImage ? `url(${withToken(a.url)}) center/cover` : (isVideo ? '#111827' : '#3B82F6'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '.05em',
        cursor: isMedia ? 'pointer' : 'default',
      }}>
        {isVideo && <span style={{ fontSize: 14, lineHeight: 1 }}>▶</span>}
        {!isMedia && ext}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {renaming ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              if (e.key === 'Escape') { setName(a.filename); setRenaming(false); }
            }}
            style={{
              width: '100%', padding: '2px 6px',
              background: theme.bg, color: theme.text,
              border: `1px solid ${theme.accent}`, borderRadius: 3,
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit', outline: 'none',
            }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <a href={withToken(a.url)} onClick={isMedia ? openMedia : undefined}
              target={isMedia ? undefined : '_blank'} rel="noreferrer" style={{
              fontSize: 13, fontWeight: 600, color: theme.text, textDecoration: 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
              cursor: 'pointer',
            }}>{a.filename}</a>
            {isCover && (
              <span style={{
                fontSize: 9.5, fontWeight: 700,
                padding: '1px 6px', borderRadius: 3,
                background: theme.accent, color: theme.accentText,
                letterSpacing: '.04em', textTransform: 'uppercase',
              }}>{rtl ? 'الغلاف' : 'Cover'}</span>
            )}
            {onRename && (
              <button onClick={() => setRenaming(true)} title={rtl ? 'إعادة تسمية' : 'Rename'} style={{
                background: 'transparent', border: 'none', color: theme.muted,
                cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center',
              }}>
                <Icon.pencil size={11} />
              </button>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, color: theme.muted }}>
          {a.mimeType} · {sizeStr} · {formatAgo(new Date(a.createdAt))}
        </div>
      </div>
      {isImage && onSetCover && (
        <button onClick={() => onSetCover(isCover ? null : a.id)} style={{
          background: 'transparent', border: `.5px solid ${theme.border}`,
          color: isCover ? '#DC2626' : theme.muted,
          padding: '3px 8px', borderRadius: 4,
          cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
        }} title={isCover ? (rtl ? 'إزالة الغلاف' : 'Remove cover') : (rtl ? 'تعيين كغلاف' : 'Set as cover')}>
          {isCover ? (rtl ? 'إزالة الغلاف' : 'Unset') : (rtl ? 'كغلاف' : 'Set cover')}
        </button>
      )}
      {onDelete && (
        <button onClick={() => onDelete(a.id)} style={{
          background: 'transparent', border: 'none', color: theme.muted,
          cursor: 'pointer', fontSize: 14, padding: 4,
        }} title={rtl ? 'حذف' : 'Delete'}>×</button>
      )}
    </div>
  );
}

// Centered overlay that previews an image or plays a video without leaving
// the card. Click backdrop or Escape to close. zIndex sits above the card
// modal (50) and the media picker (90).
function AttachmentLightbox({ theme, rtl, attachment: a, onClose }) {
  const isImage = a.mimeType?.startsWith('image/');
  const isVideo = a.mimeType?.startsWith('video/');
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, direction: rtl ? 'rtl' : 'ltr',
    }}>
      <button onClick={onClose} aria-label="Close" style={{
        position: 'absolute', top: 16, insetInlineEnd: 16,
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(255,255,255,.12)', color: '#fff',
        border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit',
      }}>×</button>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: '90vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      }}>
        {isImage && (
          <img src={withToken(a.url)} alt={a.filename}
            style={{ maxWidth: '90vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 6 }} />
        )}
        {isVideo && (
          <video src={withToken(a.url)} controls autoPlay playsInline
            style={{ maxWidth: '90vw', maxHeight: '78vh', borderRadius: 6, background: '#000' }} />
        )}
        {!isImage && !isVideo && (
          <div style={{ color: '#fff', fontSize: 14 }}>
            {rtl ? 'لا يمكن المعاينة' : 'Preview not available'}
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          color: 'rgba(255,255,255,.85)', fontSize: 12.5,
          background: 'rgba(0,0,0,.4)', padding: '6px 12px', borderRadius: 6,
        }}>
          <span style={{ fontWeight: 600 }}>{a.filename}</span>
          <a href={withToken(a.url)} download={a.filename}
            style={{ color: '#fff', textDecoration: 'underline', fontSize: 12 }}>
            {rtl ? 'تنزيل' : 'Download'}
          </a>
        </div>
      </div>
    </div>
  );
}

function ActivitySection({ theme, rtl, activity }) {
  const [open, setOpen] = React.useState(false);
  if (!activity || activity.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 0',
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: theme.text, fontFamily: 'inherit', textAlign: 'start',
      }}>
        <Icon.chevron size={12} open={open} />
        <Icon.clock size={14} />
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-.005em', flex: 1 }}>
          {rtl ? 'النشاط' : 'Activity'}
        </h4>
        <span style={{
          fontSize: 11, fontWeight: 600, color: theme.muted,
          background: theme.surface2, padding: '1px 7px', borderRadius: 999,
        }}>{activity.length}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {activity.map((a) => (
            <ActivityRow key={a.id} item={a} theme={theme} rtl={rtl} />
          ))}
        </div>
      )}
    </div>
  );
}

const VERB_LABELS = {
  card_created:        { en: 'created this card',         ar: 'أنشأ البطاقة' },
  card_moved:          { en: 'moved this card',           ar: 'نقل البطاقة' },
  card_renamed:        { en: 'renamed the card',          ar: 'غيّر اسم البطاقة' },
  card_described:      { en: 'updated the description',   ar: 'حدّث الوصف' },
  card_due_set:        { en: 'set a due date',            ar: 'حدّد تاريخ الاستحقاق' },
  card_due_cleared:    { en: 'cleared the due date',      ar: 'مسح تاريخ الاستحقاق' },
  member_assigned:     { en: 'assigned a member',         ar: 'أضاف عضوًا' },
  member_unassigned:   { en: 'unassigned a member',       ar: 'أزال عضوًا' },
  label_added:         { en: 'added a label',             ar: 'أضاف وسمًا' },
  label_removed:       { en: 'removed a label',           ar: 'أزال وسمًا' },
  comment_added:       { en: 'commented',                 ar: 'علّق' },
  checklist_added:     { en: 'added a checklist item',    ar: 'أضاف مهمة فرعية' },
  checklist_completed: { en: 'completed a task',          ar: 'أكمل مهمة' },
  checklist_uncompleted: { en: 'reopened a task',         ar: 'أعاد فتح مهمة' },
  list_created:        { en: 'added a list',              ar: 'أضاف قائمة' },
  list_renamed:        { en: 'renamed a list',            ar: 'غيّر اسم القائمة' },
  list_archived:       { en: 'archived a list',           ar: 'أرشف قائمة' },
};

function ActivityRow({ item, theme, rtl }) {
  const lbl = VERB_LABELS[item.verb] || { en: item.verb, ar: item.verb };
  const text = rtl ? lbl.ar : lbl.en;
  const meta = item.meta || {};
  const detail = meta.from && meta.to
    ? `${meta.from} → ${meta.to}`
    : meta.fromListTitle && meta.toListTitle
      ? `${meta.fromListTitle} → ${meta.toListTitle}`
      : meta.snippet || meta.text || meta.labelName || '';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0',
      fontSize: 12.5, color: theme.muted,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: item.actor.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 700, flexShrink: 0,
      }}>{item.actor.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>
          <strong style={{ color: theme.text, fontWeight: 600 }}>{item.actor.name}</strong>{' '}
          <span>{text}</span>
          {detail && <span style={{ color: theme.text, fontWeight: 500 }}> — {detail}</span>}
        </div>
        <div style={{ fontSize: 10.5, color: theme.mutedDim, marginTop: 1 }}>
          {formatAgo(new Date(item.createdAt))}
        </div>
      </div>
    </div>
  );
}

function MoveCardButton({ theme, rtl, card, lists, onMove }) {
  const ref = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <SidebarBtn theme={theme} anchorRef={ref} icon="board"
        label={rtl ? 'نقل البطاقة' : 'Move card'}
        onClick={() => setOpen((v) => !v)} />
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} theme={theme} width={240}>
        <PopoverHeader theme={theme} onClose={() => setOpen(false)}>
          {rtl ? 'نقل إلى قائمة' : 'Move to list'}
        </PopoverHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
          {lists.map((l) => (
            <button key={l.id} onClick={() => { onMove(l.id); setOpen(false); }} disabled={l.id === card.listId}
              style={{
                padding: '8px 10px', borderRadius: 5,
                background: l.id === card.listId ? theme.accentSoft : 'transparent',
                color: l.id === card.listId ? theme.accent : theme.text,
                border: 'none', cursor: l.id === card.listId ? 'default' : 'pointer',
                fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                textAlign: 'start',
              }}
              onMouseEnter={(e) => { if (l.id !== card.listId) e.currentTarget.style.background = theme.surface2; }}
              onMouseLeave={(e) => { if (l.id !== card.listId) e.currentTarget.style.background = 'transparent'; }}>
              {l.title}
              {l.id === card.listId && <span style={{ marginInlineStart: 8, fontSize: 11 }}>{rtl ? '· الحالية' : '· current'}</span>}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function DueDateButton({ theme, rtl, card, onSet }) {
  const ref = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const value = card.due ? new Date(card.due).toISOString().slice(0, 10) : '';
  return (
    <>
      <SidebarBtn theme={theme} anchorRef={ref} icon="clock"
        label={rtl ? 'تاريخ الاستحقاق' : 'Due date'}
        onClick={() => setOpen((v) => !v)} />
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} theme={theme} width={260}>
        <PopoverHeader theme={theme} onClose={() => setOpen(false)}>
          {rtl ? 'تاريخ الاستحقاق' : 'Due date'}
        </PopoverHeader>
        <input type="date" defaultValue={value}
          onChange={(e) => {
            const d = e.target.value ? new Date(e.target.value + 'T00:00:00Z').toISOString() : null;
            onSet(d);
          }}
          style={{
            width: '100%', padding: '8px 12px',
            background: theme.bg, color: theme.text,
            border: `1px solid ${theme.border}`, borderRadius: 6,
            fontSize: 13, fontFamily: 'inherit', outline: 'none',
          }} />
        {card.due && (
          <button onClick={() => { onSet(null); setOpen(false); }} style={{
            marginTop: 8, padding: '6px 10px', width: '100%',
            background: 'transparent', color: '#DC2626',
            border: `.5px solid ${theme.border}`, borderRadius: 5,
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}>{rtl ? 'إزالة التاريخ' : 'Remove date'}</button>
        )}
      </Popover>
    </>
  );
}
