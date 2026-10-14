import { describe, expect, it } from 'vitest';
import { foldCareerStats, statSpecFor } from './stat-registry.js';
import { netLineStats } from './net-stats.js';
import { COLUMN_MAP } from './category-lines.js';
import { deriveTeamStats } from './team-stats.js';
import { changesEndsAfterUnit, foldRally, isDecider, type RallyEvent, type RallyLog } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';

const pt = (side: 'A' | 'B'): RallyEvent => ({ t: 'point', side });
const run = (side: 'A' | 'B', n: number): RallyLog => Array.from({ length: n }, () => pt(side));

describe('volleyball career sets and points', () => {
  const bo3 = presetByKey('fivb_25_bo3')!;
  const none = { home: null, away: null, winner: null };

  it('a scored match gives each side its sets and rally points', () => {
    // A wins 25-20, B wins 25-23, A wins 15-10 (the loser's points first, so no set ends early).
    const setLog: RallyLog = [
      ...run('B', 20), ...run('A', 25),
      ...run('A', 23), ...run('B', 25),
      ...run('B', 10), ...run('A', 15),
    ];
    expect(netLineStats(bo3, setLog, none, 'A')).toEqual({ sets_won: 2, sets_lost: 1, points_won: 63, points_lost: 55 });
    expect(netLineStats(bo3, setLog, none, 'B')).toEqual({ sets_won: 1, sets_lost: 2, points_won: 55, points_lost: 63 });
  });

  it('a manual result gives sets, or a single set its points', () => {
    expect(netLineStats(bo3, [], { home: 2, away: 1, winner: 'A' }, 'B')).toEqual({ sets_won: 1, sets_lost: 2 });
    const single = presetByKey('single_set_25')!;
    expect(netLineStats(single, [], { home: 25, away: 21, winner: 'A' }, 'A'))
      .toEqual({ sets_won: 1, sets_lost: 0, points_won: 25, points_lost: 21 });
  });

  it('set win % and point win % come from the career totals', () => {
    const career = foldCareerStats(statSpecFor('volleyball')!, [
      { sets_won: 2, sets_lost: 1, points_won: 63, points_lost: 55 },
      { sets_won: 0, sets_lost: 2, points_won: 40, points_lost: 50 },
    ]);
    expect(career).toMatchObject({ set_win_pct: 40, point_win_pct: 49.5 });
  });

  it('points lost has a column', () => {
    expect(COLUMN_MAP.net.points_lost).toBeTruthy();
  });
});

describe('volleyball serve and ends', () => {
  const f = presetByKey('fivb_25_bo5')!;

  it('the rally winner serves next, and setServe sets the toss', () => {
    expect(foldRally(f, [pt('B')]).state.serve.side).toBe('B');
    expect(foldRally(f, [{ t: 'setServe', side: 'B' }]).state.serve.side).toBe('B');
  });

  // FIVB 7.1: the team that did not serve first in the last set serves first in the next,
  // whoever won it. A won set 1 here, and still B opens set 2.
  it('alternates the first server of each set, not the set winner', () => {
    expect(foldRally(f, run('A', 25)).state.serve.side).toBe('B');
    expect(foldRally(f, [...run('A', 25), ...run('B', 25)]).state.serve.side).toBe('A');
  });

  it('a toss before the first point is where the alternation starts', () => {
    const tossB: RallyEvent = { t: 'setServe', side: 'B', reason: 'toss' };
    expect(foldRally(f, [tossB, ...run('A', 25)]).state.serve.side).toBe('A');
  });

  it('a serve correction mid-set does not move the alternation', () => {
    const fix: RallyEvent = { t: 'setServe', side: 'B', reason: 'corrected' };
    expect(foldRally(f, [pt('A'), fix, ...run('A', 24)]).state.serve.side).toBe('B');
  });

  it('ends change after a set; the 2-2 decider is flagged for a fresh toss', () => {
    const { state, trace } = foldRally(f, run('A', 25));
    expect(changesEndsAfterUnit(f, state, trace[trace.length - 1].unitsWon)).toBe(true);
    const twoAll = [...run('A', 25), ...run('B', 25), ...run('A', 25), ...run('B', 25)];
    expect(isDecider(f, foldRally(f, twoAll).state, 0)).toBe(true);
  });

  it('ends change when the leader reaches 8 in the deciding set', () => {
    const twoAll = [...run('A', 25), ...run('B', 25), ...run('A', 25), ...run('B', 25)];
    const { trace } = foldRally(f, [...twoAll, ...run('A', 8)]);
    expect(trace[trace.length - 1].switchEnds).toBe(true);
    expect(trace[trace.length - 2].switchEnds).toBe(false);
  });

  it('corporate formats never prompt a change of ends', () => {
    const c = presetByKey('corp_21_bo3')!;
    const { state, trace } = foldRally(c, run('A', 21));
    expect(changesEndsAfterUnit(c, state, trace[trace.length - 1].unitsWon)).toBe(false);
  });
});

describe('volleyball errors', () => {
  it('a service or attack error is a point to the opponent', () => {
    const events = statSpecFor('volleyball')!.events;
    for (const key of ['serve_error', 'attack_error']) {
      expect(events.find((e) => e.key === key), key).toMatchObject({ points: 1, forOpponent: true, tone: 'error' });
    }
  });

  it('the point goes to the other side, the error stays on the player who made it', () => {
    // The deck files an A player's error on side B - the side the point goes to.
    const err: RallyEvent = { t: 'point', side: 'B', pts: 1, kind: 'serve_error', playerId: 'a1' };
    const out = deriveTeamStats('volleyball', [err]);
    expect(out.sides.B.points_scored).toBe(1);
    const line = out.players.find((p) => p.userId === 'a1')!;
    expect(line.side).toBe('A');
    expect(line.stats).toMatchObject({ service_errors: 1 });
    expect(line.stats.points_scored).toBeUndefined();
  });
});
