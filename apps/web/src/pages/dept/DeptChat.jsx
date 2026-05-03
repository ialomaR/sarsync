import React from 'react';
import { api, getAccessToken } from '../../lib/api.js';
import { Avatar } from '../../ui/Avatar.jsx';
import { Icon } from '../../ui/Icon.jsx';
import { useAuth } from '../../state/AuthContext.jsx';
import { subscribeSocket, emit } from '../../lib/socket.js';
import { VoiceRecorder, VoicePlayer } from './VoiceRecorder.jsx';
import { MentionEditor } from './MentionEditor.jsx';

const GROUP_GAP_MS = 5 * 60 * 1000;
// Authors can mutate (edit/delete) their own messages within this window —
// matches AUTHOR_MUTATION_WINDOW_MS on the server. Past it, messages lock
// in as a record.
const AUTHOR_MUTATION_WINDOW_MS = 2 * 60 * 1000;

function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(iso, rtl) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return rtl ? 'اليوم' : 'Today';
  if (sameDay(d, yesterday)) return rtl ? 'أمس' : 'Yesterday';
  return d.toLocaleDateString(rtl ? 'ar' : 'en', { weekday: 'long', month: 'short', day: 'numeric' });
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function DeptChat({ theme, rtl, deptId }) {
  const auth = useAuth();
  const myId = auth.user?.id;
  const wsId = auth.activeMembership?.workspaceId;
  const [messages, setMessages] = React.useState([]);
  const [status, setStatus] = React.useState('loading');
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [composeText, setComposeText] = React.useState('');
  const [composeAttach, setComposeAttach] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [editingText, setEditingText] = React.useState('');
  const [typingUsers, setTypingUsers] = React.useState({});
  const [mentionableMembers, setMentionableMembers] = React.useState([]);

  // Load mentionable members (dept members + admins of this workspace).
  // The actor is excluded — you can't @mention yourself.
  React.useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/workspaces/${wsId}/members`);
        if (cancelled) return;
        const all = r.members || [];
        const filtered = all.filter((m) => {
          if (m.userId === myId) return false;
          if (m.role === 'admin') return true;
          return m.department && m.department.id === deptId;
        });
        setMentionableMembers(filtered);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [wsId, deptId, myId]);

  const listRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const scrollAnchorRef = React.useRef({ stickToBottom: true });

  // Mark this dept as read. Called on initial load and whenever a new
  // message arrives while the chat is on screen.
  const markRead = React.useCallback(() => {
    api(`/departments/${deptId}/chat/read`, { method: 'POST' }).catch(() => {});
  }, [deptId]);

  // Initial load + reset on dept change
  React.useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setMessages([]);
    (async () => {
      try {
        const r = await api(`/departments/${deptId}/chat/messages?limit=50`);
        if (cancelled) return;
        setMessages(r.messages || []);
        setHasMore(r.hasMore);
        setStatus('ready');
        markRead();
        // Scroll to bottom on first load
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
        });
      } catch (err) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [deptId, markRead]);

  // Join the dept room + subscribe to live events
  React.useEffect(() => {
    emit('dept:join', deptId);
    const unsub = subscribeSocket((evt) => {
      if (evt.type !== 'event') return;
      if (evt.kind === 'chat:message_added') {
        const m = evt.payload;
        if (m.departmentId !== deptId) return;
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        // Tab is open → mark as read so the badge stays at 0
        if (m.authorId !== myId) markRead();
      } else if (evt.kind === 'chat:message_edited') {
        const m = evt.payload;
        if (m.departmentId !== deptId) return;
        setMessages((prev) => prev.map((x) => x.id === m.id ? m : x));
      } else if (evt.kind === 'chat:message_deleted') {
        const { id, departmentId } = evt.payload;
        if (departmentId !== deptId) return;
        setMessages((prev) => prev.map((x) => x.id === id ? { ...x, deleted: true, body: '' } : x));
      } else if (evt.kind === 'chat:typing') {
        const { userId, name } = evt.payload;
        if (userId === myId) return;
        setTypingUsers((prev) => ({ ...prev, [userId]: { name, until: Date.now() + 4000 } }));
      }
    });
    return () => {
      emit('dept:leave', deptId);
      unsub();
    };
  }, [deptId, myId, markRead]);

  // Auto-scroll to bottom on new message if user was already at bottom
  React.useEffect(() => {
    if (status !== 'ready') return;
    if (!listRef.current) return;
    if (scrollAnchorRef.current.stickToBottom) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, status]);

  // Clean up stale typing users
  React.useEffect(() => {
    const t = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.until > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    scrollAnchorRef.current.stickToBottom = distFromBottom < 80;
  };

  const loadOlder = async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0].createdAt;
      const r = await api(`/departments/${deptId}/chat/messages?limit=50&before=${encodeURIComponent(oldest)}`);
      const el = listRef.current;
      const prevHeight = el?.scrollHeight || 0;
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = (r.messages || []).filter((m) => !known.has(m.id));
        return [...fresh, ...prev];
      });
      setHasMore(r.hasMore);
      // Preserve scroll position so the user doesn't jump
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {} finally {
      setLoadingOlder(false);
    }
  };

  const composerRef = React.useRef(null);

  const send = async () => {
    // Pull the markup directly from the editor so any inline mention chips
    // are serialised at submit time (not at every keystroke).
    const body = composerRef.current?.getBody?.() || '';
    const text = body.trim();
    if (!text && !composeAttach) return;
    if (sending) return;
    setSending(true);
    try {
      const created = await api(`/departments/${deptId}/chat/messages`, {
        method: 'POST',
        body: { body: text, attachmentId: composeAttach?.id || null },
      });
      setMessages((prev) => prev.some((x) => x.id === created.id) ? prev : [...prev, created]);
      composerRef.current?.clear?.();
      setComposeText('');
      setComposeAttach(null);
      scrollAnchorRef.current.stickToBottom = true;
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  // Generic upload helper used by both file picker and voice recorder.
  const uploadBlob = React.useCallback(async (blob, filename, durationMs = null) => {
    const token = getAccessToken();
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', blob, filename);
    return new Promise((resolve, reject) => {
      xhr.open('POST', `/api/departments/${deptId}/chat/upload`);
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      if (durationMs != null) xhr.setRequestHeader('X-Duration-Ms', String(durationMs));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else { try { reject(new Error(JSON.parse(xhr.responseText).message)); } catch { reject(new Error('Upload failed')); } }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });
  }, [deptId]);

  const onVoiceComplete = async ({ blob, durationMs, mimeType }) => {
    setRecording(false);
    setUploading(true);
    try {
      const ext = (mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      const att = await uploadBlob(blob, `voice-${Date.now()}.${ext}`, durationMs);
      const created = await api(`/departments/${deptId}/chat/messages`, {
        method: 'POST',
        body: { body: '', attachmentId: att.id },
      });
      setMessages((prev) => prev.some((x) => x.id === created.id) ? prev : [...prev, created]);
      scrollAnchorRef.current.stickToBottom = true;
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { alert(rtl ? 'الحد ١٠٠ ميجا.' : 'Max 100 MB.'); return; }
    setUploading(true);
    try {
      const att = await uploadBlob(file, file.name);
      setComposeAttach(att);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  const editEditorRef = React.useRef(null);
  const startEdit = (m) => { setEditingId(m.id); setEditingText(m.body); };
  const submitEdit = async (m) => {
    // Pull markup from the edit editor at submit time so mention chips are
    // serialised intact (initialBody hydrated chips on open; getBody walks
    // the DOM back into @[Name](id) form).
    const fromEditor = editEditorRef.current?.getBody?.();
    const text = (fromEditor ?? editingText).trim();
    if (!text || text === m.body) { setEditingId(null); return; }
    try {
      const updated = await api(`/chat/messages/${m.id}`, { method: 'PATCH', body: { body: text } });
      setMessages((prev) => prev.map((x) => x.id === updated.id ? updated : x));
      setEditingId(null);
    } catch (err) {
      if (err.code === 'edit_window_closed') {
        alert(rtl ? 'انتهت نافذة التعديل (دقيقتان).' : 'Edit window has closed (2 minutes).');
        setEditingId(null);
      } else {
        alert(err.message);
      }
    }
  };
  const deleteMsg2 = async (m) => {
    // Renamed below — kept here for grep reference. Actual delete is in deleteMsg.
    void m;
  };
  void deleteMsg2;
  const deleteMsg = async (m) => {
    if (!window.confirm(rtl ? 'حذف الرسالة؟' : 'Delete this message?')) return;
    try {
      await api(`/chat/messages/${m.id}`, { method: 'DELETE' });
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, deleted: true, body: '' } : x));
    } catch (err) {
      if (err.code === 'delete_window_closed') {
        alert(rtl
          ? 'انتهت نافذة الحذف (دقيقتان). الرسائل القديمة مثبّتة كسجل.'
          : 'Delete window has closed (2 minutes). Older messages are locked as a record.');
      } else {
        alert(err.message);
      }
    }
  };

  // Throttled typing emit. The MentionEditor calls this with the current
  // markup body on every input — we just track non-empty for the send/mic
  // toggle and ping the typing endpoint occasionally.
  const lastTypingEmit = React.useRef(0);
  const onComposeChange = (v) => {
    setComposeText(v);
    if (!v) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 2500) {
      lastTypingEmit.current = now;
      api(`/departments/${deptId}/chat/typing`, { method: 'POST' }).catch(() => {});
    }
  };

  // Group messages: same author within GROUP_GAP_MS, AND on same calendar day.
  const groups = [];
  let lastDayKey = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const dayKey = new Date(m.createdAt).toDateString();
    if (dayKey !== lastDayKey) {
      groups.push({ kind: 'day', day: m.createdAt });
      lastDayKey = dayKey;
    }
    const prev = groups.length ? groups[groups.length - 1] : null;
    const canExtend = prev && prev.kind === 'msgs'
      && prev.authorId === m.authorId
      && (new Date(m.createdAt) - new Date(prev.lastAt)) < GROUP_GAP_MS;
    if (canExtend) {
      prev.items.push(m);
      prev.lastAt = m.createdAt;
    } else {
      groups.push({ kind: 'msgs', authorId: m.authorId, lastAt: m.createdAt, items: [m] });
    }
  }

  const typingNames = Object.values(typingUsers).map((u) => u.name).filter(Boolean);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '70vh', minHeight: 480,
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`, overflow: 'hidden',
    }}>
      <div ref={listRef} onScroll={onScroll} style={{
        flex: 1, overflowY: 'auto', padding: '10px 14px 4px',
        display: 'flex', flexDirection: 'column',
      }}>
        {hasMore && (
          <div style={{ textAlign: 'center', padding: '4px 0 10px' }}>
            <button onClick={loadOlder} disabled={loadingOlder} style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 11.5,
              background: theme.bg, color: theme.muted,
              border: `.5px solid ${theme.border}`, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {loadingOlder ? (rtl ? 'جاري…' : 'Loading…') : (rtl ? 'تحميل الأقدم' : 'Load older')}
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.muted, fontSize: 12.5 }}>
            {rtl ? 'جاري التحميل…' : 'Loading…'}
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: 14, fontSize: 12.5, color: '#991B1B' }}>
            {rtl ? 'تعذّر تحميل الرسائل.' : 'Could not load messages.'}
          </div>
        )}
        {status === 'ready' && messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', color: theme.muted }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
              {rtl ? 'لا رسائل بعد' : 'No messages yet'}
            </div>
            <div style={{ fontSize: 12 }}>
              {rtl ? 'كن أول من يبدأ الحوار في القسم.' : 'Be the first to start the conversation.'}
            </div>
          </div>
        )}

        {groups.map((g, i) => {
          if (g.kind === 'day') {
            return (
              <div key={'d' + i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                margin: '14px 0 8px',
              }}>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
                <div style={{
                  fontSize: 10.5, fontWeight: 600, color: theme.muted,
                  padding: '3px 10px', borderRadius: 999,
                  background: theme.bg, border: `.5px solid ${theme.border}`,
                }}>
                  {fmtDay(g.day, rtl)}
                </div>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>
            );
          }
          const head = g.items[0];
          const author = head.author;
          const isMine = head.authorId === myId;
          // WhatsApp-style row: mine on the end-side, theirs on the start-side.
          // For "others" groups we render a small avatar at the start, the
          // author name above the FIRST bubble, then the bubbles stacked.
          return (
            <div key={head.id} style={{
              display: 'flex', gap: 8, padding: '3px 0',
              flexDirection: isMine ? 'row-reverse' : 'row',
            }}>
              {!isMine && (
                <div style={{ width: 28, flexShrink: 0, paddingTop: 2 }}>
                  <Avatar id={author.id} size={28} />
                </div>
              )}
              <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
                maxWidth: 'min(72%, 520px)', minWidth: 0,
              }}>
                {!isMine && (
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, color: theme.text,
                    marginInlineStart: 4, marginBottom: 2,
                  }}>{author.name}</span>
                )}
                {g.items.map((m, idx) => (
                  <Bubble key={m.id} theme={theme} rtl={rtl} msg={m} myId={myId}
                    mentionableMembers={mentionableMembers}
                    isMine={isMine}
                    isFirstInGroup={idx === 0}
                    isLastInGroup={idx === g.items.length - 1}
                    editing={editingId === m.id}
                    editEditorRef={editingId === m.id ? editEditorRef : undefined}
                    onChangeEdit={setEditingText}
                    onCancelEdit={() => setEditingId(null)}
                    onSubmitEdit={() => submitEdit(m)}
                    onStartEdit={() => startEdit(m)}
                    onDelete={() => deleteMsg(m)} />
                ))}
              </div>
            </div>
          );
        })}

        {typingNames.length > 0 && (
          <div style={{ fontSize: 11, color: theme.muted, padding: '6px 4px 2px', fontStyle: 'italic' }}>
            {typingNames.length === 1
              ? (rtl ? `${typingNames[0]} يكتب…` : `${typingNames[0]} is typing…`)
              : (rtl ? `${typingNames.length} أعضاء يكتبون…` : `${typingNames.length} people are typing…`)}
          </div>
        )}
      </div>

      {recording ? (
        <div style={{ borderTop: `.5px solid ${theme.border}`, padding: '10px 12px', background: theme.surface }}>
          <VoiceRecorder theme={theme} rtl={rtl}
            onComplete={onVoiceComplete}
            onCancel={() => setRecording(false)} />
        </div>
      ) : (
        <Composer theme={theme} rtl={rtl}
          composerRef={composerRef}
          text={composeText} onChange={onComposeChange}
          attach={composeAttach} onClearAttach={() => setComposeAttach(null)}
          uploading={uploading} sending={sending}
          onAttachClick={() => fileInputRef.current?.click()}
          onSend={send}
          onStartRecording={() => setRecording(true)}
          mentionableMembers={mentionableMembers}
          fileInputRef={fileInputRef} onPickFile={onPickFile} />
      )}
    </div>
  );
}

