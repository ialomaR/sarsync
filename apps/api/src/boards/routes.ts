import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { loadMembership, canViewBoard, canEditBoard, canEditCard, canManageBoard, canSetBoardDepartment, hasDeptAccess } from './auth.js';
import { positionAt, planInsert } from './positions.js';
import { serializeBoard, serializeLabel, serializeUserMini, serializeBoardField } from './serialize.js';
import { logActivity } from './activity.js';
import { notify, notifyCardMembers } from '../notifications/service.js';
import { emitBoardEvent, actorSocketId } from '../realtime.js';

// ── Schemas ────────────────────────────────────────────────────────────────

const DEFAULT_LISTS = ['Backlog', 'In Progress', 'Done'];
const DEFAULT_LABELS: Array<{ name: string; color: string; bg: string }> = [
  { name: 'Feature',  color: '#3B82F6', bg: '#E0EBFF' },
  { name: 'Bug',      color: '#DC2626', bg: '#FEE2E2' },
  { name: 'Research', color: '#7C3AED', bg: '#EDE3FF' },
  { name: 'Design',   color: '#DB2777', bg: '#FCE4EF' },
  { name: 'Infra',    color: '#0E7C66', bg: '#D7F1E9' },
  { name: 'Urgent',   color: '#B91C1C', bg: '#FECACA' },
];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const CreateLabel = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(HEX_COLOR, 'Hex color like #RRGGBB'),
  bg: z.string().regex(HEX_COLOR, 'Hex color like #RRGGBB'),
});
const UpdateLabel = z.object({
  name: z.string().min(1).max(40).optional(),
  color: z.string().regex(HEX_COLOR).optional(),
  bg: z.string().regex(HEX_COLOR).optional(),
});

const CreateBoard = z.object({
  title: z.string().min(1).max(160),
  hue: z.number().int().min(0).max(360).optional().default(220),
  departmentId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  withDefaultLists: z.boolean().optional().default(true),
});
const UpdateBoard = z.object({
  title: z.string().min(1).max(160).optional(),
  hue: z.number().int().min(0).max(360).optional(),
  departmentId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

// Custom field (table-view column) schemas.
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'person'] as const;
const FieldOption = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  color: z.string().regex(HEX_COLOR).nullable().optional().default(null),
});
const CreateField = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(FieldOption).max(40).optional(),
});
const UpdateField = z.object({
  name: z.string().min(1).max(80).optional(),
  options: z.array(FieldOption).max(40).nullable().optional(),
  // Reorder a column: target index among the board's fields.
  toIndex: z.number().int().nonnegative().optional(),
});
// Set one card's value for one field. Exactly the column for the field's type
// is honored server-side; the rest are cleared.
const SetFieldValue = z.object({
  text: z.string().max(2000).nullable().optional(),
  number: z.number().nullable().optional(),
  date: z.string().datetime().nullable().optional(),
  userId: z.string().nullable().optional(),
  optionId: z.string().nullable().optional(),
});

const CreateList = z.object({ title: z.string().min(1).max(120) });
const UpdateList = z.object({ title: z.string().min(1).max(120).optional() });
const CreateCard = z.object({ title: z.string().min(1).max(280) });
const UpdateCard = z.object({
  title: z.string().min(1).max(280).optional(),
  description: z.string().max(20_000).nullable().optional(),
  due: z.string().datetime().nullable().optional(),
  coverAttachmentId: z.string().nullable().optional(),
  orderedBy: z.string().max(200).nullable().optional(),
});
const MoveCard = z.object({
  toListId: z.string().min(1),
  toIndex: z.number().int().nonnegative(),
});
const MoveList = z.object({
  toIndex: z.number().int().nonnegative(),
});
const AddChecklistItem = z.object({ text: z.string().min(1).max(500) });
const UpdateChecklistItem = z.object({
  done: z.boolean().optional(),
  text: z.string().min(1).max(500).optional(),
});
const AddComment = z.object({ body: z.string().min(1).max(10_000) });
const AddCardMember = z.object({ userId: z.string().min(1) });
const AddCardLabel = z.object({ labelId: z.string().min(1) });

