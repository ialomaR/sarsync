// Parse an optional date query param. Returns undefined for missing OR invalid
// input, so callers skip the filter instead of passing an `Invalid Date` to
// Prisma — which rejects it and throws an unhandled 500.
export function parseDateParam(v: string | undefined | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
