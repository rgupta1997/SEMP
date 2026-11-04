import { parseStoredFormat } from './format-ladder.js';
import { foldRally, isAggregate, resultEnvelope } from './rally-kernel.js';
import { readRallyLog } from './rally-rows.js';

// The points-quotient tie-breaker (volleyball, throwball) needs every rally point a team
// won and lost. Only a match scored point by point has them: a final-score entry saves sets.

/**
 * A set match's rally points per side, summed over every set (25-20, 23-25 -> 48-45).
 * Null when the match has no point-by-point log, so it can't count toward the quotient.
 */
export function rallyPointsOf(liveState: unknown): [number, number] | null {
  const format = parseStoredFormat((liveState as { format?: unknown } | null)?.format);
  if (!format || isAggregate(format) || format.levels.length < 2) return null;
  const log = readRallyLog(liveState);
  if (!log.length) return null;
  const { pointsFor } = resultEnvelope(format, foldRally(format, log, 'A').state);
  return pointsFor[0] + pointsFor[1] > 0 ? [pointsFor[0], pointsFor[1]] : null;
}

/** Won divided by lost. Nothing lost is the best there is (FIVB's "MAX"); nothing at all is no data. */
export function quotient(won: number, lost: number): number | null {
  if (lost > 0) return won / lost;
  return won > 0 ? Number.POSITIVE_INFINITY : null;
}
