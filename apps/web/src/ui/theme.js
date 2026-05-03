// Theme tokens — shared by all 3 themes (minimal / playful / dark).

export function buildTheme(name, accent) {
  const a = accent;
  if (name === 'dark') {
    return {
      name,
      bg: '#0E1014',
      surface: '#181B22',
      surface2: '#1F232C',
      list: '#1A1D24',
      listHd: 'rgba(255,255,255,.04)',
      card: '#23272F',
      cardHover: '#2A2F38',
      border: 'rgba(255,255,255,.06)',
      text: '#E7E9EE',
      muted: '#8B92A0',
      mutedDim: '#5A6171',
      accent: a,
      accentText: '#fff',
      accentSoft: a + '22',
      shadow: '0 1px 0 rgba(255,255,255,.04) inset, 0 1px 2px rgba(0,0,0,.5)',
      cardShadow: '0 1px 0 rgba(255,255,255,.03) inset, 0 1px 3px rgba(0,0,0,.4)',
      radius: 8,
      cardRadius: 8,
      headerBg: '#13161C',
      sidebarBg: '#0A0C10',
      boardBg: '#0E1014',
      listAccent: false,
      cardLift: false,
    };
  }
  if (name === 'playful') {
    return {
      name,
      bg: '#FBF7F0',
      surface: '#FFFFFF',
      surface2: '#FFF8EE',
      list: '#FDF1DC',
      listHd: 'transparent',
      card: '#FFFFFF',
      cardHover: '#FFFCF5',
      border: 'rgba(74,38,8,.10)',
      text: '#2A1A07',
      muted: '#7A6147',
      mutedDim: '#A89478',
      accent: a,
      accentText: '#fff',
      accentSoft: a + '22',
      shadow: '0 2px 0 rgba(74,38,8,.10), 0 1px 2px rgba(74,38,8,.05)',
      cardShadow: '0 2px 0 rgba(74,38,8,.08), 0 1px 3px rgba(74,38,8,.05)',
      radius: 14,
      cardRadius: 12,
      headerBg: '#FBF7F0',
      sidebarBg: '#F4ECDD',
      boardBg: '#FBF7F0',
      listAccent: true,
      cardLift: true,
    };
  }
  return {
    name: 'minimal',
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surface2: '#FAFBFC',
    list: '#F1F2F5',
    listHd: 'transparent',
    card: '#FFFFFF',
    cardHover: '#FAFBFC',
    border: 'rgba(15,20,30,.07)',
    text: '#1A1D24',
    muted: '#6B7280',
    mutedDim: '#9AA1AC',
    accent: a,
    accentText: '#fff',
    accentSoft: a + '1A',
    shadow: '0 1px 2px rgba(15,20,30,.04), 0 0 0 .5px rgba(15,20,30,.05)',
    cardShadow: '0 1px 2px rgba(15,20,30,.05), 0 0 0 .5px rgba(15,20,30,.05)',
    radius: 8,
    cardRadius: 6,
    headerBg: '#FFFFFF',
    sidebarBg: '#FFFFFF',
    boardBg: '#F6F7F9',
    listAccent: false,
    cardLift: false,
  };
}

export const LIST_HUES = { backlog: 230, design: 320, doing: 28, review: 50, done: 150 };

export function fontFamilyFor(rtl) {
  return rtl
    ? '"IBM Plex Sans Arabic", "Inter", system-ui, sans-serif'
    : '"Inter", system-ui, -apple-system, sans-serif';
}

export function iconBtn(theme) {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: theme.muted, padding: 4, borderRadius: 5,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

export function pillBtn(theme) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: theme.surface, color: theme.text,
    border: `.5px solid ${theme.border}`,
    padding: '6px 12px', borderRadius: 7,
    fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
