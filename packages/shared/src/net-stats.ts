import { foldRally, resultEnvelope, type RallyLog } from './rally-kernel.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import type { StatBag } from './stat-registry.js';

/**
 * Volleyball / throwball: the side's sets and rally points, credited to everyone on
 * its team sheet - the same team share racquet doubles gives both partners.
 * A scored log is replayed through the kernel; a manual result only knows the final
 * numbers, which are sets in a sets match and points in a single set.
 */
export function netLineStats(
  format: ScoringFormat,
  log: RallyLog,
  result: { home: number | null; away: number | null; winner: Side | null },
  side: Side,
): StatBag {
  const i = side === 'A' ? 0 : 1;
  const o = 1 - i;
  const top = format.levels.length - 1;
  if (log.some((e) => e.t === 'point' || e.t === 'penalty')) {
    const env = resultEnvelope(format, foldRally(format, log, 'A').state);
    return {
      sets_won: env.unitsFor[i], sets_lost: env.unitsFor[o],
      points_won: env.pointsFor[i], points_lost: env.pointsFor[o],
    };
  }
  const { home, away, winner } = result;
  if (home == null || away == null) return {};
  const mine = side === 'A' ? home : away;
  const theirs = side === 'A' ? away : home;
  // A single set stores its points as the result; the set itself goes to the winner.
  if (format.levels[top].target <= 1) {
    if (!winner) return { points_won: mine, points_lost: theirs };
    return { sets_won: winner === side ? 1 : 0, sets_lost: winner === side ? 0 : 1, points_won: mine, points_lost: theirs };
  }
  return { sets_won: mine, sets_lost: theirs };
}
