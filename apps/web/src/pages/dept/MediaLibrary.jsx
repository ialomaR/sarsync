import React from 'react';
import { api, getAccessToken } from '../../lib/api.js';
import { Avatar } from '../../ui/Avatar.jsx';
import { Icon } from '../../ui/Icon.jsx';
import { Popover } from '../../ui/Popover.jsx';
import { formatRelative } from '../../lib/normalize.js';

const MAX_BYTES = 100 * 1024 * 1024;

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// Append the access token so <img src> can authenticate (browsers don't send
// Authorization on image element loads). Same pattern as card attachments.
function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

function fileIcon(mime) {
  if (mime?.startsWith('image/')) return '🖼';
  if (mime?.startsWith('video/')) return '🎬';
  if (mime?.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  if (mime?.includes('zip') || mime?.includes('rar')) return '🗜';
  if (mime?.includes('word') || mime?.includes('officedocument.wordprocessing')) return '📝';
  if (mime?.includes('sheet') || mime?.includes('excel')) return '📊';
  if (mime?.includes('presentation') || mime?.includes('powerpoint')) return '📽';
  return '📎';
}

export function MediaLibrary({ theme, rtl, deptId }) {
  const [items, setItems] = React.useState([]);
  const [status, setStatus] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [dragActive, setDragActive] = React.useState(false);
  const dragCounter = React.useRef(0);
  const fileInputRef = React.useRef(null);
  const [sourceFilter, setSourceFilter] = React.useState('all'); // 'all' | 'upload' | 'chat'

  const load = React.useCallback(async () => {
    try {
      const qs = sourceFilter === 'all' ? '' : `?source=${sourceFilter}`;
      const r = await api(`/departments/${deptId}/media${qs}`);
      setItems(r.items || []);
      setStatus('ready');
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, [deptId, sourceFilter]);

  React.useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      alert(rtl ? 'حجم الملف يتجاوز ١٠٠ ميجا.' : 'File exceeds 100 MB.');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Use XHR for progress tracking; fetch lacks upload progress in browsers.
      const xhr = new XMLHttpRequest();
      const url = `/api${`/departments/${deptId}/media`}`;
      const token = getAccessToken();
      const result = await new Promise((resolve, reject) => {
        xhr.open('POST', url);
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
        });
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
          else {
            try { reject(new Error(JSON.parse(xhr.responseText).message)); }
            catch { reject(new Error('Upload failed (' + xhr.status + ')')); }
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(fd);
      });
      setItems((prev) => [{ ...result, canDelete: true,
        uploadedBy: { id: 'me', name: '…', avatarColor: theme.accent } }, ...prev]);
      // Refetch shortly to hydrate the uploadedBy info accurately
      setTimeout(load, 200);
    } catch (err) {
      alert(err.message || (rtl ? 'فشل الرفع' : 'Upload failed'));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };
  const onDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragActive(true);
  };
  const onDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  };
  const onDragOver = (e) => { e.preventDefault(); };

  const renameItem = async (item) => {
    const next = window.prompt(rtl ? 'الاسم الجديد' : 'New title', item.title);
    if (!next || !next.trim() || next.trim() === item.title) return;
    try {
      await api(`/media/${item.id}`, { method: 'PATCH', body: { title: next.trim() } });
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, title: next.trim() } : x));
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(rtl ? `حذف "${item.title}"؟` : `Delete "${item.title}"?`)) return;
    try {
      await api(`/media/${item.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div onDrop={onDrop} onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver}
      style={{ position: 'relative', minHeight: 280 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: theme.text, margin: 0 }}>
            {rtl ? 'مكتبة ميديا القسم' : 'Department media library'}
          </h2>
          <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 2 }}>
            {items.length > 0
              ? (rtl ? `${items.length} ملف` : `${items.length} ${items.length === 1 ? 'file' : 'files'}`)
              : (rtl ? 'لا ملفات بعد — ارفع أول ملف للقسم.' : 'No files yet — upload the first one for this department.')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {uploading && (
            <span style={{ fontSize: 11.5, color: theme.muted }}>
              {rtl ? 'جاري الرفع' : 'Uploading'} {uploadProgress}%
            </span>
          )}
          <input ref={fileInputRef} type="file" hidden onChange={onPick} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '8px 14px', borderRadius: 6,
            background: theme.accent, color: theme.accentText,
            border: 'none', fontSize: 12.5, fontWeight: 600,
            cursor: uploading ? 'wait' : 'pointer', fontFamily: 'inherit',
            opacity: uploading ? 0.7 : 1,
          }}>
            <Icon.plus size={12} /> {rtl ? 'رفع ملف' : 'Upload file'}
          </button>
        </div>
      </div>

      {/* Source filter tabs (All / Uploaded / Chat files) */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 12,
        background: theme.surface, padding: 2, borderRadius: 7,
        border: `.5px solid ${theme.border}`, alignSelf: 'flex-start',
        width: 'fit-content',
      }}>
        {[
          { id: 'all',    label: rtl ? 'الكل' : 'All' },
          { id: 'upload', label: rtl ? 'رفع مباشر' : 'Uploaded' },
          { id: 'chat',   label: rtl ? 'ملفات المحادثات' : 'From chat' },
        ].map((t) => {
          const active = t.id === sourceFilter;
          return (
            <button key={t.id} onClick={() => setSourceFilter(t.id)} style={{
              padding: '5px 12px', borderRadius: 5,
              background: active ? theme.accentSoft : 'transparent',
              color: active ? theme.accent : theme.muted,
              border: 'none', cursor: active ? 'default' : 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            }}>{t.label}</button>
          );
        })}
      </div>

      {status === 'loading' && (
        <div style={{ padding: 30, textAlign: 'center', color: theme.muted, fontSize: 12.5 }}>
          {rtl ? 'جاري التحميل…' : 'Loading…'}
        </div>
      )}
      {status === 'error' && (
        <div style={{ padding: 16, textAlign: 'center', color: '#991B1B', fontSize: 12.5,
          background: '#FEE2E2', borderRadius: theme.cardRadius }}>
          {error?.message || 'Failed to load.'}
        </div>
      )}
      {status === 'ready' && items.length === 0 && (
        <div style={{
          padding: '60px 24px', textAlign: 'center',
          background: theme.surface, borderRadius: theme.cardRadius,
          border: `.5px dashed ${theme.border}`,
        }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 6 }}>
            {rtl ? 'لا ملفات بعد' : 'Empty library'}
          </div>
          <div style={{ fontSize: 12, color: theme.muted, maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
            {rtl ? 'اسحب الملفات إلى هنا أو اضغط "رفع ملف". الحد الأقصى ١٠٠ ميجا.' : 'Drop files here or click "Upload file". Max 100 MB.'}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}>
          {items.map((m) => (
            <MediaCard key={m.id} theme={theme} rtl={rtl} item={m}
              onRename={() => renameItem(m)} onDelete={() => deleteItem(m)} />
          ))}
        </div>
      )}

      {dragActive && (
        <div style={{
          position: 'absolute', inset: 0,
          background: theme.accentSoft + 'cc',
          border: `2px dashed ${theme.accent}`,
          borderRadius: theme.cardRadius,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: theme.accent,
          pointerEvents: 'none', zIndex: 5,
        }}>
          {rtl ? 'أفلِت لرفع الملف' : 'Drop to upload'}
        </div>
      )}
    </div>
  );
}

function MediaCard({ theme, rtl, item, onRename, onDelete }) {
  const moreRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{
      background: theme.surface, borderRadius: theme.cardRadius,
      border: `.5px solid ${theme.border}`, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <a href={withToken(item.url)} target="_blank" rel="noreferrer" style={{
        display: 'block', aspectRatio: '4/3',
        background: item.thumbUrl ? `${theme.surface2}` : theme.surface2,
        backgroundImage: item.thumbUrl ? `url(${withToken(item.thumbUrl)})` : 'none',
        backgroundSize: 'cover', backgroundPosition: 'center',
        position: 'relative', textDecoration: 'none',
      }}>
        {!item.thumbUrl && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36,
          }}>{fileIcon(item.mimeType)}</div>
        )}
      </a>
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={item.title} style={{
            fontSize: 12.5, fontWeight: 600, color: theme.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{item.title}</div>
          <div style={{ fontSize: 10.5, color: theme.muted, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Avatar id={item.uploadedBy.id} size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.uploadedBy.name}
            </span>
            <span>·</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtBytes(item.sizeBytes)}</span>
          </div>
          <div style={{ fontSize: 10, color: theme.mutedDim, marginTop: 1 }}>
            {formatRelative(item.createdAt)}
          </div>
        </div>
        <button ref={moreRef} onClick={() => setOpen((v) => !v)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: theme.muted, padding: 4, borderRadius: 4,
        }}>⋯</button>
        <Popover anchorRef={moreRef} open={open} onClose={() => setOpen(false)} theme={theme} width={170} align="end">
          <a href={withToken(item.url)} target="_blank" rel="noreferrer" style={{
            display: 'block', padding: '8px 10px',
            color: theme.text, textDecoration: 'none',
            fontSize: 12.5, borderRadius: 5,
          }} onClick={() => setOpen(false)}>
            {rtl ? 'فتح / تحميل' : 'Open / download'}
          </a>
          {item.canDelete && (
            <>
              <button onClick={() => { setOpen(false); onRename(); }} style={{
                width: '100%', padding: '8px 10px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: theme.text, fontSize: 12.5, textAlign: rtl ? 'right' : 'left',
                borderRadius: 5, fontFamily: 'inherit',
              }}>{rtl ? 'إعادة تسمية' : 'Rename'}</button>
              <button onClick={() => { setOpen(false); onDelete(); }} style={{
                width: '100%', padding: '8px 10px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#DC2626', fontSize: 12.5, textAlign: rtl ? 'right' : 'left',
                borderRadius: 5, fontFamily: 'inherit', fontWeight: 500,
              }}>{rtl ? 'حذف' : 'Delete'}</button>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
