// Fractional positioning for lists and cards.
// Drop between two items: midpoint of their positions.
// Drop at start: half the smallest position. Drop at end: largest + STEP.
//
// When two neighbors get so close that a float midpoint can no longer fall
// strictly between them (precision exhausted after many inserts into the same
// gap), planInsert() rebalances the whole sibling list to clean STEP multiples
// instead of silently producing a colliding / out-of-order position.

export const STEP = 1024;

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null) return next! / 2;
  if (next == null) return prev + STEP;
  // True midpoint. Stays strictly between until float precision is genuinely
  // exhausted — never `prev + EPSILON`, which could land at/after `next` and
  // invert the order. planInsert() handles the exhausted case via rebalance.
  return (prev + next) / 2;
}

// Insert into a sorted-by-position array at the given index, returning the new
// position value to assign. Excludes a card by id (e.g., when moving within the
// same list and wanting to skip the moving card from the calculation).
//
// Used by the append paths (create at end of list); moves use planInsert().
export function positionAt<T extends { id: string; position: number }>(
  items: T[],
  index: number,
  excludeId?: string,
): number {
  const filtered = excludeId ? items.filter((i) => i.id !== excludeId) : items;
  const sorted = [...filtered].sort((a, b) => a.position - b.position);
  const prev = index > 0 ? sorted[index - 1]?.position ?? null : null;
  const next = sorted[index]?.position ?? null;
  return positionBetween(prev, next);
}

export interface MovePlan {
  // Position to assign to the moving item.
  position: number;
  // When the gap is exhausted, the siblings that must be renumbered (cleanly
  // re-spaced) for the move to land correctly. Empty for the common case.
  renumber: Array<{ id: string; position: number }>;
}

// Plan where to place a moving item among `others` (the siblings WITHOUT the
// moving item, any order) at the desired final `index`. `index` is clamped into
// range, so an out-of-range value appends instead of colliding at STEP. If the
// neighbors are too close to subdivide, the whole list is rebalanced.
export function planInsert<T extends { id: string; position: number }>(
  others: T[],
  index: number,
): MovePlan {
  const sorted = [...others].sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(index, sorted.length));
  const prev = clamped > 0 ? sorted[clamped - 1]!.position : null;
  const next = clamped < sorted.length ? sorted[clamped]!.position : null;

  // Is there room to subdivide with a value strictly between the neighbors?
  if (prev == null && next == null) return { position: STEP, renumber: [] };
  if (prev == null) {
    const p = next! / 2;
    if (p > 0 && p < next!) return { position: p, renumber: [] };
  } else if (next == null) {
    return { position: prev + STEP, renumber: [] };
  } else {
    const mid = (prev + next) / 2;
    if (mid > prev && mid < next) return { position: mid, renumber: [] };
  }

  // Precision exhausted — rebalance everything to clean STEP multiples, with
  // the moving item slotted at `clamped`.
  const renumber: Array<{ id: string; position: number }> = [];
  let pos = STEP;
  let movingPos = STEP;
  for (let i = 0; i <= sorted.length; i++) {
    if (i === clamped) { movingPos = pos; pos += STEP; }
    if (i < sorted.length) { renumber.push({ id: sorted[i]!.id, position: pos }); pos += STEP; }
  }
  return { position: movingPos, renumber };
}
