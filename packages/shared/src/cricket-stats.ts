import type { Dismissal } from './cricket-rules.js';
import type { BattingLine, BowlingLine, CricketSide, CricketState, InningsState } from './cricket-engine.js';

// ============================================================================
// Cricket's scorecard, derived from the ball log.
//
// THE GRAIN IS PER INNINGS, not per match. A person bats in innings 2 and bowls in
// innings 1; in a Test they do both twice. Flattening that to one row per match
// would make "best bowling in an innings" - one of the two figures cricket cares
// most about - unanswerable, because two spells would already be summed together.
//
// THREE TABLES, because one ball credits three people in three directions: the
// batter is dismissed, the bowler takes the wicket, the fielder takes the catch.
// A single row per person per innings with every column on it would be mostly null
// for every specialist, and worse, would have no place to put the fact that A was
// caught by B off C.
//
// Everything here is a projection of the fold. Nothing is counted twice and nothing
// is stored that could be recomputed - which is what makes re-verification possible:
// re-derive from the log and compare.
// ============================================================================

export interface BattingRow {
  userId: string;
  innings: number;
  batPosition: number;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  /** 'did_not_bat' and 'not_out' are outcomes, not absences. A duck is not a DNB. */
  dismissal: Dismissal | 'not_out' | 'did_not_bat';
  bowlerId: string | null;
  fielderId: string | null;
}

export interface BowlingRow {
  userId: string;
  innings: number;
  /** BALLS. "3.4 overs" is a display format, not a number that can be added. */
  ballsBowled: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  wides: number;
  noBalls: number;
  dots: number;
}

export interface FieldingRow {
  userId: string;
  innings: number;
  catches: number;
  stumpings: number;
  runOuts: number;
  /** Not derivable from a ball log - a drop is a non-event. Captured or zero. */
  drops: number;
}

export interface InningsRow {
  innings: number;
  battingSide: CricketSide;
  runs: number;
  wickets: number;
  balls: number;
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penaltyRuns: number;
  endedBy: string | null;
  target: number | null;
}

export interface CricketScorecard {
  batting: BattingRow[];
  bowling: BowlingRow[];
  fielding: FieldingRow[];
  innings: InningsRow[];
  /** Who batted, bowled or fielded at all - the appearance set for the spine rows. */
  appeared: Set<string>;
  /** Which side each person was on, so an outcome can be filed against them. */
  sideOf: Map<string, CricketSide>;
}

const other = (s: CricketSide): CricketSide => (s === 'A' ? 'B' : 'A');

const battingRow = (line: BattingLine, innings: number): BattingRow => ({
  userId: line.playerId,
  innings,
  batPosition: line.position,
  runs: line.runs,
  ballsFaced: line.ballsFaced,
  fours: line.fours,
  sixes: line.sixes,
  dismissal: line.out ? line.dismissal : 'not_out',
  bowlerId: line.bowlerId ?? null,
  fielderId: line.fielderId ?? null,
});

const bowlingRow = (line: BowlingLine, innings: number): BowlingRow => ({
  userId: line.playerId,
  innings,
  ballsBowled: line.ballsBowled,
  maidens: line.maidens,
  runsConceded: line.runsConceded,
  wickets: line.wickets,
  wides: line.wides,
  noBalls: line.noBalls,
  dots: line.dots,
});

/**
 * Fielding is read off the BATTING lines, not counted separately.
 *
 * Every catch, stumping and run-out is already recorded as the dismissal of some
 * batter, with the fielder named. Counting them again from the log would be a second
 * tally that could disagree with the first - so the dismissals ARE the fielding
 * figures, and a scorecard's two halves cannot drift apart.
 */
function fieldingFor(inn: InningsState): FieldingRow[] {
  const by = new Map<string, FieldingRow>();
  const at = (userId: string): FieldingRow => {
    const found = by.get(userId);
    if (found) return found;
    const made: FieldingRow = { userId, innings: inn.innings, catches: 0, stumpings: 0, runOuts: 0, drops: 0 };
    by.set(userId, made);
    return made;
  };
  for (const b of inn.batting) {
    if (!b.out || !b.fielderId) continue;
    const row = at(b.fielderId);
    // A caught-and-bowled is the bowler's catch and counts as one.
    if (b.dismissal === 'caught' || b.dismissal === 'caught_and_bowled') row.catches += 1;
    else if (b.dismissal === 'stumped') row.stumpings += 1;
    else if (b.dismissal === 'run_out') row.runOuts += 1;
  }
  return [...by.values()];
}

