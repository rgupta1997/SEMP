import type { RallyEvent, RallyLog } from './rally-kernel.js';
import type { Side } from './scoring-rules.js';
import { statSpecFor, type SportStatSpec, type StatBag, type StatEventSpec } from './stat-registry.js';

// ============================================================================
// Team-sport statistics, derived from the attributed event log.
//
// WHY THIS EXISTS. `deriveRacquetStats` folds a rally log into per-player lines for
// the five racquet sports, and there was NO EQUIVALENT for the other twenty-one.
// So a football console recorded "goal, scored by Aarav, assisted by Kabir" into the
// log, the appearance row was written - and `stats` stayed `{}`, every column of
// `invasion_match_lines` stayed at its default zero, and Aarav's own match page said
// no statistics were recorded. The taps were being captured and then thrown away at
// the last step.
//
// THE REGISTRY ALREADY DESCRIBES THE MAPPING. Each sport's spec lists its loggable
// actions with the metrics they produce - `ev('goal', 'Goal', { goals: 1 }, {
// secondPlayer: 'assist', secondPlayerMetrics: { assists: 1 } })`. This file is the
// fold that applies it. Nothing sport-specific is hard-coded here, which is what
// makes adding a metric to the registry enough on its own.
//
// TWO PEOPLE PER EVENT, deliberately. A goal and its assist are one tap and one row,
// so the assist cannot be lost by nobody remembering to record it separately. The
// primary gets `metrics`, the second gets `secondPlayerMetrics`.
// ============================================================================

export interface TeamDerivedLine {
  userId: string;
  side: Side;
  stats: StatBag;
}

export interface TeamDerivedStats {
  /** Side-level totals - produced whether or not anybody was attributed. */
  sides: Record<Side, StatBag>;
  /** One line per person the log actually credits. */
  players: TeamDerivedLine[];
}

export interface TeamDeriveOpts {
  /** Who is on which side, so an event can be filed even when the tap omitted it. */
  sideOf?: Map<string, Side>;
  /** Minutes played, from the team sheet rather than the log. */
  minutes?: Map<string, number>;
  /**
   * The final scoreline, for the sports where the RESULT is the statistic.
   *
   * Seven of the twenty-seven record no per-player actions at all - chess, boxing,
   * judo, wrestling, taekwondo, arm wrestling, tug of war - and that is correct
   * rather than missing: there is nothing to attribute in a bout between two people
   * or a pull between two teams. But their typed tables have real columns
   * (`rounds_won`, `units_won`, `result_points_x2`) and without this they stayed
   * empty, so a boxer's own match page said nothing was recorded after a bout they
   * had just won 3-0.
   */
  result?: { home: number | null; away: number | null; winner: Side | null };
  /** Everybody who took part, so a result line can be written for each of them. */
  roster?: Array<{ userId: string; side: Side }>;
}

const bump = (bag: StatBag, key: string, by = 1) => {
  if (!by) return;
  bag[key] = (bag[key] ?? 0) + by;
};

/**
 * Record a value even when it is zero.
 *
 * `bump` skips zeros on purpose - an event that happened nought times did not
 * happen, and a bag full of zeroes is noise. A RESULT-derived figure is different:
 * "rounds lost 0" after a 3-0 is the information, and a chess loss really is worth
 * nought points. Dropping those made a clean win look like a missing record.
 */
const put = (bag: StatBag, key: string, value: number) => { bag[key] = value; };

/** The magnitude an event carries, for a metric declared as 'value'. */
const magnitudeOf = (ev: Extract<RallyEvent, { t: 'point' }>): number => {
  const v = ev.value ?? ev.pts;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
};

function applyMetrics(
  bag: StatBag,
  metrics: Record<string, number | 'value'>,
  ev: Extract<RallyEvent, { t: 'point' }>,
): void {
  for (const [key, amount] of Object.entries(metrics)) {
    bump(bag, key, amount === 'value' ? magnitudeOf(ev) : amount);
  }
}

/**
 * Fold an attributed event log into per-player statistics for a team sport.
 *
 * Returns empty rather than throwing for a sport with no spec, or a log with no
 * attribution - both are ordinary. A console that records a scoreline and no
 * individual actions produces side totals and no player lines, which is the truth.
 */
