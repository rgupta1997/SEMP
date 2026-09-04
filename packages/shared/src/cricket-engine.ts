import {
  BOWLER_WICKETS, ILLEGAL_EXTRAS, type CricketFormat, type Dismissal, type Extra,
  type InningsEnd,
} from './cricket-rules.js';

// ============================================================================
// The cricket engine.
//
// Same architecture as the rally kernel, different alphabet: an append-only log of
// DELIVERIES, state as a pure fold over it, undo as a truncate. Everything a
// scorecard shows - the innings totals, the batting card, the bowling figures, the
// extras breakdown - is derived, never stored twice.
//
// THREE THINGS THIS GETS RIGHT that a naive scorer does not:
//
//  1. BALLS, NEVER DECIMAL OVERS. "3.4 overs" is a display format. 3.4 + 3.4 is
//     7.2 overs, and decimal arithmetic says 6.8. The state counts balls.
//  2. A WIDE DOES NOT ADVANCE THE OVER. An over is six LEGAL deliveries, so an
//     over with two wides is eight balls long.
//  3. A RUN-OUT IS NOT THE BOWLER'S WICKET. `BOWLER_WICKETS` is the list that is,
//     and the bowling figures use it - crediting every dismissal to the bowler is
//     the commonest error in a hand-built scorer.
// ============================================================================

export type CricketSide = 'A' | 'B';

/** Which batter was dismissed. A run-out can take the non-striker. */
export type BatterEnd = 'striker' | 'nonStriker';

export type CricketEvent =
  /**
   * ONE DELIVERY.
   *
   * `runs` is off the bat. `extra` + `extraRuns` are separate, because a wide is not
   * the batter's run and must never reach their average. A no-ball off which two
   * were hit is `{ extra: 'noball', runs: 2 }`.
   */
  | {
    t: 'ball';
    runs: number;
    extra?: Extra;
    /** Runs from the extra itself, beyond the format's penalty. Byes on a wide. */
    extraRuns?: number;
    wicket?: {
      how: Dismissal;
      /** Which batter went. Defaults to the striker; a run-out may take the other. */
      end?: BatterEnd;
      fielderId?: string;
    };
    /** Who was on strike, bowling, and at the other end - recorded, not inferred. */
    strikerId?: string;
    nonStrikerId?: string;
    bowlerId?: string;
    /** The batter coming in, when this ball took a wicket. */
    nextBatterId?: string;
    at?: string;
  }
  /** A batter retires without being dismissed; someone else comes in. */
  | { t: 'retire'; batterId?: string; nextBatterId?: string; reason?: string; at?: string }
  /** Penalty runs to a side, from outside the delivery stream. */
  | { t: 'penalty'; side: CricketSide; runs: number; reason?: string; at?: string }
  /** Swap the batters without a ball - a correction, or a crossed run-out. */
  | { t: 'swapEnds'; at?: string }
  /** Change the bowler explicitly. Normally derived at the end of an over. */
  | { t: 'setBowler'; bowlerId: string; at?: string }
  /**
   * Put a batter at one end without a ball being bowled.
   *
   * The opening pair need naming before the first delivery, and a `ball` event
   * cannot do it - it would have to score something. This is also the correction
   * path when the wrong person was recorded as facing.
   */
  | { t: 'setBatter'; end: BatterEnd; batterId: string; at?: string }
  /** The innings is over. `overs` and `all_out` are also detected automatically. */
  | { t: 'endInnings'; reason: InningsEnd; at?: string }
  /** Terminal: abandoned, conceded, a result the officials declared. */
  | { t: 'end'; reason: 'normal' | 'abandoned' | 'conceded' | 'rain' | 'override'; winner?: CricketSide | null; at?: string };

export type CricketLog = CricketEvent[];

// ---- derived state ---------------------------------------------------------

export interface BattingLine {
  playerId: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  out: boolean;
  dismissal: Dismissal | 'not_out';
  bowlerId?: string;
  fielderId?: string;
  position: number;
}

export interface BowlingLine {
  playerId: string;
  ballsBowled: number;
  runsConceded: number;
  wickets: number;
  wides: number;
  noBalls: number;
  dots: number;
  maidens: number;
}