/**
 * Everything the three tables need, from the folded state.
 *
 * `dnb` names the people on the team sheet who never came to the crease. They get a
 * row saying 'did_not_bat' rather than no row at all, because a career page has to
 * tell "batted and made nothing" from "never batted": the first belongs in an
 * average, the second does not.
 */
export function cricketScorecard(
  state: CricketState,
  squads?: { A: string[]; B: string[] },
): CricketScorecard {
  const batting: BattingRow[] = [];
  const bowling: BowlingRow[] = [];
  const fielding: FieldingRow[] = [];
  const innings: InningsRow[] = [];
  const appeared = new Set<string>();
  const sideOf = new Map<string, CricketSide>();

  for (const inn of state.innings) {
    const bowlingSide = other(inn.battingSide);

    for (const line of inn.batting) {
      batting.push(battingRow(line, inn.innings));
      appeared.add(line.playerId);
      sideOf.set(line.playerId, inn.battingSide);
    }
    for (const line of inn.bowling) {
      bowling.push(bowlingRow(line, inn.innings));
      appeared.add(line.playerId);
      sideOf.set(line.playerId, bowlingSide);
    }
    for (const row of fieldingFor(inn)) {
      fielding.push(row);
      appeared.add(row.userId);
      if (!sideOf.has(row.userId)) sideOf.set(row.userId, bowlingSide);
    }

    // Anybody on the batting squad who never faced a ball, in batting order.
    const squad = squads?.[inn.battingSide];
    if (squad) {
      const came = new Set(inn.batting.map((b) => b.playerId));
      let position = inn.batting.length;
      for (const userId of squad) {
        if (came.has(userId)) continue;
        position += 1;
        batting.push({
          userId, innings: inn.innings, batPosition: position,
          runs: 0, ballsFaced: 0, fours: 0, sixes: 0,
          dismissal: 'did_not_bat', bowlerId: null, fielderId: null,
        });
        appeared.add(userId);
        if (!sideOf.has(userId)) sideOf.set(userId, inn.battingSide);
      }
    }

    innings.push({
      innings: inn.innings,
      battingSide: inn.battingSide,
      runs: inn.runs,
      wickets: inn.wickets,
      balls: inn.balls,
      wides: inn.wides,
      noBalls: inn.noBalls,
      byes: inn.byes,
      legByes: inn.legByes,
      penaltyRuns: inn.penaltyRuns,
      endedBy: inn.endedBy ?? null,
      target: inn.target ?? null,
    });
  }

  return { batting, bowling, fielding, innings, appeared, sideOf };
}

// ============================================================================
// The career fold
// ============================================================================

export interface CricketCareer {
  matches: number;
  inningsBatted: number;
  runs: number;
  ballsFaced: number;
  /**
   * NOT OUTS, kept separately, because the batting average is
   * runs / (innings - notOuts) and not runs / innings. Every cricket average in the
   * world uses the first; using the second understates a finisher badly.
   */
  notOuts: number;
  highScore: number;
  /** True when the highest score was unbeaten, which a scorecard prints as "84*". */
  highScoreNotOut: boolean;
  fifties: number;
  hundreds: number;
  ducks: number;
  fours: number;
  sixes: number;
  battingAverage: number | null;
  strikeRate: number | null;

  inningsBowled: number;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
  bestInningsWickets: number;
  bestInningsRuns: number;
  fiveWicketHauls: number;
  bowlingAverage: number | null;
  economy: number | null;

  catches: number;
  stumpings: number;
  runOuts: number;
}

