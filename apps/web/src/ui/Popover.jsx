import React from 'react';

// Anchor-relative popover. Renders children below the anchor by default.

export function Popover({ anchorRef, open, onClose, theme, width = 280, align = 'start', children }) {
  const popRef = React.useRef(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  React.useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.left;
    if (align === 'end') left = rect.right - width;
    if (align === 'center') left = rect.left + rect.width / 2 - width / 2;
    // keep within viewport
    const maxLeft = window.innerWidth - width - 12;
    left = Math.max(12, Math.min(left, maxLeft));
    setPos({ top: rect.bottom + 6, left });
  }, [open, anchorRef, width, align]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <div ref={popRef} style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 70,
      width, background: theme.surface, color: theme.text,
      borderRadius: 10, padding: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,.22)',
      border: `.5px solid ${theme.border}`,
    }}>{children}</div>
  );
}

export function PopoverHeader({ theme, children, onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      paddingBottom: 8, borderBottom: `.5px solid ${theme.border}`, marginBottom: 8,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>{children}</span>
      {onClose && (
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: theme.muted,
          fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 2,
        }}>×</button>
      )}
    </div>
  );
}
