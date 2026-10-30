import type { Side } from './scoring-rules.js';
import { canonicalTeamSport } from './team-presets.js';

// Pool (8-ball) rubbers in a team tie, frame by frame: who won each frame and, when
// recorded, how many object balls the loser still had on the table. A rubber is best of
// N frames; the tie's frames and ball margin break level team rankings (Inter-IIM).

export const isPoolSport = (name?: string | null): boolean => canonicalTeamSport(name) === 'pool/snooker';

/** Object balls a side has in 8-ball (seven plus the 8) - the most a frame can be won by. */
export const POOL_MAX_BALLS = 8;

export interface PoolFrame {
  winner: Side;
  /** The loser's balls still on the table when the frame ended; null when not recorded. */
  ballsLeft?: number | null;
}

export interface PoolRubberState { frames: PoolFrame[] }

/** A stored pool rubber, tolerating anything malformed; null when there is none. */
export function readPoolState(raw: unknown): PoolRubberState | null {
  const r = raw as { frames?: unknown } | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.frames)) return null;
  const frames = r.frames
    .filter((f): f is PoolFrame => !!f && typeof f === 'object' && ((f as PoolFrame).winner === 'A' || (f as PoolFrame).winner === 'B'))
    .map((f) => {
      const b = f.ballsLeft;
      return { winner: f.winner, ...(typeof b === 'number' && b >= 0 ? { ballsLeft: Math.min(POOL_MAX_BALLS, Math.round(b)) } : {}) };
    });
  return { frames };
}

export interface PoolRubberResult {
  /** Frames won by each side (frames after the rubber was decided are ignored). */
  framesWon: [number, number];
  /** Balls each side won its frames by (the loser's balls left), summed. */
  ballsFor: [number, number];
  winner: Side | null;
  decided: boolean;
  /** Frames needed to win: best of 5 needs 3. */
  toWin: number;
}

/** A best-of-N rubber from its frames. */
export function poolRubber(state: PoolRubberState | null | undefined, bestOf: number): PoolRubberResult {
  const toWin = Math.floor(Math.max(1, bestOf) / 2) + 1;
  const framesWon: [number, number] = [0, 0];
  const ballsFor: [number, number] = [0, 0];
  let winner: Side | null = null;
  for (const f of state?.frames ?? []) {
    if (winner) break;
    const i = f.winner === 'A' ? 0 : 1;
    framesWon[i] += 1;
    ballsFor[i] += f.ballsLeft ?? 0;
    if (framesWon[i] >= toWin) winner = f.winner;
  }
  return { framesWon, ballsFor, winner, decided: !!winner, toWin };
}

/** A tie's frames and ball margin across its pool rubbers, home first. */
export interface PoolTieTotals { frames: [number, number]; balls: [number, number] }

export function poolTieTotals(rubbers: Array<{ pool?: PoolRubberState | null; bestOf: number }>): PoolTieTotals {
  const frames: [number, number] = [0, 0];
  const balls: [number, number] = [0, 0];
  for (const r of rubbers) {
    if (!r.pool) continue;
    const res = poolRubber(r.pool, r.bestOf);
    frames[0] += res.framesWon[0]; frames[1] += res.framesWon[1];
    balls[0] += res.ballsFor[0]; balls[1] += res.ballsFor[1];
  }
  return { frames, balls };
}

/**
 * A finished or live pool tie's totals straight from a fixture's live_state (tie + tieSpec),
 * for the standings. Null when the fixture has no frame-by-frame pool rubbers.
 */
export function poolTieTotalsOf(liveState: unknown): PoolTieTotals | null {
  const ls = liveState as { tie?: { rubbers?: unknown }; tieSpec?: { rubbers?: unknown } } | null;
  const rubbers = Array.isArray(ls?.tie?.rubbers) ? (ls!.tie!.rubbers as Array<{ pool?: unknown }>) : [];
  const specs = Array.isArray(ls?.tieSpec?.rubbers) ? (ls!.tieSpec!.rubbers as Array<{ contest?: { segMax?: unknown } }>) : [];
  const read = rubbers.map((r, i) => {
    const segMax = specs[i]?.contest?.segMax;
    // No layout saved: count every frame recorded.
    return { pool: readPoolState(r?.pool), bestOf: typeof segMax === 'number' && segMax > 0 ? segMax : 99 };
  });
  return read.some((r) => r.pool) ? poolTieTotals(read) : null;
}
