// Centralised helper for creating notifications. Used by various route handlers
// when noteworthy events happen (card assigned, comment added, etc.).
//
// Never creates a notification when the actor is the same as the recipient
// (people don't need to be notified about their own actions).
//
// In-app notification is always created (DB row + socket push). Email is
// also sent for "important" kinds — the standard pattern in Linear/Asana/
// GitHub: people open their inbox before they open the app.

import { prisma } from '../db.js';
import { config } from '../config.js';
import { emitUserEvent } from '../realtime.js';
import { sendEmail, brandedHtml, escapeHtml } from '../lib/email.js';

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

// Kinds that trigger an email in addition to the in-app notification.
// All other kinds (e.g. invite_accepted) stay in-app only.
const EMAIL_KINDS = new Set([
  'card_assigned',
  'comment_added',
  'chat_mention',
  'card_due_soon',
]);

function emailSubjectFor(kind: string, fallback: string, actorName: string): string {
  switch (kind) {
    case 'card_assigned':  return `${actorName} assigned you to a card`;
    case 'comment_added':  return `${actorName} commented on a card`;
    case 'chat_mention':   return `${actorName} mentioned you`;
    case 'card_due_soon':  return 'A card is due soon';
    default: return fallback;
  }
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
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
        recipient: { select: { id: true, email: true, firstName: true, suspendedAt: true } },
      },
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

    // Email for "important" kinds. Suspended accounts are skipped.
    if (EMAIL_KINDS.has(created.kind) && created.recipient && !created.recipient.suspendedAt) {
      const actorName = created.actor
        ? `${created.actor.firstName} ${created.actor.lastName}`.trim()
        : 'Someone';
      const subject = emailSubjectFor(created.kind, created.title, actorName);
      const absLink = created.link ? `${config.WEB_ORIGIN}${created.link}` : config.WEB_ORIGIN;
      const heading = `${actorName} ${created.title}`.trim();
      const previewBody = created.body
        ? `<p style="background:#F3F4F6;padding:10px 12px;border-radius:6px;margin:12px 0;color:#374151;font-size:13px;">${escapeHtml(created.body)}</p>`
        : '';

      sendEmail({
        to: created.recipient.email,
        subject,
        text: `${heading}\n\n${created.body || ''}\n\nOpen: ${absLink}`,
        html: brandedHtml({
          // Escape — actorName comes from a user-controlled display name and is
          // interpolated raw into the email HTML by brandedHtml. (previewBody is
          // already escaped above; the heading was the one unescaped sink.)
          heading: escapeHtml(heading),
          body: previewBody,
          cta: { label: 'Open in SarSync', url: absLink },
        }),
        reason: `notif_${created.kind}`,
      }).catch(() => {});
    }
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
