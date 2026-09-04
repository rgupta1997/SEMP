import { describe, expect, it } from 'vitest';
import {
  diffStats, isReconstructable, rallyLogToRows, rowsToRallyLog,
} from './rally-rows.js';
import { presetByKey } from './racquet-presets.js';
import { deriveRacquetStats } from './stat-registry.js';
import { foldRally, type RallyEvent, type RallyLog } from './rally-kernel.js';
import type { Side } from './scoring-rules.js';

const fmt = (k: string) => presetByKey(k)!;
const points = (side: Side, n: number): RallyLog =>
  Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);
const level = (n: number): RallyLog =>
  Array.from({ length: n * 2 }, (_, i) => ({ t: 'point', side: i % 2 === 0 ? 'A' : 'B' }) as RallyEvent);

const PAIR = { A: ['ann', 'amy'], B: ['bob', 'ben'] };

describe('the facts survive the round trip', () => {
  it('rows -> log -> rows is identical', () => {
    const f = fmt('ittf_bo5_11');
    const log: RallyLog = [
      ...points('A', 5), { t: 'let' }, ...points('B', 7),
      { t: 'fault', side: 'A' }, ...level(4), ...points('A', 8),
    ];
    const rows = rallyLogToRows(f, log, { pairing: PAIR, firstServer: 'A' });
    const back = rowsToRallyLog(rows);
    const again = rallyLogToRows(f, back, { pairing: PAIR, firstServer: 'A' });
    expect(again.map((r) => [r.event_key, r.team_side, r.points]))
      .toEqual(rows.map((r) => [r.event_key, r.team_side, r.points]));
  });

  it('stats recomputed from the ROWS equal stats from the original log', () => {
    // This is the verification claim: the table is authoritative, and the blob in
    // live_state is only the console's working copy.
    const f = fmt('bwf_official_3x21');
    const log: RallyLog = [...points('A', 21), ...level(10), ...points('B', 21), ...points('A', 11)];
    const fromLog = deriveRacquetStats(f, log, { pairing: PAIR, firstServer: 'A' });
    const rows = rallyLogToRows(f, log, { pairing: PAIR, firstServer: 'A' });
    const fromRows = deriveRacquetStats(f, rowsToRallyLog(rows), { pairing: PAIR, firstServer: 'A' });
    expect(diffStats(fromLog.sides.A, fromRows.sides.A)).toEqual([]);
    expect(diffStats(fromLog.sides.B, fromRows.sides.B)).toEqual([]);
  });

  it('reconstructs a scoreless side-out correctly, not as a point', () => {
    // Squash English 9: the receiver winning a rally takes the serve and no point.
    // The row's team_side is who SCORED, so a naive rebuild would invent a point.
    const f = fmt('english9_bo5');
    const log: RallyLog = [{ t: 'point', side: 'B' }, { t: 'point', side: 'B' }, { t: 'point', side: 'A' }];
    const rows = rallyLogToRows(f, log, { firstServer: 'A' });
    expect(rows[0].points).toBe(0);          // A served, B won it: side-out, no point
    expect(rows[1].points).toBe(1);          // B now serves and scores
    const back = rowsToRallyLog(rows);
    expect(foldRally(f, back).state.score[0]).toEqual(foldRally(f, log).state.score[0]);
  });

  it('carries the state as at each rally, so a query needs no re-fold', () => {
    const f = fmt('ittf_bo5_11');
    const rows = rallyLogToRows(f, points('A', 3), { pairing: PAIR, firstServer: 'A' });
    expect(rows[0].meta.scoreAfter).toEqual([1, 0]);
    expect(rows[2].meta.scoreAfter).toEqual([3, 0]);
    expect(rows.map((r) => r.meta.serverSide)).toEqual(['A', 'A', 'B']); // two serves each
    expect(rows[0].seq).toBe(0);
    expect(rows[2].seq).toBe(2);
  });

  it('records who served each rally, which is the per-person fact in a doubles point', () => {
    const f = fmt('bwf_official_3x21');
    const rows = rallyLogToRows(f, points('A', 2), { pairing: PAIR, firstServer: 'A' });
    // Badminton parity: 0-0 is the right court (Ann), 1-0 the left (Amy).
    expect(rows[0].player_user_id).toBe('ann');
    expect(rows[1].player_user_id).toBe('amy');
  });

  it('flags the unit a rally belonged to', () => {
    const f = fmt('ittf_bo5_11');
    const rows = rallyLogToRows(f, [...points('A', 11), ...points('A', 3)], { firstServer: 'A' });
    expect(rows[0].period_no).toBe(1);
    expect(rows[11].period_no).toBe(2);
    expect(rows[10].meta.unitsWon).toHaveLength(1);
    expect(rows[10].meta.unitsWon[0].score).toEqual([11, 0]);
  });

  it('marks deuce and the decider on the rally itself', () => {
    const f = fmt('bwf_official_3x21');
    // Two games split, then the decider to 20-20.
    // atDeuce describes the state BEFORE the rally, so the point that TAKES it to
    // 20-20 is not itself a deuce point - the one after it is.
    const log: RallyLog = [...points('A', 21), ...points('B', 21), ...level(20), { t: 'point', side: 'A' }];
    const rows = rallyLogToRows(f, log, { firstServer: 'A' });
    const last = rows[rows.length - 1];
    expect(last.meta.inDecider).toBe(true);
    expect(last.meta.atDeuce).toBe(true);
    expect(last.meta.scoreAfter).toEqual([21, 20]);
    // ...and the rally that only reached 20-20 was not yet at deuce.
    expect(rows[rows.length - 2].meta.atDeuce).toBe(false);
    // ...and not on a rally early in game one.
    expect(rows[0].meta.inDecider).toBe(false);
    expect(rows[0].meta.atDeuce).toBe(false);
  });
});

describe('being honest about what cannot be rebuilt', () => {
  it('says so when the log holds a manual score correction', () => {
    const clean: RallyLog = [...points('A', 4), { t: 'let' }];
    expect(isReconstructable(clean)).toBe(true);
    const corrected: RallyLog = [...points('A', 4), { t: 'adjust', side: 'A', delta: -1 }];
    expect(isReconstructable(corrected)).toBe(false);
  });
});

describe('diffStats', () => {
  it('treats absent and zero as the same claim', () => {
    expect(diffStats({ points_won: 5, aces: 0 }, { points_won: 5 })).toEqual([]);
  });

  it('reports a real drift with both values', () => {
    expect(diffStats({ points_won: 5 }, { points_won: 4 }))
      .toEqual([{ metric: 'points_won', expected: 5, actual: 4 }]);
  });
});
