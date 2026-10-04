// Tie-level engine: a fixture made of several rubbers (e.g. table-tennis team event
// MS/WS/MD/WD/XD). Each rubber is scored by the per-contest engine; the tie is won by
// taking the majority of rubbers and is persisted inside fixtures.live_state.tie.
// Lives here (not in the web app) so BOTH the scoring console AND the API (demo
// seeder, scripts) can build and evaluate tie states from one implementation.

import type { ContestSpec, RubberSpec, TieSpec } from './scoring.js';
import type { RallyLog } from './rally-kernel.js';
import type { ScoringFormat } from './scoring-rules.js';

// Snapshot of one contest (a single match, or one rubber of a tie). Structurally the
// state the web engine's reducer operates on; hydrate() tolerates partial persists.
export interface MatchState {
  a: number; b: number;              // current-period points (or running points)
  seg: number;                       // current period (1-based)
  segScores: [number, number][];     // finished period scores
  segsA: number; segsB: number;      // periods/sets/games won (sets/rally)
  inn: number; batting: 'A' | 'B';   // cricket
  runsA: number; wktA: number; runsB: number; wktB: number;
  ballsA: number; ballsB: number;    // cricket: legal balls bowled per innings
  ended?: boolean;                   // final period frozen - locks scoring until reopened
}

export function initState(): MatchState {
  return { a: 0, b: 0, seg: 1, segScores: [], segsA: 0, segsB: 0, inn: 1, batting: 'A', runsA: 0, wktA: 0, runsB: 0, wktB: 0, ballsA: 0, ballsB: 0 };
}

// Tolerant rehydrate from a persisted (possibly partial) snapshot.
export function hydrate(raw: any): MatchState {
  const s = initState();
  if (raw && typeof raw === 'object') Object.assign(s, raw);
  if (!Array.isArray(s.segScores)) s.segScores = [];
  return s;
}

export type RubberStatus = 'pending' | 'live' | 'completed' | 'dead';

/** Who played one rubber, as user ids per side, in nominated order (first = first server / receiver). */
export interface RubberLineup {
  A: string[];
  B: string[];
}

export interface RubberInstance {
  key: string;
  label: string;
  state: MatchState;       // the rubber's own contest state
  winner: 'A' | 'B' | null;
  status: RubberStatus;
  /** Players named for this rubber. Absent: not named yet, or skipped. */
  lineup?: RubberLineup;
  /** The scorer chose not to name players - the rubber counts for the team only. */
  lineupSkipped?: boolean;
  /** Racquet rubbers: the point-by-point log, scored by the rally kernel. */
  rally?: RallyLog;
  firstServer?: 'A' | 'B';
  /** Racquet rubbers: the rules in force, frozen at the first rally. */
  format?: ScoringFormat;
}

/** Players per side in a rubber: an explicit size, else doubles by name. */
export function rubberSize(r: Pick<RubberSpec, 'label'> & { size?: number }): number {
  return r.size ?? (/doubles/i.test(r.label) ? 2 : 1);
}

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A persisted lineup, or undefined when absent or malformed. */
export function readLineup(raw: unknown): RubberLineup | undefined {
  const l = raw as { A?: unknown; B?: unknown } | null | undefined;
  return l && isIdList(l.A) && isIdList(l.B) ? { A: l.A, B: l.B } : undefined;
}
const hydrateLineup = readLineup;

/** Players per side in a single racquet match, from the discipline's entry type. */
export function playersPerSide(entryType: string | null | undefined): number {
  return entryType === 'individual' ? 1 : 2;
}

export type LineupSource = 'named' | 'roster' | 'skipped' | 'legacy';

/**
 * Who played a single match - one rule for the console and the stat writer.
 *
 *   named   - the scorer picked them (order = first server / receiver)
 *   roster  - each side's roster is no bigger than the match, so it IS the lineup
 *   skipped - the scorer declined to name anyone: nobody is credited
 *   legacy  - scored before lineups existed: the first players listed, as before
 */