const empty = (): CricketCareer => ({
  matches: 0, inningsBatted: 0, runs: 0, ballsFaced: 0, notOuts: 0,
  highScore: 0, highScoreNotOut: false, fifties: 0, hundreds: 0, ducks: 0,
  fours: 0, sixes: 0, battingAverage: null, strikeRate: null,
  inningsBowled: 0, ballsBowled: 0, runsConceded: 0, wickets: 0, maidens: 0,
  bestInningsWickets: 0, bestInningsRuns: 0, fiveWicketHauls: 0,
  bowlingAverage: null, economy: null,
  catches: 0, stumpings: 0, runOuts: 0,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fold one person's innings rows into a career record.
 *
 * `matches` is passed in rather than counted here: the rows are per innings, and a
 * Test appearance would otherwise count as two matches.
 */
export function foldCricketCareer(
  matches: number,
  batting: BattingRow[],
  bowling: BowlingRow[],
  fielding: FieldingRow[],
): CricketCareer {
  const c = empty();
  c.matches = matches;

  for (const b of batting) {
    // A DNB is not an innings. Counting it would drag every average down.
    if (b.dismissal === 'did_not_bat') continue;
    c.inningsBatted += 1;
    c.runs += b.runs;
    c.ballsFaced += b.ballsFaced;
    c.fours += b.fours;
    c.sixes += b.sixes;
    const out = b.dismissal !== 'not_out' && b.dismissal !== 'retired';
    if (!out) c.notOuts += 1;
    // A duck is out for nought. Not out for nought is not a duck.
    if (out && b.runs === 0) c.ducks += 1;
    if (b.runs >= 100) c.hundreds += 1;
    else if (b.runs >= 50) c.fifties += 1;
    if (b.runs > c.highScore) {
      c.highScore = b.runs;
      c.highScoreNotOut = !out;
    } else if (b.runs === c.highScore && !out) {
      // 84* betters 84 when the scores are level, which is how cricket ranks them.
      c.highScoreNotOut = true;
    }
  }

  for (const b of bowling) {
    if (b.ballsBowled === 0 && b.wickets === 0) continue;
    c.inningsBowled += 1;
    c.ballsBowled += b.ballsBowled;
    c.runsConceded += b.runsConceded;
    c.wickets += b.wickets;
    c.maidens += b.maidens;
    if (b.wickets >= 5) c.fiveWicketHauls += 1;
    // Best bowling is 5/23 over 5/40 and 5/40 over 4/10: wickets first, then the
    // fewer runs. A single "best" number cannot express that, so both are kept.
    const better = b.wickets > c.bestInningsWickets
      || (b.wickets === c.bestInningsWickets && b.wickets > 0 && b.runsConceded < c.bestInningsRuns);
    if (better) {
      c.bestInningsWickets = b.wickets;
      c.bestInningsRuns = b.runsConceded;
    }
  }

  for (const f of fielding) {
    c.catches += f.catches;
    c.stumpings += f.stumpings;
    c.runOuts += f.runOuts;
  }

  const dismissals = c.inningsBatted - c.notOuts;
  c.battingAverage = dismissals > 0 ? round2(c.runs / dismissals) : null;
  c.strikeRate = c.ballsFaced > 0 ? round2((c.runs / c.ballsFaced) * 100) : null;
  c.bowlingAverage = c.wickets > 0 ? round2(c.runsConceded / c.wickets) : null;
  c.economy = c.ballsBowled > 0 ? round2(c.runsConceded / (c.ballsBowled / 6)) : null;
  return c;
}

/** "84*" / "17" - how a high score is printed. */
export function highScoreLine(c: CricketCareer): string {
  if (c.inningsBatted === 0) return '—';
  return `${c.highScore}${c.highScoreNotOut ? '*' : ''}`;
}

/** "5/23" - how best bowling is printed. */
export function bestBowlingLine(c: CricketCareer): string {
  if (c.inningsBowled === 0) return '—';
  return `${c.bestInningsWickets}/${c.bestInningsRuns}`;
}

// ============================================================================
// The career record, as a stat bag
//
// `career_stats.stats` is a flat Record<string, number>, which is what every other
// sport's career fold produces and what the profile screen renders. Cricket has no
// entry in the stat registry - its figures come from three typed tables rather than
// from an attributed event log - so it needs its own translation into that shape,
// and its own metric descriptors to be rendered by the same generic screen.
//
// The DERIVED figures are the point. Runs and wickets are sums anybody could add up;
// batting average, strike rate, economy and best bowling are the numbers a cricketer
// actually quotes, and every one of them is wrong if computed from summed averages
// rather than from the underlying totals. They are recomputed here from the whole
// career, never averaged from per-match averages.
// ============================================================================

export interface CricketMetricSpec {
  key: string;
  label: string;
  short: string;
  /** Shown on the summary row rather than only in the full table. */
  headline?: boolean;
  /** false for runs conceded and ducks - drives sort direction and colour. */
  higherIsBetter?: boolean;
  /** Rendered to one decimal place rather than as a whole number. */
  decimal?: boolean;
}

/**
 * The order a scorecard reads in: batting, then bowling, then fielding.
 *
 * Ordered deliberately rather than alphabetically - a cricketer looks for runs and
 * average first, and putting `balls_faced` above `runs` because b sorts before r
 * would be a small daily annoyance for everybody.
 */
export const CRICKET_CAREER_METRICS: CricketMetricSpec[] = [
  // ---- batting
  { key: 'innings_batted', label: 'Innings batted', short: 'Inn' },
  { key: 'runs', label: 'Runs', short: 'R', headline: true },
  { key: 'batting_average', label: 'Batting average', short: 'Avg', headline: true, decimal: true },
  { key: 'strike_rate', label: 'Strike rate', short: 'SR', headline: true, decimal: true },
  { key: 'high_score', label: 'High score', short: 'HS', headline: true },
  { key: 'balls_faced', label: 'Balls faced', short: 'BF' },
  { key: 'not_outs', label: 'Not outs', short: 'NO' },
  { key: 'hundreds', label: 'Hundreds', short: '100s', headline: true },
  { key: 'fifties', label: 'Fifties', short: '50s' },
  { key: 'fours', label: 'Fours', short: '4s' },
  { key: 'sixes', label: 'Sixes', short: '6s' },
  { key: 'ducks', label: 'Ducks', short: '0s', higherIsBetter: false },
  // ---- bowling
  { key: 'innings_bowled', label: 'Innings bowled', short: 'Inn' },
  { key: 'overs_bowled', label: 'Overs bowled', short: 'O', decimal: true },
  { key: 'wickets', label: 'Wickets', short: 'W', headline: true },
  { key: 'bowling_average', label: 'Bowling average', short: 'Avg', higherIsBetter: false, decimal: true },
  { key: 'economy', label: 'Economy', short: 'Econ', higherIsBetter: false, decimal: true },
  { key: 'runs_conceded', label: 'Runs conceded', short: 'R', higherIsBetter: false },
  { key: 'maidens', label: 'Maidens', short: 'M' },
  { key: 'five_wicket_hauls', label: 'Five-wicket hauls', short: '5w' },
  { key: 'best_bowling_wickets', label: 'Best bowling (wickets)', short: 'BBw' },
  { key: 'best_bowling_runs', label: 'Best bowling (runs)', short: 'BBr', higherIsBetter: false },
  // ---- fielding
  { key: 'catches', label: 'Catches', short: 'Ct' },
  { key: 'stumpings', label: 'Stumpings', short: 'St' },
  { key: 'run_outs', label: 'Run-outs', short: 'RO' },
];

/**
 * A career fold flattened into the bag shape `career_stats.stats` holds.
 *
 * `high_score_not_out` is a 1/0 rather than a boolean because the column is a
 * Record<string, number> - and it is kept because 84* and 84 are different figures,
 * and a reader who cannot tell them apart has been given the wrong number.
 */
export function cricketCareerBag(c: CricketCareer): Record<string, number> {
  const bag: Record<string, number> = {
    innings_batted: c.inningsBatted,
    runs: c.runs,
    balls_faced: c.ballsFaced,
    not_outs: c.notOuts,
    high_score: c.highScore,
    high_score_not_out: c.highScoreNotOut ? 1 : 0,
    hundreds: c.hundreds,
    fifties: c.fifties,
    ducks: c.ducks,
    fours: c.fours,
    sixes: c.sixes,
    innings_bowled: c.inningsBowled,
    balls_bowled: c.ballsBowled,
    // Overs as a DECIMAL of whole overs for display only - the balls stay above it,
    // because 3.4 + 3.4 is 7.2 overs and no arithmetic may ever be done on this.
    overs_bowled: Math.round((c.ballsBowled / 6) * 10) / 10,
    runs_conceded: c.runsConceded,
    wickets: c.wickets,
    maidens: c.maidens,
    five_wicket_hauls: c.fiveWicketHauls,
    best_bowling_wickets: c.bestInningsWickets,
    best_bowling_runs: c.bestInningsRuns,
    catches: c.catches,
    stumpings: c.stumpings,
    run_outs: c.runOuts,
  };
  // Null means unanswerable, not zero - a batter never dismissed has no average, and
  // writing 0 would read as "terrible" rather than "not yet applicable".
  if (c.battingAverage != null) bag.batting_average = c.battingAverage;
  if (c.strikeRate != null) bag.strike_rate = c.strikeRate;
  if (c.bowlingAverage != null) bag.bowling_average = c.bowlingAverage;
  if (c.economy != null) bag.economy = c.economy;
  return bag;
}