function Bubble({ theme, rtl, msg, myId, mentionableMembers, isMine, isFirstInGroup, isLastInGroup, editing, editEditorRef, onChangeEdit, onCancelEdit, onSubmitEdit, onStartEdit, onDelete }) {
  // 2-minute window applies to BOTH edit and self-delete; afterwards the
  // message locks as a record. Managers retain delete rights server-side.
  const inWindow = isMine && !msg.deleted
    && (Date.now() - new Date(msg.createdAt).getTime()) < AUTHOR_MUTATION_WINDOW_MS;
  // Edit only applies to text. Voice / image-only / file-only messages
  // have no body to edit — show delete only.
  const canEdit = inWindow && !!msg.body;
  const canDelete = inWindow;
  const [hover, setHover] = React.useState(false);

  // Bubble palette: accent for mine, neutral surface for theirs.
  const bg = isMine ? theme.accent : theme.surface2;
  const fg = isMine ? theme.accentText : theme.text;
  const subtleFg = isMine
    ? `${theme.accentText}b8`  // accent text at ~70% alpha
    : theme.muted;

  // "Tail" effect: only the first bubble in a group has a tightened corner
  // toward the speaker's side. Subsequent bubbles in the group all use the
  // full radius — matches WhatsApp/iMessage spacing.
  const FULL = 16, TAIL = 4;
  const radius = {
    borderTopLeftRadius: !isMine && isFirstInGroup ? TAIL : FULL,
    borderTopRightRadius: isMine && isFirstInGroup ? TAIL : FULL,
    borderBottomLeftRadius: FULL,
    borderBottomRightRadius: FULL,
  };

  // Tighten image bubbles — the picture fills edge-to-edge inside the radius.
  const imageOnly = msg.attachment?.isImage && !msg.body && !msg.deleted && !editing;
  // Voice player has its own pill — don't double-wrap it in an accent bg.
  const voiceOnly = msg.attachment?.durationMs && !msg.body && !msg.deleted && !editing;

  // Wrapper: spacing between consecutive bubbles in a group is tight (3px),
  // a bit looser between groups (handled by group margin upstream).
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', marginBottom: isLastInGroup ? 0 : 2 }}>

      {voiceOnly ? (
        // Render the voice player as the bubble itself; preserve hover toolbar.
        <div>
          <AttachmentBubble theme={theme} rtl={rtl} att={msg.attachment} />
          <div style={{
            fontSize: 10, color: theme.muted, marginTop: 2,
            textAlign: isMine ? 'end' : 'start',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {msg.editedAt && (rtl ? 'معدّلة · ' : 'edited · ')}{fmtTime(msg.createdAt)}
          </div>
        </div>
      ) : (
        <div style={{
          ...radius,
          background: msg.deleted ? theme.bg : bg,
          color: fg,
          padding: imageOnly ? 3 : (msg.deleted ? '6px 11px' : '6px 11px'),
          boxShadow: '0 1px 1px rgba(0,0,0,.04)',
          border: msg.deleted ? `.5px dashed ${theme.border}` : 'none',
          maxWidth: '100%', minWidth: 60,
          display: 'inline-block',
        }}>
          {msg.deleted ? (
            <span style={{ fontSize: 12.5, color: theme.mutedDim, fontStyle: 'italic' }}>
              {rtl ? '— رسالة محذوفة —' : '— message deleted —'}
            </span>
          ) : editing ? (
            <div style={{
              minWidth: 240, color: theme.text,
              background: theme.surface, padding: '4px 8px',
              borderRadius: 8, margin: -2,
            }}>
              <MentionEditor
                ref={editEditorRef}
                theme={theme} rtl={rtl}
                autoFocus
                initialBody={msg.body}
                placeholder=""
                mentionableMembers={mentionableMembers}
                onChangeText={onChangeEdit}
                onSubmit={onSubmitEdit} />
              <div style={{ marginTop: 4, display: 'flex', gap: 6, fontSize: 11, justifyContent: 'flex-end' }}>
                <button onClick={onCancelEdit} style={{
                  padding: '4px 12px', borderRadius: 4,
                  background: 'transparent', color: theme.muted,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
                <button onClick={onSubmitEdit} style={{
                  padding: '4px 12px', borderRadius: 4,
                  background: theme.accent, color: theme.accentText,
                  border: 'none', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>{rtl ? 'حفظ' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <>
              {msg.body && (
                <div style={{
                  fontSize: 13.5, color: fg, lineHeight: 1.45,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {renderMessageBody(msg.body, theme, myId, isMine)}
                </div>
              )}
              {msg.attachment && msg.attachment.isImage && (
                <a href={withToken(msg.attachment.url)} target="_blank" rel="noreferrer" style={{
                  display: 'block', overflow: 'hidden',
                  borderRadius: 12, marginTop: msg.body ? 6 : 0,
                }}>
                  <img src={withToken(msg.attachment.thumbUrl || msg.attachment.url)}
                    alt={msg.attachment.filename}
                    style={{ display: 'block', maxWidth: 280, maxHeight: 280, width: 'auto', height: 'auto' }} />
                </a>
              )}
              {msg.attachment && !msg.attachment.isImage && !msg.attachment.durationMs && (
                <FileChip theme={theme} rtl={rtl} isMine={isMine} att={msg.attachment} />
              )}
              <div style={{
                fontSize: 10, color: subtleFg,
                textAlign: rtl ? 'start' : 'end',
                marginTop: 2, fontVariantNumeric: 'tabular-nums',
              }}>
                {msg.editedAt && (rtl ? 'معدّلة · ' : 'edited · ')}
                {fmtTime(msg.createdAt)}
              </div>
            </>
          )}
        </div>
      )}

      {(canEdit || canDelete) && hover && !editing && !msg.deleted && (
        <div style={{
          position: 'absolute', top: -12,
          insetInlineEnd: isMine ? 4 : 'auto',
          insetInlineStart: isMine ? 'auto' : 4,
          display: 'flex', gap: 2,
          background: theme.surface, borderRadius: 5,
          border: `.5px solid ${theme.border}`, padding: 2,
          boxShadow: theme.shadow,
        }}>
          {canEdit && (
            <button onClick={onStartEdit} title={rtl ? 'تعديل' : 'Edit'} style={iconBtnStyle(theme)}>
              <Icon.pencil size={12} />
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} title={rtl ? 'حذف' : 'Delete'} style={{ ...iconBtnStyle(theme), color: '#DC2626' }}>
              <Icon.trash size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FileChip({ theme, rtl, isMine, att }) {
  const fg = isMine ? theme.accentText : theme.text;
  const tint = isMine ? `${theme.accentText}33` : theme.surface;
  return (
    <a href={withToken(att.url)} target="_blank" rel="noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      marginTop: 4, padding: '8px 10px',
      background: tint, borderRadius: 8,
      textDecoration: 'none', color: fg, maxWidth: 260,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: isMine ? `${theme.accentText}55` : theme.surface2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>📎</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {att.filename}
        </div>
        <div style={{ fontSize: 10.5, opacity: .7 }}>{fmtBytes(att.sizeBytes)}</div>
      </div>
    </a>
  );
}

function iconBtnStyle(theme) {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: theme.muted, padding: '3px 6px', borderRadius: 4,
    fontSize: 12, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}

function composerIconBtn(theme, disabled) {
  return {
    background: 'transparent', border: 'none',
    cursor: disabled ? 'wait' : 'pointer',
    color: theme.muted, padding: 8, borderRadius: '50%',
    fontFamily: 'inherit', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 36, height: 36,
  };
}

// WhatsApp-style send/mic toggle: paper-plane when there's content to send,
// mic when the input is empty (tap = jump straight into voice recording).
function SendOrMicButton({ theme, rtl, hasContent, sending, onSend, onStartRecording }) {
  const isSend = hasContent;
  const onClick = isSend ? onSend : onStartRecording;
  return (
    <button onClick={onClick} disabled={sending}
      title={isSend ? (rtl ? 'إرسال' : 'Send') : (rtl ? 'تسجيل صوتي' : 'Record voice')}
      style={{
        width: 36, height: 36, borderRadius: '50%',
        background: theme.accent, color: theme.accentText,
        border: 'none', cursor: sending ? 'wait' : 'pointer',
        fontFamily: 'inherit', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 2px rgba(0,0,0,.12)',
        transition: 'background .12s, transform .08s',
      }}>
      {isSend
        ? <Icon.send size={18} />
        : <Icon.mic size={18} />}
    </button>
  );
}

// Parses @[Name](id) markup into renderable nodes. Plain text passes through.
// `isMine` flips the chip palette so it stays legible on top of the accent
// bubble color used for the author's own messages.
const MENTION_RE = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;
function renderMessageBody(body, theme, myId, isMine = false) {
  const nodes = [];
  let lastIndex = 0;
  let m;
  MENTION_RE.lastIndex = 0;
  let key = 0;
  while ((m = MENTION_RE.exec(body)) !== null) {
    if (m.index > lastIndex) nodes.push(body.slice(lastIndex, m.index));
    const mentionedSelf = m[2] === myId;
    let bg, fg;
    if (mentionedSelf) {
      // Always pop — same warm chip color regardless of bubble side
      bg = '#FEF3C7'; fg = '#92400E';
    } else if (isMine) {
      // Translucent overlay on the accent bubble
      bg = `${theme.accentText}33`; fg = theme.accentText;
    } else {
      bg = theme.accentSoft; fg = theme.accent;
    }
    nodes.push(
      <span key={'m' + (key++)} style={{
        display: 'inline-block',
        padding: '0 6px', borderRadius: 4,
        background: bg, color: fg, fontWeight: 600,
      }}>@{m[1]}</span>
    );
    lastIndex = MENTION_RE.lastIndex;
  }
  if (lastIndex < body.length) nodes.push(body.slice(lastIndex));
  return nodes.length === 0 ? body : nodes;
}

// Voice messages render as a standalone pill (the bubble itself); image and
// file attachments are now rendered inside Bubble to inherit its bg/colors.
function AttachmentBubble({ theme, rtl, att }) {
  if (att.durationMs) {
    return <VoicePlayer theme={theme} rtl={rtl} src={withToken(att.url)} durationMs={att.durationMs} />;
  }
  return null;
}

function Composer({ theme, rtl, composerRef, text, onChange, attach, onClearAttach, uploading, sending, onAttachClick, onSend, onStartRecording, mentionableMembers, fileInputRef, onPickFile }) {
  const [dragActive, setDragActive] = React.useState(false);
  const dragCounter = React.useRef(0);
  const onDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && fileInputRef.current) {
      // Synthesize a change event so we can reuse onPickFile
      const dt = new DataTransfer();
      dt.items.add(f);
      fileInputRef.current.files = dt.files;
      const evt = new Event('change', { bubbles: true });
      fileInputRef.current.dispatchEvent(evt);
    }
  };
  const onDragEnter = (e) => { e.preventDefault(); dragCounter.current++; if (dragCounter.current === 1) setDragActive(true); };
  const onDragLeave = () => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragActive(false); } };
  const onDragOver = (e) => { e.preventDefault(); };

  return (
    <div onDrop={onDrop} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver}
      style={{
        position: 'relative',
        borderTop: `.5px solid ${theme.border}`,
        padding: '10px 12px',
        background: theme.surface,
      }}>
      {attach && (
        <div style={{
          marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 8px', background: theme.bg,
          border: `.5px solid ${theme.border}`, borderRadius: 6,
        }}>
          {attach.isImage && attach.thumbUrl ? (
            <img src={withToken(attach.thumbUrl)} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: 4, background: theme.surface2,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📎</div>
          )}
          <div style={{ fontSize: 12, color: theme.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {attach.filename}
          </div>
          <button onClick={onClearAttach} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: theme.muted, fontSize: 14, padding: '2px 6px',
          }}>×</button>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 6,
        background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 22,
        padding: '4px 6px', position: 'relative',
      }}>
        <input ref={fileInputRef} type="file" hidden onChange={onPickFile} />
        <button onClick={onAttachClick} disabled={uploading}
          title={rtl ? 'إرفاق ملف' : 'Attach'}
          style={composerIconBtn(theme, uploading)}>
          <Icon.paperclip size={18} />
        </button>
        <MentionEditor
          ref={composerRef}
          theme={theme} rtl={rtl}
          autoFocus
          placeholder={rtl ? 'اكتب رسالة…' : 'Type a message'}
          onChangeText={onChange}
          onSubmit={onSend}
          mentionableMembers={mentionableMembers} />
        <SendOrMicButton theme={theme} rtl={rtl}
          hasContent={!!(text && text.trim()) || !!attach}
          sending={sending}
          onSend={onSend}
          onStartRecording={onStartRecording} />
      </div>
      {uploading && (
        <div style={{ fontSize: 11, color: theme.muted, marginTop: 6 }}>
          {rtl ? 'جاري رفع الملف…' : 'Uploading attachment…'}
        </div>
      )}

      {dragActive && (
        <div style={{
          position: 'absolute', inset: 0,
          background: theme.accentSoft + 'cc',
          border: `2px dashed ${theme.accent}`,
          borderRadius: theme.cardRadius,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: theme.accent,
          pointerEvents: 'none', zIndex: 5,
        }}>
          {rtl ? 'أفلِت لإرفاق' : 'Drop to attach'}
        </div>
      )}
    </div>
  );
}
