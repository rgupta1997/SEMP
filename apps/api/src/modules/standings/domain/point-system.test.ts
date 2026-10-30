import { describe, expect, it } from 'vitest';
import type { GroupRanking, StandingsRule, TieResolution } from '@semp/shared';
import { drawContext, pendingPlacingTies, runScheme, tableAnalysis, type EntityTally, type SchemeFixture } from './schemes.js';
import { placingStagesOf } from '../../fixtures/domain/stage-tree.js';
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

  it('level runners-up share 3rd until the organiser sets an order, then use it', () => {
    const all = [fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 2, 1, 'Final')];
    const rule = iimk({ table_placings: true });
    const shared = run(all, rule);
    expect([shared.B.points, shared.D.points]).toEqual([4, 4]);
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

describe('Cup and Plate', () => {
  const config = {
    root: {
      type: 'group', numGroups: 2, tiebreakers: ['points'],
      branches: [
        { id: 'cup', label: 'Cup', rankFrom: 1, rankTo: 2, childStage: { type: 'knockout', eliminationType: 'single', seeding: 'auto' } },
        { id: 'plate', label: 'Plate', rankFrom: 3, rankTo: 4, childStage: { type: 'knockout', eliminationType: 'single', seeding: 'auto' } },
      ],
    },
  };

  it('only the stage fed by rank 1 decides placings', () => {
    expect([...(placingStagesOf(config) ?? [])]).toEqual([1, 2]);
    expect(placingStagesOf({ scoring: {} })).toBeNull();
  });

  it('the Plate final crowns nobody', () => {
    const all = [
      fx('A', 'B', 2, 1, 'Final', { stage_sequence: 2, bracket_position: 1 } as Partial<SchemeFixture>),
      fx('C', 'D', 2, 1, 'Final', { stage_sequence: 3, bracket_position: 1 } as Partial<SchemeFixture>),
    ];
    const ctx = drawContext(all, () => ranking, [], placingStagesOf(config));
    const rows = byId(runScheme(scored(all), iimk({ participation: 1 }), true, ctx));
    expect([rows.A.points, rows.B.points]).toEqual([10, 7]);
    expect([rows.C.points, rows.D.points]).toEqual([1, 1]);
    expect(rows.C.detail.winner).toBeUndefined();
  });
});

describe('ranking across groups', () => {
  it('records who was compared, their places and what separated them', () => {
    const all = [fx('A', 'B', 3, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 2, 1, 'Final')];
    const t = tableAnalysis(scored(all), iimk({ table_placings: true }), ctxFor(all))!;
    expect(t.comparisons).toEqual([{ stage: 1, kind: 'placings', order: ['D', 'B'], places: [3, 4], decidedBy: ['score_diff'] }]);
  });

  it('a level pair shows as sharing the place, then as hand-picked', () => {
    const all = [fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)), fx('A', 'C', 2, 1, 'Final')];
    const rule = iimk({ table_placings: true });
    expect(tableAnalysis(scored(all), rule, ctxFor(all))!.comparisons[0]).toMatchObject({ places: [3, 3], decidedBy: [null] });
    const picked: TieResolution = { scope: 'placing', stage: 1, pool: null, order: ['D', 'B'], reason: 'Coin toss', by: null, at: '' };
    expect(tableAnalysis(scored(all), rule, ctxFor(all, [picked]))!.comparisons[0]).toMatchObject({ order: ['D', 'B'], places: [3, 4], decidedBy: ['resolution'] });
  });
});

describe('a pure league has no semi-finals', () => {
  // A beats everyone, B beats C and D, C beats D: final order A, B, C, D.
  const league = [fx('A', 'B', 3, 0), fx('A', 'C', 3, 0), fx('A', 'D', 3, 0), fx('B', 'C', 3, 0), fx('B', 'D', 3, 0), fx('C', 'D', 3, 0)];
  it('a 4th place worth 0 falls to participation, not semi-finalist points', () => {
    const rows = run(league, iimk({ points: { winner: 10, runner_up: 7, third_place: 5, fourth_place: 0, semi_finalist: 3 }, participation: 1, table_placings: true }));
    expect([rows.A.points, rows.B.points, rows.C.points, rows.D.points]).toEqual([10, 7, 5, 1]);
    expect(rows.D.detail.semi_finalist).toBeUndefined();
  });
});

describe('level teams share a position (IIMK), unless the organiser orders them', () => {
  // Semi losers B and D have identical group records; no 3rd-place match.
  const all = [
    fx('A', 'B', 1, 0, null, pool(1)), fx('C', 'D', 1, 0, null, pool(2)),
    fx('A', 'D', 2, 1, 'SF'), fx('C', 'B', 2, 1, 'SF'), fx('A', 'C', 2, 1, 'Final'),
  ];
  const rule = iimk({ rank_semi_losers: true });
  it('level semi-final losers both take 3rd', () => {
    const rows = run(all, rule);
    expect([rows.B.points, rows.D.points]).toEqual([4, 4]);
    expect(rows.B.detail.third_place).toBe(1);
  });
  it('an order set by the organiser splits them', () => {
    const picked: TieResolution = { scope: 'placing', stage: 1, pool: null, order: ['B', 'D'], reason: 'Lots', by: null, at: '' };
    const rows = run(all, rule, [picked]);
    expect([rows.B.points, rows.D.points]).toEqual([4, 1]);
  });
});

