import type { GroupRanking } from '@semp/shared';
import { describe, expect, it } from 'vitest';
import { computePoolStandings, isPoolComplete, type PoolFixture } from './pool-standings.js';

const rule: GroupRanking = { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'wins', 'lost'] };

// Two orgs' team ids deliberately differ from their org ids, so a test that reads
// the org id back instead of the team id would fail loudly.
const fx = (home: string, away: string, homeScore: number, awayScore: number, winner: string | null): PoolFixture => ({
  status: 'completed', round: 'Pool A - Match 1',
  home_team_id: `team-${home}`, away_team_id: `team-${away}`,
  home_entity_id: `org-${home}`, away_entity_id: `org-${away}`,
  home_score: homeScore, away_score: awayScore, winner_team_id: winner ? `team-${winner}` : null,
});

describe('computePoolStandings', () => {
  it('ranks a completed pool by points then tiebreakers, recovering team ids (not org ids)', () => {
    const fixtures: PoolFixture[] = [
      fx('a', 'b', 3, 1, 'a'),
      fx('a', 'c', 2, 2, null),
      fx('b', 'c', 1, 0, 'b'),
    ];
    const { standings } = computePoolStandings(fixtures, rule);
    expect(standings.map((s) => s.teamId)).toEqual(['team-a', 'team-b', 'team-c']);
    expect(standings[0].rank).toBe(1);
    expect(standings.map((s) => s.entityId)).toEqual(['org-a', 'org-b', 'org-c']);
  });
});

describe('isPoolComplete', () => {
  it('is false while any fixture is scheduled/live/postponed', () => {
    expect(isPoolComplete([{ ...fx('a', 'b', null as any, null as any, null), status: 'scheduled' }])).toBe(false);
    expect(isPoolComplete([{ ...fx('a', 'b', 1, 0, 'a'), status: 'live' }])).toBe(false);
    expect(isPoolComplete([{ ...fx('a', 'b', null as any, null as any, null), status: 'postponed' }])).toBe(false);
  });

  it('is true once every fixture is completed/walkover/bye', () => {
    expect(isPoolComplete([fx('a', 'b', 1, 0, 'a'), { ...fx('c', 'd', 0, 0, null), status: 'walkover' }, { ...fx('e', 'f', null as any, null as any, null), status: 'bye' }])).toBe(true);
  });

  it('is false for an empty fixture list', () => {
    expect(isPoolComplete([])).toBe(false);
  });
});

describe('tied ranks', () => {
  it('flags ranks that are fully tied on every configured tiebreaker', () => {
    const { tied, ties } = computePoolStandings([fx('a', 'b', 1, 1, null)], rule);
    expect([...tied].sort()).toEqual([1, 2]);
    expect(ties).toEqual([['org-a', 'org-b']]);
  });

  it('flags nothing when ranks are clearly separated', () => {
    expect(computePoolStandings([fx('a', 'b', 3, 0, 'a')], rule).tied.size).toBe(0);
  });

  it('a hand-picked order settles the tie', () => {
    const { standings, tied } = computePoolStandings([fx('a', 'b', 1, 1, null)], rule, () => ['org-b', 'org-a']);
    expect(standings.map((s) => s.entityId)).toEqual(['org-b', 'org-a']);
    expect(tied.size).toBe(0);
  });

  it('a resolution for a different set of teams is ignored', () => {
    const { tied } = computePoolStandings([fx('a', 'b', 1, 1, null)], rule, (ids) => (ids.length === 3 ? ids : undefined));
    expect(tied.size).toBe(2);
  });
});

describe('tie-breakers', () => {
  // a, b, c all win one and lose one: level on points.
  const cycle = [fx('a', 'b', 2, 0, 'a'), fx('b', 'c', 1, 0, 'b'), fx('c', 'a', 3, 0, 'c')];

  it('score difference, then score for', () => {
    const ranking: GroupRanking = { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for'] };
    // diff: a -1, b -1, c +2; a scored 2, b scored 1.
    expect(computePoolStandings(cycle, ranking).standings.map((s) => s.entityId)).toEqual(['org-c', 'org-a', 'org-b']);
  });

  it('head-to-head decides a two-way tie', () => {
    const ranking: GroupRanking = { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'head_to_head'] };
    const fixtures = [fx('a', 'b', 0, 1, 'b'), fx('a', 'c', 1, 0, 'a'), fx('b', 'd', 0, 1, 'd'), fx('c', 'd', 1, 0, 'c'), fx('a', 'd', 1, 0, 'a'), fx('b', 'c', 1, 0, 'b')];
    // a 6, b 6, c 3, d 3. b beat a; c beat d.
    expect(computePoolStandings(fixtures, ranking).standings.map((s) => s.entityId)).toEqual(['org-b', 'org-a', 'org-c', 'org-d']);
  });

  it('a three-way cycle stays tied on head-to-head', () => {
    const ranking: GroupRanking = { win: 3, draw: 1, loss: 0, tiebreakers: ['points', 'head_to_head'] };
    expect(computePoolStandings(cycle, ranking).ties).toHaveLength(1);
  });

  it('match points come from the ranking', () => {
    const two: GroupRanking = { win: 2, draw: 1, loss: 0, tiebreakers: ['points'] };
    expect(computePoolStandings([fx('a', 'b', 1, 0, 'a')], two).standings[0].tally.points).toBe(2);
  });
});
