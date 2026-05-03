import React from 'react';

// Contenteditable input that renders @mentions as chips while the user types.
// The composer (and edit box) feed body in/out as `@[Name](userId)` markup;
// inside, mentions are real DOM spans so the markup is invisible to the user.
//
// Imperative API (via ref):
//   editorRef.current.getBody()  — current markup string
//   editorRef.current.clear()    — empty the editor
//   editorRef.current.focus()
//
// Why imperative? React-controlled contenteditable is a maintenance pit; we
// keep React out of the editor DOM and just read it on demand.

const MENTION_RE = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;

export const MentionEditor = React.forwardRef(function MentionEditor({
  rtl, theme, placeholder, autoFocus,
  initialBody,
  onSubmit,
  onChangeText,
  mentionableMembers,
}, fwd) {
  const ref = React.useRef(null);
  const [mention, setMention] = React.useState(null); // { query, anchorNode, atOffset, highlight }

  // ── Editor DOM helpers ─────────────────────────────────────────────────

  const buildBody = React.useCallback(() => {
    const root = ref.current;
    if (!root) return '';
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent.replace(/ /g, ' ');
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList?.contains('mention-chip') && node.dataset?.uid) {
          const text = (node.textContent || '').replace(/^@/, '');
          out += `@[${text}](${node.dataset.uid})`;
        } else if (node.tagName === 'BR') {
          out += '\n';
        } else if (node.tagName === 'DIV' || node.tagName === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          for (const c of node.childNodes) walk(c);
        } else {
          for (const c of node.childNodes) walk(c);
        }
      }
    };
    for (const c of root.childNodes) walk(c);
    return out;
  }, []);

  const makeChipSpan = React.useCallback((name, uid) => {
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.className = 'mention-chip';
    span.dataset.uid = uid;
    span.textContent = `@${name}`;
    span.style.background = theme.accentSoft;
    span.style.color = theme.accent;
    return span;
  }, [theme.accentSoft, theme.accent]);

  // Initial DOM build from markup
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (root.dataset.hydrated === '1') return; // only on mount per editor instance
    root.dataset.hydrated = '1';
    if (initialBody) {
      let lastIndex = 0;
      let m;
      MENTION_RE.lastIndex = 0;
      while ((m = MENTION_RE.exec(initialBody)) !== null) {
        if (m.index > lastIndex) root.appendChild(document.createTextNode(initialBody.slice(lastIndex, m.index)));
        root.appendChild(makeChipSpan(m[1], m[2]));
        lastIndex = MENTION_RE.lastIndex;
      }
      if (lastIndex < initialBody.length) root.appendChild(document.createTextNode(initialBody.slice(lastIndex)));
    }
    if (autoFocus) {
      // Move caret to end
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      root.focus();
    }
  }, [initialBody, autoFocus, makeChipSpan]);

  // ── Imperative ref ────────────────────────────────────────────────────

  React.useImperativeHandle(fwd, () => ({
    getBody: () => buildBody(),
    clear: () => {
      if (ref.current) {
        ref.current.innerHTML = '';
        onChangeText?.('');
      }
    },
    focus: () => ref.current?.focus(),
  }), [buildBody, onChangeText]);

  // ── @ detection ──────────────────────────────────────────────────────

  const closeMention = React.useCallback(() => setMention(null), []);

  const checkForMention = React.useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return closeMention();
    const node = sel.anchorNode;
    if (!node || !ref.current?.contains(node)) return closeMention();
    if (node.nodeType !== Node.TEXT_NODE) return closeMention();
    const offset = sel.anchorOffset;
    const before = node.textContent.slice(0, offset);
    const m = before.match(/(?:^|\s| )@([\w\-.]{0,30})$/u);
    if (!m) return closeMention();
    const atOffset = offset - m[1].length - 1;
    setMention((prev) => ({
      query: m[1].toLowerCase(),
      anchorNode: node,
      atOffset,
      highlight: prev ? prev.highlight : 0,
    }));
  }, [closeMention]);

  const filtered = React.useMemo(() => {
    if (!mention) return [];
    const q = mention.query;
    if (!q) return mentionableMembers.slice(0, 8);
    return mentionableMembers
      .filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mention, mentionableMembers]);

  // Reset highlight when filtered list shrinks below it
  React.useEffect(() => {
    if (mention && mention.highlight >= filtered.length && filtered.length > 0) {
      setMention((m) => ({ ...m, highlight: 0 }));
    }
  }, [mention, filtered.length]);

  const insertMention = React.useCallback((member) => {
    const root = ref.current;
    if (!root || !mention) return;
    const { anchorNode, atOffset, query } = mention;
    if (!root.contains(anchorNode) || anchorNode.nodeType !== Node.TEXT_NODE) return closeMention();

    const parent = anchorNode.parentNode;
    const before = anchorNode.textContent.slice(0, atOffset);
    const after = anchorNode.textContent.slice(atOffset + 1 + query.length);

    const beforeNode = document.createTextNode(before);
    const chip = makeChipSpan(member.name, member.userId);
    // Trailing nbsp keeps the caret outside the chip and gives a natural space
    const afterNode = document.createTextNode(' ' + after);

    parent.insertBefore(beforeNode, anchorNode);
    parent.insertBefore(chip, anchorNode);
    parent.replaceChild(afterNode, anchorNode);

    // Caret right after the nbsp so the next char goes naturally after the chip
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(afterNode, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    setMention(null);
    onChangeText?.(buildBody());
  }, [mention, makeChipSpan, buildBody, onChangeText, closeMention]);

  // ── Events ───────────────────────────────────────────────────────────

  const onInput = () => {
    onChangeText?.(buildBody());
    checkForMention();
  };

  const onKeyDown = (e) => {
    if (mention && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, highlight: (m.highlight + 1) % filtered.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMention((m) => ({ ...m, highlight: (m.highlight + filtered.length - 1) % filtered.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[mention.highlight]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !mention) {
      e.preventDefault();
      onSubmit?.();
      return;
    }
  };

  // Strip non-mention HTML when pasting — paste-as-plain-text
  const onPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div ref={ref}
        className="mention-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        data-placeholder={placeholder || ''}
        style={{
          minHeight: 22, maxHeight: 180, overflowY: 'auto',
          padding: '6px 4px', fontSize: 13.5, color: theme.text,
          outline: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'inherit', lineHeight: 1.5,
          direction: rtl ? 'rtl' : 'ltr',
        }} />
      {mention && filtered.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', insetInlineStart: 0,
          right: 0,
          background: theme.surface, border: `.5px solid ${theme.border}`,
          borderRadius: 8, boxShadow: theme.shadow,
          padding: 4, maxHeight: 240, overflowY: 'auto', zIndex: 30,
        }}>
          <div style={{ padding: '4px 8px 6px', fontSize: 10.5, color: theme.muted, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            {rtl ? 'ذكر شخص' : 'Mention someone'}
          </div>
          {filtered.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              onMouseEnter={() => setMention((mm) => mm && ({ ...mm, highlight: i }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 5,
                background: i === mention.highlight ? theme.accentSoft : 'transparent',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                textAlign: rtl ? 'right' : 'left',
              }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: m.avatarColor, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700,
              }}>{m.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </div>
                <div style={{ fontSize: 10.5, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.email}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
