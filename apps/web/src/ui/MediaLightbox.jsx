import React from 'react';
import { createPortal } from 'react-dom';
import { getAccessToken } from '../lib/api.js';

// Append the user's access token to attachment URLs so <img>/<video> requests
// authenticate without an Authorization header (browsers can't set custom
// headers on media loads). Shared by the card modal and the board card gallery.
export function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

const kindOf = (m) => (m?.mimeType || m?.mime || '');

// Full-screen popup that previews images and plays videos. Accepts a list of
// media items so a gallery can page through them (← / → and on-screen arrows);
// pass a single-item list for a one-off preview. Each item: { url, filename,
// mimeType }.
export function MediaLightbox({ theme, rtl, items, index = 0, onClose }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
  const [i, setI] = React.useState(Math.min(Math.max(index, 0), Math.max(list.length - 1, 0)));
  const count = list.length;
  const a = list[i];

  const go = React.useCallback((delta) => {
    setI((cur) => (count ? (cur + delta + count) % count : 0));
  }, [count]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (count > 1 && e.key === 'ArrowRight') go(rtl ? -1 : 1);
      else if (count > 1 && e.key === 'ArrowLeft') go(rtl ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, go, count, rtl]);

  if (!a) return null;
  const mime = kindOf(a);
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const name = a.filename || a.name || '';

  const navBtn = (dir) => (
    <button
      onClick={(e) => { e.stopPropagation(); go(dir); }}
      aria-label={dir > 0 ? 'Next' : 'Previous'}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        [dir > 0 ? 'insetInlineEnd' : 'insetInlineStart']: 12,
        width: 44, height: 44, borderRadius: '50%',
        background: 'rgba(255,255,255,.12)', color: '#fff',
        border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
      }}>{(dir > 0) !== !!rtl ? '›' : '‹'}</button>
  );

  // Clicking the backdrop closes the lightbox. stopPropagation is essential:
  // this overlay is portaled to <body>, but React events still bubble up the
  // COMPONENT tree to the card that rendered it — without this, closing the
  // lightbox would also trigger the card's onClick and open the card modal.
  const close = (e) => { e.stopPropagation(); onClose(); };
  const overlay = (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, direction: rtl ? 'rtl' : 'ltr',
    }}>
      <button onClick={close} aria-label="Close" style={{
        position: 'absolute', top: 16, insetInlineEnd: 16,
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(255,255,255,.12)', color: '#fff',
        border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
      }}>×</button>

      {count > 1 && navBtn(-1)}
      {count > 1 && navBtn(1)}

      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: '90vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      }}>
        {isImage && (
          <img src={withToken(a.url)} alt={name}
            style={{ maxWidth: '90vw', maxHeight: '74vh', objectFit: 'contain', borderRadius: 6 }} />
        )}
        {isVideo && (
          // key forces a fresh element when paging so the previous video stops.
          <video key={a.url} src={withToken(a.url)} controls autoPlay playsInline
            style={{ maxWidth: '90vw', maxHeight: '74vh', borderRadius: 6, background: '#000' }} />
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
          {count > 1 && (
            <span style={{ color: 'rgba(255,255,255,.6)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}/{count}</span>
          )}
          <span style={{ fontWeight: 600 }}>{name}</span>
          <a href={withToken(a.url)} download={name}
            style={{ color: '#fff', textDecoration: 'underline', fontSize: 12 }}>
            {rtl ? 'تنزيل' : 'Download'}
          </a>
        </div>
      </div>
    </div>
  );

  // Render at document.body via a portal so the fixed overlay is positioned
  // against the VIEWPORT, not the card. A board card uses transform on hover
  // (which makes it the containing block for position:fixed) plus
  // overflow:hidden — without the portal the lightbox would be trapped and
  // clipped inside the card instead of covering the page.
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
}
