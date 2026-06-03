import React from 'react';

// Manage a board's custom fields (table-view columns): add, rename, set select
// options, delete. Mutations are passed in (wired to useBoardApi); this is pure
// UI. Mirrors the styling of the other board modals.

const TYPE_LABELS = {
  text:   { en: 'Text',   ar: 'نص' },
  number: { en: 'Number', ar: 'رقم' },
  date:   { en: 'Date',   ar: 'تاريخ' },
  select: { en: 'Select', ar: 'قائمة' },
  person: { en: 'Person', ar: 'شخص' },
};
const TYPES = ['text', 'number', 'date', 'select', 'person'];

function makeOptionId(label, i) {
  const rand = (globalThis.crypto?.randomUUID?.() || `${i}-${label}`).slice(0, 8);
  return `opt-${i}-${rand}`;
}

// Build an options array from one-label-per-line text, preserving existing
// option ids (matched by label) so a card's stored value isn't orphaned.
function optionsFromText(text, existing) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((label, i) => {
    const prev = (existing || []).find((o) => o.label === label);
    return { id: prev?.id || makeOptionId(label, i), label, color: prev?.color ?? null };
  });
}
const optionsToText = (opts) => (opts || []).map((o) => o.label).join('\n');

export function FieldsManagerModal({ theme, rtl, fields, onCreate, onUpdate, onDelete, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('text');
  const [optionsText, setOptionsText] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const t = (o) => (rtl ? o.ar : o.en);

  const add = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const input = { name: name.trim(), type };
      if (type === 'select') input.options = optionsFromText(optionsText, []);
      await onCreate(input);
      setName(''); setType('text'); setOptionsText('');
    } catch (err) {
      setError(err.message || 'Failed to add field');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '9px 11px', borderRadius: 6,
    background: theme.bg, color: theme.text,
    border: `1px solid ${theme.border}`,
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(10,12,18,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 480, maxWidth: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.4)',
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `.5px solid ${theme.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{rtl ? 'إدارة الحقول' : 'Manage fields'}</h3>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none', color: theme.muted,
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
          {/* Existing fields */}
          {fields.length === 0 ? (
            <div style={{ fontSize: 12.5, color: theme.muted, marginBottom: 16 }}>
              {rtl ? 'لا توجد حقول بعد. أضف أول عمود أدناه.' : 'No fields yet. Add your first column below.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {fields.map((f) => (
                <FieldManagerRow key={f.id} theme={theme} rtl={rtl} field={f}
                  typeLabel={t(TYPE_LABELS[f.type] || { en: f.type, ar: f.type })}
                  onUpdate={onUpdate} onDelete={onDelete} />
              ))}
            </div>
          )}

          {/* Add new */}
          <form onSubmit={add} style={{
            borderTop: `.5px solid ${theme.border}`, paddingTop: 16,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: theme.mutedDim, textTransform: 'uppercase' }}>
              {rtl ? 'حقل جديد' : 'New field'}
            </div>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={rtl ? 'اسم العمود (مثل: الحالة)' : 'Column name (e.g. Status)'}
              style={inputStyle} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{t(TYPE_LABELS[ty])}</option>)}
            </select>
            {type === 'select' && (
              <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)}
                placeholder={rtl ? 'خيار في كل سطر' : 'One option per line'}
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }} />
            )}
            {error && <div style={{ fontSize: 12, color: '#DC2626' }}>{error}</div>}
            <button type="submit" disabled={saving || !name.trim()} style={{
              alignSelf: 'flex-start',
              padding: '8px 16px', borderRadius: 6,
              background: theme.accent, color: theme.accentText, border: 'none',
              fontSize: 12.5, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer', opacity: (saving || !name.trim()) ? 0.6 : 1,
              fontFamily: 'inherit',
            }}>{saving ? '…' : (rtl ? 'إضافة الحقل' : 'Add field')}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function FieldManagerRow({ theme, rtl, field, typeLabel, onUpdate, onDelete }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(field.name);
  const [optionsText, setOptionsText] = React.useState(optionsToText(field.options));
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { setName(field.name); setOptionsText(optionsToText(field.options)); }, [field]);

  const save = async () => {
    const patch = {};
    if (name.trim() && name.trim() !== field.name) patch.name = name.trim();
    if (field.type === 'select') patch.options = optionsFromText(optionsText, field.options);
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    setBusy(true);
    try { await onUpdate(field.id, patch); setEditing(false); }
    catch (err) { alert(err.message || 'Failed to update field'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(rtl
      ? `حذف العمود «${field.name}»؟ ستُحذف كل قيمه من البطاقات.`
      : `Delete column "${field.name}"? All its values on cards will be removed.`)) return;
    setBusy(true);
    try { await onDelete(field.id); }
    catch (err) { alert(err.message || 'Failed to delete field'); setBusy(false); }
  };

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`,
    fontSize: 13, fontFamily: 'inherit', outline: 'none',
  };

  if (editing) {
    return (
      <div style={{ border: `.5px solid ${theme.border}`, borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        {field.type === 'select' && (
          <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)}
            placeholder={rtl ? 'خيار في كل سطر' : 'One option per line'}
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }} />
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={save} disabled={busy} style={{
            padding: '6px 12px', borderRadius: 5, background: theme.accent, color: theme.accentText,
            border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>{busy ? '…' : (rtl ? 'حفظ' : 'Save')}</button>
          <button onClick={() => { setName(field.name); setOptionsText(optionsToText(field.options)); setEditing(false); }} style={{
            padding: '6px 10px', borderRadius: 5, background: 'transparent', color: theme.muted,
            border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>{rtl ? 'إلغاء' : 'Cancel'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      border: `.5px solid ${theme.border}`, borderRadius: 8, padding: '8px 10px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field.name}</div>
        <div style={{ fontSize: 10.5, color: theme.muted, marginTop: 1 }}>
          {typeLabel}{field.type === 'select' ? ` · ${(field.options || []).length}` : ''}
        </div>
      </div>
      <button onClick={() => setEditing(true)} disabled={busy} style={{
        padding: '5px 10px', borderRadius: 5, background: theme.surface2, color: theme.text,
        border: `.5px solid ${theme.border}`, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>{rtl ? 'تعديل' : 'Edit'}</button>
      <button onClick={remove} disabled={busy} title={rtl ? 'حذف' : 'Delete'} style={{
        padding: '5px 9px', borderRadius: 5, background: 'transparent', color: '#DC2626',
        border: `.5px solid ${theme.border}`, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
      }}>✕</button>
    </div>
  );
}
