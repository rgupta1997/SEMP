// What a season is (J5-E1-S1).
//
// Derived from ONE setting, not a table, because institutions disagree about when a
// sporting year starts and a hard-coded April-March would simply be wrong for most of
// them. And derived in ONE place, shared by the API and the web app, because two
// implementations is precisely how a page and its own export stop matching.
//
// A championship belongs to the season containing its START date. Not its end date:
// a meet that runs across the boundary is reported in the year it opened, which is
// how the people running it already talk about it.

/** 1 = January … 12 = December. The month the sporting year opens. */
export type SeasonStartMonth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** January, i.e. season == calendar year, until an institution says otherwise. */
export const DEFAULT_SEASON_START_MONTH: SeasonStartMonth = 1;

export function seasonStartMonthOf(settings: unknown): SeasonStartMonth {
  const raw = (settings as { season_start_month?: unknown } | null)?.season_start_month;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? (n as SeasonStartMonth) : DEFAULT_SEASON_START_MONTH;
}

/**
 * The season a date falls in, as the year it STARTED in. With a June start,
 * 2026-05-30 is season 2025 and 2026-06-01 is season 2026.
 */
export function seasonOf(date: Date | string, startMonth: SeasonStartMonth = DEFAULT_SEASON_START_MONTH): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  // getUTC*: a championship's start_date is a plain date, and reading it in the
  // server's local zone can move it across midnight and therefore across a season.
  const year = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= startMonth ? year : year - 1;
}

/** "2025-26" for a June start; plain "2025" when the season is the calendar year. */
export function seasonLabel(season: number, startMonth: SeasonStartMonth = DEFAULT_SEASON_START_MONTH): string {
  if (startMonth === 1) return String(season);
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

/** Half-open [start, end) so a boundary date lands in exactly one season. */
export function seasonRange(season: number, startMonth: SeasonStartMonth = DEFAULT_SEASON_START_MONTH) {
  const start = new Date(Date.UTC(season, startMonth - 1, 1));
  const end = new Date(Date.UTC(season + 1, startMonth - 1, 1));
  return { start, end };
}

/**
 * A year-on-year change, or null when there is nothing to compare against.
 *
 * null is the whole point: the first season has no predecessor, and reporting that as
 * 0% or 100% is a fabricated figure on a page whose entire job is to be trustworthy.
 * Callers render null as "no comparison available" (J5-E1-S2).
 */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * The smallest cohort that may be reported (J5-E3-S4). Below this, a demographic cell
 * is suppressed rather than shown: in a programme of three, "1 woman" identifies her.
 */
export const MIN_COHORT = 5;

/** `null` where a cell would be too small to publish. */
export const suppressSmall = (n: number): number | null => (n > 0 && n < MIN_COHORT ? null : n);
