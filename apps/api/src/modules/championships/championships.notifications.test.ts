import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Rules } from '@semp/notifications/core/rules.js';

const notify = vi.fn(async (..._args: any[]) => ({} as any));
vi.mock('@semp/notifications/server/notify.js', () => ({ notify: (...a: any[]) => notify(...a as []) }));

const { notifyStatusChanged, notifyRegistrationOpened, notifyChampionshipPublished } = await import('./championships.notifications.js');

beforeEach(() => { notify.mockReset(); notify.mockResolvedValue({} as never); });

describe('notifyStatusChanged (statuses other than registration_open)', () => {
  it('fires event_lifecycle with the default (poc/captain) audience', async () => {
    await notifyStatusChanged({} as any, 'champ1', 'ongoing', 'actor1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.championshipId).toBe('champ1');
    expect(sent.data.status).toBe('ongoing');
    // No explicit audience override here - this leaves the registry's own
    // default (poc + captain) to resolve it.
    expect(sent.audience).toBeUndefined();
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyStatusChanged({} as any, 'champ1', 'completed', 'actor1')).resolves.toBeUndefined();
  });
});

describe('notifyStatusChanged("registration_open") delegates to notifyRegistrationOpened', () => {
  it('routes through the snapshot audience instead of the generic default', async () => {
    const prisma = fakePrisma({ hostOrgId: null, participatingOrgs: [] });
    await notifyStatusChanged(prisma, 'champ1', 'registration_open', 'actor1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.audience).toBeDefined(); // an explicit audience, unlike the default-path test above
  });
});

// A fake covering every table notifyRegistrationOpened/orgEveryoneRules touch:
// championships (host lookup), championship_organizations (who's already in),
// organization_members/teams/team_members/user_org_roles (org_everyone snapshot).
function fakePrisma(seed: {
  hostOrgId: string | null;
  participatingOrgs: string[];
  orgMembers?: Record<string, string[]>;               // orgId -> active member user ids
  orgTeams?: Record<string, Array<{ id: string; coach_user_id: string | null }>>;
  teamRosters?: Record<string, string[]>;               // teamId -> active roster user ids
  orgRoleGrants?: Record<string, string[]>;             // orgId -> user ids holding a role grant
}) {
  const orgMembers = seed.orgMembers ?? {};
  const orgTeams = seed.orgTeams ?? {};
  const teamRosters = seed.teamRosters ?? {};
  const orgRoleGrants = seed.orgRoleGrants ?? {};

  return {
    championships: {
      findUnique: async () => ({ host_organization_id: seed.hostOrgId }),
    },
    championship_organizations: {
      findMany: async () => seed.participatingOrgs.map((organization_id) => ({ organization_id })),
    },
    organization_members: {
      findMany: async ({ where }: any) => (orgMembers[where.organization_id] ?? []).map((user_id) => ({ user_id })),
    },
    teams: {
      findMany: async ({ where }: any) => orgTeams[where.organization_id] ?? [],
    },
    team_members: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where.team_id.in;
        const out: { user_id: string }[] = [];
        for (const teamId of ids) for (const userId of teamRosters[teamId] ?? []) out.push({ user_id: userId });
        return out;
      },
    },
    user_org_roles: {
      findMany: async ({ where }: any) => (orgRoleGrants[where.organization_id] ?? []).map((user_id) => ({ user_id })),
    },
  } as any;
}

describe('notifyRegistrationOpened', () => {
  it('tells the host org EVERYONE (members, team rosters, coaches, role grants) when it is itself a participant', async () => {
    const prisma = fakePrisma({
      hostOrgId: 'host1',
      participatingOrgs: ['host1'],
      orgMembers: { host1: ['member1'] },
      orgTeams: { host1: [{ id: 'tA', coach_user_id: 'coach1' }] },
      teamRosters: { tA: ['player1'] },
      orgRoleGrants: { host1: ['sportsadmin1'] },
    });
    await notifyRegistrationOpened(prisma, 'champ1', 'actor1');

    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.data.status).toBe('registration_open');
    expect(sent.audience).toEqual(Rules.compose([
      Rules.directUser('member1'),
      Rules.directUser('coach1'),
      Rules.directUser('sportsadmin1'),
      Rules.directUser('player1'),
      Rules.role('captain', 'champ1'),
    ]));
  });

  it('still tells the host org everyone even when the host has no participation row of its own', async () => {
    const prisma = fakePrisma({
      hostOrgId: 'host1',
      participatingOrgs: [], // host opted out of competing - runs the event only
      orgMembers: { host1: ['member1'] },
      orgTeams: {},
      orgRoleGrants: {},
    });
    await notifyRegistrationOpened(prisma, 'champ1', 'actor1');

    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.audience).toEqual(Rules.compose([
      Rules.directUser('member1'),
      Rules.role('captain', 'champ1'),
    ]));
  });

  it('gives an already-participating NON-host org just its admins, not the everyone treatment', async () => {
    const prisma = fakePrisma({
      hostOrgId: 'host1',
      participatingOrgs: ['host1', 'guest1'],
      orgMembers: { host1: [] },
      orgTeams: {},
      orgRoleGrants: {},
    });
    await notifyRegistrationOpened(prisma, 'champ1', 'actor1');

    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.audience).toEqual(Rules.compose([
      Rules.orgAdmins('guest1'),
      Rules.role('captain', 'champ1'),
    ]));
  });

  it('has no host and no prior participants - only the (empty, for now) captain role remains', async () => {
    const prisma = fakePrisma({ hostOrgId: null, participatingOrgs: [] });
    await notifyRegistrationOpened(prisma, 'champ1', 'actor1');

    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.audience).toEqual(Rules.compose([Rules.role('captain', 'champ1')]));
  });

  it('an org that already applied (still pending) is included the same as an accepted one', async () => {
    // championship_organizations carries no status filter here - a pending
    // application already counts, matching resolveUserIds' own poc/admin checks.
    const prisma = fakePrisma({ hostOrgId: null, participatingOrgs: ['applicant1'] });
    await notifyRegistrationOpened(prisma, 'champ1', 'actor1');

    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.audience).toEqual(Rules.compose([Rules.orgAdmins('applicant1'), Rules.role('captain', 'champ1')]));
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    const prisma = fakePrisma({ hostOrgId: null, participatingOrgs: [] });
    await expect(notifyRegistrationOpened(prisma, 'champ1', 'actor1')).resolves.toBeUndefined();
  });
});

describe('notifyChampionshipPublished', () => {
  it('fires event_lifecycle to the organiser only, not the default audience', async () => {
    await notifyChampionshipPublished({} as any, 'champ1', 'actor1');
    expect(notify).toHaveBeenCalledOnce();
    const sent = (notify.mock.calls[0] as any[])[1];
    expect(sent.type).toBe('event_lifecycle');
    expect(sent.data.visibility).toBe('public');
    expect(sent.audience).toEqual(Rules.role('organiser', 'champ1'));
  });

  it('swallows a notify() failure rather than throwing', async () => {
    notify.mockRejectedValueOnce(new Error('down') as never);
    await expect(notifyChampionshipPublished({} as any, 'champ1', 'actor1')).resolves.toBeUndefined();
  });
});
