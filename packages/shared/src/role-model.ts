// The role ladder: who outranks whom, and what that is guaranteed to mean.
//
// WHY THIS FILE EXISTS
//
// The six organisation roles and the five event roles were seeded by SQL, and the
// permission arrays lived only in those migrations. Three separate follow-up
// migrations then patched them - 20260825000090 ("Owner and Org Admin were missing
// the competition permissions"), 20260826000020 ("The institution hosting an event
// could not manage it"), 20260826000030 - and every one of those gaps was found the
// same way: by logging in as a real account and discovering something senior staff
// could not do. Its own comment says so: "Found by checking what six real accounts
// could actually do rather than by reading the seed back, which is the only way this
// class of gap surfaces."
//
// That is the bug this file fixes. Not any one missing permission - the fact that
// nothing in the codebase asserted the rule everybody assumed:
//
//   A senior role holds AT LEAST everything the roles under it hold.
//
// So the grant sets are no longer written out per role. Each role declares only the
// slice it is FOR (`own`) plus which roles it is senior to (`inherits`), and its
// effective grant set is computed. A permission added to Sports Admin now reaches
// Org Admin and Owner because the graph says it must, not because somebody
// remembered. rbac.test.ts asserts the closure and asserts that Owner ends up
// holding the entire catalogue, so a NEW permission cannot be added without a
// decision about where on the ladder it belongs.
//
// WHY A GRAPH AND NOT A TIER NUMBER
//
// The obvious model - number the roles and say tier N holds everything below - is
// wrong here, and wrong in a way that matters. Billing Admin's description is "No
// access to people data", and Org Admin's is "Everything except billing". Those are
// two deliberate NON-inheritances between roles that a single ordering would force
// together: a tiered model either hands Billing Admin the people directory or hands
// Org Admin the company card. Explicit edges say exactly what was decided:
//
//                          Owner
//                         /     \
//                   Org Admin   Billing Admin
//                   /       \
//         Sports Admin   Reporting Admin
//              \             /
//                  Viewer
//
// Read upward, every edge is a promise: whoever is above holds everything below.
// Read downward, the two missing edges are the whole point - Billing Admin hangs off
// Owner alone, so the company card never reaches an administrator the Owner
// appointed, and nothing about billing reaches anybody who runs sport.
//
// WHERE THIS IS THE AUTHORITY
//
//   * roles.permission_ids in the database is a FLOOR set from `effectiveGrants()`,
//     by migration 20260828000030 and re-established with
//     `scripts/sync-role-catalogue.ts`. A floor, not a copy: /platform/roles is a
//     live screen and has been used (the platform `organiser` row holds 18
//     permissions where this file computes 6), and an institution may own a private
//     copy of a role that is deliberately narrower. The sync only ever ADDS, so
//     taking a permission away stays an explicit act in a migration. can() reads the
//     table, and an institution's own row wins.
//   * The delegation rule in org-roles.routes.ts reads this file directly: you may
//     only grant what you hold, which is the same ladder seen from below.
//   * The web app mirrors it for navigation and for showing/hiding controls, so the
//     client and the server cannot disagree about what a granted role means.

import { PERMISSION_CODES, type PermissionCode } from './permissions.js';

export type RoleVocabulary = 'org' | 'event';
export type RoleReach = 'whole_org' | 'campus_unit' | 'single_event';

export interface RoleDef {
  code: string;
  name: string;
  vocabulary: RoleVocabulary;
  /** How far a grant of this role reaches. Mirrors roles.scope. */
  reach: RoleReach;
  description: string;
  /**
   * The slice this role is FOR - only what is new at this position on the ladder.
   * Never repeat an inherited permission here: the duplicate is harmless today and
   * becomes a lie the moment the role below it changes.
   */
  own: PermissionCode[];
  /**
   * The roles this one is senior to. Every code listed here is a promise that this
   * role holds everything that role holds, enforced by rbac.test.ts.
   */
  inherits: string[];
}

// ---------------------------------------------------------------------------
// The organisation vocabulary
// ---------------------------------------------------------------------------

