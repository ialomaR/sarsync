// One-off data backfill: assign each existing card's CREATOR as a member of
// that card. New cards do this automatically (POST /lists/:listId/cards), but
// cards created before that change have no member, so they don't show up under
// the board's "by assignee" filter. This adds the missing memberships.
//
// Safe by design: INSERT-only into CardMember, idempotent (skips pairs that
// already exist), touches no other data. Dry run by default.
//
// Run from apps/api (so dotenv finds .env):
//   npx tsx scripts/backfill-card-creator-members.ts            # dry run (no writes)
//   npx tsx scripts/backfill-card-creator-members.ts --apply    # commit
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

// Every card that records who created it.
const cards = await prisma.card.findMany({
  where: { createdById: { not: null } },
  select: { id: true, createdById: true },
});

// Which (card, creator) memberships already exist, so we only add the gaps.
const existing = await prisma.cardMember.findMany({
  where: { cardId: { in: cards.map((c) => c.id) } },
  select: { cardId: true, userId: true },
});
const has = new Set(existing.map((e) => `${e.cardId}:${e.userId}`));

const toAdd = cards
  .filter((c) => !has.has(`${c.id}:${c.createdById}`))
  .map((c) => ({ cardId: c.id, userId: c.createdById! }));

console.log(`Cards with a recorded creator : ${cards.length}`);
console.log(`Creator memberships missing   : ${toAdd.length}`);

if (toAdd.length === 0) {
  console.log('Nothing to backfill. ✅');
  await prisma.$disconnect();
  process.exit(0);
}

if (!apply) {
  console.log('\nDRY RUN — no changes written. Re-run with --apply to commit.');
  await prisma.$disconnect();
  process.exit(0);
}

const res = await prisma.cardMember.createMany({ data: toAdd, skipDuplicates: true });
console.log(`\nInserted ${res.count} card-member rows. ✅`);
await prisma.$disconnect();
process.exit(0);
