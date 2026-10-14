import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

// POST /teams/bulk ("Enter multiple teams"). It used to drop the campus/department,
// so a squad made on the Departments tab became a whole-organisation team, and the
// next department's attempt at the same draw was refused as a duplicate.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test' }, isProduction: false }));
vi.mock('../../http/middleware/permissions.js', () => ({
  // Every guard lets the request through; nobody is an org admin, so the creator is captain.
  makeGuards: () => new Proxy({}, {
    get: (_t, key) => (key === 'orgRole' ? async () => false : (_req: unknown, _res: unknown, next: () => void) => next()),
  }),
}));
vi.mock('../iam/organization-archive.service.js', () => ({ assertOrgNotArchived: async () => {} }));
vi.mock('./teams.notifications.js', () => ({
  tellUser: async () => {}, checkRosterIncomplete: async () => {}, notifyRosterLocked: async () => {}, notifyTeamCreated: async () => {},
}));

const ORG = '00000000-0000-4000-8000-000000000001';
const CAMPUS = '00000000-0000-4000-8000-000000000010';
const DEPT_A = '00000000-0000-4000-8000-000000000011';
const DEPT_B = '00000000-0000-4000-8000-000000000012';
const DEPT_UNINVITED = '00000000-0000-4000-8000-000000000013';
const INTRA = '00000000-0000-4000-8000-000000000020';
const OPEN = '00000000-0000-4000-8000-000000000021';
const EI_INTRA = '00000000-0000-4000-8000-000000000030';
const EI_OPEN = '00000000-0000-4000-8000-000000000031';
const DRAW_INTRA = '00000000-0000-4000-8000-000000000040';
const DRAW_OPEN = '00000000-0000-4000-8000-000000000041';
const SPORT = '00000000-0000-4000-8000-000000000050';

type Row = Record<string, any>;
let teams: Row[] = [];
let entries: Row[] = [];
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (row[k] ?? null) === (v ?? null));

const prisma = {
  tournament_disciplines: {
    findUnique: async ({ where }: any) => ({
      id: where.id,
      tournament_sports: { sport_id: SPORT, tournaments: { championship_id: where.id === DRAW_INTRA ? INTRA : OPEN } },
    }),
  },
  championship_organizations: {
    findMany: async () => [
      { id: EI_INTRA, status: 'approved', organization_id: ORG },
      { id: EI_OPEN, status: 'approved', organization_id: ORG },
    ],
  },
  championships: {
    findMany: async () => [
      { id: INTRA, name: 'Beta intra event', entry_level: 'department', entry_scope_unit_id: null, host_organization_id: ORG, organizations: { settings: {} } },
      { id: OPEN, name: 'Open cup', entry_level: 'organization', entry_scope_unit_id: null, host_organization_id: null, organizations: { settings: {} } },
    ],
  },
  org_units: {
    findMany: async () => [
      { id: CAMPUS, organization_id: ORG, parent_id: null, type: 'campus', name: 'Main', code: null, status: 'ACTIVE', display_order: 0 },
      { id: DEPT_A, organization_id: ORG, parent_id: CAMPUS, type: 'department', name: 'Computer science', code: null, status: 'ACTIVE', display_order: 1 },
      { id: DEPT_B, organization_id: ORG, parent_id: CAMPUS, type: 'department', name: 'Team 1', code: null, status: 'ACTIVE', display_order: 2 },
      { id: DEPT_UNINVITED, organization_id: ORG, parent_id: CAMPUS, type: 'department', name: 'Physics', code: null, status: 'ACTIVE', display_order: 3 },
    ],
  },
  championship_invitations: {
    findFirst: async ({ where }: any) => ([DEPT_A, DEPT_B].includes(where.org_unit_id) ? { id: 'inv' } : null),
  },
  team_entries: { findMany: async ({ where }: any) => entries.filter((e) => where.OR.some((w: Row) => matches(e, w))) },
  teams: { findMany: async ({ where }: any) => teams.filter((t) => where.OR.some((w: Row) => matches(t, w))) },
  $transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
    teams: { create: async ({ data }: any) => { const t = { id: `t${teams.length + 1}`, ...data }; teams.push(t); return t; } },
    team_entries: { create: async ({ data }: any) => { entries.push(data); return data; } },
    team_members: { create: async () => ({}) },
  }),
};

const express = (await import('express')).default;
const { makeTeamsRouter } = await import('./teams.routes.js');
const { makeErrorHandler } = await import('../../http/middleware/error.js');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).user = { id: '00000000-0000-4000-8000-0000000000aa' }; next(); });
app.use(makeTeamsRouter(prisma as never));
app.use(makeErrorHandler(prisma as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

const squad = (o: Row = {}) => ({
  championship_id: INTRA, organization_id: ORG, championship_organization_id: EI_INTRA,
  sport_id: SPORT, tournament_discipline_id: DRAW_INTRA, name: 'Computer science Football Men', short_name: 'CSFM',
  org_unit_id: DEPT_A, ...o,
});
const bulk = async (rows: Row[]) => {
  const res = await fetch(`http://127.0.0.1:${port}/teams/bulk`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teams: rows }),
  });
  return { status: res.status, body: await res.json() as any };
};

describe('POST /teams/bulk - Enter multiple teams', () => {
  beforeEach(() => { teams = []; entries = []; });

  it('a department squad is saved FOR that department - team and entry both', async () => {
    const r = await bulk([squad()]);
    expect(r.status).toBe(201);
    expect(teams[0].org_unit_id).toBe(DEPT_A);
    expect(entries[0].org_unit_id).toBe(DEPT_A);
  });

  it('a second department can enter the same draw (was refused as a duplicate)', async () => {
    await bulk([squad()]);
    const r = await bulk([squad({ org_unit_id: DEPT_B, name: 'Team 1 Football Men', short_name: 'T1FM' })]);
    expect(r.status).toBe(201);
    expect(entries.map((e) => e.org_unit_id)).toEqual([DEPT_A, DEPT_B]);
  });

  it('the same department cannot enter the same draw twice', async () => {
    await bulk([squad()]);
    const r = await bulk([squad({ name: 'Computer science Football Men 2', short_name: 'CS2' })]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('already has a team in the draw');
  });

  it('a department not invited to the event is refused', async () => {
    const r = await bulk([squad({ org_unit_id: DEPT_UNINVITED, name: 'Physics Football Men', short_name: 'PFM' })]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('not taking part');
    expect(teams).toHaveLength(0);
  });

  it('an internal event needs a unit - no whole-organisation squad', async () => {
    const r = await bulk([squad({ org_unit_id: null })]);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(teams).toHaveLength(0);
  });

  it('an open event stays a whole-organisation squad, whatever unit is sent', async () => {
    const r = await bulk([squad({ championship_id: OPEN, championship_organization_id: EI_OPEN, tournament_discipline_id: DRAW_OPEN })]);
    expect(r.status).toBe(201);
    expect(teams[0].org_unit_id).toBeNull();
    expect(entries[0].org_unit_id).toBeNull();
  });

  it('two departments may use the same team name', async () => {
    await bulk([squad({ name: 'Football Men', short_name: 'FM' })]);
    const r = await bulk([squad({ org_unit_id: DEPT_B, name: 'Football Men', short_name: 'FM' })]);
    expect(r.status).toBe(201);
  });
});
