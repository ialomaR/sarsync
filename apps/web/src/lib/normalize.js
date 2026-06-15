// Normalize API responses to the shape the existing UI components expect.

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
// Due dates are stored as UTC midnight (see CardModal date inputs), so they must
// be FORMATTED in UTC too — otherwise users west of UTC see the previous day.
const dueFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function formatDueDate(iso) {
  if (!iso) return null;
  try {
    return dueFmt.format(new Date(iso));
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

// Custom-field values arrive as an array; key them by fieldId for O(1) lookup
// in the table view and card modal.
export function fieldValuesById(arr) {
  const out = {};
  (arr || []).forEach((v) => { out[v.fieldId] = v; });
  return out;
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
    dueIso: c.due || null, // raw ISO for real overdue comparison (see Card.jsx)
    media: c.media || [], // image/video attachments for the card gallery
    orderedBy: c.orderedBy || null,
    checklist: c.checklistTotal > 0 ? { done: c.checklistDone, total: c.checklistTotal } : null,
    comments: c.commentCount || 0,
    cover: c.coverUrl
      ? { url: c.coverUrl }
      : c.coverHue != null ? { hue: c.coverHue, label: c.coverLabel || '' } : null,
    fieldValues: fieldValuesById(c.fieldValues),
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
    archivedAt: b.archivedAt || null,
    createdById: b.createdById || null,
    createdBy: b.createdBy || null,
    starred: b.starred,
    workspaceId: b.workspaceId,
    departmentId: b.departmentId,
    teamId: b.teamId,
    fields: (b.fields || []).slice().sort((a, z) => a.position - z.position),
    fieldsById: Object.fromEntries((b.fields || []).map((f) => [f.id, f])),
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
