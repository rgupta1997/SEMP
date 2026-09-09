import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Rules } from '@semp/notifications/core/rules.js';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { tellUser, notifyRosterIncomplete, checkRosterIncomplete, notifyRosterLocked } = await import('./teams.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

function callOfType(type: string) {
  const call = notify.mock.calls.find((c: any[]) => c[1]?.type === type);
  return call?.[1] as any;
}

describe('tellUser', () => {
  it('notifies the named user with the given type and data', async () => {
    await tellUser({} as any, 'actor1', 'user1', 'team_created', { teamName: 'IIMB' });
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent).toMatchObject({ type: 'team_created', userId: 'user1', senderId: 'actor1', data: { teamName: 'IIMB' } });
  });

  it('swallows a notification failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(tellUser({} as any, 'actor1', 'user1', 'team_created', {})).resolves.toBeUndefined();
  });
});

describe('notifyRosterIncomplete', () => {
  function fakePrisma(team: { organization_id: string; coach_user_id: string | null; captains: string[] } | null) {
    return {
      teams: {
        findUnique: async () => team && {
          organization_id: team.organization_id,
          coach_user_id: team.coach_user_id,
          team_members: team.captains.map((user_id) => ({ user_id })),
        },
      },
    } as any;
  }

  it('composes coach + captains/vice-captains + org admins, never the whole roster', async () => {
    const prisma = fakePrisma({ organization_id: 'org1', coach_user_id: 'coach1', captains: ['cap1', 'vc1'] });
    await notifyRosterIncomplete(prisma, 'tA', 'actor1', { teamName: 'IIMB' });

    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('roster_incomplete');
    expect(sent.audience).toEqual(Rules.compose([
      Rules.directUser('coach1'),
      Rules.directUser('cap1'),
      Rules.directUser('vc1'),
      Rules.orgAdmins('org1'),
    ]));
  });

  it('omits the coach from the audience when the team has none', async () => {
    const prisma = fakePrisma({ organization_id: 'org1', coach_user_id: null, captains: ['cap1'] });
    await notifyRosterIncomplete(prisma, 'tA', 'actor1', {});
    const sent = callOfType('roster_incomplete');
    expect(sent.audience).toEqual(Rules.compose([Rules.directUser('cap1'), Rules.orgAdmins('org1')]));
  });

  it('does nothing when the team no longer exists', async () => {
    const prisma = fakePrisma(null);
    await notifyRosterIncomplete(prisma, 'tA', 'actor1', {});
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('checkRosterIncomplete', () => {
  function fakePrisma(seed: {
    override?: { squad_min?: number | null } | null;
    masterSquadMin?: number | null;
    activeCount: number;
    teamName?: string;
  } | null) {
    return {
      tournament_disciplines: {
        findUnique: async () => seed && {
          squad_min: seed.override?.squad_min ?? null,
          disciplines: { name: 'Football', squad_min: seed.masterSquadMin ?? null },
        },
      },
      team_members: { count: async () => seed?.activeCount ?? 0 },
      // Serves both this function's own {name} lookup AND notifyRosterIncomplete's
      // own {organization_id, coach_user_id, team_members} lookup when it fires -
      // a real Prisma client answers both `select` shapes from one row.
      teams: {
        findUnique: async () => seed && {
          name: seed.teamName ?? 'IIMB', organization_id: 'org1', coach_user_id: null, team_members: [],
        },
      },
    } as any;
  }

  it('fires roster_incomplete when the active roster is under squad_min', async () => {
    const prisma = fakePrisma({ masterSquadMin: 5, activeCount: 2, teamName: 'IIMB' });
    await checkRosterIncomplete(prisma, 'tA', 'actor1', 'draw1');

    const sent = callOfType('roster_incomplete');
    expect(sent).toBeDefined();
    expect(sent.data).toMatchObject({ teamName: 'IIMB', count: 2, squadMin: 5, disciplineName: 'Football' });
  });

  it('does not fire when the roster already meets squad_min', async () => {
    const prisma = fakePrisma({ masterSquadMin: 5, activeCount: 5, teamName: 'IIMB' });
    await checkRosterIncomplete(prisma, 'tA', 'actor1', 'draw1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a tournament_discipline override wins over the master discipline default', async () => {
    // Master says 5, but this specific draw overrides it down to 2 - a roster
    // of 3 should now be considered complete, not incomplete.
    const prisma = fakePrisma({ masterSquadMin: 5, override: { squad_min: 2 }, activeCount: 3, teamName: 'IIMB' });
    await checkRosterIncomplete(prisma, 'tA', 'actor1', 'draw1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing when the discipline draw no longer exists', async () => {
    const prisma = fakePrisma(null);
    await checkRosterIncomplete(prisma, 'tA', 'actor1', 'draw1');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('notifyRosterLocked', () => {
  it('notifies the whole team that its roster is locked', async () => {
    const prisma = { teams: { findUnique: async () => ({ name: 'IIMB' }) } } as any;
    await notifyRosterLocked(prisma, 'tA', 'actor1');

    const sent = callOfType('team_roster_locked');
    expect(sent).toBeDefined();
    expect(sent.teamId).toBe('tA');
    expect(sent.data.teamName).toBe('IIMB');
  });
});
