import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { EVENT_PHOTO_MAX_BYTES, EVENT_PHOTO_MAX_COUNT } from '@semp/shared';

// /platform/event-photos over HTTP with an in-memory photos table and a fake storage.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48), STORAGE_TRANSPORT: 'supabase' }, isProduction: false }));
vi.mock('../iam/audit.service.js', async (orig) => ({ ...(await orig<typeof import('../iam/audit.service.js')>()), audit: vi.fn(async () => undefined) }));

type Row = { id: string; championship_id: string; storage_key: string; url: string; caption: string | null; sort_order: number; created_at: Date; created_by: string };
let rows: Row[] = [];
const EVENT = '22222222-2222-4222-8222-222222222222';
const pick = (r: Row) => ({ id: r.id, url: r.url, caption: r.caption, sort_order: r.sort_order });
const prisma = {
  championships: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === EVENT ? { id: EVENT, name: 'IIMK Cup' } : null) },
  championship_photos: {
    findMany: async ({ where }: { where: { championship_id: string } }) =>
      rows.filter((r) => r.championship_id === where.championship_id).sort((a, b) => a.sort_order - b.sort_order).map(pick),
    findFirst: async ({ where }: { where: { id: string; championship_id: string } }) =>
      rows.find((r) => r.id === where.id && r.championship_id === where.championship_id) ?? null,
    aggregate: async ({ where }: { where: { championship_id: string } }) => {
      const mine = rows.filter((r) => r.championship_id === where.championship_id);
      return { _count: { _all: mine.length }, _max: { sort_order: mine.length ? Math.max(...mine.map((r) => r.sort_order)) : null } };
    },
    create: async ({ data }: { data: Omit<Row, 'created_at'> }) => { const r = { ...data, created_at: new Date() }; rows.push(r); return pick(r); },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return pick(r);
    },
    delete: async ({ where }: { where: { id: string } }) => { rows = rows.filter((r) => r.id !== where.id); },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};
const storage = { put: vi.fn(async (key: string) => `https://cdn.test/${key}`), remove: vi.fn(async () => undefined) };

const express = (await import('express')).default;
const { makeEventPhotosRouter } = await import('./event-photos.routes.js');
const { friendlyError } = await import('../../http/middleware/error.js');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use((req, _res, next) => {
  (req as Request).user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@x.in', isSuperAdmin: req.headers['x-test-super'] === '1', organizationId: null } as never;
  next();
});
app.use('/platform/event-photos', makeEventPhotosRouter(prisma as never, storage));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const f = friendlyError(err);
  res.status(f.status).json({ error: { code: f.code, message: f.message } });
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
afterAll(() => { server.close(); });

async function call(method: string, path: string, body?: unknown, { superAdmin = true } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/platform/event-photos${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(superAdmin ? { 'x-test-super': '1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() as any };
}
const IMG = Buffer.from('fake-jpeg-bytes').toString('base64');
const upload = (caption?: string) => call('POST', `/${EVENT}`, { data: IMG, contentType: 'image/jpeg', caption });

beforeEach(() => { rows = []; storage.put.mockClear(); storage.remove.mockClear(); });

describe('event photos (super admin)', () => {
  it('turns away anyone who is not a super admin', async () => {
    expect((await call('GET', `/${EVENT}`, undefined, { superAdmin: false })).status).toBe(403);
    expect((await call('POST', `/${EVENT}`, { data: IMG, contentType: 'image/jpeg' }, { superAdmin: false })).status).toBe(403);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores an upload under the event and lists photos in order', async () => {
    const a = await upload('Opening ceremony');
    const b = await upload();
    expect(a.status).toBe(201);
    expect(storage.put.mock.calls[0]![0]).toMatch(new RegExp(`^events/${EVENT}/[0-9a-f-]{36}\\.jpg$`));
    expect(a.body).toMatchObject({ caption: 'Opening ceremony', sort_order: 0 });
    expect(b.body).toMatchObject({ caption: null, sort_order: 1 });
    const list = await call('GET', `/${EVENT}`);
    expect(list.body.photos.map((p: { id: string }) => p.id)).toEqual([a.body.id, b.body.id]);
  });

  it('rejects an oversized photo and a full carousel before storing anything', async () => {
    const big = Buffer.alloc(EVENT_PHOTO_MAX_BYTES + 1).toString('base64');
    expect((await call('POST', `/${EVENT}`, { data: big, contentType: 'image/jpeg' })).status).toBe(422);
    for (let i = 0; i < EVENT_PHOTO_MAX_COUNT; i++) await upload();
    storage.put.mockClear();
    expect((await upload()).status).toBe(400);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects types other than jpeg/png/webp', async () => {
    expect((await call('POST', `/${EVENT}`, { data: IMG, contentType: 'image/gif' })).status).toBe(422);
  });

  it('404s an unknown event', async () => {
    expect((await call('GET', '/33333333-3333-4333-8333-333333333333')).status).toBe(404);
  });

  it('edits and clears a caption', async () => {
    const p = (await upload('Old')).body;
    expect((await call('PATCH', `/${EVENT}/${p.id}`, { caption: 'New' })).body.caption).toBe('New');
    expect((await call('PATCH', `/${EVENT}/${p.id}`, { caption: '' })).body.caption).toBeNull();
  });

  it('reorders only when every photo is listed once', async () => {
    const a = (await upload()).body; const b = (await upload()).body; const c = (await upload()).body;
    const ok = await call('PUT', `/${EVENT}/order`, { ids: [c.id, a.id, b.id] });
    expect(ok.body.photos.map((p: { id: string }) => p.id)).toEqual([c.id, a.id, b.id]);
    expect((await call('PUT', `/${EVENT}/order`, { ids: [a.id, b.id] })).status).toBe(422);
    expect((await call('PUT', `/${EVENT}/order`, { ids: [a.id, a.id, b.id] })).status).toBe(422);
  });

  it('deletes the file, then the row', async () => {
    const p = (await upload()).body;
    const key = storage.put.mock.calls[0]![0];
    expect((await call('DELETE', `/${EVENT}/${p.id}`)).status).toBe(204);
    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(rows).toHaveLength(0);
  });

  it('keeps the row when storage refuses the delete, so it can be retried', async () => {
    const p = (await upload()).body;
    storage.remove.mockRejectedValueOnce(new Error('S3 down'));
    expect((await call('DELETE', `/${EVENT}/${p.id}`)).status).toBe(500);
    expect(rows).toHaveLength(1);
  });
});