// A group tie nobody has ordered yet: both tied teams take part in the cross-group placing,
// instead of one of them silently counting as the runner-up and the other as 3rd.
describe('an unresolved group tie in cross-group placings', () => {
  const fx = (h: string, a: string, hs: number, as: number, o: Partial<SchemeFixture> = {}): SchemeFixture => ({
    status: 'completed', round: null, home_team_id: h, away_team_id: a, home_entity_id: h, away_entity_id: a,
    home_score: hs, away_score: as, winner_team_id: hs > as ? h : hs < as ? a : null, pool_number: 1, stage_sequence: 1, ...o });
  const ranking = { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff'] as GroupRanking['tiebreakers'] };
  const rule: StandingsRule = { scheme: 'placement', points: { winner: 10, runner_up: 7, third_place: 4 }, participation: 1, table_placings: true, ranking } as StandingsRule;
  // Group 1: A wins both; B and C draw and lose to A by the same score - level on everything.
  const all = [
    fx('A', 'B', 1, 0), fx('A', 'C', 1, 0), fx('B', 'C', 1, 1),
    fx('D', 'E', 3, 0, { pool_number: 2 }), fx('D', 'F', 3, 0, { pool_number: 2 }), fx('E', 'F', 1, 0, { pool_number: 2 }),
    fx('A', 'D', 2, 1, { round: 'Final', pool_number: null }),
  ];

  it('B and C stay level with each other, and the better runner-up E is placed ahead of both', () => {
    const ctx = drawContext(all, () => ranking, []);
    const pts = Object.fromEntries(runScheme(all, rule, true, ctx).map((r) => [r.entity_id, r.points]));
    // E won a group match (2 pts) and is 3rd; B and C (1 pt, level) share 4th, worth participation here.
    expect(pts.E).toBe(4);
    expect(pts.B).toBe(pts.C);
    expect(pts.C).toBe(1);
    expect(pendingPlacingTies(all, rule, ctx)).toEqual([]);
  });

  // Pool 2's runner-up F is level with B and C on points and difference: all three tie for 3rd.
  const level = [
    fx('A', 'B', 1, 0), fx('A', 'C', 1, 0), fx('B', 'C', 1, 1),
    fx('D', 'E', 3, 0, { pool_number: 2 }), fx('D', 'F', 1, 0, { pool_number: 2 }), fx('E', 'F', 0, 0, { pool_number: 2 }),
    fx('A', 'D', 2, 1, { round: 'Final', pool_number: null }),
  ];
  const placing = (order: string[]): TieResolution => ({ scope: 'placing', stage: 1, pool: null, order, reason: 'decided by the committee', by: null, at: '2026-10-30' });

  it('the three tied for 3rd wait for an order, and "Set order" is applied', () => {
    expect(pendingPlacingTies(level, rule, drawContext(level, () => ranking, []))).toEqual([{ stage: 1, entities: ['B', 'C', 'F'], from: 3, to: 4 }]);
    const ctx = drawContext(level, () => ranking, [placing(['C', 'F', 'B'])]);
    const pts = Object.fromEntries(runScheme(level, rule, true, ctx).map((r) => [r.entity_id, r.points]));
    expect([pts.C, pts.F, pts.B]).toEqual([4, 1, 1]);
    expect(pendingPlacingTies(level, rule, ctx)).toEqual([]);
  });
});

// One league, then a final: two teams level for 3rd. "Set order" decides who is 3rd.
describe('"Set order" in a single league', () => {
  const fx = (h: string, a: string, hs: number, as: number, o: Partial<SchemeFixture> = {}): SchemeFixture => ({
    status: 'completed', round: null, home_team_id: h, away_team_id: a, home_entity_id: h, away_entity_id: a,
    home_score: hs, away_score: as, winner_team_id: hs > as ? h : hs < as ? a : null, pool_number: 1, stage_sequence: 1, ...o });
  const ranking = { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff'] as GroupRanking['tiebreakers'] };
  const rule = { scheme: 'placement', points: { winner: 10, runner_up: 7, third_place: 4 }, participation: 1, table_placings: true, ranking } as StandingsRule;
  // A and B top the league and play the final; C and D draw and lose the rest by the same scores.
  const all = [
    fx('A', 'B', 1, 0), fx('A', 'C', 1, 0), fx('A', 'D', 1, 0), fx('B', 'C', 1, 0), fx('B', 'D', 1, 0), fx('C', 'D', 1, 1),
    fx('A', 'B', 2, 1, { round: 'Final', pool_number: null }),
  ];

  it('without an order C and D wait; with "D, then C" saved, D is 3rd', () => {
    expect(pendingPlacingTies(all, rule, drawContext(all, () => ranking, []))).toEqual([{ stage: 1, entities: ['C', 'D'], from: 3, to: 4 }]);
    const order: TieResolution = { scope: 'placing', stage: 1, pool: null, order: ['D', 'C'], reason: 'committee', by: null, at: '2026-10-30' };
    const ctx = drawContext(all, () => ranking, [order]);
    const pts = Object.fromEntries(runScheme(all, rule, true, ctx).map((r) => [r.entity_id, r.points]));
    expect([pts.D, pts.C]).toEqual([4, 1]);
    expect(pendingPlacingTies(all, rule, ctx)).toEqual([]);
  });
});
