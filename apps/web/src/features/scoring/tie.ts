// Tie-level engine: a fixture made of several rubbers (e.g. table-tennis team event
// MS/WS/MD/WD/XD). Each rubber is scored by the existing per-contest engine; the tie
// is won by taking the majority of rubbers. Sits on top of engine.ts and is persisted
// inside fixtures.live_state.tie.

import type { TieSpec } from '@semp/shared';
import { initState, hydrate, type MatchState, type SportDef } from './engine';

export type RubberStatus = 'pending' | 'live' | 'completed' | 'dead';

export interface RubberInstance {
  key: string;
  label: string;
  state: MatchState;       // the rubber's own contest state (see engine.MatchState)
  winner: 'A' | 'B' | null;
  status: RubberStatus;
}

export interface TieState {
  activeRubber: number;
  rubbers: RubberInstance[];
}

// A rubber's contest spec is structurally a SportDef, so it drives reduce/headline/subLine.
export function rubberDef(spec: TieSpec, index: number): SportDef {
  return spec.rubbers[index].contest as SportDef;
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
