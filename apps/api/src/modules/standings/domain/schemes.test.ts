import { describe, expect, it } from 'vitest';
import { DEFAULT_STANDINGS_RULE, type StandingsRule } from '@semp/shared';
import { runScheme, rankBy, accumulate, type SchemeFixture, type EntityTally } from './schemes.js';

// One team per org for brevity: team_id === org_id.
function fx(home: string, away: string, hs: number, as: number, round: string | null = null): SchemeFixture {
  const winner = hs > as ? home : as > hs ? away : null;
  return {
    status: 'completed', round,
    home_team_id: home, away_team_id: away,
    home_entity_id: home, away_entity_id: away,
    home_score: hs, away_score: as, winner_team_id: winner,
  };
}

const byId = (rows: EntityTally[]) => Object.fromEntries(rows.map((r) => [r.entity_id, r]));

describe('league_points scheme', () => {
  const rule = DEFAULT_STANDINGS_RULE; // 3 / 1 / 0

  it('awards win/draw/loss points and counts P/W/D/L', () => {
    const rows = byId(runScheme([fx('A', 'B', 2, 0), fx('A', 'C', 1, 1), fx('B', 'C', 3, 1)], rule));
    expect(rows.A).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, points: 4 });
    expect(rows.B).toMatchObject({ played: 2, won: 1, drawn: 0, lost: 1, points: 3 });
    expect(rows.C).toMatchObject({ played: 2, won: 0, drawn: 1, lost: 1, points: 1 });
  });

  it('honours custom point values', () => {
    const custom: StandingsRule = { scheme: 'league_points', win: 2, draw: 0, loss: 0, participation: 0, tiebreakers: ['points'] };
    const rows = byId(runScheme([fx('A', 'B', 2, 0)], custom));
    expect(rows.A.points).toBe(2);
    expect(rows.B.points).toBe(0);
  });

  it('ranks by tiebreakers (points then score_diff)', () => {
    const rows = runScheme([fx('A', 'B', 2, 0), fx('A', 'C', 1, 1), fx('B', 'C', 3, 1)], rule);
    const ranked = rankBy(rows, ['points', 'wins', 'lost', 'score_diff']);
    expect(ranked.map((r) => r.entity_id)).toEqual(['A', 'B', 'C']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe('placement scheme', () => {
  const rule: StandingsRule = { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }, participation: 0 };

  it('scores winner > runner-up > semi-finalists from a 4-team bracket', () => {
    // SF: A beat B, C beat D. Final: A beat C.
    const rows = byId(runScheme([
      fx('A', 'B', 2, 1, 'SF'),
      fx('C', 'D', 3, 0, 'SF'),
      fx('A', 'C', 1, 0, 'Final'),
    ], rule));
    expect(rows.A.points).toBe(7);
    expect(rows.C.points).toBe(5);
    expect(rows.B.points).toBe(3);
    expect(rows.D.points).toBe(3);
    expect(rows.A.detail).toEqual({ winner: 1 });
    expect(rows.C.detail).toEqual({ runner_up: 1 });
    // P/W/L still tallied from the knockout results.
    expect(rows.A).toMatchObject({ played: 2, won: 2, lost: 0 });
    expect(rows.C).toMatchObject({ played: 2, won: 1, lost: 1 });
  });

  it('lets a 3rd-place win outscore the semi-final loss', () => {
    const rows = byId(runScheme([
      fx('A', 'B', 2, 1, 'SF'),
      fx('C', 'D', 3, 0, 'SF'),
      fx('B', 'D', 1, 0, '3rd Place'), // B wins bronze match
      fx('A', 'C', 1, 0, 'Final'),
    ], { scheme: 'placement', points: { winner: 7, runner_up: 5, third_place: 4, fourth_place: 2, semi_finalist: 3 }, participation: 0 }));
    expect(rows.B.points).toBe(4); // third_place beats semi_finalist
    expect(rows.D.points).toBe(2); // fourth_place
  });
});

describe('medal scheme', () => {
  const rule: StandingsRule = { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 0 };

  it('awards gold/silver/bronze to the top three by win record', () => {
    // A 3-0, B 2-1, C 1-2, D 0-3 across a round robin.
    const rows = byId(runScheme([
      fx('A', 'B', 2, 0), fx('A', 'C', 2, 0), fx('A', 'D', 2, 0),
      fx('B', 'C', 2, 0), fx('B', 'D', 2, 0),
      fx('C', 'D', 2, 0),
    ], rule));
    expect(rows.A.points).toBe(5);
    expect(rows.B.points).toBe(3);
    expect(rows.C.points).toBe(1);
    expect(rows.D.points).toBe(0);
    expect(rows.A.detail).toEqual({ gold: 1 });
    expect(rows.D.detail).toEqual({});
  });
});

describe('participation points', () => {
  it('adds a flat point to every org that played, on top of the scheme', () => {
    const rule: StandingsRule = { scheme: 'league_points', win: 3, draw: 1, loss: 0, participation: 2, tiebreakers: ['points'] };
    const rows = byId(runScheme([fx('A', 'B', 2, 0)], rule));
    expect(rows.A.points).toBe(5); // win 3 + participation 2
    expect(rows.B.points).toBe(2); // loss 0 + participation 2
    expect(rows.A.detail.participation).toBe(1);
    expect(rows.B.detail.participation).toBe(1);
  });
});

describe('placement floors accrue progressively, round by round', () => {
  const rule: StandingsRule = { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }, participation: 1 };

  it('banks the semi-finalist floor as soon as a team wins through to the semis', () => {
    // Only the QFs are in: A/C/E/G reached the semis, B/D/F/H are out below them.
    const rows = byId(runScheme([
      fx('A', 'B', 2, 1, 'QF'), fx('C', 'D', 3, 0, 'QF'),
      fx('E', 'F', 1, 0, 'QF'), fx('G', 'H', 2, 0, 'QF'),
    ], rule));
    // Reached the semis → semi-finalist floor, credited immediately (no final yet).
    for (const t of ['A', 'C', 'E', 'G']) {
      expect(rows[t].points).toBe(3);
      expect(rows[t].detail).toMatchObject({ semi_finalist: 1 });
    }
    // Lost the QF → quarter-finalist points (configured), so no participation top-up.
    for (const t of ['B', 'D', 'F', 'H']) {
      expect(rows[t].points).toBe(1);
      expect(rows[t].detail).toMatchObject({ quarter_finalist: 1 });
      expect(rows[t].detail.participation).toBeUndefined();
    }
  });

  it('upgrades the floor to runner-up the moment a team reaches the final', () => {
    // QFs + SFs played, final still pending: A and E reached the final.
    const rows = byId(runScheme([
      fx('A', 'B', 2, 1, 'QF'), fx('C', 'D', 3, 0, 'QF'),
      fx('E', 'F', 1, 0, 'QF'), fx('G', 'H', 2, 0, 'QF'),
      fx('A', 'C', 1, 0, 'SF'), fx('E', 'G', 2, 1, 'SF'),
    ], rule));
    expect(rows.A.points).toBe(5); // reached final → runner-up floor
    expect(rows.E.points).toBe(5);
    expect(rows.C.points).toBe(3); // lost SF → stays at semi-finalist
    expect(rows.G.points).toBe(3);
  });
});

describe('placement participation is a sub-semis consolation only', () => {
  it('awards participation to a QF loser when no quarter-finalist points are configured', () => {
    const rule: StandingsRule = { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3 }, participation: 1 };
    const rows = byId(runScheme([fx('A', 'B', 2, 1, 'QF')], rule));
    expect(rows.A.points).toBe(3); // reached the semis
    expect(rows.A.detail.participation).toBeUndefined();
    expect(rows.B.points).toBe(1); // no QF points → consolation participation
    expect(rows.B.detail).toMatchObject({ participation: 1 });
  });

  it('does not give participation to anyone who reached the semis', () => {
    const rule: StandingsRule = { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3 }, participation: 1 };
    // 4-team bracket: everyone reaches at least the semis, so nobody gets participation.
    const rows = byId(runScheme([
      fx('A', 'B', 2, 1, 'SF'), fx('C', 'D', 3, 0, 'SF'), fx('A', 'C', 1, 0, 'Final'),
    ], rule));
    for (const t of ['A', 'B', 'C', 'D']) expect(rows[t].detail.participation).toBeUndefined();
    expect(rows.A.points).toBe(7);
    expect(rows.B.points).toBe(3);
  });
});

