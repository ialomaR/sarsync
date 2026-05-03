import React from 'react';
import { useLocation } from 'react-router-dom';
import { useSettings } from '../state/SettingsContext.jsx';
import { useIsMobile } from '../state/useViewport.js';
import { buildTheme, fontFamilyFor } from '../ui/theme.js';
import { TopBar } from './TopBar.jsx';
import { Sidebar } from './Sidebar.jsx';
import { SettingsMenu } from '../ui/SettingsMenu.jsx';
import { SearchPalette } from '../ui/SearchPalette.jsx';

export function AppShell({ board, children, hideSidebar }) {
  const s = useSettings();
  const theme = buildTheme(s.themeName, s.accent);
  const isMobile = useIsMobile();
  const location = useLocation();
  const [showSettings, setShowSettings] = React.useState(false);
  const [showSearch, setShowSearch] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Cmd/Ctrl+K opens search
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close the drawer when the user navigates (touch tap on a sidebar entry).
  React.useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: theme.boardBg, color: theme.text,
      fontFamily: fontFamilyFor(s.rtl), fontSize: 13 * s.fontScale,
      display: 'flex', flexDirection: 'column',
      direction: s.rtl ? 'rtl' : 'ltr',
      letterSpacing: s.rtl ? 0 : '-.005em',
    }}>
      <TopBar theme={theme} board={board} rtl={s.rtl}
        showMenuButton={isMobile && !hideSidebar}
        onOpenMenu={() => setDrawerOpen(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenSearch={() => setShowSearch(true)} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {!hideSidebar && (
          isMobile ? (
            <>
              {drawerOpen && (
                <div onClick={() => setDrawerOpen(false)} style={{
                  position: 'fixed', inset: 0, zIndex: 50,
                  background: 'rgba(0,0,0,.4)',
                }} />
              )}
              <div style={{
                position: 'fixed', insetBlock: 0, insetInlineStart: 0,
                zIndex: 51, transform: drawerOpen
                  ? 'translateX(0)'
                  : (s.rtl ? 'translateX(100%)' : 'translateX(-100%)'),
                transition: 'transform .22s ease',
                boxShadow: drawerOpen ? '0 0 24px rgba(0,0,0,.18)' : 'none',
                top: 52, // below the topbar
              }}>
                <Sidebar theme={theme} rtl={s.rtl} />
              </div>
            </>
          ) : (
            <Sidebar theme={theme} rtl={s.rtl} />
          )
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
      {showSettings && <SettingsMenu onClose={() => setShowSettings(false)} />}
      <SearchPalette theme={theme} rtl={s.rtl} open={showSearch} onClose={() => setShowSearch(false)} />
    </div>
  );
}
