import { describe, it, expect } from 'vitest';
import { authorizeRecordView } from './records.access.js';

// The boundary that keeps FR-PPL-5 from being a privacy incident: a coordinator
// may open "a player's" record, but only a player of THEIRS.

// memberships: userId -> orgIds they are an ACTIVE member of.
// grants:      userId -> orgIds where they hold people.view via an assigned role.
function fakeDb({ memberships = {}, grants = {} }: {
  memberships?: Record<string, Array<{ org: string; status?: string }>>;
  grants?: Record<string, string[]>;
} = {}) {
  return {
    organization_members: {
      findMany: async ({ where }: any) => (memberships[where.user_id] ?? [])
        .filter((m) => (m.status ?? 'active') === where.status)
        .map((m) => ({ organization_id: m.org })),
      findFirst: async () => null,   // no membership-implied role in these fixtures
    },
    user_org_roles: {
      findMany: async ({ where }: any) =>
        ((grants[where.user_id] ?? []).includes(where.organization_id) ? [{ role_id: `r:${where.organization_id}` }] : []),
    },
    user_championship_roles: { findMany: async () => [] },
    // can() runs the J6-E2 module pre-check first; empty settings means every
    // module is on, which is the state these tests are about.
    organizations: { findUnique: async () => ({ settings: {} }) },
    roles: {
      findMany: async ({ where }: any) => (where.OR ?? [])
        .filter((c: any) => c.id)
        .flatMap((c: any) => c.id.in.map(() => ({ permission_ids: ['people.view'], code: null, organization_id: null }))),
    },
  } as any;
}

const VIEWER = { id: 'coach' };

describe('authorizeRecordView', () => {
  it('always opens a person their own record', async () => {
    const db = fakeDb({ memberships: { player: [{ org: 'o1' }] } });
    await expect(authorizeRecordView(db, { id: 'player' }, 'player'))
      .resolves.toMatchObject({ isSelf: true });
  });

  it('opens a player of theirs to a coordinator holding people.view', async () => {
    const db = fakeDb({
      memberships: { coach: [{ org: 'o1' }], player: [{ org: 'o1' }] },
      grants: { coach: ['o1'] },
    });
    await expect(authorizeRecordView(db, VIEWER, 'player'))
      .resolves.toMatchObject({ isSelf: false, sharedOrgIds: ['o1'] });
  });

  // The requirement's own scoping clause. Without it, one institution's
  // coordinator can read another institution's students.
  it('refuses a player they share no institution with, however privileged', async () => {
    const db = fakeDb({
      memberships: { coach: [{ org: 'o1' }], player: [{ org: 'o2' }] },
      // people.view in their OWN institution, and in the other one too - neither
      // helps, because the shared-institution test runs first.
      grants: { coach: ['o1', 'o2'] },
    });
    await expect(authorizeRecordView(db, VIEWER, 'player')).rejects.toThrow(/institution you belong to/i);
  });

  it('refuses a fellow member who does not hold people.view', async () => {
    const db = fakeDb({ memberships: { coach: [{ org: 'o1' }], player: [{ org: 'o1' }] } });
    await expect(authorizeRecordView(db, VIEWER, 'player')).rejects.toThrow(/permission/i);
  });

  // A pending join request is not membership. Otherwise anyone could read a
  // whole institution's records by asking to join it.
  it('does not count a pending membership as sharing an institution', async () => {
    const db = fakeDb({
      memberships: { coach: [{ org: 'o1', status: 'pending' }], player: [{ org: 'o1' }] },
      grants: { coach: ['o1'] },
    });
    await expect(authorizeRecordView(db, VIEWER, 'player')).rejects.toThrow(/institution you belong to/i);
  });

  it('refuses when the subject belongs to no institution at all', async () => {
    const db = fakeDb({ memberships: { coach: [{ org: 'o1' }] }, grants: { coach: ['o1'] } });
    await expect(authorizeRecordView(db, VIEWER, 'stranger')).rejects.toThrow(/institution you belong to/i);
  });

  it('lets a super admin through, and still reports what they actually share', async () => {
    const db = fakeDb({ memberships: { admin: [], player: [{ org: 'o2' }] } });
    await expect(authorizeRecordView(db, { id: 'admin', isSuperAdmin: true }, 'player'))
      .resolves.toMatchObject({ isSelf: false, sharedOrgIds: [] });
  });

  it('accepts a grant in any one of several shared institutions', async () => {
    const db = fakeDb({
      memberships: { coach: [{ org: 'o1' }, { org: 'o2' }], player: [{ org: 'o1' }, { org: 'o2' }] },
      grants: { coach: ['o2'] },   // not o1
    });
    await expect(authorizeRecordView(db, VIEWER, 'player')).resolves.toMatchObject({ isSelf: false });
  });
});
