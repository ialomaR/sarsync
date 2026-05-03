import React from 'react';
import { LABELS } from '../data/board-data.js';
import { useBoardData } from '../state/BoardDataContext.jsx';
import { getAccessToken } from '../lib/api.js';

// Append the user's access token to attachment URLs so <img>/CSS background
// requests can authenticate (browsers won't send Authorization headers).
function withToken(url) {
  if (!url) return url;
  const t = getAccessToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

function findLabel(id, ctx) {
  return ctx?.labelsById?.[id] || LABELS[id];
}

export function LabelChip({ id, theme, size = 'sm' }) {
  const ctx = useBoardData();
  const lbl = findLabel(id, ctx);
  if (!lbl) return null;
  const small = size === 'sm';
  return (
    <span style={{
      background: theme.name === 'dark' ? lbl.color + '33' : lbl.bg,
      color: lbl.color,
      padding: small ? '2px 8px' : '4px 10px',
      borderRadius: 999,
      fontSize: small ? 10.5 : 11.5,
      fontWeight: 600,
      letterSpacing: '.02em',
      lineHeight: 1.3,
      whiteSpace: 'nowrap',
    }}>{lbl.name}</span>
  );
}

export function LabelStripe({ id }) {
  const ctx = useBoardData();
  const lbl = findLabel(id, ctx);
  if (!lbl) return null;
  return (
    <span style={{
      display: 'inline-block', height: 6, width: 32,
      borderRadius: 3, background: lbl.color,
    }} />
  );
}

// Renders a card cover. If `url` is set, shows the real uploaded image.
// Otherwise falls back to the legacy striped placeholder.
export function CoverPlaceholder({ url, hue = 220, label = 'cover', height = 100 }) {
  if (url) {
    return (
      <div style={{
        height, width: '100%',
        background: `#0001 url(${withToken(url)}) center/cover no-repeat`,
      }} />
    );
  }
  const bg = `oklch(0.85 0.08 ${hue})`;
  const stripe = `oklch(0.78 0.10 ${hue})`;
  return (
    <div style={{
      height, width: '100%',
      background: `repeating-linear-gradient(135deg, ${bg} 0 14px, ${stripe} 14px 28px)`,
      display: 'flex', alignItems: 'flex-end', padding: 8, color: 'rgba(0,0,0,.5)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10,
      letterSpacing: '.05em',
    }}>{label}</div>
  );
}
