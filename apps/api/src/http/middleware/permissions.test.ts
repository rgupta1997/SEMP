import { describe, it, expect } from 'vitest';
import type { RequestHandler } from 'express';
import { makeGuards } from './permissions.js';

// ---- test doubles -------------------------------------------------------
interface User { id: string; isSuperAdmin: boolean; accountType: string; institutionId: string | null }

const SUPER: User = { id: 'admin', isSuperAdmin: true, accountType: 'organiser', institutionId: null };
const ORGANISER: User = { id: 'org1', isSuperAdmin: false, accountType: 'organiser', institutionId: null };
const PARTICIPANT: User = { id: 'p1', isSuperAdmin: false, accountType: 'participant', institutionId: 'inst1' };
const STAFF: User = { id: 's1', isSuperAdmin: false, accountType: 'institution', institutionId: 'inst1' };

function fakePrisma(over: {
  organiserEventIds?: string[]; organiserUserId?: string;
  team?: any; fixture?: any;
} = {}): any {
  return {
    roles: { findUnique: async () => ({ id: 'role-org' }) },
    user_event_roles: {
      findFirst: async (args: any) =>
        (over.organiserEventIds ?? []).includes(args.where.event_id) && args.where.user_id === over.organiserUserId
          ? { id: 'uer' } : null,
    },
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
describe('organiserAccount', () => {
  const g = makeGuards(fakePrisma());
  it('allows super admin', async () => expect((await run(g.organiserAccount, SUPER)).ok).toBe(true));
  it('allows organiser accounts', async () => expect((await run(g.organiserAccount, ORGANISER)).ok).toBe(true));
  it('denies participants', async () => {
    const r = await run(g.organiserAccount, PARTICIPANT);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('enrollSelf', () => {
  const g = makeGuards(fakePrisma());
  it('allows enrolling own institution', async () =>
    expect((await run(g.enrollSelf, PARTICIPANT, { body: { institution_id: 'inst1' } })).ok).toBe(true));
  it('denies enrolling another institution', async () =>
    expect((await run(g.enrollSelf, PARTICIPANT, { body: { institution_id: 'inst2' } })).ok).toBe(false));
});

describe('teamCreate', () => {
  const g = makeGuards(fakePrisma());
  it('allows creating for own institution', async () =>
    expect((await run(g.teamCreate, PARTICIPANT, { body: { institution_id: 'inst1' } })).ok).toBe(true));
  it('denies creating for another institution', async () =>
    expect((await run(g.teamCreate, PARTICIPANT, { body: { institution_id: 'inst2' } })).ok).toBe(false));
  it('allows bulk all-own-institution', async () =>
    expect((await run(g.teamCreate, PARTICIPANT, { body: { teams: [{ institution_id: 'inst1' }, { institution_id: 'inst1' }] } })).ok).toBe(true));
  it('denies bulk with a foreign institution', async () =>
    expect((await run(g.teamCreate, PARTICIPANT, { body: { teams: [{ institution_id: 'inst1' }, { institution_id: 'inst2' }] } })).ok).toBe(false));
});

describe('eventManager', () => {
  it('allows super admin', async () => {
    const g = makeGuards(fakePrisma());
    expect((await run(g.eventManager(async () => 'e1'), SUPER)).ok).toBe(true);
  });
  it('allows the organiser of that event', async () => {
    const g = makeGuards(fakePrisma({ organiserEventIds: ['e1'], organiserUserId: 'org1' }));
    expect((await run(g.eventManager(async () => 'e1'), ORGANISER)).ok).toBe(true);
  });
  it('denies an organiser of a different event', async () => {
    const g = makeGuards(fakePrisma({ organiserEventIds: ['e2'], organiserUserId: 'org1' }));
    const r = await run(g.eventManager(async () => 'e1'), ORGANISER);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('teamManager', () => {
  it('allows institution staff of the owning institution', async () => {
    const g = makeGuards(fakePrisma({ team: { institution_id: 'inst1', team_members: [] } }));
    expect((await run(g.teamManager, STAFF, { params: { id: 't1' } })).ok).toBe(true);
  });
  it('allows the team captain', async () => {
    const g = makeGuards(fakePrisma({ team: { institution_id: 'inst1', team_members: [{ role: 'captain' }] } }));
    expect((await run(g.teamManager, PARTICIPANT, { params: { id: 't1' } })).ok).toBe(true);
  });
  it('denies a non-captain player', async () => {
    const g = makeGuards(fakePrisma({ team: { institution_id: 'inst1', team_members: [] } }));
    expect((await run(g.teamManager, PARTICIPANT, { params: { id: 't1' } })).ok).toBe(false);
  });
  it('denies staff from another institution', async () => {
    const g = makeGuards(fakePrisma({ team: { institution_id: 'inst2', team_members: [] } }));
    expect((await run(g.teamManager, STAFF, { params: { id: 't1' } })).ok).toBe(false);
  });
});

describe('fixtureScorer', () => {
  const fixture = { official_id: 'off1', tournament_disciplines: { tournament_sports: { tournaments: { event_id: 'e1' } } } };
  it('allows the assigned official', async () => {
    const g = makeGuards(fakePrisma({ fixture }));
    const official: User = { id: 'off1', isSuperAdmin: false, accountType: 'official', institutionId: null };
    expect((await run(g.fixtureScorer, official, { params: { id: 'f1' } })).ok).toBe(true);
  });
  it('allows the event organiser', async () => {
    const g = makeGuards(fakePrisma({ fixture, organiserEventIds: ['e1'], organiserUserId: 'org1' }));
    expect((await run(g.fixtureScorer, ORGANISER, { params: { id: 'f1' } })).ok).toBe(true);
  });
  it('denies an unrelated user', async () => {
    const g = makeGuards(fakePrisma({ fixture }));
    const other: User = { id: 'x', isSuperAdmin: false, accountType: 'official', institutionId: null };
    const r = await run(g.fixtureScorer, other, { params: { id: 'f1' } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});
