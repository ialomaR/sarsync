import React from 'react';
import { MEMBERS } from '../data/board-data.js';
import { ORG_MEMBERS } from '../data/org-data.js';
import { useBoardData } from '../state/BoardDataContext.jsx';

function findMember(id, ctx) {
  return ctx?.peopleById?.[id]
    || MEMBERS.find((x) => x.id === id)
    || ORG_MEMBERS.find((x) => x.id === id);
}

export function Avatar({ id, size = 22, ring }) {
  const ctx = useBoardData();
  const m = findMember(id, ctx);
  if (!m) return null;
  return (
    <div title={m.name} style={{
      width: size, height: size, borderRadius: '50%',
      background: m.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 600, letterSpacing: '.02em',
      boxShadow: ring ? `0 0 0 2px ${ring}` : 'none',
      flexShrink: 0,
    }}>{m.initials}</div>
  );
}

export function AvatarStack({ ids, size = 22, max = 4, ringColor = '#fff' }) {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <div style={{ display: 'flex' }}>
      {shown.map((id, i) => (
        <div key={id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar id={id} size={size} ring={ringColor} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          marginLeft: -6, width: size, height: size, borderRadius: '50%',
          background: 'rgba(0,0,0,.08)', color: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.4, fontWeight: 600, boxShadow: `0 0 0 2px ${ringColor}`,
        }}>+{extra}</div>
      )}
    </div>
  );
}
