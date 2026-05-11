// Normalize API responses to the shape the existing UI components expect.

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

export function formatDueDate(iso) {
  if (!iso) return null;
  try {
    return dateFmt.format(new Date(iso));
  } catch {
    return null;
  }
}

export function formatRelative(iso) {
  if (!iso) return '';
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = (now - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return dateFmt.format(new Date(iso));
}

export function normalizeCard(c) {
  return {
    id: c.id,
    listId: c.listId,
    title: c.title,
    position: c.position,
    labels: c.labelIds || [],
    members: c.memberIds || [],
    due: formatDueDate(c.due),
    checklist: c.checklistTotal > 0 ? { done: c.checklistDone, total: c.checklistTotal } : null,
    comments: c.commentCount || 0,
    cover: c.coverUrl
      ? { url: c.coverUrl }
      : c.coverHue != null ? { hue: c.coverHue, label: c.coverLabel || '' } : null,
  };
}

export function normalizeList(l) {
  return {
    id: l.id,
    title: l.title,
    position: l.position,
    cards: (l.cards || []).map(normalizeCard),
  };
}

export function normalizeBoard(b) {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    hue: b.hue,
    coverUrl: b.coverUrl || null,
    starred: b.starred,
    workspaceId: b.workspaceId,
    departmentId: b.departmentId,
    teamId: b.teamId,
    lists: (b.lists || []).map(normalizeList),
    peopleById: b.peopleById || {},
    labelsById: b.labelsById || {},
  };
}

export function normalizeBoardSummary(b) {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    hue: b.hue,
    coverUrl: b.coverUrl || null,
    starred: b.starred,
    lists: b.listCount || 0,
    cards: b.cardCount || 0,
    updated: formatRelative(b.updatedAt),
    team: b.subtitle || '',
    departmentId: b.departmentId || null,
    departmentName: b.departmentName || null,
    departmentNameAr: b.departmentNameAr || null,
    departmentHue: b.departmentHue ?? null,
  };
}
