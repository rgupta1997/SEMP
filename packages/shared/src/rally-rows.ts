import type { ScoringFormat, Side } from './scoring-rules.js';
import { foldRally, type RallyEvent, type RallyLog } from './rally-kernel.js';
import { resolveServer, type Pairing } from './serve-resolvers.js';

// ============================================================================
// The rally log as TABLE ROWS, and back again.
//
// WHY THIS EXISTS. The event-by-event record currently lives only in
// `fixtures.live_state.rally` - one jsonb blob per fixture - and the per-player
// stats are derived straight from it. That works, and it cannot be verified:
//
//   - you cannot ask a question across matches. "Every point this player won on
//     serve" means reading every fixture's blob and folding each one in
//     application code.
//   - nothing is typed or constrained, so a malformed entry is discovered when the
//     fold runs, not when it is written.
//   - a stat has no trail back to the rallies that produced it, so "why does this
//     say 47?" has no answer except "run the code again".
//
// So the facts go in a table (`fixture_events`, which has existed and been unwritten
// since June) and the stats stay derived. That split is the whole verification story:
//
//   fixture_events        immutable facts, one row per action, QUERYABLE
//   player_match_stats    derived, recomputable, disposable
//   career_stats.stats    derived, recomputable, disposable
//
// jsonb is fine for the derived layers precisely BECAUSE they are derived - a bag
// that can be rebuilt from facts is a cache, and a wrong cache is repaired by
// recomputing. jsonb for the FACTS would be unverifiable, which is what this fixes.
//
// The round trip is the test: rows -> log -> rows must be identical, and the stats
// derived from the reconstructed log must equal the stats derived from the original.
// ============================================================================

/** One `fixture_events` row, as the API will insert it. Column names, not camelCase. */
export interface RallyRow {
  rubber_key: string | null;
  team_side: Side | null;
  event_key: string;
  label: string;
  /** Credited to `team_side`. 0 for a rally that scored nothing (a side-out). */
  points: number;
  /** The person who SERVED this rally, where a pairing was supplied. */
  player_user_id: string | null;
  /** The receiver, where the sport determines one. */
  second_user_id: string | null;
  /** The unit in play, e.g. "Game 2". */
  segment: string | null;
  period_no: number | null;
  seq: number;
  metric_value: number | null;
  /**
   * Everything needed to answer a question about this rally without re-folding the
   * match: the score after it, who served, whether it was at deuce or in the
   * decider. Derived, but stored, because the point of a fact table is that a query
   * can answer a question on its own.
   */
  meta: {
    scored: Side | null;
    serverSide: Side | null;
    serverNo: number;
    courtHalf: 'right' | 'left' | null;
    atDeuce: boolean;
    inDecider: boolean;
    switchEnds: boolean;
    scoreAfter: [number, number];
    unitsAfter: [number, number];
    unitsWon: Array<{ level: number; key: string; winner: Side; score: [number, number] }>;
    reason?: string;
    by?: string;
  };
}

const LABELS: Record<string, string> = {
  point: 'Rally',
  let: 'Let',
  fault: 'Fault',
  penalty: 'Conduct point',
  awardServe: 'Serve awarded',
  awardUnit: 'Unit awarded',
  adjust: 'Score corrected',
  setServe: 'Serve corrected',
  capFired: 'Time up',
  end: 'Match ended',
};

/**
 * Flatten a rally log into rows.
 *
 * Folds the log once, so each row carries the state AS AT that rally - which is
 * what makes "points won while serving" a WHERE clause instead of a program.
 */
export function rallyLogToRows(
  format: ScoringFormat,
  log: RallyLog,
  opts: { pairing?: Pairing; firstServer?: Side; rubberKey?: string | null } = {},
): RallyRow[] {
  const first = opts.firstServer ?? 'A';
  const { trace } = foldRally(format, log, first);

  // Re-walk to get the state BEFORE each event, which is when the serving player is
  // resolved - after the event the serve has already moved on.
  const rows: RallyRow[] = [];
  let state = foldRally(format, [], first).state;
  const top = format.levels.length - 1;

  log.forEach((ev, i) => {
    const eff = trace[i];
    const before = state;
    const resolved = opts.pairing ? resolveServer(format, before, opts.pairing) : null;
    const next = foldRally(format, log.slice(0, i + 1), first).state;
    state = next;

    const side: Side | null = 'side' in ev && ev.side ? (ev.side as Side) : null;
    rows.push({
      rubber_key: opts.rubberKey ?? null,
      team_side: eff.scored ?? side,
      event_key: ev.t,
      label: LABELS[ev.t] ?? ev.t,
      points: eff.scored ? 1 : 0,
      player_user_id: resolved?.server ?? null,
      second_user_id: resolved?.receiver ?? null,
      segment: `${format.levels[0].label} ${Math.min(next.score[top]?.[0] + next.score[top]?.[1] + 1, 99)}`,
      period_no: (before.score[top]?.[0] ?? 0) + (before.score[top]?.[1] ?? 0) + 1,
      seq: i,
      metric_value: null,
      meta: {
        scored: eff.scored,
        serverSide: eff.serverSide,
        serverNo: eff.serverNo,
        courtHalf: before.serve.courtHalf,
        atDeuce: eff.atDeuce,
        inDecider: eff.inDecider,
        switchEnds: eff.switchEnds,
        scoreAfter: [next.score[next.pointLevel][0], next.score[next.pointLevel][1]],
        unitsAfter: top > 0 ? [next.score[top][0], next.score[top][1]] : [0, 0],
        unitsWon: eff.unitsWon.map((u) => ({ level: u.level, key: u.key, winner: u.winner, score: u.score })),
        ...('reason' in ev && ev.reason ? { reason: String(ev.reason) } : {}),
        ...('by' in ev && ev.by ? { by: String(ev.by) } : {}),
      },
    });
  });

  return rows;
}

