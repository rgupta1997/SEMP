import { describe, it, expect } from 'vitest';
import { can } from './can.js';

// A grant has three states and only one of them grants anything. The engine used
// to read all three, which meant suspending somebody's Sports Admin took away the
// navigation and left every permission behind it working - and the auth context,
// which has always filtered on ACTIVE, disagreed with the boundary.

const ORG = 'org-1';
const USER = { id: 'u1' };

/** One person, one explicit grant of `role` in `status`, and no membership. */
function fakeDb(status: string) {
  return {
    organizations: { findUnique: async () => ({ settings: {} }) },
    organization_members: { findFirst: async () => null },
    user_championship_roles: { findMany: async () => [] },
    user_org_roles: {
      findMany: async ({ where }: any) =>
        (where.status === undefined || where.status === status ? [{ role_id: 'r1' }] : []),
    },
    roles: {
      findMany: async () => [{ permission_ids: ['people.view'], code: null, organization_id: null }],
    },
  } as any;
}

describe('can() and the status of a grant', () => {
  it('honours an ACTIVE grant', async () => {
    await expect(can(fakeDb('ACTIVE'), 'people.view', { user: USER, scope: { organizationId: ORG } }))
      .resolves.toBe(true);
  });

  it('refuses a SUSPENDED grant', async () => {
    await expect(can(fakeDb('SUSPENDED'), 'people.view', { user: USER, scope: { organizationId: ORG } }))
      .resolves.toBe(false);
  });

  it('refuses an INVITED grant - it has not been accepted yet', async () => {
    await expect(can(fakeDb('INVITED'), 'people.view', { user: USER, scope: { organizationId: ORG } }))
      .resolves.toBe(false);
  });

  it('still falls back for a suspended holder, so this narrows nothing else', async () => {
    await expect(can(fakeDb('SUSPENDED'), 'people.view', {
      user: USER, scope: { organizationId: ORG }, fallback: async () => true,
    })).resolves.toBe(true);
  });
});
