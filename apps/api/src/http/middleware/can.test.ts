import { describe, it, expect } from 'vitest';
import { can, permissionsFor, MEMBERSHIP_ROLE_CODES } from './can.js';

// A roles/grants stand-in.
//   `orgGrants` / `champGrants`  - permissions carried by an EXPLICITLY assigned role.
//   `membership`                 - organization_members.role, which implies a role.
//   `roleGrants`                 - what each seeded role row (by code) carries.
//   `orgRoleGrants`               - an institution's OWN row for a code, which shadows
//                                   the platform one for that institution only.
function fakeDb({ orgGrants = {}, champGrants = {}, membership = {}, roleGrants = {}, orgRoleGrants = {} }: {
  orgGrants?: Record<string, string[]>;
  champGrants?: Record<string, string[]>;
  membership?: Record<string, { role: string; status?: string }>;
  roleGrants?: Record<string, string[]>;
  /** orgId -> roleCode -> permissions */
  orgRoleGrants?: Record<string, Record<string, string[]>>;
} = {}) {
  const roleFor = (scope: string, kind: 'o' | 'c') => `${kind}:${scope}`;
  return {
    user_org_roles: {
      findMany: async ({ where }: any) =>
        (orgGrants[where.organization_id] ? [{ role_id: roleFor(where.organization_id, 'o') }] : []),
    },
    user_championship_roles: {
      findMany: async ({ where }: any) =>
        (champGrants[where.championship_id] ? [{ role_id: roleFor(where.championship_id, 'c') }] : []),
    },
    organization_members: {
      findFirst: async ({ where }: any) => {
        const m = membership[where.organization_id];
        // The query asks for status: 'active'; a pending member must not match.
        if (!m || (m.status ?? 'active') !== where.status) return null;
        return { role: m.role };
      },
    },
    roles: {
      findMany: async ({ where }: any) => {
        const out: { permission_ids: string[]; code: string | null; organization_id: string | null }[] = [];
        for (const clause of where.OR ?? []) {
          if (clause.id) {
            for (const id of clause.id.in) {
              const [kind, scope] = id.split(':');
              out.push({
                permission_ids: (kind === 'o' ? orgGrants[scope] : champGrants[scope]) ?? [],
                code: null, organization_id: null,
              });
            }
          }
          if (clause.code) {
            // The real query asks for the platform row OR this org's own; both come
            // back and can() picks the override.
            const orgId = clause.OR?.find((o: any) => o.organization_id)?.organization_id ?? null;
            for (const code of clause.code.in) {
              if (roleGrants[code]) out.push({ permission_ids: roleGrants[code], code, organization_id: null });
              const own = orgId ? orgRoleGrants[orgId]?.[code] : undefined;
              if (own) out.push({ permission_ids: own, code, organization_id: orgId });
            }
          }
        }
        return out;
      },
    },
    // `can()` runs the J6-E2 module pre-check before it looks at any grant, so a
    // stand-in has to answer it. Empty settings = no module configured = every
    // module on, which is the state all the tests below assume.
    organizations: { findUnique: async () => ({ settings: {} }) },
  } as any;
}

const USER = { id: 'u1' };
const SUPER = { id: 'admin', isSuperAdmin: true };

// What the seed migration puts in the role rows. The tests below assert against these
// because they are what the retired fallbacks used to say in code.
const SEEDED = {
  org_owner: ['org.manage', 'org.member.manage', 'org.structure.manage', 'audit.view', 'people.view',
    'people.verify', 'team.manage', 'team.create', 'event.create', 'event.enroll',
    'achievement.validate', 'certificate.issue', 'report.view'],
  org_admin: ['org.member.manage', 'org.structure.manage', 'people.view', 'people.verify',
    'team.manage', 'team.create', 'event.create', 'event.enroll', 'report.view'],
  org_member: ['people.view', 'report.view'],
};

