import { describe, it, expect } from 'vitest';
import { awardAchievementRows, scopeKey } from './award-achievements.service.js';
import type { AwardScope } from './championship-awards.service.js';

const scope: AwardScope = {
  level: 'championship', championshipId: 'ev1', tournamentId: null, tournamentSportId: null,
  sportIds: ['kabaddi', 'football'], where: 'this event',
};
const teams = [
  { id: 'tK', name: 'Raiders', organization_id: 'o1', sport_id: 'kabaddi', member_ids: ['p1', 'p2'] },
  { id: 'tF', name: 'Strikers', organization_id: 'o2', sport_id: 'football', member_ids: ['p3'] },
];
const given = new Date('2026-10-22T10:00:00Z');

describe('awardAchievementRows', () => {
  it("files a player's event award under the sport and organisation they played for", () => {
    const rows = awardAchievementRows(
      [{ award_type_code: 'mvp', award_name: 'Most Valuable Player', recipient_user_id: 'p3', recipient_team_id: null, notes: null, given_at: given }],
      teams, scope, 'Inter-School Championship',
    );
    expect(rows).toEqual([{
      user_id: 'p3', organization_id: 'o2', sport_id: 'football',
      title: 'Most Valuable Player - Inter-School Championship',
      detail: { award_type_code: 'mvp', award_name: 'Most Valuable Player', award_level: 'championship', award_scope: scopeKey(scope) },
      occurred_on: given,
    }]);
  });

  it('gives a team award to every member, naming the team', () => {
    const rows = awardAchievementRows(
      [{ award_type_code: 'best_team', award_name: 'Best Team', recipient_user_id: null, recipient_team_id: 'tK', notes: 'Unbeaten', given_at: given }],
      teams, scope, 'Inter-School Championship',
    );
    expect(rows.map((r) => r.user_id)).toEqual(['p1', 'p2']);
    expect(rows[0].detail).toMatchObject({ team_award: true, award_team_id: 'tK', team_name: 'Raiders', notes: 'Unbeaten' });
    expect(rows.every((r) => r.sport_id === 'kabaddi' && r.organization_id === 'o1')).toBe(true);
  });

  it('dates each achievement the day its award was given, not the event end', () => {
    const later = new Date('2026-10-25T10:00:00Z');
    const rows = awardAchievementRows([
      { award_type_code: 'mvp', award_name: 'Most Valuable Player', recipient_user_id: 'p3', recipient_team_id: null, notes: null, given_at: given },
      { award_type_code: 'best_team', award_name: 'Best Team', recipient_user_id: null, recipient_team_id: 'tK', notes: null, given_at: later },
    ], teams, scope, 'Inter-School Championship');
    expect(rows.map((r) => [r.user_id, r.occurred_on])).toEqual([['p3', given], ['p1', later], ['p2', later]]);
  });

  it('keys each scope apart, so a save supersedes only its own rows', () => {
    expect(scopeKey(scope)).toBe('championship:ev1');
    expect(scopeKey({ ...scope, level: 'tournament_sport', tournamentId: 't1', tournamentSportId: 'ts1' })).toBe('tournament_sport:ts1');
  });
});
