import React from 'react';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { MyWorkView } from './role-views.jsx';

export function MyWorkPage() {
  const s = useSettings();
  return (
    <AppShell>
      <MyWorkView themeName={s.themeName} accent={s.accent} rtl={s.rtl} userId="m6" />
    </AppShell>
  );
}
