// Centralised helper for creating notifications. Used by various route handlers
// when noteworthy events happen (card assigned, comment added, etc.).
//
// Never creates a notification when the actor is the same as the recipient
// (people don't need to be notified about their own actions).

import { prisma } from '../db.js';
import { emitUserEvent } from '../realtime.js';

export interface NotifyArgs {
  recipientId: string;
  actorId?: string | null;
  workspaceId?: string | null;
  kind: string;
  title: string;
  body?: string;
  link?: string;
  meta?: Record<string, unknown>;
}

export async function notify(args: NotifyArgs) {
  if (args.actorId && args.actorId === args.recipientId) return null;
  try {
    const created = await prisma.notification.create({
      data: {
        recipientId: args.recipientId,
        actorId: args.actorId ?? null,
        workspaceId: args.workspaceId ?? null,
        kind: args.kind,
        title: args.title,
        body: args.body ?? null,
        link: args.link ?? null,
        meta: (args.meta ?? null) as never,
      },
      include: { actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } } },
    });
    // Push to the recipient's socket if connected
    emitUserEvent(args.recipientId, 'notification:new', {
      id: created.id,
      kind: created.kind,
      title: created.title,
      body: created.body,
      link: created.link,
      meta: created.meta,
      readAt: null,
      createdAt: created.createdAt.toISOString(),
      actor: created.actor ? {
        id: created.actor.id,
        name: `${created.actor.firstName} ${created.actor.lastName}`,
        color: created.actor.avatarColor,
      } : null,
    });
    return created;
  } catch (err) {
    console.error('notify() failed', err);
    return null;
  }
}

// Notify all card members except the actor.
export async function notifyCardMembers(args: {
  cardId: string;
  actorId: string;
  workspaceId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
  meta?: Record<string, unknown>;
}) {
  const members = await prisma.cardMember.findMany({
    where: { cardId: args.cardId },
    select: { userId: true },
  });
  await Promise.all(members
    .filter((m) => m.userId !== args.actorId)
    .map((m) => notify({
      recipientId: m.userId,
      actorId: args.actorId,
      workspaceId: args.workspaceId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      link: args.link,
      meta: args.meta,
    })));
}
