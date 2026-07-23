// Tie-level engine: a fixture made of several rubbers (e.g. table-tennis team event
// MS/WS/MD/WD/XD). Each rubber is scored by the per-contest engine; the tie is won by
// taking the majority of rubbers and is persisted inside fixtures.live_state.tie.
// Lives here (not in the web app) so BOTH the scoring console AND the API (demo
// seeder, scripts) can build and evaluate tie states from one implementation.

import type { ContestSpec, TieSpec } from './scoring.js';

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

export interface RubberInstance {
  key: string;
  label: string;
  state: MatchState;       // the rubber's own contest state
  winner: 'A' | 'B' | null;
  status: RubberStatus;
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
      return {
        key: r.key,
        label: r.label,
        state: hydrate(rr.state),
        winner: rr.winner === 'A' || rr.winner === 'B' ? rr.winner : null,
        status,
      };
    });
    if (typeof raw.activeRubber === 'number') base.activeRubber = Math.min(Math.max(0, raw.activeRubber), spec.rubbers.length - 1);
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
    if (i === index) return { ...r, winner: null, status: 'live' as RubberStatus, state: resetState ? initState() : r.state };
    return r.winner === null && r.status === 'dead' ? { ...r, status: 'pending' as RubberStatus } : r;
  });
  return applyDead(spec, { ...state, activeRubber: index, rubbers });
}
