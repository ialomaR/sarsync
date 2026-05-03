import React from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { DepartmentView } from './role-views.jsx';

export function DepartmentPage() {
  const s = useSettings();
  const { id = 'design' } = useParams();
  return (
    <AppShell>
      <DepartmentView themeName={s.themeName} accent={s.accent} rtl={s.rtl} deptId={id} />
    </AppShell>
  );
}
