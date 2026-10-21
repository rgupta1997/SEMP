import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

// Leaving a roster keeps the squad place - inactive, with the date - so the player's
// matches for that squad stay in their history. It used to delete the row.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test' }, isProduction: false }));
vi.mock('../../http/middleware/permissions.js', () => ({
  makeGuards: () => new Proxy({}, {
    get: (_t, key) => (key === 'orgRole' ? async () => false : (_req: unknown, _res: unknown, next: () => void) => next()),
  }),
}));
vi.mock('../iam/organization-archive.service.js', () => ({ assertOrgNotArchived: async () => {} }));
vi.mock('../championships/contingent.js', () => ({
  assertPlayerEligible: async () => {}, screenSquad: async () => ({ ok: [], refused: [] }), squadEntryRefusal: () => null,
}));
vi.mock('./teams.notifications.js', () => ({
  tellUser: async () => {}, checkRosterIncomplete: async () => {}, notifyRosterLocked: async () => {}, notifyTeamCreated: async () => {},
}));

const TEAM = '00000000-0000-4000-8000-000000000001';
const PLAYER = '00000000-0000-4000-8000-0000000000b1';
const CAPTAIN = '00000000-0000-4000-8000-0000000000b2';

type Row = Record<string, any>;
let rows: Row[] = [];
const fits = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(r[k]);
  if (v && typeof v === 'object' && 'not' in v) return r[k] !== v.not;
  return r[k] === v;
});

const team_members = {
  findFirst: async ({ where }: any) => rows.find((r) => fits(r, where)) ?? null,
  findMany: async ({ where }: any) => rows.filter((r) => fits(r, where)),
  count: async ({ where }: any) => rows.filter((r) => fits(r, where)).length,
  updateMany: async ({ where, data }: any) => {
    const hit = rows.filter((r) => fits(r, where));
    hit.forEach((r) => Object.assign(r, data));
    return { count: hit.length };
  },
  update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data),
  upsert: async ({ where, update, create }: any) => {
    const { team_id, user_id } = where.team_id_user_id;
    const found = rows.find((r) => r.team_id === team_id && r.user_id === user_id);
    if (found) return Object.assign(found, update);
    const row = { id: `m${rows.length + 1}`, is_active: true, left_at: null, joined_at: new Date(), ...create };
    rows.push(row);
    return row;
  },
};

const prisma = {
  team_members,
  team_entries: { findMany: async () => [] },
  teams: {
    findUnique: async ({ where }: any) => (where.id === TEAM
      ? { id: TEAM, name: 'Algonkings', organization_id: 'org', org_unit_id: null, team_entries: [] }
      : null),
  },
};

const express = (await import('express')).default;
const { makeTeamsRouter } = await import('./teams.routes.js');
const { makeErrorHandler } = await import('../../http/middleware/error.js');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).user = { id: CAPTAIN }; next(); });
app.use(makeTeamsRouter(prisma as never));
app.use(makeErrorHandler(prisma as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() as any };
};

describe('roster: leaving and coming back', () => {
  beforeEach(() => {
    rows = [
      { id: 'm1', team_id: TEAM, user_id: PLAYER, role: 'player', jersey_number: 7, is_active: true, left_at: null, joined_at: new Date('2026-09-01') },
      { id: 'm2', team_id: TEAM, user_id: CAPTAIN, role: 'captain', jersey_number: 1, is_active: true, left_at: null, joined_at: new Date('2026-09-01') },
    ];
  });

  it('removing a player keeps the row, inactive and dated', async () => {
    const r = await call('DELETE', `/teams/${TEAM}/members/m1`);
    expect(r.status).toBe(204);
    expect(rows).toHaveLength(2);
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].left_at).toBeInstanceOf(Date);
  });

  it('a player who left is off the roster list', async () => {
    await call('DELETE', `/teams/${TEAM}/members/m1`);
    const r = await call('GET', `/teams/${TEAM}/members`);
    expect(r.body.map((m: Row) => m.user_id)).toEqual([CAPTAIN]);
  });

  it('adding them back reactivates the same row and keeps the first join date', async () => {
    await call('DELETE', `/teams/${TEAM}/members/m1`);
    const r = await call('POST', `/teams/${TEAM}/members`, { user_id: PLAYER, role: 'player' });
    expect(r.status).toBe(201);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'm1', is_active: true, left_at: null });
    expect(rows[0].joined_at).toEqual(new Date('2026-09-01'));
  });

  it('a captain who left does not block naming a new captain', async () => {
    await call('DELETE', `/teams/${TEAM}/members/m2`);
    const r = await call('PATCH', `/teams/${TEAM}/members/m1`, { role: 'captain' });
    expect(r.status).toBe(200);
  });

  it('someone already on the squad cannot be added twice', async () => {
    const r = await call('POST', `/teams/${TEAM}/members`, { user_id: PLAYER, role: 'player' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('removing someone who already left is not found', async () => {
    await call('DELETE', `/teams/${TEAM}/members/m1`);
    const r = await call('DELETE', `/teams/${TEAM}/members/m1`);
    expect(r.status).toBe(404);
  });
});
