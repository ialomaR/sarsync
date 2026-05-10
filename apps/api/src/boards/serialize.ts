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

interface RawBoard {
  id: string;
  title: string;
  subtitle: string | null;
  hue: number;
  coverImagePath: string | null;
  workspaceId: string;
  departmentId: string | null;
  teamId: string | null;
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
      coverHue: number | null;
      coverLabel: string | null;
      coverAttachmentId: string | null;
      completedAt: Date | null;
      labels: Array<{ labelId: string }>;
      members: Array<{ userId: string }>;
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
    starred: viewer.starred,
    workspaceId: board.workspaceId,
    departmentId: board.departmentId,
    teamId: board.teamId,
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
            return {
              id: c.id,
              listId: c.listId,
              title: c.title,
              position: c.position,
              due: c.due ? c.due.toISOString() : null,
              coverHue: c.coverHue,
              coverLabel: c.coverLabel,
              coverAttachmentId: c.coverAttachmentId,
              coverUrl: c.coverAttachmentId ? `/api/attachments/${c.coverAttachmentId}` : null,
              completedAt: c.completedAt ? c.completedAt.toISOString() : null,
              labelIds: c.labels.map((x) => x.labelId),
              memberIds: c.members.map((x) => x.userId),
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
