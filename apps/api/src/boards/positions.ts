// Fractional positioning for lists and cards.
// Drop between two items: midpoint of their positions.
// Drop at start: half the smallest position. Drop at end: largest + STEP.
// When precision degrades (delta < EPSILON), the caller should renumber the list.

const STEP = 1024;
const EPSILON = 0.0001;

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null) return next! / 2;
  if (next == null) return prev + STEP;
  if (next - prev < EPSILON) return prev + EPSILON; // caller should renumber
  return (prev + next) / 2;
}

// Insert into a sorted-by-position array at the given index, returning the new
// position value to assign. Excludes a card by id (e.g., when moving within the
// same list and wanting to skip the moving card from the calculation).
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
