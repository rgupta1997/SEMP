import { describe, it, expect } from 'vitest';
import { expandAwards, type GivenAward } from './award-recipients.js';

const award = (over: Partial<GivenAward>): GivenAward => ({
  awardRef: 'match:fx1:potm', title: 'Player of the Match', level: 'match', scope: 'Riders vs Blasters',
  sportName: 'Football', fixtureId: 'fx1', lockVersion: 1, recipientUserId: null, recipientTeamId: null, ...over,
});
const users = new Map([['p1', 'Asha'], ['p9', 'Ravi']]);
const teams = new Map([['tA', { name: 'Riders', members: [{ id: 'p1', name: 'Asha' }, { id: 'p2', name: 'Bela' }] }]]);

describe('expandAwards', () => {
  it('gives a player award to the player, with no team named', () => {
    expect(expandAwards([award({ recipientUserId: 'p1' })], users, teams)).toEqual([
      expect.objectContaining({ userId: 'p1', name: 'Asha', title: 'Player of the Match', team: null, awardRef: 'match:fx1:potm' }),
    ]);
  });

  it('expands a team award to every active member, naming the team', () => {
    const out = expandAwards([award({ awardRef: 'championship:tournament:t1:best_team', title: 'Best Team', recipientTeamId: 'tA' })], users, teams);
    expect(out.map((c) => [c.userId, c.team])).toEqual([['p1', 'Riders'], ['p2', 'Riders']]);
  });

  it('keeps two different awards to the same person as two candidates', () => {
    const out = expandAwards([
      award({ recipientUserId: 'p1' }),
      award({ awardRef: 'match:fx1:raider', title: 'Best Raider', recipientUserId: 'p1' }),
    ], users, teams);
    expect(out.map((c) => c.title)).toEqual(['Player of the Match', 'Best Raider']);
  });

  it('narrows to one team: its team awards and its own players', () => {
    const out = expandAwards([
      award({ recipientUserId: 'p1' }),
      award({ awardRef: 'match:fx2:potm', recipientUserId: 'p9' }),
      award({ awardRef: 'championship:tournament:t1:fair', title: 'Fair Play', recipientTeamId: 'tB' }),
    ], users, teams, 'tA');
    expect(out.map((c) => c.userId)).toEqual(['p1']);
  });
});