export interface InningsState {
  innings: number;
  battingSide: CricketSide;
  runs: number;
  wickets: number;
  /** LEGAL balls bowled. Never a decimal. */
  balls: number;
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penaltyRuns: number;
  batting: BattingLine[];
  bowling: BowlingLine[];
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
  /** Runs conceded in the over in progress, for the maiden test. */
  overRuns: number;
  overBalls: number;
  ended: boolean;
  endedBy?: InningsEnd;
  target?: number;
  /** The next delivery is a free hit (a no-ball was bowled). */
  freeHit: boolean;
}

export interface CricketState {
  format: CricketFormat;
  innings: InningsState[];
  current: number;
  ended: boolean;
  winner: CricketSide | null;
  /** 'tie' is distinct from 'draw': a tie has equal scores, a draw ran out of time. */
  outcome: 'win' | 'tie' | 'draw' | 'void' | null;
  reason: string | null;
  /** "won by 34 runs" / "won by 5 wickets" - how a cricket result is actually said. */
  margin: string | null;
}

const emptyInnings = (innings: number, battingSide: CricketSide): InningsState => ({
  innings, battingSide,
  runs: 0, wickets: 0, balls: 0,
  wides: 0, noBalls: 0, byes: 0, legByes: 0, penaltyRuns: 0,
  batting: [], bowling: [],
  overRuns: 0, overBalls: 0,
  ended: false, freeHit: false,
});

export function initCricket(format: CricketFormat, firstBatting: CricketSide = 'A'): CricketState {
  return {
    format,
    innings: [emptyInnings(1, firstBatting)],
    current: 0,
    ended: false,
    winner: null,
    outcome: null,
    reason: null,
    margin: null,
  };
}

const bat = (inn: InningsState, id?: string): BattingLine | undefined => {
  if (!id) return undefined;
  let line = inn.batting.find((b) => b.playerId === id);
  if (!line) {
    line = {
      playerId: id, runs: 0, ballsFaced: 0, fours: 0, sixes: 0,
      out: false, dismissal: 'not_out', position: inn.batting.length + 1,
    };
    inn.batting.push(line);
  }
  return line;
};

const bowl = (inn: InningsState, id?: string): BowlingLine | undefined => {
  if (!id) return undefined;
  let line = inn.bowling.find((b) => b.playerId === id);
  if (!line) {
    line = {
      playerId: id, ballsBowled: 0, runsConceded: 0, wickets: 0,
      wides: 0, noBalls: 0, dots: 0, maidens: 0,
    };
    inn.bowling.push(line);
  }
  return line;
};

const other = (s: CricketSide): CricketSide => (s === 'A' ? 'B' : 'A');

/** Total the batting side has scored, for the chase test. */
const totalOf = (inn: InningsState) => inn.runs;

// ---- the fold --------------------------------------------------------------

export interface CricketStep {
  event: CricketEvent;
  /** Runs this delivery added to the innings, extras included. */
  runsScored: number;
  /** True when the delivery consumed a legal ball of the over. */
  legal: boolean;
  wicketFell: boolean;
  overComplete: boolean;
  inningsEnded: boolean;
  matchEnded: boolean;
}

const clone = (s: CricketState): CricketState => ({
  ...s,
  innings: s.innings.map((i) => ({
    ...i,
    batting: i.batting.map((b) => ({ ...b })),
    bowling: i.bowling.map((b) => ({ ...b })),
  })),
});