export const ORG_ROLES: Record<string, RoleDef> = {
  viewer: {
    code: 'viewer',
    name: 'Viewer',
    vocabulary: 'org',
    reach: 'campus_unit',
    description: 'Read-only visibility of dashboards, events and achievements.',
    // THE FLOOR. Everybody who belongs to an institution holds this, because
    // membership implies it (see `membershipRoleCode`). Anything added here is
    // added for every single person in every institution - which is why it is two
    // permissions and both of them are reads.
    own: ['people.view', 'achievement.view'],
    inherits: [],
  },

  sports_admin: {
    code: 'sports_admin',
    name: 'Sports Admin',
    vocabulary: 'org',
    reach: 'campus_unit',
    description: 'Runs sport day to day inside one campus or unit - people, teams, events, scoring.',
    own: [
      'people.verify', 'people.edit', 'people.import',
      'team.create', 'team.manage',
      'event.create', 'event.enroll', 'event.manage', 'event.approve',
      'official.assign', 'fixture.score', 'fixture.lock',
      'achievement.validate', 'certificate.issue',
      'audit.view',
    ],
    // Note what is NOT here: fixture.unlock. Locking is a review; reopening rewrites
    // a published result, and the person at the match should not be able to do the
    // second. It belongs to Org Admin, above.
    inherits: ['viewer'],
  },

  reporting_admin: {
    code: 'reporting_admin',
    name: 'Reporting Admin',
    vocabulary: 'org',
    reach: 'campus_unit',
    description: 'Read and export reporting for the assigned scope. No operational actions.',
    own: ['report.view'],
    inherits: ['viewer'],
  },

  billing_admin: {
    code: 'billing_admin',
    name: 'Billing Admin',
    vocabulary: 'org',
    reach: 'whole_org',
    description: 'Subscription, invoices and billing contact. No access to people data.',
    own: ['billing.manage'],
    // DELIBERATELY INHERITS NOTHING - not even Viewer. "No access to people data" is
    // the role's whole definition, and Viewer's floor is the people directory. This
    // is the one place on the ladder where a senior-looking role is narrower than
    // the floor, and it is narrower on purpose.
    inherits: [],
  },

  org_admin: {
    code: 'org_admin',
    name: 'Org Admin',
    vocabulary: 'org',
    reach: 'whole_org',
    description: 'Everything except billing, security policy and tenant deletion.',
    own: [
      'org.manage', 'org.member.manage', 'org.structure.manage',
      'role.manage',
      // Reversing a locked result. See the note under Sports Admin.
      'fixture.unlock',
    ],
    inherits: ['sports_admin', 'reporting_admin'],
  },

  owner: {
    code: 'owner',
    name: 'Owner',
    vocabulary: 'org',
    reach: 'whole_org',
    description: 'Full control of the tenant, including billing and deletion.',
    // security.manage is the Owner's alone, and this is a NARROWING of what
    // 20260825000080 seeded. Administration already withheld the Security tab from
    // Org Admin, with the right reason on it: org-wide policy (2FA enforcement, IP
    // allowlist, session length) binds the administrators too, and somebody the
    // Owner appointed - and can remove - should not be able to relax the rules that
    // bind them. The server granted it anyway, so the screen and the API disagreed.
    // They now agree, and they agree on the answer the product had already given.
    own: ['security.manage'],
    inherits: ['org_admin', 'billing_admin'],
  },
};

// ---------------------------------------------------------------------------
// The event vocabulary
// ---------------------------------------------------------------------------

export const EVENT_ROLES: Record<string, RoleDef> = {
  participant: {
    code: 'participant',
    name: 'Participant',
    vocabulary: 'event',
    reach: 'single_event',
    description: 'Competes in the event. Sees it as published.',
    own: [],
    inherits: [],
  },

  captain: {
    code: 'captain',
    name: 'Captain',
    vocabulary: 'event',
    reach: 'single_event',
    description: 'Leads a squad. Captaincy is a team fact; the role exists so the word means one thing.',
    own: [],
    inherits: ['participant'],
  },

  poc: {
    code: 'poc',
    name: 'POC',
    vocabulary: 'event',
    reach: 'single_event',
    description: 'The point of contact an institution nominates for an event.',
    own: [],
    inherits: ['participant'],
  },

  official: {
    code: 'official',
    name: 'Official',
    vocabulary: 'event',
    reach: 'single_event',
    description: 'Records what happened in the matches they are assigned to.',
    // Scoring only. Locking makes a result official and is the organiser's review;
    // an official who could lock their own card would be reviewing themselves.
    own: ['fixture.score'],
    inherits: ['participant'],
  },

  organiser: {
    code: 'organiser',
    name: 'Organiser',
    vocabulary: 'event',
    reach: 'single_event',
    description: 'Runs the event: setup, entries, officials, results.',
    own: [
      'event.manage', 'event.approve',
      'official.assign', 'fixture.lock', 'fixture.unlock',
    ],
    // This is the user's rule stated as data: whoever is organising the event holds
    // everything every other role in that event holds. Before this the event roles
    // carried EMPTY permission arrays and the organiser's authority lived only in a
    // hard-coded role-id lookup, so can('fixture.score', {championshipId}) was false
    // for the person running the whole thing.
    inherits: ['official', 'captain', 'poc'],
  },
};

export const ROLE_DEFS: Record<string, RoleDef> = { ...ORG_ROLES, ...EVENT_ROLES };

