import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

// PATCH /me/identity: the player's own shirt number, over HTTP with an in-memory user.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48) }, isProduction: false }));

const ME = '11111111-1111-4111-8111-111111111111';
let user: Record<string, unknown>;
const prisma = {
  users: {
    findUnique: async () => user,
    findFirst: async () => null,
    update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(user, data); return user; },
  },
  profile_privacy: { findUnique: async () => null },
};

const express = (await import('express')).default;
const { makeProfileRouter } = await import('./profile.routes.js');
const { friendlyError } = await import('../../http/middleware/error.js');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as Request).user = { id: ME, email: 'a@x.in', isSuperAdmin: false, organizationId: null } as never; next(); });
app.use('/', makeProfileRouter(prisma as never));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const f = friendlyError(err);
  res.status(f.status).json({ error: { code: f.code, message: f.message } });
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

const patch = async (body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}/me/identity`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};

beforeEach(() => {
  user = { id: ME, name: 'Aarav', email: 'a@x.in', preferred_sports: [], jersey_number: null, handle: null, tagline: null };
});

describe('profile shirt number', () => {
  it('saves a number and returns it with the profile', async () => {
    const r = await patch({ jersey_number: 10 });
    expect(r.status).toBe(200);
    expect(r.body.controlled.jersey_number).toBe(10);
  });

  it('accepts 0 and 999, refuses anything outside or fractional', async () => {
    expect((await patch({ jersey_number: 0 })).status).toBe(200);
    expect((await patch({ jersey_number: 999 })).status).toBe(200);
    for (const bad of [-1, 1000, 7.5, '10']) expect((await patch({ jersey_number: bad })).status).toBe(422);
    expect(user.jersey_number).toBe(999);
  });

  it('clears with null and is left alone when not sent', async () => {
    await patch({ jersey_number: 23 });
    await patch({ tagline: 'Striker' });
    expect(user.jersey_number).toBe(23);
    await patch({ jersey_number: null });
    expect(user.jersey_number).toBeNull();
  });
});