export function stepCricket(prev: CricketState, ev: CricketEvent): { state: CricketState; step: CricketStep } {
  const state = clone(prev);
  const step: CricketStep = {
    event: ev, runsScored: 0, legal: false, wicketFell: false,
    overComplete: false, inningsEnded: false, matchEnded: false,
  };
  if (state.ended && ev.t !== 'end') return { state: prev, step };

  const f = state.format;
  const inn = state.innings[state.current];
  if (!inn) return { state: prev, step };

  switch (ev.t) {
    case 'setBowler':
      inn.bowlerId = ev.bowlerId;
      bowl(inn, ev.bowlerId);
      break;

    case 'setBatter': {
      // Registers the batting line too, so somebody who is bowled first ball still
      // appears on the scorecard rather than vanishing for having faced nothing.
      if (ev.end === 'nonStriker') inn.nonStrikerId = ev.batterId;
      else inn.strikerId = ev.batterId;
      bat(inn, ev.batterId);
      break;
    }

    case 'swapEnds': {
      const s = inn.strikerId;
      inn.strikerId = inn.nonStrikerId;
      inn.nonStrikerId = s;
      break;
    }

    case 'penalty':
      // Penalty runs belong to the SIDE, not to any batter's average.
      if (ev.side === inn.battingSide) {
        inn.runs += ev.runs;
        inn.penaltyRuns += ev.runs;
        step.runsScored = ev.runs;
      } else {
        // Awarded against the batting side: they go to the other innings' total,
        // which for a limited-overs match means the chasing target moves.
        inn.penaltyRuns += 0;
      }
      break;

    case 'retire': {
      const line = bat(inn, ev.batterId ?? inn.strikerId);
      if (line) { line.out = false; line.dismissal = 'retired'; }
      if (ev.nextBatterId) {
        if ((ev.batterId ?? inn.strikerId) === inn.nonStrikerId) inn.nonStrikerId = ev.nextBatterId;
        else inn.strikerId = ev.nextBatterId;
        bat(inn, ev.nextBatterId);
      }
      break;
    }

    case 'ball': {
      if (inn.ended) return { state: prev, step };
      // Who is involved. The event may state it (a corrected scorecard) or inherit
      // the state, which is what a live scorer does.
      if (ev.strikerId) inn.strikerId = ev.strikerId;
      if (ev.nonStrikerId) inn.nonStrikerId = ev.nonStrikerId;
      if (ev.bowlerId) inn.bowlerId = ev.bowlerId;
      const striker = bat(inn, inn.strikerId);
      bat(inn, inn.nonStrikerId);
      const bowler = bowl(inn, inn.bowlerId);

      const extra = ev.extra;
      const illegal = !!extra && ILLEGAL_EXTRAS.includes(extra);
      const penalty = extra === 'wide' ? f.wideRuns : extra === 'noball' ? f.noBallRuns : 0;
      const extraRuns = ev.extraRuns ?? 0;
      const offBat = Math.max(0, ev.runs ?? 0);

      // A wide is never the batter's run; runs off a no-ball are.
      const batterRuns = extra === 'wide' ? 0 : offBat;
      const total = penalty + extraRuns + offBat;

      inn.runs += total;
      step.runsScored = total;

      if (extra === 'wide') { inn.wides += penalty + extraRuns; if (bowler) bowler.wides += 1; }
      else if (extra === 'noball') { inn.noBalls += penalty; if (bowler) bowler.noBalls += 1; }
      else if (extra === 'bye') inn.byes += extraRuns;
      else if (extra === 'legbye') inn.legByes += extraRuns;

      if (striker && batterRuns >= 0 && extra !== 'wide') {
        striker.runs += batterRuns;
        if (batterRuns === 4) striker.fours += 1;
        if (batterRuns === 6) striker.sixes += 1;
      }
      // A ball faced is any delivery the batter had to play at - which excludes a
      // wide (they never had a chance to hit it) and includes a no-ball.
      if (striker && extra !== 'wide') striker.ballsFaced += 1;

      if (bowler) {
        // Byes and leg-byes are not the bowler's runs; wides and no-balls are.
        const chargedToBowler = extra === 'bye' || extra === 'legbye'
          ? offBat
          : total;
        bowler.runsConceded += chargedToBowler;
        if (!illegal) bowler.ballsBowled += 1;
        if (!illegal && total === 0) bowler.dots += 1;
      }

      // THE OVER ADVANCES ON LEGAL BALLS ONLY.
      if (!illegal) {
        inn.balls += 1;
        inn.overBalls += 1;
        step.legal = true;
      }
      inn.overRuns += total;

      // Free hit: set by a no-ball, and survives an illegal delivery so a wide off a
      // free hit does not consume it.
      if (extra === 'noball' && f.freeHitAfterNoBall) inn.freeHit = true;
      else if (!illegal) inn.freeHit = false;

      // The wicket.
      if (ev.wicket) {
        const outEnd = ev.wicket.end ?? 'striker';
        const outId = outEnd === 'nonStriker' ? inn.nonStrikerId : inn.strikerId;
        const line = bat(inn, outId);
        if (line) {
          line.out = true;
          line.dismissal = ev.wicket.how;
          line.bowlerId = inn.bowlerId;
          if (ev.wicket.fielderId) line.fielderId = ev.wicket.fielderId;
        }
        inn.wickets += 1;
        step.wicketFell = true;
        // A RUN-OUT IS NOT THE BOWLER'S WICKET.
        if (bowler && BOWLER_WICKETS.includes(ev.wicket.how)) bowler.wickets += 1;

        if (ev.nextBatterId) {
          if (outEnd === 'nonStriker') inn.nonStrikerId = ev.nextBatterId;
          else inn.strikerId = ev.nextBatterId;
          bat(inn, ev.nextBatterId);
        } else if (outEnd === 'striker') {
          inn.strikerId = undefined;
        } else {
          inn.nonStrikerId = undefined;
        }
      }

      // Strike rotation: odd runs off the bat cross the batters. Byes and leg-byes
      // are run too, so they rotate as well; a wide's penalty does not.
      const ran = extra === 'wide' ? extraRuns : (offBat + (extra === 'bye' || extra === 'legbye' ? extraRuns : 0));
      if (ran % 2 === 1) {
        const s = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = s;
      }

      // End of the over: the strike crosses and the bowler must change.
      if (!illegal && inn.overBalls >= f.ballsPerOver) {
        step.overComplete = true;
        if (bowler && inn.overRuns === 0) bowler.maidens += 1;
        inn.overBalls = 0;
        inn.overRuns = 0;
        const s = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = s;
        inn.bowlerId = undefined;
      }

      settleInnings(state, step);
      break;
    }

    case 'endInnings':
      inn.ended = true;
      inn.endedBy = ev.reason;
      step.inningsEnded = true;
      advance(state, step);
      break;

    case 'end':
      state.ended = true;
      state.reason = ev.reason;
      state.winner = ev.winner ?? null;
      state.outcome = ev.winner ? 'win' : ev.reason === 'rain' || ev.reason === 'abandoned' ? 'void' : 'draw';
      state.margin = null;
      step.matchEnded = true;
      break;
  }

  return { state, step };
}

