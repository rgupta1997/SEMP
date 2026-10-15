import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

// PATCH /users/:id - the registration-day path that swaps a provisioned login's
// placeholder contact (5000000xxx / x@placeholder.invalid) for the real one.
//
// The guard is stubbed open: who may reach the route at all (super admin, or an
// owner/admin of the target's org) is manageUser's job and tested with it. What is
// asserted here is the rule INSIDE the route - email is super-admin only, whoever
// got past the guard.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48) }, isProduction: false }));

vi.mock('../../http/middleware/permissions.js', () => ({
  makeGuards: () => ({
    manageUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  }),
}));

vi.mock('@semp/notifications/server/notify.js', () => ({ notify: async () => undefined }));

const audits: Array<{ action: string; diff?: unknown; summary?: string | null }> = [];
vi.mock('./audit.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audit.service.js')>()),
  audit: async (_p: unknown, _req: unknown, entry: { action: string; diff?: unknown; summary?: string | null }) => {
    audits.push(entry);
  },
}));

// The target account, as provisioned for the event: both contacts are stand-ins.
const TARGET = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Asha Rao',
  email: 'asha-rao@placeholder.invalid',
  phone: '5000000017',
  organization_id: '22222222-2222-4222-8222-222222222222',
};

let clash: { id: string } | null = null;
const updates: Array<Record<string, unknown>> = [];
const clashQueries: unknown[] = [];

const prisma = {
  users: {
    findUnique: async () => ({ ...TARGET }),
    findFirst: async (args: unknown) => { clashQueries.push(args); return clash; },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data);
      return { ...TARGET, ...data, is_active: true, is_super_admin: false, created_at: new Date(), organizations: null };
    },
  },
};

const express = (await import('express')).default;
const { makeUsersRouter } = await import('./users.routes.js');
const { friendlyError } = await import('../../http/middleware/error.js');

// A real HTTP round trip so validateBody (the zod normalisation) and the error
// mapping are in the path. The caller is chosen per request by a test header.
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const isSuperAdmin = req.headers['x-test-super'] === '1';
  (req as Request).user = { id: isSuperAdmin ? 'super' : 'org-admin', email: 'actor@x.in', isSuperAdmin, organizationId: null };
  next();
});
app.use('/users', makeUsersRouter(prisma as never));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const f = friendlyError(err);
  res.status(f.status).json({ error: { code: f.code, message: f.message } });
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

async function patch(body: Record<string, unknown>, { superAdmin }: { superAdmin: boolean }) {
  const res = await fetch(`http://127.0.0.1:${port}/users/${TARGET.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(superAdmin ? { 'x-test-super': '1' } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

beforeEach(() => {
  clash = null;
  updates.length = 0;
  clashQueries.length = 0;
  audits.length = 0;
});

describe('PATCH /users/:id - email', () => {
  it('lets a super admin replace a placeholder email, normalised, and re-opens its verification', async () => {
    const { status } = await patch({ email: '  Asha.Rao@Corp.COM ' }, { superAdmin: true });

    expect(status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].email).toBe('asha.rao@corp.com');
    expect(updates[0]).toHaveProperty('email_verified_at', null);
    // The phone was not touched, so its verification stands.
    expect(updates[0]).not.toHaveProperty('phone_verified_at');
  });

  it('checks for a clash exactly and case-insensitively, excluding the account itself', async () => {
    await patch({ email: 'asha_rao@corp.com' }, { superAdmin: true });

    expect(clashQueries[0]).toMatchObject({
      // `_` escaped: an unescaped ILIKE would let "asha_rao" collide with "asha-rao".
      where: { email: { equals: 'asha\\_rao@corp.com', mode: 'insensitive' }, NOT: { id: TARGET.id } },
    });
  });

  it('refuses an email that already belongs to another account with a 409', async () => {
    clash = { id: 'someone-else' };

    const { status, body } = await patch({ email: 'taken@corp.com' }, { superAdmin: true });

    expect(status).toBe(409);
    expect(body.error.message).toContain('taken@corp.com');
    expect(body.error.message).toMatch(/another account/);
    expect(updates).toHaveLength(0);
  });

  it('forbids anyone but a super admin from changing it', async () => {
    const { status, body } = await patch({ email: 'asha.rao@corp.com' }, { superAdmin: false });

    expect(status).toBe(403);
    expect(body.error.message).toMatch(/super admin/i);
    expect(updates).toHaveLength(0);
  });

  it('lets a non-super-admin save the form when it only echoes the current email back', async () => {
    // The edit form always sends the email; a no-op must not be a 403.
    const { status } = await patch({ name: 'Asha R', email: 'ASHA-RAO@placeholder.invalid' }, { superAdmin: false });

    expect(status).toBe(200);
    expect(updates[0]).toEqual({ name: 'Asha R' });
    expect(audits).toHaveLength(0);
  });

  it('rejects a malformed address before touching anything', async () => {
    const { status } = await patch({ email: 'not-an-email' }, { superAdmin: true });

    expect(status).toBe(422);
    expect(updates).toHaveLength(0);
  });
});

describe('PATCH /users/:id - phone', () => {
  it('replaces a placeholder phone with the real one and re-opens phone verification', async () => {
    const { status } = await patch({ phone: '9876543210' }, { superAdmin: false });

    expect(status).toBe(200);
    expect(updates[0]).toMatchObject({ phone: '9876543210', phone_verified_at: null });
    expect(updates[0]).not.toHaveProperty('email_verified_at');
  });

  it('treats a reformatted copy of the same number as no change', async () => {
    await patch({ phone: '+91 50000 00017' }, { superAdmin: true });

    expect(updates[0]).not.toHaveProperty('phone_verified_at');
    expect(audits).toHaveLength(0);
  });
});

describe('PATCH /users/:id - audit', () => {
  it('records a contact change with the contacts masked', async () => {
    await patch({ email: 'asha.rao@corp.com', phone: '9876543210' }, { superAdmin: true });

    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('user.contact_changed');
    expect(audits[0].summary).toBe('Changed email and phone for Asha Rao');
    const flat = JSON.stringify(audits[0].diff);
    expect(flat).not.toContain('asha.rao@corp.com');
    expect(flat).not.toContain('9876543210');
  });
});
