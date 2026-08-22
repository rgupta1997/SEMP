import type { StandingsRule } from '@semp/shared';
import { describe, expect, it } from 'vitest';
import { computePoolStandings, isPoolComplete, tiedRanks, type PoolFixture } from './pool-standings.js';

const rule: StandingsRule = { scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 0, tiebreakers: ['points', 'wins', 'lost'] };

// Two orgs' team ids deliberately differ from their org ids, so a test that reads
// the org id back instead of the team id would fail loudly.
const fx = (home: string, away: string, homeScore: number, awayScore: number, winner: string | null): PoolFixture => ({
  status: 'completed', round: 'Pool A - Match 1',
  home_team_id: `team-${home}`, away_team_id: `team-${away}`,
  home_org_id: `org-${home}`, away_org_id: `org-${away}`,
  home_score: homeScore, away_score: awayScore, winner_team_id: winner ? `team-${winner}` : null,
});

describe('computePoolStandings', () => {
  it('ranks a completed pool by points then tiebreakers, recovering team ids (not org ids)', () => {
    const fixtures: PoolFixture[] = [
      fx('a', 'b', 3, 1, 'a'),
      fx('a', 'c', 2, 2, null),
      fx('b', 'c', 1, 0, 'b'),
    ];
    const standings = computePoolStandings(fixtures, rule, ['points', 'wins', 'lost']);
    expect(standings.map((s) => s.teamId)).toEqual(['team-a', 'team-b', 'team-c']);
    expect(standings[0].rank).toBe(1);
    expect(standings.map((s) => s.organizationId)).toEqual(['org-a', 'org-b', 'org-c']);
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

describe('tiedRanks', () => {
  it('flags adjacent ranks that are fully tied on every configured tiebreaker', () => {
    const fixtures: PoolFixture[] = [fx('a', 'b', 1, 1, null)]; // a draw - both sides identical on points/wins/lost
    const standings = computePoolStandings(fixtures, rule, ['points', 'wins', 'lost']);
    const tied = tiedRanks(standings, ['points', 'wins', 'lost']);
    expect(tied.has(1)).toBe(true);
    expect(tied.has(2)).toBe(true);
  });

  it('flags nothing when ranks are clearly separated', () => {
    const fixtures: PoolFixture[] = [fx('a', 'b', 3, 0, 'a')];
    const standings = computePoolStandings(fixtures, rule, ['points', 'wins', 'lost']);
    expect(tiedRanks(standings, ['points', 'wins', 'lost']).size).toBe(0);
  });
});
