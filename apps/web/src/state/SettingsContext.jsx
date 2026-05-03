import React from 'react';

const DEFAULTS = {
  themeName: 'minimal',     // 'minimal' | 'playful' | 'dark'
  accent: '#3B82F6',
  density: 'cozy',          // 'compact' | 'cozy'
  showAvatars: true,
  rtl: false,
  fontScale: 1,
};

const STORAGE_KEY = 'sarsync:settings:v1';

const SettingsCtx = React.createContext(null);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = React.useState(load);

  const set = React.useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const ctx = React.useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