export function deriveTeamStats(
  sport: string | null | undefined,
  log: RallyLog,
  opts: TeamDeriveOpts = {},
): TeamDerivedStats {
  const spec = statSpecFor(sport);
  const out: TeamDerivedStats = { sides: { A: {}, B: {} }, players: [] };
  if (!spec) return out;

  const byKey = new Map<string, StatEventSpec>(spec.events.map((e) => [e.key, e]));
  const perPerson = new Map<string, StatBag>();
  const sideFound = new Map<string, Side>();
  const bagFor = (userId: string): StatBag => {
    const found = perPerson.get(userId);
    if (found) return found;
    const made: StatBag = {};
    perPerson.set(userId, made);
    return made;
  };

  for (const raw of log) {
    if (raw.t !== 'point') continue;
    const ev = raw as Extract<RallyEvent, { t: 'point' }>;

    // Side totals always. `pts` is the scoreboard magnitude - a 3-pointer is 3 -
    // and it is the one number a scoreline can be checked against.
    bump(out.sides[ev.side], 'points_scored', typeof ev.pts === 'number' ? ev.pts : 1);

    // An event with no declared action is a plain point on the scoreboard: it moves
    // the score and credits nobody, which is what an unattributed tap means.
    const declared = ev.kind ? byKey.get(ev.kind) : undefined;

    if (ev.playerId) {
      sideFound.set(ev.playerId, ev.side);
      const bag = bagFor(ev.playerId);
      if (declared) {
        applyMetrics(bag, declared.metrics, ev);
      } else {
        // No spec for this action, but somebody was named - so the scoreboard
        // contribution is still theirs. Dropping it would lose a basketball
        // console's points entirely just because the tap said 'fg2' and the
        // registry happened to call it something else.
        bump(bag, 'points_scored', typeof ev.pts === 'number' ? ev.pts : 1);
      }
    }

    if (ev.secondId && declared?.secondPlayerMetrics) {
      // The second person is on the SAME side as the primary - an assist comes from
      // a team-mate. Recorded from the event's side, not guessed.
      sideFound.set(ev.secondId, ev.side);
      applyMetrics(bagFor(ev.secondId), declared.secondPlayerMetrics, ev);
    }
  }

  // ---- the sports where the RESULT is the statistic --------------------------
  //
  // Applied only when the log credited nobody, so an event-recording sport is never
  // overwritten by a coarser reading of its scoreline. Derived from the score the
  // official actually entered - nothing here guesses.
  if (!perPerson.size && opts.result && opts.roster?.length) {
    const { home, away, winner } = opts.result;
    if (home != null && away != null) {
      for (const { userId, side } of opts.roster) {
        const mine = side === 'A' ? home : away;
        const theirs = side === 'A' ? away : home;
        const bag = bagFor(userId);
        sideFound.set(userId, side);

        if (spec.family === 'combat') {
          // A bout's scoreline IS rounds won and lost, and the appearance is one bout.
          put(bag, 'bouts', 1);
          put(bag, 'rounds_won', mine);
          put(bag, 'rounds_lost', theirs);
        } else if (spec.family === 'board') {
          // METRIC keys, not column names. `units_won` is the column; the metric is
          // `boards_won`, and the mapping in category-lines.ts folds carrom boards
          // and snooker frames into that one pair. Emitting the column name here
          // meant the value arrived unmapped and was dropped.
          put(bag, 'boards_won', mine);
          put(bag, 'boards_lost', theirs);
          // Chess reports a result as a POINT, and a draw is half of one. Doubled so
          // the half stays an integer: 2 win, 1 draw, 0 loss - which is exactly how a
          // chess tournament table is built.
          if (spec.sport === 'chess') {
            const won = winner ? (winner === side) : mine > theirs;
            const drawn = !winner && mine === theirs;
            put(bag, 'result_points_x2', drawn ? 1 : won ? 2 : 0);
          }
        } else {
          // Every other family records actions; a bare scoreline is the side's, not
          // any one person's, so nothing individual is invented here.
          perPerson.delete(userId);
        }
      }
    }
  }

  for (const [userId, stats] of perPerson) {
    const mins = opts.minutes?.get(userId);
    if (typeof mins === 'number' && mins > 0) stats.minutes = mins;
    out.players.push({
      userId,
      side: opts.sideOf?.get(userId) ?? sideFound.get(userId) ?? 'A',
      stats,
    });
  }
  return out;
}

/**
 * Does this sport's console attribute events to people at all?
 *
 * Used to decide whether an empty stat line means "nobody recorded anything" or
 * "this sport does not work that way" - two different things to tell a player.
 */
export function attributesEvents(sport: string | null | undefined): boolean {
  const spec: SportStatSpec | undefined = statSpecFor(sport);
  return !!spec && spec.events.length > 0;
}
