import React from 'react';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { AdminConsole } from './role-views.jsx';

export function AdminPage() {
  const s = useSettings();
  return (
    <AppShell hideSidebar>
      <AdminConsole themeName={s.themeName} accent={s.accent} rtl={s.rtl} />
    </AppShell>
  );
}
