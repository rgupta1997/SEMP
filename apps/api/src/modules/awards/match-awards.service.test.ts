import { describe, it, expect } from 'vitest';
import { toMatchAwardRows } from './match-awards.service.js';
import type { AwardTypeView } from './award-types.service.js';

const type = (id: string, label: string, recipient_kind: 'player' | 'team'): AwardTypeView => ({
  id, code: id, label, description: null, levels: ['match'], recipient_kind, all_sports: true,
  is_active: true, sort_order: 10, championship_id: null, sport_ids: [], sports: [],
});

const POTM = type('potm', 'Player of the Match', 'player');
const FAIR = type('fair', 'Fair Play', 'team');
const sides = { teamIds: ['home', 'away'], playerIds: new Set(['p1', 'p2']) };

describe('toMatchAwardRows', () => {
  it('snapshots the label and keeps the right recipient column', () => {
    const rows = toMatchAwardRows([
      { award_type_id: 'potm', recipient_user_id: 'p1' },
      { award_type_id: 'fair', recipient_team_id: 'away' },
    ], [POTM, FAIR], sides);
    expect(rows).toEqual([
      { award_type_id: 'potm', award_name: 'Player of the Match', recipient_user_id: 'p1', recipient_team_id: null },
      { award_type_id: 'fair', award_name: 'Fair Play', recipient_user_id: null, recipient_team_id: 'away' },
    ]);
  });

  it('rejects a type not offered for this sport', () => {
    expect(() => toMatchAwardRows([{ award_type_id: 'best_raider', recipient_user_id: 'p1' }], [POTM], sides))
      .toThrow('not offered here');
  });

  it('rejects a player award given to a team, and the reverse', () => {
    expect(() => toMatchAwardRows([{ award_type_id: 'potm', recipient_team_id: 'home' }], [POTM], sides)).toThrow('goes to a player');
    expect(() => toMatchAwardRows([{ award_type_id: 'fair', recipient_user_id: 'p1' }], [FAIR], sides)).toThrow('goes to a team');
  });

  it('rejects a recipient who is not in this match', () => {
    expect(() => toMatchAwardRows([{ award_type_id: 'potm', recipient_user_id: 'stranger' }], [POTM], sides)).toThrow('player in this match');
    expect(() => toMatchAwardRows([{ award_type_id: 'fair', recipient_team_id: 'other' }], [FAIR], sides)).toThrow('team in this match');
  });

  it('rejects the same award twice for the same recipient', () => {
    expect(() => toMatchAwardRows([
      { award_type_id: 'potm', recipient_user_id: 'p1' },
      { award_type_id: 'potm', recipient_user_id: 'p1' },
    ], [POTM], sides)).toThrow('listed twice');
  });
});
