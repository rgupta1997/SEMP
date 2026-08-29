import { describe, it, expect } from 'vitest';
import {
  ORG_ROLES, EVENT_ROLES, ROLE_DEFS, PERMISSION_CODES, PERMISSIONS,
  effectiveGrants, grantsOfRoles, outranks, canDelegateRole, membershipRoleCode,
  ORGANIZATION_MEMBER_ROLE, type PermissionCode,
} from '@semp/shared';
import { can, heldPermissions } from './can.js';

// THE VERIFICATION HARNESS.
//
// The question this file answers is the one that had no answer: does the RBAC
// actually work? Three migrations had already patched a permission onto a senior
// role after somebody logged in and discovered they could not do their job, and
// 20260825000090 says so in its own comment - "the only way this class of gap
// surfaces". That is the thing being fixed here. Not any single permission: the
// absence of anything that fails when the ladder is violated.
//
// Four groups, in the order they matter:
//
//   1. CLOSURE      a senior role holds at least everything below it, and Owner
//                   holds the entire catalogue - so a NEW permission cannot be added
//                   without a decision about where on the ladder it goes.
//   2. THE FLOOR    belonging to an institution IS holding Viewer there, for every
//                   membership value the enum allows.
//   3. SCOPE        a suspended grant grants nothing; a campus-scoped grant answers
//                   for its campus and not for another.
//   4. DELEGATION   you cannot grant what you do not hold.

// ---------------------------------------------------------------------------
// A fake `Db`. can() touches five tables; each fixture says what they contain.
// ---------------------------------------------------------------------------

interface Fixture {
  /** Explicit org grants: the role row's permissions plus an optional campus. */
  orgGrants?: Array<{ code: string; permissions?: string[]; scope_ref?: string | null; status?: string; organization_id?: string | null }>;
  /** Explicit championship grants. */
  eventGrants?: Array<{ code: string; permissions?: string[] }>;
  /** organization_members.role, or null for a non-member. */
  membership?: string | null;
  /** organizations.settings. */
  settings?: unknown;
}

const ORG = 'org-1';
const EVENT = 'event-1';
const USER = { id: 'u1' };

function fakeDb(f: Fixture) {
  // Role rows are keyed by a synthetic id so `where: { id: { in } }` can resolve
  // them, exactly as the real query does.
  const rows = [
    ...(f.orgGrants ?? []).map((g, i) => ({
      id: `org-role-${i}`, code: g.code, organization_id: g.organization_id ?? null,
      permission_ids: g.permissions ?? (effectiveGrants(g.code) as unknown as string[]),
      scope_ref: g.scope_ref ?? null, status: g.status ?? 'ACTIVE',
    })),
    ...(f.eventGrants ?? []).map((g, i) => ({
      id: `event-role-${i}`, code: g.code, organization_id: null,
      permission_ids: g.permissions ?? (effectiveGrants(g.code) as unknown as string[]),
      scope_ref: null, status: 'ACTIVE',
    })),
  ];

  return {
    organizations: { findUnique: async () => ({ settings: f.settings ?? {} }) },
    organization_members: {
      findFirst: async () => (f.membership ? { role: f.membership } : null),
    },
    user_org_roles: {
      findMany: async ({ where }: any) => rows
        .filter((r) => r.id.startsWith('org-role-'))
        .filter((r) => where.status === undefined || r.status === where.status)
        .map((r) => ({ role_id: r.id, scope_ref: r.scope_ref })),
    },
    user_championship_roles: {
      findMany: async () => rows.filter((r) => r.id.startsWith('event-role-')).map((r) => ({ role_id: r.id })),
    },
    roles: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where.OR?.find((c: any) => c.id)?.id?.in ?? [];
        const codes: string[] = where.OR?.find((c: any) => c.code)?.code?.in ?? [];
        // Implied-by-membership roles are looked up by code and are not in `rows`.
        const implied = codes.map((code) => ({
          code, organization_id: null,
          permission_ids: effectiveGrants(code) as unknown as string[],
        }));
        return [
          ...rows.filter((r) => ids.includes(r.id)).map((r) => ({
            code: r.code, organization_id: r.organization_id, permission_ids: r.permission_ids,
          })),
          ...implied,
        ];
      },
    },
  } as any;
}

const canFor = (f: Fixture, permission: PermissionCode, scope: object = { organizationId: ORG }) =>
  can(fakeDb(f), permission, { user: USER, scope });

// ---------------------------------------------------------------------------
// 1. CLOSURE - the rule the three patch-migrations were each a symptom of
// ---------------------------------------------------------------------------

