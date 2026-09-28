import { describe, expect, it } from 'vitest';
import { ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { blockArchivedWritesVia } from './championship-archive.service.js';

const ARCHIVED = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';

// Only what assertNotArchived reads.
const prisma = {
  championships: {
    findUnique: async ({ where }: any) => ({ archived_at: where.id === ARCHIVED ? new Date() : null }),
  },
} as any;

// The route's :id maps straight to its event here - the real guards look it up.
const guard = blockArchivedWritesVia(async (id) => id, { allow: /^\/retrieve$/ }, prisma);

function run(method: string, id: string, path = '/') {
  return new Promise<unknown>((resolve) => {
    guard({ method, params: { id }, path } as any, {} as any, (err?: unknown) => resolve(err ?? null));
  });
}

describe('archived read-only guard', () => {
  it('refuses a change to an archived event with the shared message', async () => {
    const err = await run('POST', ARCHIVED, '/lock') as Error;
    expect(err?.message).toBe(ARCHIVED_READ_ONLY_MESSAGE);
  });

  it('lets reads through, and changes to a live event', async () => {
    expect(await run('GET', ARCHIVED)).toBeNull();
    expect(await run('PATCH', LIVE, '/result')).toBeNull();
  });

  it('lets the allowed actions through even while archived', async () => {
    expect(await run('POST', ARCHIVED, '/retrieve')).toBeNull();
  });
});