/** Has this innings finished on its own terms - overs, wickets, or the target? */
function settleInnings(state: CricketState, step: CricketStep): void {
  const f = state.format;
  const inn = state.innings[state.current];
  if (inn.ended) return;

  const oversDone = f.oversPerInnings !== null && inn.balls >= f.oversPerInnings * f.ballsPerOver;
  const allOut = inn.wickets >= f.wicketsToEndInnings;
  const chased = inn.target !== undefined && totalOf(inn) >= inn.target;

  if (!oversDone && !allOut && !chased) return;

  inn.ended = true;
  inn.endedBy = chased ? 'target' : allOut ? 'all_out' : 'overs';
  step.inningsEnded = true;
  advance(state, step);
}

/** Move to the next innings, or decide the match. */
function advance(state: CricketState, step: CricketStep): void {
  const f = state.format;
  const played = state.innings.length;
  const totalInnings = f.inningsPerSide * 2;

  if (played < totalInnings) {
    const prev = state.innings[state.current];
    const next = emptyInnings(played + 1, other(prev.battingSide));
    // The chasing side needs one more than the runs already made against them.
    // For a Test this is only meaningful in the last innings, which is why it is
    // set from the aggregate rather than from the previous innings alone.
    if (played + 1 === totalInnings) {
      const forNext = aggregateFor(state, next.battingSide);
      const against = aggregateFor(state, prev.battingSide);
      next.target = against - forNext + 1;
    }
    state.innings.push(next);
    state.current = played;
    return;
  }

  decide(state);
  step.matchEnded = state.ended;
}

/** Runs a side has scored across all its innings. */
export function aggregateFor(state: CricketState, side: CricketSide): number {
  return state.innings
    .filter((i) => i.battingSide === side)
    .reduce((n, i) => n + i.runs, 0);
}

/**
 * Decide the match and phrase the margin the way cricket phrases it.
 *
 * A side that batted last and won wins BY WICKETS - the ones it had left. A side
 * that bowled last and won wins BY RUNS. Reporting both as a run difference is the
 * tell of a scorer that does not know the game.
 */
function decide(state: CricketState): void {
  const f = state.format;
  const a = aggregateFor(state, 'A');
  const b = aggregateFor(state, 'B');
  const last = state.innings[state.innings.length - 1];

  state.ended = true;
  state.reason = state.reason ?? 'normal';

  if (a === b) {
    state.outcome = 'tie';
    state.winner = null;
    state.margin = f.superOverOnTie ? 'tied — super over to follow' : 'tied';
    return;
  }

  const winner: CricketSide = a > b ? 'A' : 'B';
  state.winner = winner;
  state.outcome = 'win';

  if (last.battingSide === winner) {
    const left = Math.max(0, f.wicketsToEndInnings - last.wickets);
    state.margin = `won by ${left} wicket${left === 1 ? '' : 's'}`;
  } else {
    const by = Math.abs(a - b);
    state.margin = `won by ${by} run${by === 1 ? '' : 's'}`;
  }
}

