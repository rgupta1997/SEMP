import { describe, expect, it } from 'vitest';
import { foldRally, type RallyEvent, type RallyLog } from './rally-kernel.js';
import { presetByKey, presetsFor } from './racquet-presets.js';
import { foldCareerStats, statSpecFor } from './stat-registry.js';
import { deriveTeamStats } from './team-stats.js';
import { COLUMN_MAP } from './category-lines.js';

const pt = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side });
const run = (side: 'A' | 'B', n: number): RallyLog => Array.from({ length: n }, () => pt(side));

describe('throwball actions', () => {
  const spec = statSpecFor('throwball')!;
  const keys = spec.events.map((e) => e.key);

  it('offers throwball actions, not volleyball ones', () => {
    expect(keys).toEqual(['ace', 'throw_point', 'service_fault', 'dropped_catch', 'throw_fault', 'catch']);
    for (const vb of ['kill', 'block_vb', 'dig', 'serve_error', 'attack_error']) expect(keys).not.toContain(vb);
  });

  it('every fault scores for the other side', () => {
    for (const key of ['service_fault', 'dropped_catch', 'throw_fault']) {
      expect(spec.events.find((e) => e.key === key), key).toMatchObject({ points: 1, forOpponent: true, tone: 'error' });
    }
  });

  it('a dropped catch is a point to the thrower\'s side and a fault on the catcher', () => {
    // A's player drops the catch: the deck files it on side B, the side the point goes to.
    const drop: RallyEvent = { t: 'point', side: 'B', pts: 1, kind: 'dropped_catch', playerId: 'a1' };
    const out = deriveTeamStats('throwball', [drop]);
    expect(out.sides.B.points_scored).toBe(1);
    const line = out.players.find((p) => p.userId === 'a1')!;
    expect(line.side).toBe('A');
    expect(line.stats).toEqual({ dropped_catches: 1 });
  });

  it('every action has a stat column, reusing volleyball\'s', () => {
    for (const k of ['throw_points', 'catches', 'service_faults', 'dropped_catches', 'throw_faults']) {
      expect(COLUMN_MAP.net[k], k).toBeTruthy();
    }
  });

  it('career totals read in throwball\'s own words', () => {
    const career = foldCareerStats(spec, [{ throw_points: 4, catches: 6, dropped_catches: 1, sets_won: 2, sets_lost: 1 }]);
    expect(career).toMatchObject({ throw_points: 4, catches: 6, dropped_catches: 1, set_win_pct: 66.7 });
  });
});

describe('throwball serve and formats', () => {
  it('a new set is served by the side that did not start the last one (SGFI)', () => {
    const f = presetByKey('tb_bo3_15')!;
    // A started set 1 and won it - B still opens set 2.
    expect(foldRally(f, run('A', 15)).state.serve.side).toBe('B');
    // B won the toss, A won set 1 - A opens set 2.
    expect(foldRally(f, [{ t: 'setServe', side: 'B', reason: 'toss' }, ...run('A', 15)]).state.serve.side).toBe('A');
  });

  it('every throwball format alternates the first serve', () => {
    for (const f of presetsFor('throwball')) expect(f.serve.nextUnitServer, f.presetKey).toBe('alternate');
  });

  it('offers the international best of 3 to 25 with a deciding set to 15', () => {
    const f = presetByKey('tb_bo3_25')!;
    expect(f.levels[0]).toMatchObject({ target: 25, winBy: 2, deciderOverride: { target: 15 } });
    // 1-1 in sets: the third goes to 15, so 15-13 ends the match.
    const oneAll = [...run('A', 25), ...run('B', 25)];
    expect(foldRally(f, [...oneAll, ...run('B', 13), ...run('A', 15)]).state).toMatchObject({ ended: true, winner: 'A' });
  });

  it('keeps the Indian 15-point format as the default', () => {
    expect(presetsFor('throwball')[0].presetKey).toBe('tb_bo3_15');
  });
});
