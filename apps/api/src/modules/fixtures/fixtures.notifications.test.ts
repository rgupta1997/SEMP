import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { newlyAwarded, notifyNewAwards, notifyOfficialAssignment } = await import('./fixtures.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function callsOfType(type: string) {
  return notify.mock.calls.filter((c: any[]) => c[1]?.type === type).map((c: any[]) => c[1]);
}

describe('newlyAwarded', () => {
  function fakePrisma(existing: Array<{ recipient_user_id: string; award_name: string; award_type_id: string | null }>) {
    return { fixture_awards: { findMany: async () => existing } } as any;
  }

  it('returns everything when nothing was recorded before', async () => {
    const prisma = fakePrisma([]);
    const awards = [{ award_name: 'MVP', award_type_id: null, recipient_user_id: 'u1' }];
    await expect(newlyAwarded(prisma, 'fx1', awards)).resolves.toEqual(awards);
  });

  it('filters out an award already recorded for the same recipient/name/type', async () => {
    const prisma = fakePrisma([{ recipient_user_id: 'u1', award_name: 'MVP', award_type_id: 'type1' }]);
    const awards = [
      { award_name: 'MVP', award_type_id: 'type1', recipient_user_id: 'u1' }, // unchanged - not new
      { award_name: 'Fair Play', award_type_id: null, recipient_user_id: 'u2' }, // genuinely new
    ];
    const result = await newlyAwarded(prisma, 'fx1', awards);
    expect(result).toEqual([{ award_name: 'Fair Play', award_type_id: null, recipient_user_id: 'u2' }]);
  });

  it('treats the same name/recipient with a different type as new', async () => {
    const prisma = fakePrisma([{ recipient_user_id: 'u1', award_name: 'MVP', award_type_id: 'type1' }]);
    const awards = [{ award_name: 'MVP', award_type_id: 'type2', recipient_user_id: 'u1' }];
    await expect(newlyAwarded(prisma, 'fx1', awards)).resolves.toEqual(awards);
  });
});

describe('notifyNewAwards', () => {
  function fakePrisma(seed: { awardTypeCode?: string | null; home?: string; away?: string; championshipId?: string } = {}) {
    return {
      award_types: {
        findMany: async () => (seed.awardTypeCode ? [{ id: 'type1', code: seed.awardTypeCode }] : []),
      },
      fixtures: {
        findUnique: async () => ({
          teams_fixtures_home_team_idToteams: { name: seed.home ?? 'IIMB' },
          teams_fixtures_away_team_idToteams: { name: seed.away ?? 'IIMA' },
          tournament_disciplines: { tournament_sports: { tournaments: { championship_id: seed.championshipId ?? 'champ1' } } },
        }),
      },
    } as any;
  }

  it('does nothing when there are no new awards', async () => {
    await notifyNewAwards(fakePrisma(), 'fx1', [], 'actor1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends player_of_the_match when the award type code matches', async () => {
    const prisma = fakePrisma({ awardTypeCode: 'player_of_the_match' });
    await notifyNewAwards(prisma, 'fx1', [{ award_name: 'POTM', award_type_id: 'type1', recipient_user_id: 'u1' }], 'actor1');

    const sent = callsOfType('player_of_the_match');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ championshipId: 'champ1', userId: 'u1', data: { label: 'IIMB vs IIMA', awardName: 'POTM' } });
    expect(callsOfType('tournament_award')).toHaveLength(0);
  });

  it('sends tournament_award for any other award type, and for untyped awards', async () => {
    const prisma = fakePrisma({ awardTypeCode: 'fair_play' });
    await notifyNewAwards(prisma, 'fx1', [
      { award_name: 'Fair Play', award_type_id: 'type1', recipient_user_id: 'u1' },
      { award_name: 'Crowd favourite', award_type_id: null, recipient_user_id: 'u2' },
    ], 'actor1');

    expect(callsOfType('player_of_the_match')).toHaveLength(0);
    expect(callsOfType('tournament_award')).toHaveLength(2);
  });

  // The exact regression this test guards: one recipient's notify() throwing must
  // not swallow every award notification queued after it in the same batch.
  it('one recipient failing does not block the rest of the batch', async () => {
    const prisma = fakePrisma();
    notify
      .mockResolvedValueOnce({} as never)      // u1 (player_of_the_match check call from award_types is separate, this is the notify() for u1)
      .mockRejectedValueOnce(new Error('down') as never) // u2 fails
      .mockResolvedValueOnce({} as never);      // u3 must still be attempted

    await notifyNewAwards(prisma, 'fx1', [
      { award_name: 'A1', award_type_id: null, recipient_user_id: 'u1' },
      { award_name: 'A2', award_type_id: null, recipient_user_id: 'u2' },
      { award_name: 'A3', award_type_id: null, recipient_user_id: 'u3' },
    ], 'actor1');

    const recipients = callsOfType('tournament_award').map((s: any) => s.userId);
    expect(recipients).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('notifyOfficialAssignment', () => {
  const FX = {
    id: 'fx1',
    official_id: null as string | null,
    scheduled_at: null as Date | null,
    teams_fixtures_home_team_idToteams: { name: 'IIMB' },
    teams_fixtures_away_team_idToteams: { name: 'IIMA' },
    venue_grounds: null,
    tournament_disciplines: null,
  };

  it('tells the newly-assigned official, with schedule/venue folded into the details', async () => {
    await notifyOfficialAssignment({} as any, { ...FX, scheduled_at: new Date('2026-10-01T10:00:00Z') }, 'champ1', 'ref1', 'actor1');

    const sent = callsOfType('match_official_assigned');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ championshipId: 'champ1', userId: 'ref1' });
    expect(sent[0].data.label).toBe('IIMB vs IIMA');
    expect(sent[0].data.details).toMatch(/Scheduled for/);
  });

  it('tells the PREVIOUS official they have been reassigned away', async () => {
    await notifyOfficialAssignment({} as any, { ...FX, official_id: 'old-ref' }, 'champ1', 'new-ref', 'actor1');

    const manual = callsOfType('manual');
    expect(manual).toHaveLength(1);
    expect(manual[0].userId).toBe('old-ref');
    expect(manual[0].data.title).toMatch(/No longer officiating/);
  });

  it('does not tell a previous official anything when there was none', async () => {
    await notifyOfficialAssignment({} as any, { ...FX, official_id: null }, 'champ1', 'new-ref', 'actor1');
    expect(callsOfType('manual')).toHaveLength(0);
  });

  it('does not send match_official_assigned when the assignment is being cleared', async () => {
    await notifyOfficialAssignment({} as any, { ...FX, official_id: 'old-ref' }, 'champ1', null, 'actor1');
    expect(callsOfType('match_official_assigned')).toHaveLength(0);
    // Clearing still leaves the previous official told they've lost the match.
    expect(callsOfType('manual')).toHaveLength(1);
  });
});
