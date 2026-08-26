import { describe, it, expect } from 'vitest';
import { moduleOfPermission } from '@semp/shared';
import { audienceOfRole, moduleBlocks, moduleSettingsOf } from './module-access.js';

// The module gate runs AHEAD of every grant and every fallback, so which module a
// permission belongs to decides who can reach the route - not just which switch
// hides it. That makes the permission-to-area pairing part of the boundary, and
// worth pinning: reading the honours board through `people.view` put it behind the
// People module, and an institution that limits its directory to staff was refusing
// its own students a board that Records has switched on for them.

/** One institution, one member. Enough for the pre-check, which reads exactly these two rows. */
function fakeDb(modules: Record<string, string[]>, membershipRole: string | null) {
  return {
    organizations: { findUnique: async () => ({ settings: { modules } }) },
    organization_members: { findFirst: async () => (membershipRole ? { role: membershipRole } : null) },
  } as any;
}

const STAFF_ONLY_DIRECTORY = { people: ['staff'], records: ['staff', 'students'] };
const ORG = { userId: 'u1', organizationId: 'o1' };

describe('the module a permission is gated by', () => {
  it('files the honours board under Records, not People', () => {
    expect(moduleOfPermission('achievement.view')).toBe('records');
    expect(moduleOfPermission('people.view')).toBe('people');
  });
});

describe('moduleBlocks', () => {
  it('lets a student read the honours board while the directory is staff-only', async () => {
    const db = fakeDb(STAFF_ONLY_DIRECTORY, 'member');
    expect(await moduleBlocks(db, 'people.view', ORG)).toBe(true);
    expect(await moduleBlocks(db, 'achievement.view', ORG)).toBe(false);
  });

  it('blocks neither for staff', async () => {
    const db = fakeDb(STAFF_ONLY_DIRECTORY, 'admin');
    expect(await moduleBlocks(db, 'people.view', ORG)).toBe(false);
    expect(await moduleBlocks(db, 'achievement.view', ORG)).toBe(false);
  });

  it('blocks a configured module for somebody with no membership at all', async () => {
    // No membership is no audience, which is not the same as being a student: an
    // outsider fails every module that has been configured, whatever it names.
    const db = fakeDb(STAFF_ONLY_DIRECTORY, null);
    expect(await moduleBlocks(db, 'people.view', ORG)).toBe(true);
    expect(await moduleBlocks(db, 'achievement.view', ORG)).toBe(true);
  });

  it('leaves an unconfigured module on', async () => {
    const db = fakeDb({}, 'member');
    expect(await moduleBlocks(db, 'people.view', ORG)).toBe(false);
    expect(await moduleBlocks(db, 'achievement.view', ORG)).toBe(false);
  });
});

describe('audienceOfRole', () => {
  it('reads the membership strings the join and invite paths actually write', () => {
    expect(audienceOfRole('owner')).toBe('staff');
    expect(audienceOfRole('admin')).toBe('staff');
    expect(audienceOfRole('member')).toBe('students');
    expect(audienceOfRole(null)).toBeNull();
  });
});

describe('moduleSettingsOf', () => {
  it('treats a malformed blob as not configured rather than switched off', () => {
    expect(moduleSettingsOf({ modules: { people: 'staff' } })).toEqual({});
    expect(moduleSettingsOf(null)).toEqual({});
  });
});