describe('can', () => {
  it('lets a super admin through without consulting anything', async () => {
    await expect(can(fakeDb(), 'fixture.lock', { user: SUPER })).resolves.toBe(true);
  });

  it('grants when a role held IN THAT SCOPE carries the permission', async () => {
    const db = fakeDb({ orgGrants: { orgA: ['team.manage', 'people.verify'] } });
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });

  // The point of scoping: a role at one institution must grant nothing at another.
  it('does not leak a grant into another organisation', async () => {
    const db = fakeDb({ orgGrants: { orgA: ['team.manage'] } });
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgB' } })).resolves.toBe(false);
  });

  it('refuses a permission the held role does not carry', async () => {
    const db = fakeDb({ orgGrants: { orgA: ['people.view'] } });
    await expect(can(db, 'people.verify', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });

  it('resolves championship-scoped grants from championship roles', async () => {
    const db = fakeDb({ champGrants: { champ1: ['fixture.lock'] } });
    await expect(can(db, 'fixture.lock', { user: USER, scope: { championshipId: 'champ1' } })).resolves.toBe(true);
  });

  it('refuses when there is no grant and no fallback', async () => {
    await expect(can(fakeDb(), 'certificate.issue', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });

  // An old row holding uuids rather than catalogue codes must be inert, not a
  // wildcard - an unreadable grant becoming an accidental one is the worst failure.
  it('ignores permission ids that are not catalogue codes', async () => {
    const db = fakeDb({ orgGrants: { orgA: ['3f6b1c2e-0000-4000-8000-000000000000'] } });
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });
});

// Membership implies a role. This is the bridge that made retiring the fallbacks
// possible: the hard-coded rules read organization_members.role, the engine read
// `roles`, and nothing joined the two.
describe('membership implies a role', () => {
  const db = (role: string, status = 'active') =>
    fakeDb({ membership: { orgA: { role, status } }, roleGrants: SEEDED });

  it('an owner holds everything org_owner carries', async () => {
    await expect(can(db('owner'), 'org.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });

  it('an admin holds what org_admin carries', async () => {
    await expect(can(db('admin'), 'team.create', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });

  // The difference between the two seeded roles has to be real, or "owner" and "admin"
  // are the same thing with two names.
  it('an admin does not hold what only the owner carries', async () => {
    await expect(can(db('admin'), 'org.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
    await expect(can(db('admin'), 'certificate.issue', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });

  it('an ordinary member holds almost nothing', async () => {
    await expect(can(db('member'), 'people.view', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
    await expect(can(db('member'), 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });

  // A pending member is not a member. The hard-coded rules checked status: 'active',
  // and dropping that check on the way through the engine would let anyone who has
  // merely requested to join act as one.
  it('a pending member holds nothing', async () => {
    await expect(can(db('owner', 'pending'), 'team.manage', { user: USER, scope: { organizationId: 'orgA' } }))
      .resolves.toBe(false);
  });

  it('membership in one organisation grants nothing in another', async () => {
    await expect(can(db('owner'), 'team.manage', { user: USER, scope: { organizationId: 'orgB' } })).resolves.toBe(false);
  });

  it('adds to an explicit grant rather than replacing it', async () => {
    const both = fakeDb({
      membership: { orgA: { role: 'member' } }, roleGrants: SEEDED,
      orgGrants: { orgA: ['fixture.unlock'] },
    });
    await expect(can(both, 'fixture.unlock', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
    await expect(can(both, 'people.view', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });

  it('maps every membership role the schema allows', () => {
    expect(Object.keys(MEMBERSHIP_ROLE_CODES).sort()).toEqual(['admin', 'member', 'owner']);
  });
});

// One test per retired fallback. Each pins BOTH halves: the person the hard-coded rule
// used to allow is still allowed (through a grant now), and - the new part - editing
// the role actually takes the permission away. The second half is the whole reason for
// retiring them; while a fallback was in place, a grant could only ever widen.
describe('retired fallbacks', () => {
  const withRole = (perms: string[], role = 'admin') =>
    fakeDb({ membership: { orgA: { role } }, roleGrants: { [MEMBERSHIP_ROLE_CODES[role]]: perms } });

  const RETIRED: Array<{ permission: Parameters<typeof can>[1]; guard: string }> = [
    { permission: 'team.manage', guard: 'teamManager' },
    { permission: 'team.create', guard: 'teamCreate' },
    { permission: 'org.member.manage', guard: 'manageUser' },
    { permission: 'event.enroll', guard: 'enrollSelf' },
  ];

  for (const { permission, guard } of RETIRED) {
    it(`${permission}: an org admin still passes ${guard} with no fallback`, async () => {
      await expect(can(withRole(SEEDED.org_admin), permission, { user: USER, scope: { organizationId: 'orgA' } }))
        .resolves.toBe(true);
    });

    it(`${permission}: removing it from the role now actually removes it`, async () => {
      const trimmed = SEEDED.org_admin.filter((p) => p !== permission);
      await expect(can(withRole(trimmed), permission, { user: USER, scope: { organizationId: 'orgA' } }))
        .resolves.toBe(false);
    });

    it(`${permission}: an owner keeps it`, async () => {
      await expect(can(withRole(SEEDED.org_owner, 'owner'), permission, { user: USER, scope: { organizationId: 'orgA' } }))
        .resolves.toBe(true);
    });

    it(`${permission}: a plain member never had it and still does not`, async () => {
      await expect(can(withRole(SEEDED.org_member, 'member'), permission, { user: USER, scope: { organizationId: 'orgA' } }))
        .resolves.toBe(false);
    });
  }

  // The fallback mechanism itself stays - guards outside this migration may still pass
  // one - so its contract is still worth pinning.
  it('a fallback, where one is still passed, is consulted only after grants', async () => {
    let consulted = false;
    const db = fakeDb({ membership: { orgA: { role: 'admin' } }, roleGrants: SEEDED });
    await can(db, 'team.manage', {
      user: USER, scope: { organizationId: 'orgA' },
      fallback: () => { consulted = true; return false; },
    });
    expect(consulted).toBe(false);
  });
});

// Role DEFINITIONS used to be global while ASSIGNMENTS were scoped, so editing what
// "Coordinator" meant changed it at every institution on the platform at once.
describe('an institution can redefine a role for itself', () => {
  const platformOnly = { org_admin: ['team.manage', 'team.create'] };

  it('uses the platform definition when the institution has not overridden it', async () => {
    const db = fakeDb({ membership: { orgA: { role: 'admin' } }, roleGrants: platformOnly });
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });

  it("the institution's own definition shadows the platform one", async () => {
    const db = fakeDb({
      membership: { orgA: { role: 'admin' } },
      roleGrants: platformOnly,
      // Here, an admin may create teams but not manage existing ones.
      orgRoleGrants: { orgA: { org_admin: ['team.create'] } },
    });
    await expect(can(db, 'team.create', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
    // Shadowing means REPLACING, not merging - otherwise an override could never
    // narrow anything, which is the bug this whole change exists to fix.
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
  });

  it('one institution overriding a role does not touch another', async () => {
    const db = fakeDb({
      membership: { orgA: { role: 'admin' }, orgB: { role: 'admin' } },
      roleGrants: platformOnly,
      orgRoleGrants: { orgA: { org_admin: [] } }, // orgA strips its admins bare
    });
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(false);
    await expect(can(db, 'team.manage', { user: USER, scope: { organizationId: 'orgB' } })).resolves.toBe(true);
  });

  it('an override can also widen', async () => {
    const db = fakeDb({
      membership: { orgA: { role: 'member' } },
      roleGrants: { org_member: ['people.view'] },
      orgRoleGrants: { orgA: { org_member: ['people.view', 'team.create'] } },
    });
    await expect(can(db, 'team.create', { user: USER, scope: { organizationId: 'orgA' } })).resolves.toBe(true);
  });
});

describe('permissionsFor', () => {
  it('reports a super admin as holding everything', async () => {
    await expect(permissionsFor(fakeDb(), { user: SUPER })).resolves.toEqual(['*']);
  });

  it('lists what a person actually holds in one scope', async () => {
    const db = fakeDb({ orgGrants: { orgA: ['people.view', 'report.view'] } });
    const out = await permissionsFor(db, { user: USER, scope: { organizationId: 'orgA' } });
    expect(out.sort()).toEqual(['people.view', 'report.view']);
  });

  // What the client mirrors for UX has to include the implied role, or an owner sees a
  // read-only screen while the server would happily accept their writes.
  it('includes what membership implies', async () => {
    const db = fakeDb({ membership: { orgA: { role: 'owner' } }, roleGrants: SEEDED });
    const out = await permissionsFor(db, { user: USER, scope: { organizationId: 'orgA' } });
    expect(out).toContain('org.manage');
    expect(out).toContain('team.manage');
  });
});
