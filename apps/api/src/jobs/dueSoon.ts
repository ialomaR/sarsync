// Scheduled job: notify card members when a card is due within 24 hours.
//
// Runs every 30 minutes. Dedup logic: we look for any existing
// 'card_due_soon' notification for (recipient, card) created in the last
// ~22h — if found, skip. Avoids re-pinging users every cycle.
//
// Cards already completed or archived are excluded.

import { prisma } from '../db.js';
import { notify } from '../notifications/service.js';

const RUN_EVERY_MS = 30 * 60 * 1000;       // 30 minutes
const HORIZON_MS = 24 * 60 * 60 * 1000;    // 24 hours
const DEDUP_WINDOW_MS = 22 * 60 * 60 * 1000;

let started = false;

export function startDueSoonJob(log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void }) {
  if (started) return;
  started = true;
  // Run once on startup, then every interval
  void runOnce(log).catch((err) => log.warn({ err }, 'dueSoon initial run failed'));
  setInterval(() => {
    void runOnce(log).catch((err) => log.warn({ err }, 'dueSoon tick failed'));
  }, RUN_EVERY_MS);
}

async function runOnce(log: { info: (...a: unknown[]) => void }) {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_MS);

  // Cards due within the next 24h, not yet completed or archived
  const cards = await prisma.card.findMany({
    where: {
      due: { not: null, gte: now, lte: horizon },
      completedAt: null,
      archivedAt: null,
    },
    include: {
      members: { select: { userId: true } },
      list: { include: { board: { select: { id: true, workspaceId: true, title: true } } } },
    },
  });

  if (cards.length === 0) {
    log.info({ checked: 0 }, 'dueSoon: no cards in window');
    return;
  }

  const dedupSince = new Date(now.getTime() - DEDUP_WINDOW_MS);
  let queued = 0;

  for (const card of cards) {
    if (card.members.length === 0) continue;
    const recipientIds = card.members.map((m) => m.userId);

    // Drop recipients who already got a 'card_due_soon' for THIS card recently.
    const recent = await prisma.notification.findMany({
      where: {
        kind: 'card_due_soon',
        recipientId: { in: recipientIds },
        createdAt: { gte: dedupSince },
        meta: { path: ['cardId'], equals: card.id },
      },
      select: { recipientId: true },
    });
    const alreadyNotified = new Set(recent.map((r) => r.recipientId));
    const fresh = recipientIds.filter((id) => !alreadyNotified.has(id));
    if (fresh.length === 0) continue;

    const dueIso = card.due!.toISOString();
    const hoursLeft = Math.max(0, Math.round((card.due!.getTime() - now.getTime()) / 3600_000));
    const phrase = hoursLeft <= 1 ? 'in less than an hour'
                 : hoursLeft <= 6 ? `in about ${hoursLeft} hours`
                 : `tomorrow`;

    await Promise.all(fresh.map((userId) => notify({
      recipientId: userId,
      actorId: null,                        // system-generated
      workspaceId: card.list.board.workspaceId,
      kind: 'card_due_soon',
      title: `"${card.title}" is due ${phrase}`,
      body: card.list.board.title,
      link: `/b/${card.list.boardId}?card=${card.id}`,
      meta: { cardId: card.id, boardId: card.list.boardId, due: dueIso },
    })));
    queued += fresh.length;
  }

  log.info({ checked: cards.length, queued }, 'dueSoon: pass complete');
}