describe('placement byes earn the reached-stage floor', () => {
  const rule: StandingsRule = { scheme: 'placement', points: { winner: 7, runner_up: 5, semi_finalist: 3, quarter_finalist: 1 }, participation: 1 };
  const bye = (team: string, round: string): SchemeFixture => ({
    status: 'bye', round,
    home_team_id: team, away_team_id: null,
    home_entity_id: team, away_entity_id: null,
    home_score: null, away_score: null, winner_team_id: null,
  });

  it('a bye into the semis banks the semi-finalist floor with no match played', () => {
    const rows = byId(runScheme([bye('A', 'QF')], rule));
    expect(rows.A.points).toBe(3);
    expect(rows.A.detail).toMatchObject({ semi_finalist: 1 });
    expect(rows.A).toMatchObject({ played: 0 }); // a bye is not a played match
  });

  it('a bye into the final banks the runner-up floor', () => {
    const rows = byId(runScheme([bye('A', 'SF')], rule));
    expect(rows.A.points).toBe(5);
    expect(rows.A.detail).toMatchObject({ runner_up: 1 });
  });

  it('does not double-count a bye followed by a loss at that stage', () => {
    // A byes into the semis, then loses the SF; B reaches the semis the normal way.
    const rows = byId(runScheme([
      bye('A', 'QF'),
      fx('B', 'C', 2, 0, 'QF'),
      fx('B', 'A', 2, 1, 'SF'),
    ], rule));
    expect(rows.A.points).toBe(3); // semi-finalist floor, credited once
    expect(rows.A.detail).toMatchObject({ semi_finalist: 1 });
    expect(rows.B.points).toBe(5); // B won through to the final → runner-up floor
    expect(rows.C.points).toBe(1); // lost the QF → quarter-finalist points
  });
});

describe('medal position points are withheld until the discipline is decided', () => {
  const bracket = [fx('A', 'B', 2, 1, 'SF'), fx('C', 'D', 3, 0, 'SF'), fx('A', 'C', 1, 0, 'Final')];

  it('medal awards no medals while undecided', () => {
    const rule: StandingsRule = { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 0 };
    const undecided = byId(runScheme(bracket, rule, false));
    expect(undecided.A.points).toBe(0);
    expect(undecided.A.detail.gold).toBeUndefined();
  });
});

describe('accumulate across draws', () => {
  it('sums points and merges medal/placement detail by org', () => {
    const acc = new Map<string, EntityTally>();
    accumulate(acc, runScheme([fx('A', 'B', 2, 0)], DEFAULT_STANDINGS_RULE)); // A +3
    accumulate(acc, runScheme([fx('A', 'B', 1, 0)], { scheme: 'medal', gold: 5, silver: 3, bronze: 1, participation: 0 })); // A gold +5
    const a = acc.get('A')!;
    expect(a.points).toBe(8);
    expect(a.detail.gold).toBe(1);
    expect(a.played).toBe(2);
  });
});