export function resolveMatchLineup(
  liveState: unknown, roster: RubberLineup, size: number,
): { lineup: RubberLineup | null; source: LineupSource } {
  const ls = (liveState ?? {}) as { lineup?: unknown; lineupSkipped?: unknown; pairSwap?: { A?: unknown; B?: unknown } };
  const named = readLineup(ls.lineup);
  if (named) return { lineup: named, source: 'named' };
  const swap = (pair: string[], on: unknown) => (on === true && pair.length === 2 ? [pair[1], pair[0]] : pair);
  const ordered = (l: RubberLineup): RubberLineup => ({ A: swap(l.A, ls.pairSwap?.A), B: swap(l.B, ls.pairSwap?.B) });
  if (roster.A.length <= size && roster.B.length <= size) return { lineup: ordered(roster), source: 'roster' };
  if (ls.lineupSkipped === true) return { lineup: null, source: 'skipped' };
  return { lineup: ordered({ A: roster.A.slice(0, size), B: roster.B.slice(0, size) }), source: 'legacy' };
}

export interface TieState {
  activeRubber: number;
  rubbers: RubberInstance[];
}

// A rubber's contest spec drives reduce/headline/subLine in the console.
export function rubberDef(spec: TieSpec, index: number): ContestSpec {
  return spec.rubbers[index].contest;
}

// Rubbers needed to clinch: explicit `target`, else a simple majority of the rubbers.
export function tieTarget(spec: TieSpec): number {
  if (spec.target) return spec.target;
  return Math.floor(spec.rubbers.length / 2) + 1;
}

export function initTie(spec: TieSpec): TieState {
  return {
    activeRubber: 0,
    rubbers: spec.rubbers.map((r) => ({
      key: r.key, label: r.label, state: initState(), winner: null, status: 'pending' as RubberStatus,
    })),
  };
}

// Tolerant rehydrate from persisted live_state.tie, re-aligned to the current spec by
// index (so editing the template later can't desync labels). Falls back to a fresh tie.
export function hydrateTie(raw: any, spec: TieSpec): TieState {
  const base = initTie(spec);
  const rawRubbers = raw?.rubbers;
  if (Array.isArray(rawRubbers) && rawRubbers.length === spec.rubbers.length) {
    base.rubbers = spec.rubbers.map((r, i) => {
      const rr = rawRubbers[i] ?? {};
      const status: RubberStatus = ['pending', 'live', 'completed', 'dead'].includes(rr.status) ? rr.status : 'pending';
      const lineup = hydrateLineup(rr.lineup);
      return {
        key: r.key,
        label: r.label,
        state: hydrate(rr.state),
        winner: rr.winner === 'A' || rr.winner === 'B' ? rr.winner : null,
        status,
        ...(lineup ? { lineup } : {}),
        ...(rr.lineupSkipped === true ? { lineupSkipped: true } : {}),
        ...(Array.isArray(rr.rally)
          ? { rally: rr.rally.filter((e: any) => !!e && typeof e === 'object' && typeof e.t === 'string') }
          : {}),
        ...(rr.firstServer === 'A' || rr.firstServer === 'B' ? { firstServer: rr.firstServer } : {}),
        ...(rr.format && typeof rr.format === 'object' ? { format: rr.format } : {}),
      };
    });
    if (typeof raw.activeRubber === 'number') base.activeRubber = Math.min(Math.max(0, raw.activeRubber), spec.rubbers.length - 1);
  }
  // Land on something PLAYABLE. A persisted pointer can name a rubber that has since
  // been completed or skipped - a stale snapshot, a hand-edited live_state, a tie
  // reopened from another device - and a console pointed at a finished contest shows
  // a dead screen with no way forward. Only moved when the tie still has rubbers to
  // play; a decided tie legitimately points at its last one.
  const at = base.rubbers[base.activeRubber];
  if (at && at.status !== 'pending' && at.status !== 'live') {
    const next = base.rubbers.findIndex((r) => r.status === 'pending' || r.status === 'live');
    if (next >= 0) base.activeRubber = next;
  }
  return base;
}

