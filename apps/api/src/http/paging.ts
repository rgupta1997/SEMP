// Shared list-endpoint helpers.
//
// parsePaging: opt-in and backward-compatible. It only constrains results when the
// client sends ?limit (clamped to 1..MAX_PAGE); ?offset skips. With no params the
// query stays unbounded, preserving the existing array-returning contract - so this
// is safe to drop into legacy list routes and gives the client a tool to page.
//
// coerceFilter: Express query values arrive as string | string[] | undefined. A
// repeated param (?championship_id=a&championship_id=b) is an array, which Prisma would reject in
// an equality `where`. Collapse to a single string so filters can't blow up a route.

export const MAX_PAGE = 200;

export function parsePaging(q: Record<string, unknown>): { take?: number; skip?: number } {
  const limit = Number(q.limit);
  const offset = Number(q.offset);
  const take = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), MAX_PAGE) : undefined;
  const skip = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : undefined;
  return { take, skip };
}

export function coerceFilter(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  return Array.isArray(val) ? String(val[0]) : String(val);
}
