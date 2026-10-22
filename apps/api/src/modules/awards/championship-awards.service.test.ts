import { describe, it, expect } from 'vitest';
import { toChampionshipAwardRows, type AwardScope } from './championship-awards.service.js';
import type { AwardTypeView } from './award-types.service.js';

const type = (id: string, label: string, recipient_kind: 'player' | 'team'): AwardTypeView => ({
  id, code: id, label, description: null, levels: ['tournament_sport'], recipient_kind, all_sports: true,
  is_active: true, sport_ids: [], sports: [], sort_order: 10, championship_id: null,
});

const scope: AwardScope = {
  level: 'tournament_sport', championshipId: 'ev1', tournamentId: 't1', tournamentSportId: 'ts1',
  sportIds: ['kabaddi'], where: 'this sport',
};
const participants = {
  teams: [{ id: 'tA', name: 'Strikers', organization: null, sport: 'Kabaddi', organization_id: 'o1', sport_id: 'kabaddi' }],
  players: [{ id: 'p1', name: 'Asha', team_id: 'tA', team: 'Strikers' }],
};
const BEST = type('best', 'Best Raider', 'player');
const TEAM = type('team', 'Best Team', 'team');

describe('toChampionshipAwardRows', () => {
  it('stamps each row with its scope, label and notes', () => {
    const rows = toChampionshipAwardRows([
      { award_type_id: 'best', recipient_user_id: 'p1', notes: '  42 raid points ' },
      { award_type_id: 'team', recipient_team_id: 'tA' },
    ], [BEST, TEAM], participants, scope);
    expect(rows).toEqual([
      {
        award_type_id: 'best', award_name: 'Best Raider', recipient_user_id: 'p1', recipient_team_id: null, notes: '42 raid points',
        level: 'tournament_sport', championship_id: 'ev1', tournament_id: 't1', tournament_sport_id: 'ts1',
      },
      {
        award_type_id: 'team', award_name: 'Best Team', recipient_user_id: null, recipient_team_id: 'tA', notes: null,
        level: 'tournament_sport', championship_id: 'ev1', tournament_id: 't1', tournament_sport_id: 'ts1',
      },
    ]);
  });

  it('refuses someone who did not take part in the scope, naming the scope', () => {
    expect(() => toChampionshipAwardRows([{ award_type_id: 'best', recipient_user_id: 'outsider' }], [BEST], participants, scope))
      .toThrow('must go to a player in this sport');
    expect(() => toChampionshipAwardRows([{ award_type_id: 'team', recipient_team_id: 'tZ' }], [TEAM], participants, scope))
      .toThrow('must go to a team in this sport');
  });

  it('refuses a type not offered in the scope', () => {
    expect(() => toChampionshipAwardRows([{ award_type_id: 'nope', recipient_user_id: 'p1' }], [BEST], participants, scope))
      .toThrow('not offered here');
  });
});