/**
 * Rebuild the log from rows.
 *
 * This is the half that makes the facts authoritative rather than a copy: if the
 * stats can be recomputed from the TABLE, the table is the source and the blob in
 * live_state is just the console's working state.
 */
export function rowsToRallyLog(rows: Array<Pick<RallyRow, 'event_key' | 'team_side' | 'seq' | 'meta'>>): RallyLog {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .map((r): RallyEvent | null => {
      const side = r.team_side ?? undefined;
      switch (r.event_key) {
        case 'point':
          // The row's `team_side` is who SCORED, which under server-only scoring is
          // not who won the rally - so a scoreless rally is reconstructed from the
          // server, which is the only side that could have lost it.
          if (r.meta?.scored) return { t: 'point', side: r.meta.scored };
          if (r.meta?.serverSide) return { t: 'point', side: r.meta.serverSide === 'A' ? 'B' : 'A' };
          return side ? { t: 'point', side } : null;
        case 'let': return { t: 'let' };
        case 'fault': return side ? { t: 'fault', side } : null;
        case 'penalty': return side ? { t: 'penalty', side, reason: r.meta?.reason } : null;
        case 'awardServe': return side ? { t: 'awardServe', side, reason: r.meta?.reason } : null;
        case 'awardUnit': return side ? { t: 'awardUnit', side, reason: r.meta?.reason } : null;
        case 'setServe': return side ? { t: 'setServe', side, serverNo: r.meta?.serverNo, reason: r.meta?.reason } : null;
        case 'capFired': return { t: 'capFired' };
        case 'end':
          return {
            t: 'end',
            outcome: r.meta?.scored ? 'win' : 'draw',
            reason: (r.meta?.reason as any) ?? 'normal',
            winner: r.meta?.scored ?? null,
          };
        // `adjust` carries a delta the row does not model, so it is deliberately not
        // reconstructed - see `isReconstructable`.
        default: return null;
      }
    })
    .filter((e): e is RallyEvent => e !== null);
}

/**
 * Can this log be rebuilt from its rows without loss?
 *
 * A manual `adjust` (minus-one, or a technical-foul point) carries a signed delta
 * and a preserveServe flag that a fact row does not model. Rather than pretend the
 * round trip is lossless, say when it is not: verification against a match with a
 * hand correction in it compares what it can and reports the rest as unverifiable.
 */
export function isReconstructable(log: RallyLog): boolean {
  return !log.some((e) => e.t === 'adjust');
}

/** Field-by-field difference between two stat bags. Empty means they agree. */
export function diffStats(
  expected: Record<string, number>,
  actual: Record<string, number>,
): Array<{ metric: string; expected: number | undefined; actual: number | undefined }> {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const out: Array<{ metric: string; expected: number | undefined; actual: number | undefined }> = [];
  for (const k of [...keys].sort()) {
    const e = expected[k];
    const a = actual[k];
    // Absent and zero are the same claim - a metric nobody scored need not be stored.
    if ((e ?? 0) !== (a ?? 0)) out.push({ metric: k, expected: e, actual: a });
  }
  return out;
}

/**
 * Read a persisted rally log out of `fixtures.live_state`, tolerating anything
 * malformed. Shared so the console, the fact writer and the verifier all agree on
 * what a stored log looks like.
 */
export function readRallyLog(liveState: unknown): RallyLog {
  const raw = (liveState as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is RallyEvent => !!e && typeof e === 'object' && typeof (e as RallyEvent).t === 'string');
}

/** Who served the first point, as persisted. Defaults to the home side. */
export function readFirstServer(liveState: unknown): Side {
  return ((liveState as { firstServer?: unknown } | null)?.firstServer === 'B' ? 'B' : 'A');
}
