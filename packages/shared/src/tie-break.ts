import type { RallyEvent, RallyLog, KernelState } from './rally-kernel.js';
import type { ScoringFormat, Side, TieBreakSpec } from './scoring-rules.js';

/**
 * SETTLING A LEVEL KNOCKOUT.
 *
 * The kernel stops short on purpose: a level aggregate with no draw allowed leaves
 * the match open rather than inventing a winner. This module is what happens next,
 * in football's order - extra time, then a shoot-out - and it is pure so the rules
 * can be tested without a browser.
 *
 * The phases:
 *
 *   regulation   the periods the format declares
 *   extraTime    further periods, each the tie-break's own length
 *   penalties    kicks, which do NOT move the scoreline
 *   done         somebody has won, or the match is drawable and drawn
 */
export type TiePhase = 'regulation' | 'extraTime' | 'penalties' | 'done';

export interface TieProgress {
  phase: TiePhase;
  /** Periods of extra time already finished. */
  extraPlayed: number;
  /** Periods of extra time the format asks for. 0 when it declares none. */
  extraTotal: number;
  /** How long the period now in progress runs, in ms - regulation or extra time. */
  periodMs: number;
  /** True when the scores are level and regulation is complete. */
  levelAfterRegulation: boolean;
}

const PERIOD_LEVEL = 0;

/** Periods finished, counting extra time as well as regulation. */
function periodsFinished(state: KernelState): number {
  return state.finished.filter((u) => u.level === PERIOD_LEVEL).length;
}

/**
 * Where the match has got to.
 *
 * Extra time is just MORE PERIODS - the kernel re-decides on the aggregate every
 * time one ends, and leaves the match open while the total is level, so no kernel
 * change was needed to play them. What the console needs from here is which phase
 * it is in and how long the current period runs.
 */
export function tieProgress(
  format: ScoringFormat,
  state: KernelState,
  score: readonly [number, number],
): TieProgress {
  const tb: TieBreakSpec | null | undefined = format.tieBreak;
  const regulation = format.levels[format.levels.length - 1]?.target ?? 1;
  const extraTotal = tb?.extraTime?.periods ?? 0;
  const regulationMs = ((format.clock?.minutes ?? 0) * 60_000) / Math.max(1, regulation);
  const extraMs = (tb?.extraTime?.minutes ?? 0) * 60_000;

  const finished = periodsFinished(state);
  const extraPlayed = Math.max(0, finished - regulation);
  const level = score[0] === score[1];
  const levelAfterRegulation = level && finished >= regulation;

  if (state.ended) {
    return { phase: 'done', extraPlayed, extraTotal, periodMs: regulationMs, levelAfterRegulation };
  }

  // Still inside the declared periods: ordinary play, whatever the score is.
  if (finished < regulation) {
    return { phase: 'regulation', extraPlayed, extraTotal, periodMs: regulationMs, levelAfterRegulation };
  }

  // Regulation done and level. Extra time first, if the format declares any AND
  // there is any left to play.
  if (extraTotal > 0 && extraPlayed < extraTotal) {
    return { phase: 'extraTime', extraPlayed, extraTotal, periodMs: extraMs, levelAfterRegulation };
  }

  // Extra time exhausted (or never offered) and still level: kicks.
  if (tb?.penalties) {
    return { phase: 'penalties', extraPlayed, extraTotal, periodMs: extraMs, levelAfterRegulation };
  }

  // Nothing declared to settle it - the match stays open for an organiser, which is
  // the behaviour that existed before any of this.
  return { phase: 'regulation', extraPlayed, extraTotal, periodMs: regulationMs, levelAfterRegulation };
}

// ---- the shoot-out ---------------------------------------------------------

export interface ShootoutState {
  kicks: Array<{ side: Side; scored: boolean }>;
  scored: [number, number];
  taken: [number, number];
  /** Whose kick it is next. */
  next: Side;
  /** Past the opening round, where any split pair ends it. */
  suddenDeath: boolean;
  winner: Side | null;
  decided: boolean;
  /** Set while one side cannot be caught even if every remaining kick goes in. */
  clinchedBy: Side | null;
}

const otherSide = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * Fold a shoot-out out of the log.
 *
 * Two rules do the real work and both are easy to get wrong:
 *
 *   ALTERNATION. A and B kick alternately, A first. The next kicker is therefore a
 *   function of how many kicks have been taken, not of who took the last one - which
 *   matters after an undo.
 *
 *   IT ENDS EARLY. A shoot-out stops the moment one side cannot be caught, which is
 *   why 3-0 after four kicks is over and nobody takes the fifth. Playing all ten
 *   regardless is the commonest way a shoot-out is scored wrongly.
 */
export function shootoutState(log: RallyLog, kicksEach: number): ShootoutState {
  const kicks: Array<{ side: Side; scored: boolean }> = [];
  for (const ev of log) {
    if (ev.t === 'penaltyKick') kicks.push({ side: ev.side, scored: ev.scored });
  }

  const scored: [number, number] = [0, 0];
  const taken: [number, number] = [0, 0];
  for (const k of kicks) {
    const i = k.side === 'A' ? 0 : 1;
    taken[i] += 1;
    if (k.scored) scored[i] += 1;
  }

  // A kicks the odd-numbered kicks, B the even ones.
  const next: Side = kicks.length % 2 === 0 ? 'A' : 'B';
  const openingDone = taken[0] >= kicksEach && taken[1] >= kicksEach;

  let winner: Side | null = null;
  let clinchedBy: Side | null = null;

  if (!openingDone) {
    // Unassailable inside the opening round: the lead is bigger than the kicks the
    // trailing side has left.
    const leftA = Math.max(0, kicksEach - taken[0]);
    const leftB = Math.max(0, kicksEach - taken[1]);
    if (scored[0] > scored[1] + leftB) clinchedBy = 'A';
    else if (scored[1] > scored[0] + leftA) clinchedBy = 'B';
    winner = clinchedBy;
  } else if (taken[0] === taken[1] && scored[0] !== scored[1]) {
    // Level number of kicks taken and the scores differ - decided, whether that is
    // at the end of the opening round or at the end of a sudden-death pair.
    winner = scored[0] > scored[1] ? 'A' : 'B';
  }

  return {
    kicks,
    scored,
    taken,
    next,
    suddenDeath: openingDone && winner === null,
    winner,
    decided: winner !== null,
    clinchedBy,
  };
}

/** The line a scoresheet carries: "won 4-3 on penalties". */
export function shootoutLine(st: ShootoutState, nameOf: (s: Side) => string): string {
  if (!st.winner) return `${st.scored[0]}–${st.scored[1]} on penalties`;
  const [w, l] = st.winner === 'A' ? [st.scored[0], st.scored[1]] : [st.scored[1], st.scored[0]];
  return `${nameOf(st.winner)} won ${w}–${l} on penalties`;
}

/** The terminal event that closes a match settled by kicks. */
export function shootoutEnd(winner: Side): RallyEvent {
  return { t: 'end', outcome: 'win', winner, reason: 'penalties' };
}
