import React from 'react';
import { useSettings } from '../state/SettingsContext.jsx';
import { buildTheme } from './theme.js';

const PRESET_ACCENTS = ['#3B82F6', '#7C3AED', '#10B981', '#F97316', '#E11D48', '#0EA5E9'];

export function SettingsMenu({ onClose }) {
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(10,12,18,.4)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
      padding: '60px 24px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: theme.surface, color: theme.text,
        borderRadius: 12, width: 320, maxWidth: '100%',
        boxShadow: '0 20px 80px rgba(0,0,0,.4)',
        padding: 16,
        border: theme.name === 'dark' ? `.5px solid ${theme.border}` : 'none',
        fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Settings</h3>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: theme.muted,
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}>×</button>
        </div>

        <Section title="Theme" theme={theme}>
          <Radio value={s.themeName} options={[
            { value: 'minimal', label: 'Minimal' },
            { value: 'playful', label: 'Playful' },
            { value: 'dark', label: 'Dark' },
          ]} onChange={(v) => s.set('themeName', v)} theme={theme} />
        </Section>

        <Section title="Accent color" theme={theme}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {PRESET_ACCENTS.map((c) => (
              <button key={c} onClick={() => s.set('accent', c)} style={{
                width: 24, height: 24, borderRadius: '50%',
                background: c, border: s.accent === c ? `2px solid ${theme.text}` : `1px solid ${theme.border}`,
                cursor: 'pointer', padding: 0,
              }} />
            ))}
            <input type="color" value={s.accent}
              onChange={(e) => s.set('accent', e.target.value)}
              style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }} />
          </div>
        </Section>

        <Section title="Card density" theme={theme}>
          <Radio value={s.density} options={[
            { value: 'compact', label: 'Compact' },
            { value: 'cozy', label: 'Cozy' },
          ]} onChange={(v) => s.set('density', v)} theme={theme} />
        </Section>

        <Section title="Direction" theme={theme}>
          <Radio value={s.rtl ? 'rtl' : 'ltr'} options={[
            { value: 'ltr', label: 'LTR' },
            { value: 'rtl', label: 'RTL (عربي)' },
          ]} onChange={(v) => s.set('rtl', v === 'rtl')} theme={theme} />
        </Section>

        <Section title="Font scale" theme={theme}>
          <input type="range" min="0.85" max="1.2" step="0.05"
            value={s.fontScale}
            onChange={(e) => s.set('fontScale', parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: theme.accent }} />
          <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 4 }}>{s.fontScale.toFixed(2)}×</div>
        </Section>

        <Section title="Display" theme={theme} last>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.showAvatars}
              onChange={(e) => s.set('showAvatars', e.target.checked)}
              style={{ accentColor: theme.accent }} />
            Show avatars
          </label>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, theme, last, children }) {
  return (
    <div style={{
      paddingTop: 12, paddingBottom: 12,
      borderTop: `.5px solid ${theme.border}`,
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em',
        color: theme.mutedDim, textTransform: 'uppercase', marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Radio({ value, options, onChange, theme }) {
  return (
    <div style={{
      display: 'flex', gap: 0,
      border: `.5px solid ${theme.border}`,
      borderRadius: 7, padding: 2,
      background: theme.surface2,
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: 1, padding: '6px 8px',
            border: 'none', cursor: 'pointer',
            background: active ? theme.surface : 'transparent',
            color: active ? theme.text : theme.muted,
            borderRadius: 5, fontSize: 12, fontWeight: 600,
            fontFamily: 'inherit',
            boxShadow: active ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}
