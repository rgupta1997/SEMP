import { describe, it, expect } from 'vitest';
import type { RequestHandler } from 'express';
import { makeGuards } from './permissions.js';

// ---- test doubles -------------------------------------------------------
interface User { id: string; isSuperAdmin: boolean; organizationId: string | null }

const SUPER: User = { id: 'admin', isSuperAdmin: true, organizationId: null };
const ORGANISER: User = { id: 'org1', isSuperAdmin: false, organizationId: null };
const PLAYER: User = { id: 'p1', isSuperAdmin: false, organizationId: 'org-a' };
const OWNER: User = { id: 's1', isSuperAdmin: false, organizationId: 'org-a' };

// `orgAdmins`: list of "<userId>|<orgId>" the fake treats as owner/admin members.
//
// `hostOrg` / `hostOrgManagers` model the second route into a championship: an
// event is hosted BY an institution, and whoever holds `event.manage` there
// manages it. That goes through the permission engine, so the fake has to answer
// what the engine reads - the membership, its implied role, and that role's
// permission list.
function fakePrisma(over: {
  organiserChampionshipIds?: string[]; organiserUserId?: string;
  orgAdmins?: string[];
  /** The institution hosting every championship this fake is asked about. */
  hostOrg?: string | null;
  /** "<userId>|<orgId>" pairs who are Owner of that institution. */
  hostOrgManagers?: string[];
  team?: any; fixture?: any;
} = {}): any {
  const isAdmin = (userId: string, orgId: string) => (over.orgAdmins ?? []).includes(`${userId}|${orgId}`);
  const manages = (userId: string, orgId: string) => (over.hostOrgManagers ?? []).includes(`${userId}|${orgId}`);
  return {
    // findFirst, not findUnique: roles are org-scoped, so the organiser role is
    // resolved by stable code against the platform rows (see @semp/shared
    // role-codes), which is not a unique-key lookup.
    roles: {
      findFirst: async () => ({ id: 'role-org' }),
      // What being an Owner grants. `event.manage` sits in permission_ids rather
      // than in a role list in code, which is the whole point: an institution
      // moves it on its own Roles & Permissions screen.
      findMany: async (args: any) =>
        JSON.stringify(args?.where ?? {}).includes('"owner"')
          ? [{ code: 'owner', organization_id: null, permission_ids: ['event.manage'] }]
          : [],
    },
    user_org_roles: { findMany: async () => [] },
    user_championship_roles: {
      findFirst: async (args: any) =>
        (over.organiserChampionshipIds ?? []).includes(args.where.championship_id) && args.where.user_id === over.organiserUserId
          ? { id: 'uer' } : null,
    },
    organization_members: {
      findFirst: async (args: any) =>
        isAdmin(args.where.user_id, args.where.organization_id) || manages(args.where.user_id, args.where.organization_id)
          ? { id: 'om', role: manages(args.where.user_id, args.where.organization_id) ? 'owner' : 'member' }
          : null,
    },
    // No module switches configured, so nothing is gated off.
    organizations: { findUnique: async () => ({ settings: null }) },
    championships: { findUnique: async () => ({ host_organization_id: over.hostOrg ?? null }) },
    teams: { findUnique: async () => over.team ?? null },
    fixtures: { findUnique: async () => over.fixture ?? null },
  };
}

// Runs a guard and resolves whether it called next() (allow) or errored (deny).
function run(handler: RequestHandler, user: User, opts: { params?: any; body?: any; method?: string } = {}) {
  return new Promise<{ ok: boolean; status?: number }>((resolve) => {
    const req: any = { user, params: opts.params ?? {}, body: opts.body ?? {}, method: opts.method ?? 'POST' };
    const next = (err?: any) => resolve(err ? { ok: false, status: err?.status } : { ok: true });
    try { (handler as any)(req, {}, next); } catch (e: any) { resolve({ ok: false, status: e?.status }); }
  });
}

// ---- tests --------------------------------------------------------------
describe('enrollSelf', () => {
  it('allows an owner/admin to enroll their org', async () => {
    const g = makeGuards(fakePrisma({ orgAdmins: ['s1|org-a'] }));
    expect((await run(g.enrollSelf, OWNER, { body: { organization_id: 'org-a' } })).ok).toBe(true);
  });
  it('denies a plain member', async () => {
    const g = makeGuards(fakePrisma());
    expect((await run(g.enrollSelf, PLAYER, { body: { organization_id: 'org-a' } })).ok).toBe(false);
  });
});

describe('teamCreate', () => {
  it('allows an owner/admin creating for their org', async () => {
    const g = makeGuards(fakePrisma({ orgAdmins: ['s1|org-a'] }));
    expect((await run(g.teamCreate, OWNER, { body: { organization_id: 'org-a' } })).ok).toBe(true);
  });
  it('denies creating for an org you do not administer', async () => {
    const g = makeGuards(fakePrisma());
    expect((await run(g.teamCreate, PLAYER, { body: { organization_id: 'org-a' } })).ok).toBe(false);
  });
  it('allows bulk all-own-org', async () => {
    const g = makeGuards(fakePrisma({ orgAdmins: ['s1|org-a'] }));
    expect((await run(g.teamCreate, OWNER, { body: { teams: [{ organization_id: 'org-a' }, { organization_id: 'org-a' }] } })).ok).toBe(true);
  });
  it('denies bulk with a foreign org', async () => {
    const g = makeGuards(fakePrisma({ orgAdmins: ['s1|org-a'] }));
    expect((await run(g.teamCreate, OWNER, { body: { teams: [{ organization_id: 'org-a' }, { organization_id: 'org-b' }] } })).ok).toBe(false);
  });
});