// Run a reorder as a Serializable transaction so two concurrent moves into the
// same gap can't read identical neighbors and compute colliding positions —
// Postgres aborts one with a write-conflict, which we retry a few times.
async function withSerializableRetry<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      // P2034: transaction write-conflict / deadlock (serialization failure).
      const code = (err as { code?: string }).code;
      if (attempt < 4 && code === 'P2034') continue;
      throw err;
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function boardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // List boards in a workspace (filtered by visibility).
  app.get<{ Params: { workspaceId: string } }>('/workspaces/:workspaceId/boards', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;
    const m = request.membership!;

    const boards = await prisma.board.findMany({
      where: { workspaceId: m.workspaceId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { lists: true } },
        department: { select: { id: true, name: true, nameAr: true, hue: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
      },
    });

    const visible = boards.filter((b) => canViewBoard(m, { id: b.id, departmentId: b.departmentId, teamId: b.teamId }));

    // Star state is per-user — fetch this viewer's starred boards
    const stars = await prisma.boardStar.findMany({
      where: { userId: m.userId, boardId: { in: visible.map((b) => b.id) } },
      select: { boardId: true },
    });
    const starredIds = new Set(stars.map((s) => s.boardId));

    // Card counts in one query
    const counts = await prisma.card.groupBy({
      by: ['listId'],
      _count: { _all: true },
      where: { archivedAt: null, list: { boardId: { in: visible.map((b) => b.id) } } },
    });
    const lists = await prisma.list.findMany({
      where: { boardId: { in: visible.map((b) => b.id) } },
      select: { id: true, boardId: true },
    });
    const listToBoard = new Map(lists.map((l) => [l.id, l.boardId] as const));
    const cardsByBoard = new Map<string, number>();
    for (const c of counts) {
      const bid = listToBoard.get(c.listId);
      if (!bid) continue;
      cardsByBoard.set(bid, (cardsByBoard.get(bid) ?? 0) + c._count._all);
    }

    // Sort starred-first within the already-updatedAt-sorted list
    visible.sort((a, b) => {
      const sa = starredIds.has(a.id) ? 0 : 1;
      const sb = starredIds.has(b.id) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return reply.send({
      boards: visible.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        hue: b.hue,
        starred: starredIds.has(b.id),
        listCount: b._count.lists,
        cardCount: cardsByBoard.get(b.id) ?? 0,
        updatedAt: b.updatedAt.toISOString(),
        departmentId: b.departmentId,
        departmentName: b.department?.name ?? null,
        departmentNameAr: b.department?.nameAr ?? null,
        departmentHue: b.department?.hue ?? null,
        teamId: b.teamId,
        coverUrl: b.coverImagePath ? `/api/boards/${b.id}/cover` : null,
        createdById: b.createdById,
        createdBy: b.createdBy ? {
          id: b.createdBy.id,
          name: `${b.createdBy.firstName} ${b.createdBy.lastName}`.trim(),
          avatarColor: b.createdBy.avatarColor,
        } : null,
      })),
    });
  });

  // Get full board with lists + cards.
  app.get<{ Params: { id: string } }>('/boards/:id', async (request, reply) => {
    const board = await prisma.board.findUnique({
      where: { id: request.params.id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
        fields: true,
        lists: {
          where: { archivedAt: null },
          include: {
            cards: {
              where: { archivedAt: null },
              include: {
                labels: { select: { labelId: true } },
                members: { select: { userId: true } },
                fieldValues: true,
                _count: { select: { comments: true } },
                checklist: { select: { done: true } },
              },
            },
          },
        },
      },
    });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });

    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    const m = request.membership!;
    if (!canViewBoard(m, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access to this board' });

    // Collect all referenced user + label IDs
    const userIds = new Set<string>();
    const labelIds = new Set<string>();
    for (const l of board.lists)
      for (const c of l.cards) {
        c.members.forEach((m) => userIds.add(m.userId));
        c.labels.forEach((l) => labelIds.add(l.labelId));
        // person-type field values reference a user — resolve them too
        c.fieldValues.forEach((v) => { if (v.valueUserId) userIds.add(v.valueUserId); });
      }

    const [users, labels, star] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, firstName: true, lastName: true, avatarColor: true },
      }),
      prisma.label.findMany({ where: { id: { in: [...labelIds] } } }),
      prisma.boardStar.findUnique({
        where: { boardId_userId: { boardId: board.id, userId: m.userId } },
        select: { boardId: true },
      }),
    ]);

    const peopleById: Record<string, ReturnType<typeof serializeUserMini>> = {};
    users.forEach((u) => { peopleById[u.id] = serializeUserMini(u); });
    const labelsById: Record<string, ReturnType<typeof serializeLabel>> = {};
    labels.forEach((l) => { labelsById[l.id] = serializeLabel(l); });

    return reply.send(serializeBoard(board, peopleById, labelsById, { starred: !!star }));
  });

  // Add list to board
  app.post<{ Params: { id: string }; Body: unknown }>('/boards/:id/lists', async (request, reply) => {
    const parsed = CreateList.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const lists = await prisma.list.findMany({
      where: { boardId: board.id, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    const position = positionAt(lists, lists.length);
    const list = await prisma.list.create({
      data: { boardId: board.id, title: parsed.data.title, position },
    });
    await logActivity({
      boardId: board.id, actorId: request.userId!,
      verb: 'list_created', targetType: 'list', targetId: list.id,
      meta: { title: list.title },
    });
    emitBoardEvent(board.id, 'list:added', {
      list: { id: list.id, title: list.title, position: list.position, cards: [] },
    }, actorSocketId(request));
    return reply.code(201).send({ id: list.id, title: list.title, position: list.position, cards: [] });
  });

  // Add card to list
  app.post<{ Params: { listId: string }; Body: unknown }>('/lists/:listId/cards', async (request, reply) => {
    const parsed = CreateCard.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const list = await prisma.list.findUnique({
      where: { id: request.params.listId },
      include: { board: true },
    });
    if (!list) return reply.code(404).send({ error: 'not_found', message: 'List not found' });
    await loadMembership(request, reply, list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const cards = await prisma.card.findMany({
      where: { listId: list.id, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    const position = positionAt(cards, cards.length);
    // The creator is auto-assigned as a member so their work shows up under the
    // "by assignee" filter by default. They can remove themselves afterward.
    const card = await prisma.card.create({
      data: {
        listId: list.id, title: parsed.data.title, position,
        createdById: request.userId,
        members: { create: { userId: request.userId! } },
      },
    });
    const memberIds = [request.userId!];
    await logActivity({
      boardId: list.boardId, actorId: request.userId!,
      verb: 'card_created', targetType: 'card', targetId: card.id,
      meta: { title: card.title, listTitle: list.title },
    });
    emitBoardEvent(list.boardId, 'card:added', {
      listId: list.id,
      card: {
        id: card.id, listId: card.listId, title: card.title, position: card.position,
        due: null, orderedBy: null, coverHue: null, coverLabel: null,
        labelIds: [], memberIds, checklistDone: 0, checklistTotal: 0, commentCount: 0,
      },
    }, actorSocketId(request));
    return reply.code(201).send({
      id: card.id, listId: card.listId, title: card.title,
      position: card.position, due: null, orderedBy: null, coverHue: null, coverLabel: null,
      labelIds: [], memberIds,
      checklistDone: 0, checklistTotal: 0, commentCount: 0,
    });
  });

  // Move card (drag-and-drop)
  app.patch<{ Params: { id: string }; Body: unknown }>('/cards/:id/move', async (request, reply) => {
    const parsed = MoveCard.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: { list: { include: { board: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    // Verify target list is on the same board
    const toList = await prisma.list.findUnique({ where: { id: parsed.data.toListId } });
    if (!toList || toList.boardId !== card.list.boardId) {
      return reply.code(400).send({ error: 'invalid_target', message: 'Target list not on same board' });
    }

    const { updated, renumber } = await withSerializableRetry(async (tx) => {
      const siblings = await tx.card.findMany({
        where: { listId: parsed.data.toListId, archivedAt: null, id: { not: card.id } },
        select: { id: true, position: true },
      });
      const plan = planInsert(siblings, parsed.data.toIndex);
      for (const r of plan.renumber) {
        await tx.card.update({ where: { id: r.id }, data: { position: r.position } });
      }
      const updated = await tx.card.update({
        where: { id: card.id },
        data: { listId: parsed.data.toListId, position: plan.position },
      });
      return { updated, renumber: plan.renumber };
    });

    if (card.listId !== parsed.data.toListId) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: 'card_moved', targetType: 'card', targetId: card.id,
        meta: { fromListTitle: card.list.title, toListTitle: toList.title, cardTitle: card.title },
      });
    }
    // If a rebalance happened, tell live clients the new positions of the
    // shifted siblings too, so their local order stays consistent.
    for (const r of renumber) {
      emitBoardEvent(card.list.boardId, 'card:moved', {
        cardId: r.id, listId: parsed.data.toListId, position: r.position,
      }, actorSocketId(request));
    }
    emitBoardEvent(card.list.boardId, 'card:moved', {
      cardId: updated.id, listId: updated.listId, position: updated.position,
    }, actorSocketId(request));
    return reply.send({ id: updated.id, listId: updated.listId, position: updated.position });
  });

  // Update card fields
  app.patch<{ Params: { id: string }; Body: unknown }>('/cards/:id', async (request, reply) => {
    const parsed = UpdateCard.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: { list: { include: { board: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;

    // Description and cover are collaborative — anyone with board edit access
    // can add them. Title and due are part of card identity and stay
    // restricted to the creator (or a manager) via canEditCard.
    const wantsIdentityChange = parsed.data.title !== undefined || parsed.data.due !== undefined;
    if (wantsIdentityChange) {
      if (!canEditCard(request.membership!, card, card.list.board)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Only the card creator (or a manager) can edit this card' });
      }
    } else {
      if (!canEditBoard(request.membership!, card.list.board)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });
      }
    }

    const data: Parameters<typeof prisma.card.update>[0]['data'] = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.due !== undefined) data.due = parsed.data.due ? new Date(parsed.data.due) : null;
    if (parsed.data.orderedBy !== undefined) data.orderedBy = parsed.data.orderedBy?.trim() || null;
    if (parsed.data.coverAttachmentId !== undefined) {
      // Validate attachment belongs to this card if not null
      if (parsed.data.coverAttachmentId) {
        const att = await prisma.attachment.findUnique({ where: { id: parsed.data.coverAttachmentId } });
        if (!att || att.cardId !== card.id) {
          return reply.code(400).send({ error: 'invalid_attachment', message: 'Attachment not on this card' });
        }
      }
      data.coverAttachmentId = parsed.data.coverAttachmentId;
    }

    const updated = await prisma.card.update({ where: { id: card.id }, data });
    if (parsed.data.title !== undefined && parsed.data.title !== card.title) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: 'card_renamed', targetType: 'card', targetId: card.id,
        meta: { from: card.title, to: parsed.data.title },
      });
    }
    if (parsed.data.description !== undefined) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: 'card_described', targetType: 'card', targetId: card.id,
        meta: { cardTitle: card.title },
      });
    }
    if (parsed.data.due !== undefined) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: parsed.data.due ? 'card_due_set' : 'card_due_cleared',
        targetType: 'card', targetId: card.id,
        meta: { cardTitle: card.title, due: parsed.data.due },
      });
    }
    if (parsed.data.coverAttachmentId !== undefined
        && parsed.data.coverAttachmentId !== card.coverAttachmentId) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: parsed.data.coverAttachmentId ? 'card_cover_set' : 'card_cover_cleared',
        targetType: 'card', targetId: card.id,
        meta: { cardTitle: card.title },
      });
    }
    if (parsed.data.orderedBy !== undefined && (data.orderedBy ?? null) !== card.orderedBy) {
      await logActivity({
        boardId: card.list.boardId, actorId: request.userId!,
        verb: data.orderedBy ? 'card_ordered_by_set' : 'card_ordered_by_cleared',
        targetType: 'card', targetId: card.id,
        meta: { cardTitle: card.title, orderedBy: data.orderedBy ?? null },
      });
    }
    emitBoardEvent(card.list.boardId, 'card:updated', {
      id: updated.id, title: updated.title, description: updated.description,
      due: updated.due ? updated.due.toISOString() : null,
      orderedBy: updated.orderedBy,
    }, actorSocketId(request));
    return reply.send({
      id: updated.id, title: updated.title, description: updated.description,
      due: updated.due ? updated.due.toISOString() : null,
      orderedBy: updated.orderedBy,
    });
  });

  // Card detail (modal)
  app.get<{ Params: { id: string } }>('/cards/:id', async (request, reply) => {
    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: {
        list: { include: { board: true } },
        labels: { select: { labelId: true } },
        members: { select: { userId: true } },
        checklist: { orderBy: { position: 'asc' } },
        comments: { orderBy: { createdAt: 'desc' }, include: { author: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } } },
        attachments: true,
      },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const userIds = [...new Set([
      ...card.members.map((m) => m.userId),
      ...card.comments.map((c) => c.author.id),
    ])];
    const labelIds = card.labels.map((l) => l.labelId);

    const [users, labels] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, avatarColor: true } }),
      prisma.label.findMany({ where: { id: { in: labelIds } } }),
    ]);

    const peopleById: Record<string, ReturnType<typeof serializeUserMini>> = {};
    users.forEach((u) => { peopleById[u.id] = serializeUserMini(u); });
    const labelsById: Record<string, ReturnType<typeof serializeLabel>> = {};
    labels.forEach((l) => { labelsById[l.id] = serializeLabel(l); });

    return reply.send({
      id: card.id,
      listId: card.listId,
      listTitle: card.list.title,
      boardId: card.list.boardId,
      boardDepartmentId: card.list.board.departmentId,
      title: card.title,
      description: card.description,
      due: card.due ? card.due.toISOString() : null,
      orderedBy: card.orderedBy,
      coverHue: card.coverHue,
      coverLabel: card.coverLabel,
      coverAttachmentId: card.coverAttachmentId,
      coverUrl: card.coverAttachmentId ? `/api/attachments/${card.coverAttachmentId}` : null,
      completedAt: card.completedAt ? card.completedAt.toISOString() : null,
      completedById: card.completedById,
      createdById: card.createdById,
      labelIds: card.labels.map((l) => l.labelId),
      memberIds: card.members.map((m) => m.userId),
      checklist: card.checklist.map((k) => ({ id: k.id, text: k.text, done: k.done, position: k.position })),
      comments: card.comments.map((c) => ({
        id: c.id, body: c.body, authorId: c.authorId,
        createdAt: c.createdAt.toISOString(),
      })),
      attachments: card.attachments.map((a) => ({
        id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes,
        createdAt: a.createdAt.toISOString(),
        url: `/api/attachments/${a.id}`,
      })),
      peopleById,
      labelsById,
    });
  });

  // Add checklist item
  app.post<{ Params: { id: string }; Body: unknown }>('/cards/:id/checklist', async (request, reply) => {
    const parsed = AddChecklistItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const last = await prisma.checklistItem.findFirst({
      where: { cardId: card.id }, orderBy: { position: 'desc' }, select: { position: true },
    });
    const position = (last?.position ?? 0) + 1024;
    const item = await prisma.checklistItem.create({
      data: { cardId: card.id, text: parsed.data.text, position },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'checklist_added', targetType: 'checklist', targetId: item.id,
      meta: { cardTitle: card.title, text: item.text },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'checklist_added' }, actorSocketId(request));
    return reply.code(201).send({ id: item.id, text: item.text, done: item.done, position: item.position });
  });

  // Toggle / edit checklist item
  app.patch<{ Params: { id: string }; Body: unknown }>('/checklist/:id', async (request, reply) => {
    const parsed = UpdateChecklistItem.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const item = await prisma.checklistItem.findUnique({
      where: { id: request.params.id },
      include: { card: { include: { list: { include: { board: true } } } } },
    });
    if (!item) return reply.code(404).send({ error: 'not_found', message: 'Item not found' });
    await loadMembership(request, reply, item.card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, item.card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const updated = await prisma.checklistItem.update({
      where: { id: item.id },
      data: parsed.data,
    });
    if (parsed.data.done !== undefined && parsed.data.done !== item.done) {
      await logActivity({
        boardId: item.card.list.boardId, actorId: request.userId!,
        verb: parsed.data.done ? 'checklist_completed' : 'checklist_uncompleted',
        targetType: 'checklist', targetId: item.id,
        meta: { cardTitle: item.card.title, text: item.text },
      });
    }
    emitBoardEvent(item.card.list.boardId, 'card:detail_changed', { cardId: item.cardId, kind: 'checklist_updated' }, actorSocketId(request));
    return reply.send({ id: updated.id, text: updated.text, done: updated.done, position: updated.position });
  });

  // Delete checklist item
  app.delete<{ Params: { id: string } }>('/checklist/:id', async (request, reply) => {
    const item = await prisma.checklistItem.findUnique({
      where: { id: request.params.id },
      include: { card: { include: { list: { include: { board: true } } } } },
    });
    if (!item) return reply.code(404).send({ error: 'not_found', message: 'Item not found' });
    await loadMembership(request, reply, item.card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, item.card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    await prisma.checklistItem.delete({ where: { id: item.id } });
    emitBoardEvent(item.card.list.boardId, 'card:detail_changed', { cardId: item.cardId, kind: 'checklist_removed' }, actorSocketId(request));
    return reply.code(204).send();
  });

  // Add comment
  app.post<{ Params: { id: string }; Body: unknown }>('/cards/:id/comments', async (request, reply) => {
    const parsed = AddComment.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const c = await prisma.comment.create({
      data: { cardId: card.id, authorId: request.userId!, body: parsed.data.body },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'comment_added', targetType: 'comment', targetId: c.id,
      meta: { cardTitle: card.title, snippet: parsed.data.body.slice(0, 80) },
    });
    // Notify all card members except the author
    await notifyCardMembers({
      cardId: card.id,
      actorId: request.userId!,
      workspaceId: card.list.board.workspaceId,
      kind: 'comment_added',
      title: `commented on "${card.title}"`,
      body: parsed.data.body.slice(0, 140),
      link: `/b/${card.list.boardId}?card=${card.id}`,
      meta: { cardId: card.id, boardId: card.list.boardId, commentId: c.id },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'comment_added' }, actorSocketId(request));
    return reply.code(201).send({
      id: c.id, body: c.body, authorId: c.authorId,
      createdAt: c.createdAt.toISOString(),
    });
  });

  // ── Board CRUD ─────────────────────────────────────────────────────────

  app.post<{ Params: { workspaceId: string }; Body: unknown }>('/workspaces/:workspaceId/boards', async (request, reply) => {
    await loadMembership(request, reply, request.params.workspaceId);
    if (reply.sent) return;
    const m = request.membership!;
    if (m.role === Role.guest) return reply.code(403).send({ error: 'forbidden', message: 'Guests cannot create boards' });
    if (m.role === Role.member) return reply.code(403).send({ error: 'forbidden', message: 'Members cannot create boards' });

    const parsed = CreateBoard.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    // Validate dept/team belong to workspace and align
    if (parsed.data.departmentId) {
      const d = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
      if (!d || d.workspaceId !== m.workspaceId) {
        return reply.code(400).send({ error: 'invalid_dept', message: 'Department not in workspace' });
      }
      // dept_manager / team_lead can only create in their dept
      if ((m.role === Role.dept_manager || m.role === Role.team_lead) && parsed.data.departmentId !== m.departmentId) {
        return reply.code(403).send({ error: 'forbidden', message: 'Cannot create boards in other departments' });
      }
    } else if (m.role === Role.dept_manager || m.role === Role.team_lead) {
      // Non-admins must scope to their own department; admin may leave it null
      // (workspace-wide / "General"). If a dept_manager / team_lead somehow
      // has no departmentId on their membership, refuse rather than silently
      // creating an orphan General board with no owning department.
      if (!m.departmentId) {
        return reply.code(400).send({
          error: 'no_department',
          message: 'Your membership has no department — ask an admin to assign you to one before creating boards.',
        });
      }
      parsed.data.departmentId = m.departmentId;
      // team_lead also scopes to their team by default so boards land where teammates can see them.
      if (m.role === Role.team_lead && !parsed.data.teamId && m.teamId) {
        parsed.data.teamId = m.teamId;
      }
    }

    if (parsed.data.teamId) {
      const t = await prisma.team.findUnique({ where: { id: parsed.data.teamId } });
      if (!t || t.workspaceId !== m.workspaceId) {
        return reply.code(400).send({ error: 'invalid_team', message: 'Team not in workspace' });
      }
      // The team must belong to the board's department. Without this a board in
      // dept A could be pinned to a team in dept B, and (via the team branch in
      // canEdit/canManage) that team would gain edit/manage rights across the
      // department boundary.
      const boardDept = parsed.data.departmentId ?? null;
      if (boardDept && t.departmentId !== boardDept) {
        return reply.code(400).send({ error: 'team_dept_mismatch', message: "Team is not in the board's department" });
      }
      // A team-scoped board created without an explicit department inherits the
      // team's department, so the two never disagree.
      if (!boardDept) parsed.data.departmentId = t.departmentId;
    }

    const board = await prisma.board.create({
      data: {
        workspaceId: m.workspaceId,
        title: parsed.data.title,
        hue: parsed.data.hue,
        departmentId: parsed.data.departmentId ?? null,
        teamId: parsed.data.teamId ?? null,
        createdById: m.userId,
        lists: parsed.data.withDefaultLists
          ? { create: DEFAULT_LISTS.map((title, i) => ({ title, position: (i + 1) * 1024 })) }
          : undefined,
        // Every new board gets a default label palette — it can be edited per-board afterward
        labels: { create: DEFAULT_LABELS },
      },
    });
    await logActivity({
      boardId: board.id, actorId: m.userId,
      verb: 'board_created', targetType: 'board', targetId: board.id,
      meta: { boardTitle: board.title, departmentId: board.departmentId },
    });
    return reply.code(201).send({
      id: board.id, title: board.title, hue: board.hue, starred: false,
      departmentId: board.departmentId, teamId: board.teamId,
    });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/boards/:id', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    const m = request.membership!;

    const parsed = UpdateBoard.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });
    const data = parsed.data;

    // What is this PATCH actually trying to change? Department reassignment is
    // gated separately from the rest (see below).
    const wantsDeptChange = 'departmentId' in data && (data.departmentId ?? null) !== board.departmentId;
    const wantsTeamChange = 'teamId' in data && (data.teamId ?? null) !== board.teamId;
    const wantsOtherChange = data.title !== undefined || data.hue !== undefined || wantsTeamChange;

    // Title / hue / team reassignment — full management rights (cross-dept
    // assignees can edit cards but never manage the board itself).
    const isManager = canManageBoard(m, board);
    if (wantsOtherChange && !isManager) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only board managers can change board settings' });
    }
    // Department reassignment follows its own one-way rule: admins move freely;
    // a creator / dept_manager may only claim a General board into their own
    // department. Gated independently of isManager so a dept_manager cannot
    // re-home a board that already lives in their department.
    if (wantsDeptChange && !canSetBoardDepartment(m, board, data.departmentId ?? null)) {
      return reply.code(403).send({ error: 'forbidden', message: 'You can only move a general board into your own department' });
    }
    // A request that changes nothing the caller is entitled to touch is forbidden.
    if (!wantsDeptChange && !wantsOtherChange && !isManager) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only board managers can change board settings' });
    }

    // Validate any dept/team target belongs to this workspace (mirrors create).
    if (data.departmentId) {
      const d = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!d || d.workspaceId !== board.workspaceId) {
        return reply.code(400).send({ error: 'invalid_dept', message: 'Department not in workspace' });
      }
    }
    if (data.teamId) {
      const t = await prisma.team.findUnique({ where: { id: data.teamId } });
      if (!t || t.workspaceId !== board.workspaceId) {
        return reply.code(400).send({ error: 'invalid_team', message: 'Team not in workspace' });
      }
      // The team must belong to the board's (possibly newly-set) department, so
      // a team can never bridge two departments and leak cross-dept edit/manage.
      const boardDept = ('departmentId' in data ? (data.departmentId ?? null) : board.departmentId);
      if (boardDept && t.departmentId !== boardDept) {
        return reply.code(400).send({ error: 'team_dept_mismatch', message: "Team is not in the board's department" });
      }
    }

    const updated = await prisma.board.update({
      where: { id: board.id },
      data,
    });
    if (wantsDeptChange) {
      await logActivity({
        boardId: board.id, actorId: m.userId,
        verb: 'board_moved', targetType: 'board', targetId: board.id,
        meta: { boardTitle: updated.title, departmentId: updated.departmentId },
      });
    }
    const star = await prisma.boardStar.findUnique({
      where: { boardId_userId: { boardId: updated.id, userId: request.userId! } },
      select: { boardId: true },
    });
    return reply.send({
      id: updated.id, title: updated.title, hue: updated.hue, starred: !!star,
      departmentId: updated.departmentId, teamId: updated.teamId,
    });
  });

  // Star/unstar — viewer-scoped, anyone with view access can toggle.
  app.put<{ Params: { id: string } }>('/boards/:id/star', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access to this board' });
    await prisma.boardStar.upsert({
      where: { boardId_userId: { boardId: board.id, userId: request.userId! } },
      create: { boardId: board.id, userId: request.userId! },
      update: {},
    });
    return reply.send({ starred: true });
  });

  app.delete<{ Params: { id: string } }>('/boards/:id/star', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access to this board' });
    await prisma.boardStar.deleteMany({
      where: { boardId: board.id, userId: request.userId! },
    });
    return reply.send({ starred: false });
  });

  app.post<{ Params: { id: string } }>('/boards/:id/archive', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canManageBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'Only board managers can archive a board' });
    await prisma.board.update({ where: { id: board.id }, data: { archivedAt: new Date() } });
    await logActivity({
      boardId: board.id, actorId: request.userId!,
      verb: 'board_archived', targetType: 'board', targetId: board.id,
      meta: { boardTitle: board.title },
    });
    return reply.code(204).send();
  });

  // Restore an archived board: clear archivedAt so it returns to the home
  // page, sidebar, and "My Work" lists. Managers only — same gate as archive.
  app.delete<{ Params: { id: string } }>('/boards/:id/archive', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canManageBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'Only board managers can restore a board' });
    if (!board.archivedAt) return reply.code(204).send();
    await prisma.board.update({ where: { id: board.id }, data: { archivedAt: null } });
    await logActivity({
      boardId: board.id, actorId: request.userId!,
      verb: 'board_restored', targetType: 'board', targetId: board.id,
      meta: { boardTitle: board.title },
    });
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>('/boards/:id', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    // Hard delete restricted to admin
    if (request.membership!.role !== Role.admin) {
      return reply.code(403).send({ error: 'forbidden', message: 'Admin required to permanently delete' });
    }
    await prisma.board.delete({ where: { id: board.id } });
    return reply.code(204).send();
  });

  // ── List management ────────────────────────────────────────────────────

  app.patch<{ Params: { id: string }; Body: unknown }>('/lists/:id', async (request, reply) => {
    const list = await prisma.list.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!list) return reply.code(404).send({ error: 'not_found', message: 'List not found' });
    await loadMembership(request, reply, list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const parsed = UpdateList.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const updated = await prisma.list.update({ where: { id: list.id }, data: parsed.data });
    emitBoardEvent(list.boardId, 'list:updated', {
      id: updated.id, title: updated.title, position: updated.position,
    }, actorSocketId(request));
    return reply.send({ id: updated.id, title: updated.title, position: updated.position });
  });

  // Move a list within its board. Uses fractional indexing (midpoint of the
  // neighbours at the destination index) so reordering is a single UPDATE
  // and never reshuffles the other rows.
  app.patch<{ Params: { id: string }; Body: unknown }>('/lists/:id/move', async (request, reply) => {
    const list = await prisma.list.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!list) return reply.code(404).send({ error: 'not_found', message: 'List not found' });
    await loadMembership(request, reply, list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const parsed = MoveList.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const { updated, renumber } = await withSerializableRetry(async (tx) => {
      const siblings = await tx.list.findMany({
        where: { boardId: list.boardId, archivedAt: null, id: { not: list.id } },
        select: { id: true, position: true },
      });
      const plan = planInsert(siblings, parsed.data.toIndex);
      for (const r of plan.renumber) {
        await tx.list.update({ where: { id: r.id }, data: { position: r.position } });
      }
      const updated = await tx.list.update({ where: { id: list.id }, data: { position: plan.position } });
      return { updated, renumber: plan.renumber };
    });

    for (const r of renumber) {
      emitBoardEvent(list.boardId, 'list:moved', { id: r.id, position: r.position }, actorSocketId(request));
    }
    emitBoardEvent(list.boardId, 'list:moved', {
      id: updated.id, position: updated.position,
    }, actorSocketId(request));
    return reply.send({ id: updated.id, position: updated.position });
  });

  app.delete<{ Params: { id: string } }>('/lists/:id', async (request, reply) => {
    const list = await prisma.list.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!list) return reply.code(404).send({ error: 'not_found', message: 'List not found' });
    await loadMembership(request, reply, list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    // Deleting a list cascades to every card it contains (onDelete: Cascade) —
    // including cards created by OTHER users. That would bypass the per-card
    // ownership gate on DELETE /cards, where a plain member can only delete
    // their own cards. So: managers may delete a populated list (they can delete
    // any card in their scope anyway); everyone else must empty it first, which
    // forces each card removal through canEditCard.
    const cardCount = await prisma.card.count({ where: { listId: list.id } });
    if (cardCount > 0 && !canManageBoard(request.membership!, list.board)) {
      return reply.code(409).send({
        error: 'list_not_empty',
        message: 'Move or delete the cards in this list before deleting it.',
      });
    }

    await prisma.list.delete({ where: { id: list.id } });
    await logActivity({
      boardId: list.boardId, actorId: request.userId!,
      verb: 'list_deleted', targetType: 'list', targetId: list.id,
      meta: { listTitle: list.title, cardCount },
    });
    emitBoardEvent(list.boardId, 'list:deleted', { id: list.id }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Card members ───────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: unknown }>('/cards/:id/members', async (request, reply) => {
    const parsed = AddCardMember.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    // Verify the user is a member of this workspace
    const targetMs = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: parsed.data.userId, workspaceId: card.list.board.workspaceId } },
    });
    if (!targetMs) return reply.code(400).send({ error: 'not_member', message: 'User is not in this workspace' });

    // If the assignee can't see this board through their department, grant
    // explicit board access. This enables cross-department collaboration:
    // a designer can be added to a Marketing card without being moved to that dept.
    if (!hasDeptAccess(targetMs, card.list.board)) {
      await prisma.boardMember.upsert({
        where: { boardId_userId: { boardId: card.list.boardId, userId: parsed.data.userId } },
        create: { boardId: card.list.boardId, userId: parsed.data.userId },
        update: {},
      });
    }

    await prisma.cardMember.upsert({
      where: { cardId_userId: { cardId: card.id, userId: parsed.data.userId } },
      create: { cardId: card.id, userId: parsed.data.userId },
      update: {},
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'member_assigned', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, assigneeId: parsed.data.userId },
    });
    // Notify the newly-assigned member (skipped if it's the actor themselves)
    await notify({
      recipientId: parsed.data.userId,
      actorId: request.userId,
      workspaceId: card.list.board.workspaceId,
      kind: 'card_assigned',
      title: `assigned you to "${card.title}"`,
      link: `/b/${card.list.boardId}?card=${card.id}`,
      meta: { cardId: card.id, boardId: card.list.boardId },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'member_added', userId: parsed.data.userId }, actorSocketId(request));
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { id: string; userId: string } }>('/cards/:id/members/:userId', async (request, reply) => {
    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    await prisma.cardMember.deleteMany({
      where: { cardId: card.id, userId: request.params.userId },
    });
    // If the user has no remaining cards on this board AND doesn't have base
    // dept access, remove the explicit board grant we created on assignment.
    const targetMs = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: request.params.userId, workspaceId: card.list.board.workspaceId } },
    });
    if (targetMs && !hasDeptAccess(targetMs, card.list.board)) {
      const stillOnBoard = await prisma.cardMember.findFirst({
        where: { userId: request.params.userId, card: { list: { boardId: card.list.boardId } } },
        select: { cardId: true },
      });
      if (!stillOnBoard) {
        await prisma.boardMember.deleteMany({
          where: { boardId: card.list.boardId, userId: request.params.userId },
        });
      }
    }
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'member_unassigned', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, assigneeId: request.params.userId },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'member_removed', userId: request.params.userId }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Card labels ────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: unknown }>('/cards/:id/labels', async (request, reply) => {
    const parsed = AddCardLabel.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: 'Invalid request' });

    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    const label = await prisma.label.findUnique({ where: { id: parsed.data.labelId } });
    if (!label || label.boardId !== card.list.boardId) {
      return reply.code(400).send({ error: 'invalid_label', message: 'Label not on this board' });
    }
    await prisma.cardLabel.upsert({
      where: { cardId_labelId: { cardId: card.id, labelId: parsed.data.labelId } },
      create: { cardId: card.id, labelId: parsed.data.labelId },
      update: {},
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'label_added', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, labelName: label.name },
    });
    emitBoardEvent(card.list.boardId, 'card:label_added', {
      cardId: card.id, labelId: parsed.data.labelId,
    }, actorSocketId(request));
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { id: string; labelId: string } }>('/cards/:id/labels/:labelId', async (request, reply) => {
    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    await prisma.cardLabel.deleteMany({
      where: { cardId: card.id, labelId: request.params.labelId },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'label_removed', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, labelId: request.params.labelId },
    });
    emitBoardEvent(card.list.boardId, 'card:label_removed', {
      cardId: card.id, labelId: request.params.labelId,
    }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Card completion ────────────────────────────────────────────────────
  // Explicit completion (Asana/Linear pattern). Sets completedAt + completedById.
  // Reopen via DELETE — clears both fields.

  app.post<{ Params: { id: string } }>('/cards/:id/complete', async (request, reply) => {
    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    if (card.completedAt) {
      return reply.send({ completedAt: card.completedAt.toISOString(), completedById: card.completedById });
    }
    const updated = await prisma.card.update({
      where: { id: card.id },
      data: { completedAt: new Date(), completedById: request.userId! },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'card_described', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, completed: true },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'completed' }, actorSocketId(request));
    return reply.send({
      completedAt: updated.completedAt!.toISOString(),
      completedById: updated.completedById,
    });
  });

  app.delete<{ Params: { id: string } }>('/cards/:id/complete', async (request, reply) => {
    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit' });

    if (!card.completedAt) return reply.code(204).send();
    await prisma.card.update({
      where: { id: card.id },
      data: { completedAt: null, completedById: null },
    });
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'card_described', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title, reopened: true },
    });
    emitBoardEvent(card.list.boardId, 'card:detail_changed', { cardId: card.id, kind: 'reopened' }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Card delete ────────────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>('/cards/:id', async (request, reply) => {
    const card = await prisma.card.findUnique({ where: { id: request.params.id }, include: { list: { include: { board: true } } } });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditCard(request.membership!, card, card.list.board)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Only the card creator (or a manager) can delete this card' });
    }
    await logActivity({
      boardId: card.list.boardId, actorId: request.userId!,
      verb: 'card_deleted', targetType: 'card', targetId: card.id,
      meta: { cardTitle: card.title },
    });
    await prisma.card.delete({ where: { id: card.id } });
    emitBoardEvent(card.list.boardId, 'card:deleted', { id: card.id }, actorSocketId(request));
    return reply.code(204).send();
  });

  // ── Board labels (per-board palette) ──────────────────────────────────

  app.get<{ Params: { id: string } }>('/boards/:id/labels', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const labels = await prisma.label.findMany({
      where: { boardId: board.id },
      orderBy: { name: 'asc' },
    });
    return reply.send({ labels });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/boards/:id/labels', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });

    const parsed = CreateLabel.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0].message });

    const l = await prisma.label.create({
      data: { boardId: board.id, ...parsed.data },
    });
    emitBoardEvent(board.id, 'label:added', { label: l }, actorSocketId(request));
    return reply.code(201).send(l);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/labels/:id', async (request, reply) => {
    const label = await prisma.label.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!label) return reply.code(404).send({ error: 'not_found', message: 'Label not found' });
    await loadMembership(request, reply, label.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, label.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });

    const parsed = UpdateLabel.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0].message });

    const updated = await prisma.label.update({ where: { id: label.id }, data: parsed.data });
    emitBoardEvent(label.boardId, 'label:updated', { label: updated }, actorSocketId(request));
    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>('/labels/:id', async (request, reply) => {
    const label = await prisma.label.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!label) return reply.code(404).send({ error: 'not_found', message: 'Label not found' });
    await loadMembership(request, reply, label.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, label.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });
    await prisma.label.delete({ where: { id: label.id } });
    emitBoardEvent(label.boardId, 'label:deleted', { id: label.id }, actorSocketId(request));
    return reply.code(204).send();
  });

  // Card label add/remove must verify the label belongs to the SAME board.
  // (Already validated in the existing /cards/:id/labels routes via label.workspaceId
  // — let me update those to check label.boardId === card.list.boardId)

  // ── Custom fields (per-board table-view columns) ───────────────────────
  // Mirrors the per-board label palette: defining a column needs board edit
  // rights (same bar as labels); setting a value on a card is a content edit.

  app.get<{ Params: { id: string } }>('/boards/:id/fields', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const fields = await prisma.boardField.findMany({
      where: { boardId: board.id },
      orderBy: { position: 'asc' },
    });
    return reply.send({ fields: fields.map(serializeBoardField) });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/boards/:id/fields', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });

    const parsed = CreateField.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0].message });

    const siblings = await prisma.boardField.findMany({
      where: { boardId: board.id },
      select: { id: true, position: true },
    });
    const position = positionAt(siblings, siblings.length);
    const field = await prisma.boardField.create({
      data: {
        boardId: board.id,
        name: parsed.data.name,
        type: parsed.data.type,
        position,
        // options only meaningful for select; store as given (or null)
        options: parsed.data.type === 'select' ? (parsed.data.options ?? []) : undefined,
      },
    });
    emitBoardEvent(board.id, 'field:added', { field: serializeBoardField(field) }, actorSocketId(request));
    return reply.code(201).send(serializeBoardField(field));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/fields/:id', async (request, reply) => {
    const field = await prisma.boardField.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!field) return reply.code(404).send({ error: 'not_found', message: 'Field not found' });
    await loadMembership(request, reply, field.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, field.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });

    const parsed = UpdateField.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0].message });

    const data: Prisma.BoardFieldUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    // options only apply to select fields; ignore otherwise
    if (parsed.data.options !== undefined && field.type === 'select') {
      data.options = (parsed.data.options ?? []) as Prisma.InputJsonValue;
    }
    if (parsed.data.toIndex !== undefined) {
      const toIndex = parsed.data.toIndex;
      const updated = await withSerializableRetry(async (tx) => {
        const siblings = await tx.boardField.findMany({
          where: { boardId: field.boardId, id: { not: field.id } },
          select: { id: true, position: true },
        });
        const plan = planInsert(siblings, toIndex);
        for (const r of plan.renumber) {
          await tx.boardField.update({ where: { id: r.id }, data: { position: r.position } });
        }
        return tx.boardField.update({ where: { id: field.id }, data: { ...data, position: plan.position } });
      });
      emitBoardEvent(field.boardId, 'field:updated', { field: serializeBoardField(updated) }, actorSocketId(request));
      return reply.send(serializeBoardField(updated));
    }

    const updated = await prisma.boardField.update({ where: { id: field.id }, data });
    emitBoardEvent(field.boardId, 'field:updated', { field: serializeBoardField(updated) }, actorSocketId(request));
    return reply.send(serializeBoardField(updated));
  });

  app.delete<{ Params: { id: string } }>('/fields/:id', async (request, reply) => {
    const field = await prisma.boardField.findUnique({ where: { id: request.params.id }, include: { board: true } });
    if (!field) return reply.code(404).send({ error: 'not_found', message: 'Field not found' });
    await loadMembership(request, reply, field.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, field.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });
    // Cascade removes all CardFieldValue rows for this column.
    await prisma.boardField.delete({ where: { id: field.id } });
    emitBoardEvent(field.boardId, 'field:deleted', { id: field.id }, actorSocketId(request));
    return reply.code(204).send();
  });

  // Set (or clear) one card's value for one field. Upserts the join row; the
  // column written is chosen by the field's type, the rest are nulled out.
  app.put<{ Params: { id: string; fieldId: string }; Body: unknown }>('/cards/:id/fields/:fieldId', async (request, reply) => {
    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: { list: { include: { board: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canEditBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'Cannot edit board' });

    const field = await prisma.boardField.findUnique({ where: { id: request.params.fieldId } });
    if (!field || field.boardId !== card.list.boardId) {
      return reply.code(400).send({ error: 'invalid_field', message: 'Field does not belong to this board' });
    }

    const parsed = SetFieldValue.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0].message });
    const b = parsed.data;

    // Project the request onto the one column this field's type owns.
    const value = {
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueDate: null as Date | null,
      valueUserId: null as string | null,
      valueOptionId: null as string | null,
    };
    switch (field.type) {
      case 'text':   value.valueText = b.text ?? null; break;
      case 'number': value.valueNumber = b.number ?? null; break;
      case 'date':   value.valueDate = b.date ? new Date(b.date) : null; break;
      case 'person': value.valueUserId = b.userId ?? null; break;
      case 'select': {
        // Validate the option exists in the field definition.
        const opts = Array.isArray(field.options) ? (field.options as Array<{ id: string }>) : [];
        if (b.optionId && !opts.some((o) => o.id === b.optionId)) {
          return reply.code(400).send({ error: 'invalid_option', message: 'Unknown option for this field' });
        }
        value.valueOptionId = b.optionId ?? null;
        break;
      }
    }

    await prisma.cardFieldValue.upsert({
      where: { cardId_fieldId: { cardId: card.id, fieldId: field.id } },
      create: { cardId: card.id, fieldId: field.id, ...value },
      update: value,
    });
    const wire = {
      fieldId: field.id,
      valueText: value.valueText,
      valueNumber: value.valueNumber,
      valueDate: value.valueDate ? value.valueDate.toISOString() : null,
      valueUserId: value.valueUserId,
      valueOptionId: value.valueOptionId,
    };
    emitBoardEvent(card.list.boardId, 'card:field_changed', {
      cardId: card.id, value: wire,
    }, actorSocketId(request));
    return reply.send({ cardId: card.id, ...wire });
  });

  // ── Activity feed ──────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/boards/:id/activity', async (request, reply) => {
    const board = await prisma.board.findUnique({ where: { id: request.params.id } });
    if (!board) return reply.code(404).send({ error: 'not_found', message: 'Board not found' });
    await loadMembership(request, reply, board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const items = await prisma.activity.findMany({
      where: { boardId: board.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    return reply.send({
      activity: items.map((a) => ({
        id: a.id, verb: a.verb, targetType: a.targetType, targetId: a.targetId,
        meta: a.meta, createdAt: a.createdAt.toISOString(),
        actor: { id: a.actor.id, name: `${a.actor.firstName} ${a.actor.lastName}`, color: a.actor.avatarColor },
      })),
    });
  });

  app.get<{ Params: { id: string } }>('/cards/:id/activity', async (request, reply) => {
    const card = await prisma.card.findUnique({
      where: { id: request.params.id },
      include: { list: { include: { board: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Card not found' });
    await loadMembership(request, reply, card.list.board.workspaceId);
    if (reply.sent) return;
    if (!canViewBoard(request.membership!, card.list.board)) return reply.code(403).send({ error: 'forbidden', message: 'No access' });

    const items = await prisma.activity.findMany({
      where: { boardId: card.list.boardId, targetType: 'card', targetId: card.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    // Also pull card-related activity (checklist, comments) by checklist/comment IDs scoped to this card
    const checklist = await prisma.checklistItem.findMany({ where: { cardId: card.id }, select: { id: true } });
    const comments = await prisma.comment.findMany({ where: { cardId: card.id }, select: { id: true } });
    const extraIds = [...checklist.map((x) => x.id), ...comments.map((x) => x.id)];
    const extra = extraIds.length > 0
      ? await prisma.activity.findMany({
          where: { boardId: card.list.boardId, targetId: { in: extraIds } },
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
        })
      : [];

    const all = [...items, ...extra]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);

    return reply.send({
      activity: all.map((a) => ({
        id: a.id, verb: a.verb, targetType: a.targetType, targetId: a.targetId,
        meta: a.meta, createdAt: a.createdAt.toISOString(),
        actor: { id: a.actor.id, name: `${a.actor.firstName} ${a.actor.lastName}`, color: a.actor.avatarColor },
      })),
    });
  });
}