describe('the role ladder is closed upward', () => {
  it.each(Object.keys(ROLE_DEFS))('%s holds everything the roles it inherits hold', (code) => {
    const mine = new Set(effectiveGrants(code));
    for (const junior of ROLE_DEFS[code].inherits) {
      const missing = effectiveGrants(junior).filter((p) => !mine.has(p));
      // If this fails, a permission was added to a junior role and the senior one
      // was left behind - the exact shape of every gap the patch-migrations fixed.
      expect(missing, `${code} is senior to ${junior} but is missing ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('Owner holds the entire permission catalogue', () => {
    const owner = new Set(effectiveGrants('owner'));
    const missing = PERMISSION_CODES.filter((p) => !owner.has(p));
    // THE TRIPWIRE. Add a permission to @semp/shared and this fails until somebody
    // decides which role it belongs to. That decision is the thing that was being
    // skipped, discovered months later by an owner who could not do something.
    expect(missing, `nobody was given ${missing.join(', ')} - put it on a role`).toEqual([]);
  });

  it('every permission is reachable by some org role, or is an event permission', () => {
    const orgReachable = grantsOfRoles(Object.keys(ORG_ROLES));
    const eventReachable = grantsOfRoles(Object.keys(EVENT_ROLES));
    for (const code of PERMISSION_CODES) {
      expect(
        orgReachable.has(code) || eventReachable.has(code),
        `${code} is in the catalogue and no role grants it`,
      ).toBe(true);
    }
  });

  it('a championship-scoped permission is held by an event role', () => {
    // Otherwise the permission can only ever be answered from the organisation side,
    // and an event role could not carry it however it was configured - which is what
    // left the event vocabulary with empty permission arrays.
    const eventReachable = grantsOfRoles(Object.keys(EVENT_ROLES));
    const championshipScoped = PERMISSION_CODES.filter((c) => PERMISSIONS[c].scope === 'championship');
    for (const code of championshipScoped) {
      expect(eventReachable.has(code), `${code} is championship-scoped and no event role grants it`).toBe(true);
    }
  });

  it('no role repeats a permission it already inherits', () => {
    // A duplicate is harmless today and becomes a lie the moment the junior role
    // changes: the senior one keeps a permission the ladder no longer gives it, and
    // the closure test above passes while the intent has quietly diverged.
    for (const [code, def] of Object.entries(ROLE_DEFS)) {
      const inherited = grantsOfRoles(def.inherits);
      const repeated = def.own.filter((p) => inherited.has(p));
      expect(repeated, `${code} declares ${repeated.join(', ')} which it already inherits`).toEqual([]);
    }
  });

  it('the organiser holds everything every other event role holds', () => {
    // The user's rule, stated as a test: whoever is organising the event has at
    // least the rights of everybody in it.
    const organiser = new Set(effectiveGrants('organiser'));
    for (const code of Object.keys(EVENT_ROLES)) {
      const missing = effectiveGrants(code).filter((p) => !organiser.has(p));
      expect(missing, `organiser is missing ${code}'s ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('keeps the two deliberate non-inheritances', () => {
    // These two ARE the reason the ladder is a graph and not a tier number. If a
    // later edit turns it back into a single ordering, these fail.
    expect(outranks('owner', 'billing_admin')).toBe(true);
    expect(outranks('org_admin', 'billing_admin'), 'Org Admin must not reach billing').toBe(false);
    expect(effectiveGrants('billing_admin'), 'Billing Admin must hold no people data').toEqual(['billing.manage']);
    expect(effectiveGrants('org_admin')).not.toContain('security.manage');
    expect(effectiveGrants('owner')).toContain('security.manage');
  });

  it('keeps lock and unlock apart', () => {
    // Locking is a review; reopening rewrites a published result. The person at the
    // match may do the first and not the second.
    expect(effectiveGrants('sports_admin')).toContain('fixture.lock');
    expect(effectiveGrants('sports_admin')).not.toContain('fixture.unlock');
    expect(effectiveGrants('official')).not.toContain('fixture.lock');
    expect(effectiveGrants('org_admin')).toContain('fixture.unlock');
  });

  it('declares only real permission codes', () => {
    for (const [code, def] of Object.entries(ROLE_DEFS)) {
      for (const p of def.own) {
        expect(PERMISSION_CODES, `${code} declares unknown permission ${p}`).toContain(p);
      }
      for (const j of def.inherits) {
        expect(ROLE_DEFS[j], `${code} inherits unknown role ${j}`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. THE FLOOR - "by default all will be viewer who are part of org"
// ---------------------------------------------------------------------------

describe('belonging to an institution is holding Viewer there', () => {
  it.each([...ORGANIZATION_MEMBER_ROLE])('a %s membership implies a role', (role) => {
    expect(membershipRoleCode(role)).not.toBeNull();
  });

  it.each([...ORGANIZATION_MEMBER_ROLE])('a %s membership can read the people directory', async (role) => {
    // captain and alumni are the two the server's old three-key map missed, so they
    // held nothing while the web app showed them Dashboard, Events and Achievements.
    await expect(canFor({ membership: role }, 'people.view')).resolves.toBe(true);
  });

  it.each([...ORGANIZATION_MEMBER_ROLE])('a %s membership can read the honours board', async (role) => {
    await expect(canFor({ membership: role }, 'achievement.view')).resolves.toBe(true);
  });

  it('a non-member holds nothing', async () => {
    await expect(canFor({ membership: null }, 'people.view')).resolves.toBe(false);
  });

  it('the floor is only the floor - a member cannot manage the institution', async () => {
    for (const role of ['member', 'alumni', 'captain']) {
      await expect(canFor({ membership: role }, 'org.manage')).resolves.toBe(false);
      await expect(canFor({ membership: role }, 'people.edit')).resolves.toBe(false);
      await expect(canFor({ membership: role }, 'billing.manage')).resolves.toBe(false);
    }
  });

  it('an owner membership carries the whole catalogue', async () => {
    for (const code of PERMISSION_CODES.filter((c) => PERMISSIONS[c].scope === 'org')) {
      await expect(canFor({ membership: 'owner' }, code), code).resolves.toBe(true);
    }
  });

  it('an admin membership carries everything except billing and security', async () => {
    await expect(canFor({ membership: 'admin' }, 'org.member.manage')).resolves.toBe(true);
    await expect(canFor({ membership: 'admin' }, 'role.manage')).resolves.toBe(true);
    await expect(canFor({ membership: 'admin' }, 'billing.manage')).resolves.toBe(false);
    await expect(canFor({ membership: 'admin' }, 'security.manage')).resolves.toBe(false);
  });

  it('a granted role widens the floor without replacing it', async () => {
    // Union, not override. Losing a grant must not also strip the access being a
    // member already carries, which is what the engine has always done.
    const f: Fixture = { membership: 'member', orgGrants: [{ code: 'billing_admin' }] };
    await expect(canFor(f, 'billing.manage')).resolves.toBe(true);
    await expect(canFor(f, 'people.view')).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. SCOPE - a grant that is not live, and a grant that is not here
// ---------------------------------------------------------------------------

describe('a grant applies where and when it says', () => {
  it('an ACTIVE grant applies', async () => {
    await expect(canFor({ orgGrants: [{ code: 'sports_admin' }] }, 'people.import')).resolves.toBe(true);
  });

  it.each(['SUSPENDED', 'INVITED'])('a %s grant applies nothing', async (status) => {
    await expect(canFor({ orgGrants: [{ code: 'sports_admin', status }] }, 'people.import')).resolves.toBe(false);
  });

  it('an unscoped grant reaches every campus', async () => {
    const f: Fixture = { orgGrants: [{ code: 'sports_admin', scope_ref: null }] };
    await expect(canFor(f, 'team.manage', { organizationId: ORG, orgUnitId: 'unit-a' })).resolves.toBe(true);
    await expect(canFor(f, 'team.manage', { organizationId: ORG, orgUnitId: 'unit-b' })).resolves.toBe(true);
  });

  it('a campus-scoped grant answers for its campus and refuses another', async () => {
    // The over-granting bug campus-admin.ts documented and nothing fixed: "a Sports
    // Admin, Bangalore only grant currently reaches the whole organisation".
    const f: Fixture = { orgGrants: [{ code: 'sports_admin', scope_ref: 'unit-a' }] };
    await expect(canFor(f, 'team.manage', { organizationId: ORG, orgUnitId: 'unit-a' })).resolves.toBe(true);
    await expect(canFor(f, 'team.manage', { organizationId: ORG, orgUnitId: 'unit-b' })).resolves.toBe(false);
  });

  it('a campus-scoped grant still answers the organisation-wide question', async () => {
    // "Does this person administer sport ANYWHERE here" is what navigation and every
    // dashboard asks. Refusing it would take the workspace away from every campus
    // administrator, which is why an unnamed unit keeps a scoped grant counting.
    const f: Fixture = { orgGrants: [{ code: 'sports_admin', scope_ref: 'unit-a' }] };
    await expect(canFor(f, 'team.manage', { organizationId: ORG })).resolves.toBe(true);
  });

  it('an event grant answers championship-scoped questions', async () => {
    // Before the event roles had permission arrays this was false for the person
    // running the whole event.
    const f: Fixture = { eventGrants: [{ code: 'organiser' }] };
    await expect(canFor(f, 'fixture.score', { championshipId: EVENT })).resolves.toBe(true);
    await expect(canFor(f, 'fixture.unlock', { championshipId: EVENT })).resolves.toBe(true);
    await expect(canFor(f, 'event.manage', { championshipId: EVENT })).resolves.toBe(true);
  });

  it('an official scores and does not lock', async () => {
    const f: Fixture = { eventGrants: [{ code: 'official' }] };
    await expect(canFor(f, 'fixture.score', { championshipId: EVENT })).resolves.toBe(true);
    await expect(canFor(f, 'fixture.lock', { championshipId: EVENT })).resolves.toBe(false);
  });

  it('a captain, a POC and a participant operate nothing', async () => {
    for (const code of ['captain', 'poc', 'participant']) {
      const f: Fixture = { eventGrants: [{ code }] };
      await expect(canFor(f, 'fixture.score', { championshipId: EVENT }), code).resolves.toBe(false);
      await expect(canFor(f, 'event.manage', { championshipId: EVENT }), code).resolves.toBe(false);
    }
  });

  it('an org role says nothing about an event', async () => {
    // Administering an institution is not authority over an event you were entered
    // into - the rule the web app calls "an event role overrides an organisation one".
    const f: Fixture = { membership: 'owner' };
    await expect(canFor(f, 'event.manage', { championshipId: EVENT })).resolves.toBe(false);
  });

  it('an unsynced platform role still grants what the ladder says', async () => {
    // The event roles shipped with empty arrays for months. A platform row with
    // nothing in it means the database has not been synced, not that the role grants
    // nothing - so the model answers.
    const f: Fixture = { eventGrants: [{ code: 'organiser', permissions: [] }] };
    await expect(canFor(f, 'event.manage', { championshipId: EVENT })).resolves.toBe(true);
  });

  it("an institution's own empty copy of a role is a real revocation", async () => {
    // The other side of the same rule: taking ownership of a role and emptying it is
    // a decision, and the model must not overrule it.
    const f: Fixture = { orgGrants: [{ code: 'sports_admin', permissions: [], organization_id: ORG }] };
    await expect(canFor(f, 'people.import')).resolves.toBe(false);
  });

  it('a module switched off refuses the permission however it was granted', async () => {
    const f: Fixture = {
      membership: 'member',
      orgGrants: [{ code: 'sports_admin' }],
      settings: { modules: { people: ['staff'] } },
    };
    // A 'member' membership is the students audience, so People is off for them -
    // ahead of the grant and ahead of any fallback.
    await expect(can(fakeDb(f), 'people.import', {
      user: USER, scope: { organizationId: ORG }, fallback: () => true,
    })).resolves.toBe(false);
    // ...and a module that is off does not bleed into the ones that are on.
    await expect(canFor(f, 'event.create')).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. DELEGATION - "Org Owner will set who is going to be organiser, billing
//    admin, sports admin"; nobody sets anything above themselves
// ---------------------------------------------------------------------------

describe('you cannot grant what you do not hold', () => {
  it('an owner may hand out every role', () => {
    for (const code of Object.keys(ROLE_DEFS)) {
      expect(canDelegateRole(['owner'], code), `owner should be able to grant ${code}`).toBe(true);
    }
  });

  it('an org admin may appoint the administrators below them', () => {
    for (const code of ['sports_admin', 'reporting_admin', 'viewer']) {
      expect(canDelegateRole(['org_admin'], code)).toBe(true);
    }
  });

  it('an org admin may not appoint a Billing Admin, or an Owner', () => {
    // The escalation this closes: two clicks from "administrator the Owner can
    // remove" to "holds the company card", with an audit line saying it was fine.
    expect(canDelegateRole(['org_admin'], 'billing_admin')).toBe(false);
    expect(canDelegateRole(['org_admin'], 'owner')).toBe(false);
  });

  it('a sports admin may not appoint an administrator', () => {
    expect(canDelegateRole(['sports_admin'], 'org_admin')).toBe(false);
    expect(canDelegateRole(['sports_admin'], 'reporting_admin')).toBe(false); // report.view
    expect(canDelegateRole(['sports_admin'], 'viewer')).toBe(true);
  });

  it('a viewer may appoint nobody but another viewer', () => {
    expect(canDelegateRole(['viewer'], 'viewer')).toBe(true);
    expect(canDelegateRole(['viewer'], 'sports_admin')).toBe(false);
  });

  it('two narrow roles together may appoint what each alone cannot', () => {
    // Union, consistent with the engine. Sports Admin + Reporting Admin is exactly
    // Org Admin's operational half, so between them they cover Reporting Admin.
    expect(canDelegateRole(['sports_admin'], 'reporting_admin')).toBe(false);
    expect(canDelegateRole(['sports_admin', 'reporting_admin'], 'reporting_admin')).toBe(true);
  });

  it('the ceiling is not narrowed by a switched-off module', async () => {
    // Module access answers "can this person reach the People screen", not "may this
    // person appoint a Sports Admin". Gating the ceiling would let a module setting
    // silently un-delegate half the catalogue.
    const f: Fixture = { membership: 'owner', settings: { modules: { people: ['students'] } } };
    const held = await heldPermissions(fakeDb(f), { user: USER, scope: { organizationId: ORG } });
    expect(held.has('people.import')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. WHERE THE SPORTS ADMIN BELONGS
//
// The role that prompted all of this. It hit "Only an organization owner/admin can
// change the structure" while doing something that looked like its own job, and the
// answer turned out to be that the routers had collapsed several different acts
// under one membership-only guard. These tests fix the line in both directions - the
// things the role must be able to do, and the things it must not.
// ---------------------------------------------------------------------------

describe('the Sports Admin boundary', () => {
  const sportsAdmin: Fixture = { membership: 'member', orgGrants: [{ code: 'sports_admin' }] };

  it.each([
    ['people.view', 'read the directory'],
    ['people.edit', 'add and edit a person'],
    ['people.import', 'bulk-upload a roster'],
    ['people.verify', 'verify a player'],
    ['team.create', 'create a squad'],
    ['team.manage', 'manage a squad'],
    ['event.create', 'create a championship'],
    ['event.manage', 'run one'],
    ['event.approve', 'approve entries'],
    ['event.enroll', 'enter the institution into another host’s event'],
    ['official.assign', 'name the officials'],
    ['fixture.score', 'record a score'],
    ['fixture.lock', 'lock a scorecard'],
    ['achievement.validate', 'validate a claim'],
    ['certificate.issue', 'issue certificates'],
    ['audit.view', 'read the audit trail'],
  ] as const)('CAN %s - %s', async (permission, _why) => {
    await expect(canFor(sportsAdmin, permission as PermissionCode)).resolves.toBe(true);
  });

  it.each([
    ['org.structure.manage', 'shaping the institution - add, rename or delete a campus'],
    ['org.manage', 'the organisation’s own settings'],
    ['org.member.manage', 'who belongs to the institution at all'],
    ['role.manage', 'deciding who else is an administrator'],
    ['billing.manage', 'the company card'],
    ['security.manage', 'org-wide security policy'],
    ['fixture.unlock', 'reversing a published result'],
    ['report.view', 'the reporting suite'],
  ] as const)('CANNOT %s - %s', async (permission, _why) => {
    await expect(canFor(sportsAdmin, permission as PermissionCode)).resolves.toBe(false);
  });

  it('places people into its OWN campus and not into another', async () => {
    // The concrete form of the scope_ref fix, on the route that first needed it:
    // POST /organizations/:id/units/:unitId/members narrows by unit.
    const scoped: Fixture = { membership: 'member', orgGrants: [{ code: 'sports_admin', scope_ref: 'unit-a' }] };
    await expect(canFor(scoped, 'people.edit', { organizationId: ORG, orgUnitId: 'unit-a' })).resolves.toBe(true);
    await expect(canFor(scoped, 'people.edit', { organizationId: ORG, orgUnitId: 'unit-b' })).resolves.toBe(false);
  });

  it('cannot appoint whoever runs a campus, even one it is scoped to', async () => {
    // `org_units.admin_user_id` is read by authorisation, so naming somebody there
    // delegates authority over that unit's squads. It is org.structure.manage, and
    // the route checks it separately from editing the unit's other fields.
    const scoped: Fixture = { membership: 'member', orgGrants: [{ code: 'sports_admin', scope_ref: 'unit-a' }] };
    await expect(canFor(scoped, 'org.structure.manage', { organizationId: ORG, orgUnitId: 'unit-a' })).resolves.toBe(false);
  });

  it('an Org Admin shapes the institution and a Sports Admin does not', async () => {
    await expect(canFor({ membership: 'admin' }, 'org.structure.manage')).resolves.toBe(true);
    await expect(canFor(sportsAdmin, 'org.structure.manage')).resolves.toBe(false);
  });

  it('cannot delegate its own way upward', () => {
    expect(canDelegateRole(['sports_admin'], 'org_admin')).toBe(false);
    expect(canDelegateRole(['sports_admin'], 'sports_admin')).toBe(true);
  });
});