export function rubbersWon(state: TieState): { a: number; b: number } {
  let a = 0, b = 0;
  for (const r of state.rubbers) {
    if (r.winner === 'A') a += 1;
    else if (r.winner === 'B') b += 1;
  }
  return { a, b };
}

export function tieWinner(spec: TieSpec, state: TieState): 'A' | 'B' | null {
  const { a, b } = rubbersWon(state);
  const t = tieTarget(spec);
  if (a >= t) return 'A';
  if (b >= t) return 'B';
  return null;
}

/** Rubbers that can still be played - pending or live, not completed or skipped. */
export function playableRubbers(state: TieState): number {
  return state.rubbers.filter((r) => r.status === 'pending' || r.status === 'live').length;
}

/**
 * The tie's real standing: won, DRAWN, or still in progress.
 *
 * `tieWinner` alone cannot tell "nobody has reached the target yet" from "nobody
 * ever will". An EVEN tie can finish level - the shipped chess template is four
 * boards with a majority of three, and 2-2 is an ordinary chess result - and at
 * that point every board has been played, no side has the target, and a console
 * that only asks `tieWinner` refuses to sign the fixture off while telling the
 * official to "record rubber results until one side reaches 3". There are none
 * left to record. The fixture can never be completed.
 *
 * So the level-and-finished case gets a name of its own, and the console can offer
 * the draw that chess has always allowed.
 */
export function tieOutcome(spec: TieSpec, state: TieState): {
  winner: 'A' | 'B' | null; drawn: boolean; playable: number; decided: boolean;
} {
  const winner = tieWinner(spec, state);
  const playable = playableRubbers(state);
  const drawn = winner === null && playable === 0;
  return { winner, drawn, playable, decided: winner !== null || drawn };
}

// Once the tie is decided, mark any unplayed rubbers dead (skipped) when the format
// drops dead rubbers. Idempotent.
export function applyDead(spec: TieSpec, state: TieState): TieState {
  if (!spec.skipDeadRubbers || !tieWinner(spec, state)) return state;
  return {
    ...state,
    rubbers: state.rubbers.map((r) => (r.winner === null && r.status !== 'dead' ? { ...r, status: 'dead' as RubberStatus } : r)),
  };
}

// Record a rubber's winner, then advance the active pointer to the next playable rubber.
export function decideRubber(spec: TieSpec, state: TieState, index: number, winner: 'A' | 'B'): TieState {
  const rubbers = state.rubbers.map((r, i) => (i === index ? { ...r, winner, status: 'completed' as RubberStatus } : r));
  let next: TieState = { ...state, rubbers };
  next = applyDead(spec, next);
  const upcoming = next.rubbers.findIndex((r) => r.status === 'pending' || r.status === 'live');
  if (upcoming >= 0) next.activeRubber = upcoming;
  return next;
}

// Reopen a rubber for correction: clear its result so its deck/decision re-enables.
// Reviving a decided rubber can un-decide the tie, so any previously-skipped (dead)
// rubbers come back to playable; applyDead then re-skips them if it's still decided.
// `resetState` true also wipes the rubber's point tally to start the contest fresh.
export function reopenRubber(spec: TieSpec, state: TieState, index: number, resetState = false): TieState {
  const rubbers = state.rubbers.map((r, i) => {
    if (i === index) {
      const reopened: RubberInstance = { ...r, winner: null, status: 'live', state: resetState ? initState() : r.state };
      // A fresh re-score clears the points and their frozen rules; who played stays.
      if (resetState) { delete reopened.rally; delete reopened.format; delete reopened.firstServer; }
      return reopened;
    }
    return r.winner === null && r.status === 'dead' ? { ...r, status: 'pending' as RubberStatus } : r;
  });
  return applyDead(spec, { ...state, activeRubber: index, rubbers });
}