describe('championshipManager', () => {
  it('allows super admin', async () => {
    const g = makeGuards(fakePrisma());
    expect((await run(g.championshipManager(async () => 'c1'), SUPER)).ok).toBe(true);
  });
  it('allows the organiser of that championship', async () => {
    const g = makeGuards(fakePrisma({ organiserChampionshipIds: ['c1'], organiserUserId: 'org1' }));
    expect((await run(g.championshipManager(async () => 'c1'), ORGANISER)).ok).toBe(true);
  });
  it('denies an organiser of a different championship', async () => {
    const g = makeGuards(fakePrisma({ organiserChampionshipIds: ['c2'], organiserUserId: 'org1' }));
    const r = await run(g.championshipManager(async () => 'c1'), ORGANISER);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  // The second route in. An event is run BY an institution, and until this existed
  // the only answer was an Organiser row on the event itself - so the owner of the
  // institution hosting it had no authority over its own event, and whoever was
  // named Organiser held it personally.
  it('allows the owner of the institution hosting it, with no Organiser row', async () => {
    const g = makeGuards(fakePrisma({ hostOrg: 'org-a', hostOrgManagers: ['s1|org-a'] }));
    expect((await run(g.championshipManager(async () => 'c1'), OWNER)).ok).toBe(true);
  });

  it('denies the owner of an institution that is not hosting it', async () => {
    const g = makeGuards(fakePrisma({ hostOrg: 'org-b', hostOrgManagers: ['s1|org-a'] }));
    const r = await run(g.championshipManager(async () => 'c1'), OWNER);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('denies a plain member of the hosting institution', async () => {
    // Being at the institution is not running its events - `event.manage` is.
    const g = makeGuards(fakePrisma({ hostOrg: 'org-a' }));
    expect((await run(g.championshipManager(async () => 'c1'), PLAYER)).ok).toBe(false);
  });

  it('denies everybody when an individual is hosting', async () => {
    // No host institution to inherit authority from - a real case, not missing data.
    const g = makeGuards(fakePrisma({ hostOrg: null, hostOrgManagers: ['s1|org-a'] }));
    expect((await run(g.championshipManager(async () => 'c1'), OWNER)).ok).toBe(false);
  });
});

describe('teamManager', () => {
  it('allows an owner/admin of the owning org', async () => {
    const g = makeGuards(fakePrisma({ team: { organization_id: 'org-a', team_members: [] }, orgAdmins: ['s1|org-a'] }));
    expect((await run(g.teamManager, OWNER, { params: { id: 't1' } })).ok).toBe(true);
  });
  it('allows the team captain', async () => {
    const g = makeGuards(fakePrisma({ team: { organization_id: 'org-a', team_members: [{ role: 'captain' }] } }));
    expect((await run(g.teamManager, PLAYER, { params: { id: 't1' } })).ok).toBe(true);
  });
  it('denies a non-captain player', async () => {
    const g = makeGuards(fakePrisma({ team: { organization_id: 'org-a', team_members: [] } }));
    expect((await run(g.teamManager, PLAYER, { params: { id: 't1' } })).ok).toBe(false);
  });
  it('denies an admin of another org', async () => {
    const g = makeGuards(fakePrisma({ team: { organization_id: 'org-b', team_members: [] }, orgAdmins: ['s1|org-a'] }));
    expect((await run(g.teamManager, OWNER, { params: { id: 't1' } })).ok).toBe(false);
  });
});

describe('fixtureScorer', () => {
  const fixture = { official_id: 'off1', tournament_disciplines: { tournament_sports: { tournaments: { championship_id: 'c1' } } } };
  it('allows the assigned official', async () => {
    const g = makeGuards(fakePrisma({ fixture }));
    const official: User = { id: 'off1', isSuperAdmin: false, organizationId: null };
    expect((await run(g.fixtureScorer, official, { params: { id: 'f1' } })).ok).toBe(true);
  });
  it('allows the championship organiser', async () => {
    const g = makeGuards(fakePrisma({ fixture, organiserChampionshipIds: ['c1'], organiserUserId: 'org1' }));
    expect((await run(g.fixtureScorer, ORGANISER, { params: { id: 'f1' } })).ok).toBe(true);
  });
  it('allows the owner of the hosting institution', async () => {
    const g = makeGuards(fakePrisma({ fixture, hostOrg: 'org-a', hostOrgManagers: ['s1|org-a'] }));
    expect((await run(g.fixtureScorer, OWNER, { params: { id: 'f1' } })).ok).toBe(true);
  });
  it('denies an unrelated user', async () => {
    const g = makeGuards(fakePrisma({ fixture }));
    const other: User = { id: 'x', isSuperAdmin: false, organizationId: null };
    const r = await run(g.fixtureScorer, other, { params: { id: 'f1' } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});
