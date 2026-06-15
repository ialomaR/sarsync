// Wire-format serializers for boards/lists/cards.
// Pulls related people + labels into top-level lookup maps for the frontend.

export function serializeUserMini(u: {
  id: string; firstName: string; lastName: string; avatarColor: string;
}) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    initials: (u.firstName?.[0] || '') + (u.lastName?.[0] || ''),
    name: `${u.firstName} ${u.lastName}`.trim(),
    color: u.avatarColor,
  };
}

export function serializeLabel(l: { id: string; name: string; color: string; bg: string }) {
  return { id: l.id, name: l.name, color: l.color, bg: l.bg };
}

export function serializeBoardField(f: {
  id: string; name: string; type: string; position: number; options: unknown;
}) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    position: f.position,
    // options is stored as JSON ([{id,label,color}]); pass it through as-is.
    options: Array.isArray(f.options) ? f.options : null,
  };
}

function serializeFieldValue(v: {
  fieldId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueUserId: string | null;
  valueOptionId: string | null;
}) {
  return {
    fieldId: v.fieldId,
    valueText: v.valueText,
    valueNumber: v.valueNumber,
    valueDate: v.valueDate ? v.valueDate.toISOString() : null,
    valueUserId: v.valueUserId,
    valueOptionId: v.valueOptionId,
  };
}

interface RawBoard {
  id: string;
  title: string;
  subtitle: string | null;
  hue: number;
  coverImagePath: string | null;
  archivedAt: Date | null;
  createdById: string | null;
  createdBy?: { id: string; firstName: string; lastName: string; avatarColor: string | null } | null;
  workspaceId: string;
  departmentId: string | null;
  teamId: string | null;
  fields?: Array<{ id: string; name: string; type: string; position: number; options: unknown }>;
  lists: Array<{
    id: string;
    title: string;
    position: number;
    cards: Array<{
      id: string;
      listId: string;
      title: string;
      position: number;
      due: Date | null;
      orderedBy: string | null;
      coverHue: number | null;
      coverLabel: string | null;
      coverAttachmentId: string | null;
      completedAt: Date | null;
      attachments?: Array<{ id: string; mimeType: string; filename: string }>;
      labels: Array<{ labelId: string }>;
      members: Array<{ userId: string }>;
      fieldValues?: Array<{
        fieldId: string;
        valueText: string | null;
        valueNumber: number | null;
        valueDate: Date | null;
        valueUserId: string | null;
        valueOptionId: string | null;
      }>;
      _count?: { comments: number };
      checklist?: Array<{ done: boolean }>;
    }>;
  }>;
}

export function serializeBoard(
  board: RawBoard,
  peopleById: Record<string, ReturnType<typeof serializeUserMini>>,
  labelsById: Record<string, ReturnType<typeof serializeLabel>>,
  viewer: { starred: boolean },
) {
  return {
    id: board.id,
    title: board.title,
    subtitle: board.subtitle,
    hue: board.hue,
    coverUrl: board.coverImagePath ? `/api/boards/${board.id}/cover` : null,
    archivedAt: board.archivedAt ? board.archivedAt.toISOString() : null,
    createdById: board.createdById,
    createdBy: board.createdBy ? {
      id: board.createdBy.id,
      name: `${board.createdBy.firstName} ${board.createdBy.lastName}`.trim(),
      avatarColor: board.createdBy.avatarColor,
    } : null,
    starred: viewer.starred,
    workspaceId: board.workspaceId,
    departmentId: board.departmentId,
    teamId: board.teamId,
    fields: (board.fields ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(serializeBoardField),
    lists: board.lists
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        title: l.title,
        position: l.position,
        cards: l.cards
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((c) => {
            const total = c.checklist?.length ?? 0;
            const done = c.checklist?.filter((k) => k.done).length ?? 0;
            // Image/video attachments surfaced on the board card as a gallery.
            // The chosen cover (if any) floats to the front so a single image
            // renders as the cover and the order is stable.
            const media = (c.attachments ?? [])
              .filter((a) => a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/'))
              .map((a) => ({
                id: a.id,
                kind: a.mimeType.startsWith('video/') ? 'video' : 'image',
                mime: a.mimeType,
                name: a.filename,
                url: `/api/attachments/${a.id}`,
              }))
              .sort((x, y) => {
                if (x.id === c.coverAttachmentId) return -1;
                if (y.id === c.coverAttachmentId) return 1;
                return 0;
              });
            return {
              id: c.id,
              listId: c.listId,
              title: c.title,
              position: c.position,
              due: c.due ? c.due.toISOString() : null,
              orderedBy: c.orderedBy,
              coverHue: c.coverHue,
              coverLabel: c.coverLabel,
              coverAttachmentId: c.coverAttachmentId,
              coverUrl: c.coverAttachmentId ? `/api/attachments/${c.coverAttachmentId}` : null,
              media,
              completedAt: c.completedAt ? c.completedAt.toISOString() : null,
              labelIds: c.labels.map((x) => x.labelId),
              memberIds: c.members.map((x) => x.userId),
              fieldValues: (c.fieldValues ?? []).map(serializeFieldValue),
              checklistDone: done,
              checklistTotal: total,
              commentCount: c._count?.comments ?? 0,
            };
          }),
      })),
    peopleById,
    labelsById,
  };
}
