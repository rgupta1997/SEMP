import { describe, expect, it } from 'vitest';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { blockArchivedWritesVia } from './championship-archive.service.js';

const ARCHIVED = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const HOST = { id: 'host', isSuperAdmin: false };
const PLAYER = { id: 'player', isSuperAdmin: false };

// Only what the guard reads: the archive flag, and whether the caller organises it.
const prisma = {
  championships: {
    findUnique: async ({ where }: any) => ({ archived_at: where.id === ARCHIVED ? new Date() : null, host_organization_id: null }),
  },
  user_championship_roles: {
    findFirst: async ({ where }: any) => (where.user_id === HOST.id ? { id: 'role' } : null),
  },
} as any;

// The route's :id maps straight to its event here - the real guards look it up.
const guard = blockArchivedWritesVia(async (id) => id, { allow: /^\/retrieve$/ }, prisma);

function run(method: string, id: string, path = '/', user: object = HOST) {
  return new Promise<any>((resolve) => {
    guard({ method, params: { id }, path, user } as any, {} as any, (err?: unknown) => resolve(err ?? null));
  });
}

describe('archived event guard', () => {
  it('refuses the host a change, with the shared message', async () => {
    expect((await run('POST', ARCHIVED, '/lock'))?.message).toBe(ARCHIVED_READ_ONLY_MESSAGE);
  });

  it('lets the host read it, and retrieve it', async () => {
    expect(await run('GET', ARCHIVED)).toBeNull();
    expect(await run('POST', ARCHIVED, '/retrieve')).toBeNull();
  });

  it('hides it from anyone else - reads and writes alike 404', async () => {
    expect((await run('GET', ARCHIVED, '/', PLAYER))?.status).toBe(404);
    expect((await run('POST', ARCHIVED, '/lock', PLAYER))?.status).toBe(404);
  });

  it('leaves a live event alone for everyone', async () => {
    expect(await run('GET', LIVE, '/', PLAYER)).toBeNull();
    expect(await run('PATCH', LIVE, '/result', PLAYER)).toBeNull();
  });
});
