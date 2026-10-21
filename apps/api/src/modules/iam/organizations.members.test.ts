import { describe, it, expect, vi, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';

// GET /organizations/:id/members carries emails and phones. It was readable by any
// signed-in account for any organisation; now only by that organisation's own people.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test' }, isProduction: false }));

const ORG = '00000000-0000-4000-8000-000000000001';
const ADMIN = 'u-admin';
const PLAYER = 'u-player';
const SPORTS_ADMIN = 'u-sports-admin';
const REMOVED = 'u-removed';
const STRANGER = 'u-stranger';

const memberships = [
  { user_id: ADMIN, role: 'admin', status: 'active' },
  { user_id: PLAYER, role: 'member', status: 'active' },
  { user_id: SPORTS_ADMIN, role: 'member', status: 'active' },
  { user_id: REMOVED, role: 'member', status: 'past' },
];
const userOf = (id: string) => ({ id, name: `Name ${id}`, email: `${id}@x.in`, phone: '9000000000' });
const pick = (o: Record<string, unknown>, select: Record<string, boolean>) =>
  Object.fromEntries(Object.keys(select).map((k) => [k, o[k]]));

const prisma = {
  organization_members: {
    findFirst: async ({ where }: any) =>
      memberships.find((m) => m.user_id === where.user_id && (!where.status || m.status === where.status)) ?? null,
    findMany: async ({ where, include, select }: any) => memberships
      .filter((m) => !where.status || m.status === where.status)
      .map((m) => {
        const row = { ...m, organization_id: ORG, member_code: 'R-1', scholarship: true };
        const users = pick(userOf(m.user_id), (include ?? select).users.select);
        return select ? { ...pick(row, select), users } : { ...row, users };
      }),
  },
  user_org_roles: { findFirst: async ({ where }: any) => (where.user_id === SPORTS_ADMIN ? { id: 'g1' } : null) },
  org_units: { findFirst: async () => null },
};

const express = (await import('express')).default;
const { makeOrganizationsRouter } = await import('./organizations.routes.js');
const { makeErrorHandler } = await import('../../http/middleware/error.js');

let caller = ADMIN;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).user = { id: caller, isSuperAdmin: false }; next(); });
app.use(makeOrganizationsRouter(prisma as never));
app.use(makeErrorHandler(prisma as never));
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

const list = async (who: string) => {
  caller = who;
  const res = await fetch(`http://127.0.0.1:${port}/${ORG}/members`);
  return { status: res.status, body: await res.json() as any };
};

describe('GET /organizations/:id/members', () => {
  it('someone outside the organisation is refused', async () => {
    expect((await list(STRANGER)).status).toBe(403);
  });

  it('a removed member is refused', async () => {
    expect((await list(REMOVED)).status).toBe(403);
  });

  it('an admin gets everyone, with contact details', async () => {
    const r = await list(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(4);
    expect(r.body[0].users.email).toBeDefined();
  });

  it('someone granted a role here counts as staff', async () => {
    const r = await list(SPORTS_ADMIN);
    expect(r.body).toHaveLength(4);
    expect(r.body[0].users.phone).toBeDefined();
  });

  it('a plain member gets current members by name only', async () => {
    const r = await list(PLAYER);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
    expect(r.body.every((m: any) => m.users.email === undefined && m.users.phone === undefined)).toBe(true);
    expect(r.body.every((m: any) => m.member_code === undefined && m.scholarship === undefined)).toBe(true);
  });
});