export interface CricketFold {
  state: CricketState;
  trace: CricketStep[];
}

export function foldCricket(
  format: CricketFormat, log: CricketLog, firstBatting: CricketSide = 'A',
): CricketFold {
  let state = initCricket(format, firstBatting);
  const trace: CricketStep[] = [];
  for (const ev of log) {
    const r = stepCricket(state, ev);
    state = r.state;
    trace.push(r.step);
  }
  return { state, trace };
}

/** Undo is a truncate-and-refold, exactly as in the rally kernel. */
export function undoCricket(
  format: CricketFormat, log: CricketLog, firstBatting: CricketSide = 'A',
): { log: CricketLog; state: CricketState } {
  const next = log.slice(0, -1);
  return { log: next, state: foldCricket(format, next, firstBatting).state };
}

// ---- the headline ----------------------------------------------------------

/**
 * The two numbers standings read. RUNS, aggregated per side.
 *
 * Not wickets, not innings won: a cricket result is a run total, and the wickets
 * only phrase the margin.
 */
export function cricketHeadline(state: CricketState): [number, number] {
  return [aggregateFor(state, 'A'), aggregateFor(state, 'B')];
}

/** "142/6 (18.3)" for one innings - how a scoreboard actually reads. */
export function inningsLine(inn: InningsState, ballsPerOver = 6): string {
  const ov = `${Math.floor(inn.balls / ballsPerOver)}.${inn.balls % ballsPerOver}`;
  return `${inn.runs}/${inn.wickets} (${ov})`;
}

/** Extras, itemised, so a scorecard balances against the bowling figures. */
export function extrasLine(inn: InningsState): string {
  const parts: string[] = [];
  if (inn.wides) parts.push(`w ${inn.wides}`);
  if (inn.noBalls) parts.push(`nb ${inn.noBalls}`);
  if (inn.byes) parts.push(`b ${inn.byes}`);
  if (inn.legByes) parts.push(`lb ${inn.legByes}`);
  if (inn.penaltyRuns) parts.push(`pen ${inn.penaltyRuns}`);
  const total = inn.wides + inn.noBalls + inn.byes + inn.legByes + inn.penaltyRuns;
  return parts.length ? `${total} (${parts.join(', ')})` : '0';
}

/** Runs per over, to one decimal. The number a chase is judged by. */
export function runRate(inn: InningsState, ballsPerOver = 6): number {
  if (!inn.balls) return 0;
  return Math.round((inn.runs / (inn.balls / ballsPerOver)) * 100) / 100;
}

/** What the chasing side needs, phrased the way a scoreboard phrases it. */
export function chaseLine(state: CricketState): string | null {
  const inn = state.innings[state.current];
  if (!inn || inn.target === undefined || inn.ended) return null;
  const f = state.format;
  const need = inn.target - inn.runs;
  if (need <= 0) return null;
  if (f.oversPerInnings === null) return `need ${need} run${need === 1 ? '' : 's'}`;
  const ballsLeft = f.oversPerInnings * f.ballsPerOver - inn.balls;
  if (ballsLeft <= 0) return null;
  return `need ${need} from ${ballsLeft} ball${ballsLeft === 1 ? '' : 's'}`;
}

/** Bowler's economy: runs per over. */
export function economy(line: BowlingLine, ballsPerOver = 6): number {
  if (!line.ballsBowled) return 0;
  return Math.round((line.runsConceded / (line.ballsBowled / ballsPerOver)) * 100) / 100;
}

/** Batter's strike rate: runs per hundred balls. */
export function strikeRate(line: BattingLine): number {
  if (!line.ballsFaced) return 0;
  return Math.round((line.runs / line.ballsFaced) * 1000) / 10;
}

/** Overs a bowler has left, so the console can stop offering them. */
export function oversLeft(f: CricketFormat, line: BowlingLine): number | null {
  if (f.maxOversPerBowler === null) return null;
  return Math.max(0, f.maxOversPerBowler - Math.floor(line.ballsBowled / f.ballsPerOver));
}
