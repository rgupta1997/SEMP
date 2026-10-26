import { describe, expect, it } from 'vitest';
import type { GroupRanking, StandingsRule, TieResolution } from '@semp/shared';
import { drawContext, pendingPlacingTies, runScheme, type EntityTally, type SchemeFixture } from './schemes.js';
import { convertEventTotals } from './event-conversion.js';

// team id === contingent id for brevity.
function fx(home: string, away: string, hs: number | null, as: number | null, round: string | null = 'Round 1', extra: Partial<SchemeFixture> = {}): SchemeFixture {
  const winner = hs == null || as == null ? null : hs > as ? home : as > hs ? away : null;
  return {
    status: hs == null ? 'scheduled' : 'completed', round,
    home_team_id: home, away_team_id: away, home_entity_id: home, away_entity_id: away,
    home_score: hs, away_score: as, winner_team_id: winner, ...extra,
  };
}
const pool = (n: number) => ({ pool_number: n, round: `Pool ${String.fromCharCode(64 + n)} - Match 1` });
const byId = (rows: EntityTally[]) => Object.fromEntries(rows.map((r) => [r.entity_id, r]));
const ranking: GroupRanking = { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for', 'head_to_head'] };
const iimk = (extra: Partial<Extract<StandingsRule, { scheme: 'placement' }>> = {}): Extract<StandingsRule, { scheme: 'placement' }> => ({
  scheme: 'placement', points: { winner: 10, runner_up: 7, third_place: 4, fourth_place: 1 }, participation: 0, ...extra,
});
const ctxFor = (all: SchemeFixture[], resolutions: TieResolution[] = []) => drawContext(all, () => ranking, resolutions);
const scored = (all: SchemeFixture[]) => all.filter((f) => f.status !== 'scheduled');
const run = (all: SchemeFixture[], rule: StandingsRule, resolutions: TieResolution[] = []) => byId(runScheme(scored(all), rule, true, ctxFor(all, resolutions)));

describe('no-show and zero placements (G07, G08)', () => {
  it('a team that only lost walkovers gets no participation', () => {
    const wo: SchemeFixture = { ...fx('A', 'B', null, null, 'QF'), status: 'walkover', winner_team_id: 'A' };
    const rows = byId(runScheme([wo, fx('C', 'D', 2, 1, 'QF')], iimk({ participation: 1 })));
    expect(rows.B.points).toBe(0);
    expect(rows.D.points).toBe(1);
  });

  it('a placement worth 0 still leaves participation', () => {
    const rule = iimk({ points: { winner: 10, runner_up: 7, quarter_finalist: 0 }, participation: 1 });
    expect(byId(runScheme([fx('A', 'B', 2, 1, 'QF')], rule)).B.points).toBe(1);
  });
});

describe('table placings (G03)', () => {
  // A single league: A 9, B 6, C 3, D 0.
  const league = [fx('A', 'B', 2, 0), fx('A', 'C', 2, 0), fx('A', 'D', 2, 0), fx('B', 'C', 2, 0), fx('B', 'D', 2, 0), fx('C', 'D', 2, 0)];

  it('awards 1st-4th from a finished league', () => {
    const rows = run(league, iimk({ table_placings: true, participation: 1 }));
    expect([rows.A.points, rows.B.points, rows.C.points, rows.D.points]).toEqual([10, 7, 4, 1]);
    expect(rows.C.detail.third_place).toBe(1);
  });

  it('waits until every league match is played', () => {
    const rows = run([...league.slice(0, 5), fx('C', 'D', null, null)], iimk({ table_placings: true }));
    expect(rows.A.points).toBe(0);
  });

  it('old rules without table placings behave as before', () => {
    expect(run(league, iimk({ participation: 1 })).A.points).toBe(1);
  });

  it('groups then a final: the best runners-up are 3rd and 4th', () => {
    const all = [
      fx('A', 'B', 3, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)),
      fx('A', 'C', 2, 1, 'Final'),
    ];
    const rows = run(all, iimk({ table_placings: true }));
    expect(rows.A.points).toBe(10);
    expect(rows.C.points).toBe(7);
    // B lost 0-3, D lost 0-1: D has the better score difference.
    expect(rows.D.points).toBe(4);
    expect(rows.B.points).toBe(1);
  });

  it('level runners-up wait for a hand-picked order, then use it', () => {
    const all = [fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 2, 1, 'Final')];
    const rule = iimk({ table_placings: true });
    expect(run(all, rule).B.points).toBe(0);
    expect(pendingPlacingTies(scored(all), rule, ctxFor(all))).toEqual([{ stage: 1, entities: ['B', 'D'], from: 3, to: 4 }]);
    const resolution: TieResolution = { scope: 'placing', stage: 1, pool: null, order: ['D', 'B'], reason: 'Coin toss', by: null, at: '' };
    const rows = run(all, rule, [resolution]);
    expect([rows.D.points, rows.B.points]).toEqual([4, 1]);
  });

  it('level teams share a place when it makes no points difference', () => {
    const all = [fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 2, 1, 'Final')];
    const rows = run(all, iimk({ points: { winner: 10, runner_up: 7, third_place: 3, fourth_place: 3 }, table_placings: true }));
    expect([rows.B.points, rows.D.points]).toEqual([3, 3]);
  });
});

describe('semi-final losers without a 3rd-place match', () => {
  it('ranks them by group record', () => {
    const all = [
      fx('A', 'B', 1, 0, null, pool(1)), fx('A', 'X', 1, 0, null, pool(1)), fx('B', 'X', 1, 0, null, pool(1)),
      fx('C', 'D', 5, 0, null, pool(2)), fx('C', 'Y', 1, 0, null, pool(2)), fx('D', 'Y', 1, 0, null, pool(2)),
      fx('A', 'D', 0, 1, 'SF'), fx('C', 'B', 0, 1, 'SF'),
    ];
    const rows = run(all, iimk({ rank_semi_losers: true }));
    // A and C both won their groups with 6 points; C has the better score difference.
    expect(rows.C.detail.third_place).toBe(1);
    expect(rows.A.detail.fourth_place).toBe(1);
  });
});

describe('"both": placings plus match points', () => {
  it('adds group match points on top of the placing', () => {
    const all = [fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 1, 0, 'Final')];
    const rows = run(all, iimk({ include_match_points: true }));
    expect(rows.A.points).toBe(13);
    expect(rows.A.detail.match_points).toBe(3);
  });
});

describe('medal participation (G22)', () => {
  it('medallists do not also get participation', () => {
    const rows = byId(runScheme([fx('A', 'B', 2, 0), fx('B', 'C', 2, 0), fx('A', 'C', 2, 0), fx('D', 'C', 0, 1)], { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 1 }));
    expect(rows.A.points).toBe(5);
  });
});

describe('event conversion (G11)', () => {
  it('ranks totals, ties on golds, and shares the better place when still level', () => {
    const out = byId(convertEventTotals([
      { entity_id: 'A', points: 20, gold: 1, silver: 0 },
      { entity_id: 'B', points: 20, gold: 2, silver: 0 },
      { entity_id: 'C', points: 5, gold: 0, silver: 1 },
      { entity_id: 'D', points: 5, gold: 0, silver: 1 },
      { entity_id: 'E', points: 0, gold: 0, silver: 0 },
    ], [10, 7, 4, 1], 1));
    expect([out.B.points, out.A.points, out.C.points, out.D.points, out.E.points]).toEqual([10, 7, 4, 4, 1]);
  });
});
