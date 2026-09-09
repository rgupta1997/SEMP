import { describe, it, expect } from 'vitest';
import { resolveUserIds, type NotificationPrisma } from './resolve-user-ids.js';
import { Rules } from '../core/rules.js';

// A fake matching exactly the NotificationPrisma port - no ORM, no schema drift
// risk beyond what this file itself declares. Every rule kind resolveUserIds
// supports gets its own in-memory table here, seeded per test.
function fakePrisma(seed: {
  championshipOfficials?: Array<{ championship_id: string; user_id: string; is_active: boolean }>;
  championshipOrganizations?: Array<{ championship_id: string; organization_id: string }>;
  organizationMembers?: Array<{ organization_id: string; user_id: string; role: string; status: string }>;
  teamMembers?: Array<{ team_id: string; user_id: string; role: string; is_active: boolean }>;
  teamEntries?: Array<{ championship_id: string; team_id: string }>;
  roles?: Array<{ id: string; code: string }>;
  userChampionshipRoles?: Array<{ championship_id: string; user_id: string; role_id: string }>;
}): NotificationPrisma {
  const {
    championshipOfficials = [], championshipOrganizations = [], organizationMembers = [],
    teamMembers = [], teamEntries = [], roles = [], userChampionshipRoles = [],
  } = seed;

  return {
    championship_officials: {
      findMany: async ({ where }) => championshipOfficials
        .filter((r) => r.championship_id === where.championship_id && r.is_active === where.is_active)
        .map((r) => ({ user_id: r.user_id })),
    },
    championship_organizations: {
      findMany: async ({ where }) => championshipOrganizations
        .filter((r) => r.championship_id === where.championship_id)
        .map((r) => ({ organization_id: r.organization_id })),
    },
    organization_members: {
      findMany: async ({ where }) => {
        const orgIds = typeof where.organization_id === 'string' ? [where.organization_id] : where.organization_id.in;
        const wantedRoles = typeof where.role === 'string' ? [where.role] : where.role.in;
        return organizationMembers
          .filter((r) => orgIds.includes(r.organization_id) && wantedRoles.includes(r.role) && r.status === where.status)
          .map((r) => ({ user_id: r.user_id }));
      },
    },
    team_members: {
      findMany: async ({ where }) => {
        const teamIds = where.team_id == null ? null : typeof where.team_id === 'string' ? [where.team_id] : where.team_id.in;
        return teamMembers
          .filter((r) => (teamIds == null || teamIds.includes(r.team_id))
            && r.is_active === where.is_active
            && (!where.role || where.role.in.includes(r.role)))
          .map((r) => ({ user_id: r.user_id }));
      },
    },
    roles: {
      findFirst: async ({ where }) => {
        const code = where.OR.find((o): o is { code: string } => 'code' in o && !!o.code)?.code;
        const row = roles.find((r) => r.code === code);
        return row ? { id: row.id } : null;
      },
    },
    team_entries: {
      findMany: async ({ where }) => teamEntries
        .filter((r) => r.championship_id === where.championship_id)
        .map((r) => ({ team_id: r.team_id })),
    },
    user_championship_roles: {
      findMany: async ({ where }) => userChampionshipRoles
        .filter((r) => r.championship_id === where.championship_id && where.role_id.in.includes(r.role_id))
        .map((r) => ({ user_id: r.user_id })),
    },
  };
}

describe('resolveUserIds · direct_user', () => {
  it('resolves to exactly the one named user', async () => {
    const ids = await resolveUserIds(fakePrisma({}), Rules.directUser('u1'));
    expect(ids).toEqual(new Set(['u1']));
  });
});