export const ORG_ROLE_CODE_LIST = Object.keys(ORG_ROLES);
export const EVENT_ROLE_CODE_LIST = Object.keys(EVENT_ROLES);

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

const grantsCache = new Map<string, PermissionCode[]>();

/**
 * Everything a role grants: its own slice plus the transitive closure of the roles
 * it is senior to.
 *
 * An unknown code returns nothing rather than throwing. A custom role somebody
 * created through the Roles screen is not in this graph, and the caller's job is to
 * fall back to that role's own stored array - not to crash authorisation.
 */
export function effectiveGrants(code: string): PermissionCode[] {
  const cached = grantsCache.get(code);
  if (cached) return cached;

  const out = new Set<PermissionCode>();
  // Iterative, with a seen-set: a cycle in `inherits` is a typo, and a typo must not
  // become a stack overflow inside a permission check.
  const seen = new Set<string>();
  const stack = [code];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const def = ROLE_DEFS[next];
    if (!def) continue;
    for (const p of def.own) out.add(p);
    stack.push(...def.inherits);
  }

  // Catalogue order, so two roles' grant lists are comparable by eye and the
  // materialised arrays in the database are stable across re-syncs.
  const list = PERMISSION_CODES.filter((p) => out.has(p));
  grantsCache.set(code, list);
  return list;
}

/** Does `code` grant this permission, by its own slice or by inheritance? */
export const roleGrants = (code: string, permission: PermissionCode): boolean =>
  effectiveGrants(code).includes(permission);

/**
 * Is `senior` at or above `junior` on the ladder?
 *
 * Reachability, not a number. Owner outranks Billing Admin; Org Admin does not,
 * and that is the point of the graph.
 */
export function outranks(senior: string, junior: string): boolean {
  if (senior === junior) return true;
  const seen = new Set<string>();
  const stack = [senior];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next === junior) return true;
    stack.push(...(ROLE_DEFS[next]?.inherits ?? []));
  }
  return false;
}

/**
 * The union of everything this set of role codes grants.
 *
 * Union, never "the highest one wins". Somebody can be a Sports Admin on one campus
 * and a Reporting Admin on another, and the engine has always unioned grants -
 * picking a winner here would disagree with it.
 */
export function grantsOfRoles(codes: readonly string[]): Set<PermissionCode> {
  const out = new Set<PermissionCode>();
  for (const c of codes) for (const p of effectiveGrants(c)) out.add(p);
  return out;
}

/**
 * May somebody holding `holderCodes` hand out `roleCode`?
 *
 * The delegation rule, and the reason it is here rather than inline in a route: you
 * cannot grant what you do not hold. Without it an Org Admin - a role the Owner
 * appoints and can remove - could assign themselves Billing Admin and reach the
 * company card the ladder deliberately keeps above them. Same for taking a private
 * copy of a role and editing permissions into it.
 *
 * Stated as a permission subset rather than as "is it below me", because the
 * subset is the thing that actually matters and it keeps working for a custom role
 * that has no position on the ladder at all.
 */
export function canDelegateRole(holderCodes: readonly string[], roleCode: string): boolean {
  const held = grantsOfRoles(holderCodes);
  return effectiveGrants(roleCode).every((p) => held.has(p));
}

/** The permissions in `wanted` that `holderCodes` does not itself hold. */
export function undelegatable(
  holderCodes: readonly string[],
  wanted: readonly PermissionCode[],
): PermissionCode[] {
  const held = grantsOfRoles(holderCodes);
  return wanted.filter((p) => !held.has(p));
}

// ---------------------------------------------------------------------------
// Membership implies a role
// ---------------------------------------------------------------------------

/**
 * The role code an `organization_members.role` implies.
 *
 * BELONGING TO AN INSTITUTION IS HOLDING VIEWER THERE. That is the rule, and the
 * default is what makes it true: `ORGANIZATION_MEMBER_ROLE` has five values -
 * owner, admin, captain, member, alumni - and the server's map only ever covered
 * three of them. A captain or an alumnus therefore held NO role at all on the
 * server, while the web app mapped every non-owner/admin membership to 'viewer'.
 * The two disagreed in the worst direction: navigation offered Dashboard, Events
 * and Achievements, and every one of those pages refused them.
 *
 * `member` and `alumni` and `captain` are all Viewer here. Captaincy is a TEAM
 * fact (team_members.role) and leading a squad says nothing about what you may do
 * to the institution, so it does not earn a wider org role - only the floor.
 *
 * The default is `viewer` rather than null so that a sixth membership value added
 * later grants the floor instead of nothing.
 */
export function membershipRoleCode(role: string | null | undefined): string | null {
  if (!role) return null;
  switch (role) {
    case 'owner': return 'owner';
    case 'admin': return 'org_admin';
    default: return 'viewer';
  }
}