describe('resolveUserIds · org_admins', () => {
  it('returns only active owners/admins of the named org, not members or other orgs', async () => {
    const prisma = fakePrisma({
      organizationMembers: [
        { organization_id: 'org1', user_id: 'owner1', role: 'owner', status: 'active' },
        { organization_id: 'org1', user_id: 'admin1', role: 'admin', status: 'active' },
        { organization_id: 'org1', user_id: 'member1', role: 'member', status: 'active' },
        { organization_id: 'org1', user_id: 'suspended-admin', role: 'admin', status: 'suspended' },
        { organization_id: 'org2', user_id: 'other-org-admin', role: 'admin', status: 'active' },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.orgAdmins('org1'));
    expect(ids).toEqual(new Set(['owner1', 'admin1']));
  });
});

describe('resolveUserIds · team_members', () => {
  it('returns only active members of the named team', async () => {
    const prisma = fakePrisma({
      teamMembers: [
        { team_id: 'tA', user_id: 'p1', role: 'player', is_active: true },
        { team_id: 'tA', user_id: 'p2', role: 'captain', is_active: true },
        { team_id: 'tA', user_id: 'ex-player', role: 'player', is_active: false },
        { team_id: 'tB', user_id: 'p3', role: 'player', is_active: true },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.teamMembers('tA'));
    expect(ids).toEqual(new Set(['p1', 'p2']));
  });
});

describe('resolveUserIds · role', () => {
  it('official: reads championship_officials, not user_championship_roles', async () => {
    const prisma = fakePrisma({
      championshipOfficials: [
        { championship_id: 'c1', user_id: 'ref1', is_active: true },
        { championship_id: 'c1', user_id: 'ex-ref', is_active: false },
        { championship_id: 'c2', user_id: 'other-champ-ref', is_active: true },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.role('official', 'c1'));
    expect(ids).toEqual(new Set(['ref1']));
  });

  it('poc: the active owner of each org enrolled in the championship', async () => {
    const prisma = fakePrisma({
      championshipOrganizations: [{ championship_id: 'c1', organization_id: 'org1' }],
      organizationMembers: [
        { organization_id: 'org1', user_id: 'owner1', role: 'owner', status: 'active' },
        { organization_id: 'org1', user_id: 'admin1', role: 'admin', status: 'active' },
      ],
    });
    // POC is the OWNER specifically - an admin of the same org must not qualify.
    const ids = await resolveUserIds(prisma, Rules.role('poc', 'c1'));
    expect(ids).toEqual(new Set(['owner1']));
  });

  it('poc: empty when no organization is enrolled', async () => {
    const ids = await resolveUserIds(fakePrisma({}), Rules.role('poc', 'c1'));
    expect(ids).toEqual(new Set());
  });

  it('captain: captains and vice-captains of teams entered in the championship, not plain players', async () => {
    const prisma = fakePrisma({
      teamEntries: [{ championship_id: 'c1', team_id: 'tA' }],
      teamMembers: [
        { team_id: 'tA', user_id: 'captain1', role: 'captain', is_active: true },
        { team_id: 'tA', user_id: 'vc1', role: 'vice_captain', is_active: true },
        { team_id: 'tA', user_id: 'player1', role: 'player', is_active: true },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.role('captain', 'c1'));
    expect(ids).toEqual(new Set(['captain1', 'vc1']));
  });

  it('organiser: resolves the role by stable code, then the championship-scoped grant', async () => {
    const prisma = fakePrisma({
      roles: [{ id: 'role-organiser', code: 'organiser' }],
      userChampionshipRoles: [
        { championship_id: 'c1', user_id: 'org-user1', role_id: 'role-organiser' },
        { championship_id: 'c2', user_id: 'other-champ-organiser', role_id: 'role-organiser' },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.role('organiser', 'c1'));
    expect(ids).toEqual(new Set(['org-user1']));
  });

  it('organiser: empty (not a throw) when the platform role row does not exist', async () => {
    const ids = await resolveUserIds(fakePrisma({}), Rules.role('organiser', 'c1'));
    expect(ids).toEqual(new Set());
  });
});

describe('resolveUserIds · everyone', () => {
  it('unions organisers, officials, team members, and POCs for the championship', async () => {
    const prisma = fakePrisma({
      roles: [{ id: 'role-organiser', code: 'organiser' }],
      userChampionshipRoles: [{ championship_id: 'c1', user_id: 'organiser1', role_id: 'role-organiser' }],
      championshipOfficials: [{ championship_id: 'c1', user_id: 'ref1', is_active: true }],
      teamEntries: [{ championship_id: 'c1', team_id: 'tA' }],
      teamMembers: [{ team_id: 'tA', user_id: 'player1', role: 'player', is_active: true }],
      championshipOrganizations: [{ championship_id: 'c1', organization_id: 'org1' }],
      organizationMembers: [{ organization_id: 'org1', user_id: 'owner1', role: 'owner', status: 'active' }],
    });
    const ids = await resolveUserIds(prisma, Rules.everyone('c1'));
    expect(ids).toEqual(new Set(['organiser1', 'ref1', 'player1', 'owner1']));
  });

  it('does not leak people from a different championship', async () => {
    const prisma = fakePrisma({
      championshipOfficials: [{ championship_id: 'c2', user_id: 'other-champ-ref', is_active: true }],
    });
    const ids = await resolveUserIds(prisma, Rules.everyone('c1'));
    expect(ids).toEqual(new Set());
  });
});

describe('resolveUserIds · compose', () => {
  it('unions several rules and de-duplicates a person who matches more than one', async () => {
    const prisma = fakePrisma({
      organizationMembers: [{ organization_id: 'org1', user_id: 'admin1', role: 'admin', status: 'active' }],
      teamMembers: [
        { team_id: 'tA', user_id: 'coach1', role: 'coach', is_active: true },
        // Same person is both a captain of the team AND (in this seed) the org admin -
        // compose must return them once, not twice-as-a-count (a Set already
        // guarantees this, but the assertion pins the contract).
        { team_id: 'tA', user_id: 'admin1', role: 'captain', is_active: true },
      ],
    });
    const ids = await resolveUserIds(prisma, Rules.compose([
      Rules.teamMembers('tA'),
      Rules.orgAdmins('org1'),
    ]));
    expect(ids).toEqual(new Set(['coach1', 'admin1']));
  });

  it('resolves to an empty set when every child rule is empty', async () => {
    const ids = await resolveUserIds(fakePrisma({}), Rules.compose([
      Rules.orgAdmins('org1'),
      Rules.teamMembers('tA'),
    ]));
    expect(ids).toEqual(new Set());
  });
});
