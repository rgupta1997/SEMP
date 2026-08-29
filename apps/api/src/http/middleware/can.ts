import { effectiveGrants, membershipRoleCode, type PermissionCode } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { moduleBlocks } from '../../modules/iam/module-access.js';

// The permission engine (J6-E1-S4).
//
// `can()` resolves in this order:
//
//   1. super admin              - always
//   2. a grant                  - a role the user holds IN THAT SCOPE whose
//                                 permission_ids include this permission
//   3. the caller's fallback    - a hard-coded rule, where one is still passed in
//
// Roles come from two places, and the second is what let the fallbacks be retired:
//
//   * EXPLICIT  - user_org_roles / user_championship_roles, assigned deliberately.
//   * IMPLIED   - organization_members.role. Being an owner of an organisation IS
//                 holding the org_owner role there. Before this, membership role
//                 ('owner' | 'admin' | 'member') and `roles` were two vocabularies for
//                 the same idea, which is why every guard needed a hard-coded rule
//                 reading the first while the engine read the second.
//
// Step 3 is now the exception rather than the rule. It was a retrofit device: while
// every call site passed one, a grant could only ever ADD access, so no configured
// role could decide anything and `user_org_roles` sat empty in production. Fallbacks
// are being removed one permission at a time, each behind a test in can.test.ts.

export interface PermissionScope {
  organizationId?: string | null;
  championshipId?: string | null;
  /**
   * The campus or batch the question is ABOUT, when there is one.
   *
   * A grant may carry a `scope_ref` - "Sports Admin, Bangalore only" - which the
   * role-assignment screen has always written and which nothing read, so a
   * campus-scoped grant reached the whole organisation. It is read now, and this is
   * the field that lets it be: name the unit and a scoped grant only answers for
   * that unit.
   *
   * Leaving it out keeps a scoped grant counting, and that is deliberate rather
   * than lazy. Plenty of questions are genuinely organisation-wide in the sense
   * that matters here - "does this person administer sport ANYWHERE in this
   * institution", which is what navigation and every dashboard is asking. Refusing
   * those would take the whole workspace away from every campus administrator. A
   * call site narrows by naming the unit; until it does, behaviour is what it was.
   */
  orgUnitId?: string | null;
}

export interface CanContext {
  user: { id: string; isSuperAdmin?: boolean };
  scope?: PermissionScope;
  /**
   * The rule that was already in force. Called only when no explicit grant matched,
   * so behaviour is preserved by construction.
   */
  fallback?: () => Promise<boolean> | boolean;
}

// Membership role -> the role row that says what it grants.
//
// This used to be a three-key object literal - owner, admin, member - and
// ORGANIZATION_MEMBER_ROLE allows five. A membership of 'captain' or 'alumni'
// therefore resolved to `undefined` and the person held NO role on the server,
// while useWorkspace.ts mapped every non-owner/admin membership to 'viewer'. The
// client and the boundary disagreed in the worst direction: navigation offered
// Dashboard, Events and Achievements, and all three refused them.
//
// It now delegates to `membershipRoleCode` in @semp/shared, which defaults to
// 'viewer' - belonging to an institution IS holding Viewer there - so a sixth
// membership value added later grants the floor rather than nothing, and the web
// app resolves it through the same function.
//
// The membership STRINGS are not changing: 'member' is written by the join and
// invite paths and read by the notification audience resolver.
export { membershipRoleCode };

// Which roles does this person hold in this scope, and what do those roles grant?
// One query per scope; the result is small and the call sites are per-request.
async function grantedPermissions(db: Db, ctx: CanContext): Promise<Set<string>> {
  const { user, scope } = ctx;
  const roleIds: string[] = [];
  const roleCodes: string[] = [];

  if (scope?.organizationId) {
    // ACTIVE only. A grant has three states and two of them grant nothing: a
    // SUSPENDED one keeps its scope and its history precisely so it can be handed
    // back, and an INVITED one has not been accepted yet. Reading them all was the
    // engine disagreeing with the auth context, which has always filtered here -
    // so suspending somebody's Sports Admin removed the nav and left every
    // permission behind it intact.
    const rows = await db.user_org_roles.findMany({
      where: { user_id: user.id, organization_id: scope.organizationId, status: 'ACTIVE' },
      select: { role_id: true, scope_ref: true },
    });

    // SCOPE_REF IS READ HERE, and until now it was read nowhere. The
    // role-assignment screen writes it, the Campuses screen explains it ("Sports
    // Admin granted here reaches this campus and nothing else"), and authorisation
    // ignored it - so that grant reached the whole institution. Somebody could
    // quietly pick players for a campus that was not theirs, which surfaces only as
    // a result nobody can explain.
    //
    // A grant with no scope_ref is organisation-wide and always counts. A scoped one
    // counts when the caller has not named a unit (see PermissionScope.orgUnitId for
    // why that is the right default) or when it names this one.
    const wantedUnit = scope.orgUnitId ?? null;
    roleIds.push(...rows
      .filter((r) => !r.scope_ref || !wantedUnit || r.scope_ref === wantedUnit)
      .map((r) => r.role_id));

    // Implied by membership. Only active members: a pending or removed member holds
    // no role, which is the same thing the hard-coded rules checked.
    const membership = await db.organization_members.findFirst({
      where: { user_id: user.id, organization_id: scope.organizationId, status: 'active' },
      select: { role: true },
    });
    const implied = membershipRoleCode(membership?.role);
    if (implied) roleCodes.push(implied);
  }

  if (scope?.championshipId) {
    const rows = await db.user_championship_roles.findMany({
      where: { user_id: user.id, championship_id: scope.championshipId },
      select: { role_id: true },
    });
    roleIds.push(...rows.map((r) => r.role_id));
  }

  if (roleIds.length === 0 && roleCodes.length === 0) return new Set();

  // Roles are owned: organization_id null is the platform role every institution
  // starts from, a row with an organization_id is that institution's own override.
  // Both are fetched, and the override shadows the platform row below - which is what
  // lets one institution redefine "org_admin" without touching anybody else's.
  const roles = await db.roles.findMany({
    where: {
      OR: [
        ...(roleIds.length ? [{ id: { in: [...new Set(roleIds)] } }] : []),
        ...(roleCodes.length ? [{
          code: { in: [...new Set(roleCodes)] },
          OR: [{ organization_id: null }, { organization_id: scope?.organizationId ?? undefined }],
        }] : []),
      ],
    },
    select: { permission_ids: true, code: true, organization_id: true },
  });

  const byId = roles.filter((r) => !r.code);
  const byCode = new Map<string, typeof roles[number]>();
  for (const r of roles) {
    if (!r.code) continue;
    const current = byCode.get(r.code);
    // An institution's own row wins over the platform one for the same code.
    if (!current || (r.organization_id && !current.organization_id)) byCode.set(r.code, r);
  }
  const effective = [...byId, ...byCode.values()];

  // `permission_ids` holds permission CODES (the catalogue is code-owned); older rows
  // may hold uuids, which simply never match a code and are ignored rather than
  // throwing - an unreadable grant must not become an accidental one.
  const granted = new Set<string>();
  for (const r of effective) {
    const stored = ((r.permission_ids as unknown as string[] | null) ?? []).filter((p) => typeof p === 'string');

    // A PLATFORM row with nothing in it means the database has not been synced to
    // the ladder, not that the role grants nothing. The event roles shipped with
    // empty arrays for months for exactly this reason, and the code is the
    // authority - so fall back to the model rather than silently refusing the
    // person running the event.
    //
    // Only platform rows. An institution's own copy with an empty array is a
    // deliberate revocation - that is what taking ownership of a role is for - and
    // re-granting it from the model would overrule the decision the copy exists to
    // record.
    const source = stored.length === 0 && r.code && !r.organization_id
      ? (effectiveGrants(r.code) as unknown as string[])
      : stored;

    for (const p of source) granted.add(p);
  }
  return granted;
}

export async function can(db: Db, permission: PermissionCode, ctx: CanContext): Promise<boolean> {
  if (ctx.user.isSuperAdmin) return true;

  // MODULE PRE-CHECK (J6-E2-S3). If the institution has switched this
  // permission's module off for this person's audience, nothing else matters:
  // not a role, not the hard-coded fallback. That is what "one place to switch
  // something off" has to mean - a module gate that only hid navigation, or that
  // sat beside the permission engine rather than in front of it, would be
  // trivially bypassed by any route still carrying its original guard.
  if (await moduleBlocks(db, permission, {
    userId: ctx.user.id,
    organizationId: ctx.scope?.organizationId,
    isSuperAdmin: ctx.user.isSuperAdmin,
  })) return false;

  // An explicit grant is checked before the fallback so that configuring a role is
  // the thing that widens access - which is the entire point of the engine.
  const granted = await grantedPermissions(db, ctx);
  if (granted.has(permission)) return true;

  return ctx.fallback ? !!(await ctx.fallback()) : false;
}

/**
 * Everything a person HOLDS in one scope, before the module gate.
 *
 * This is the delegation ceiling, and it is deliberately not `permissionsFor`.
 * Module access answers "can this person reach the People screen", which is a
 * different question from "may this person hand the People permissions to somebody
 * else": an institution that has switched the People module off for staff has not
 * thereby stopped its Owner from appointing a Sports Admin. Gating the ceiling would
 * make a module setting silently un-delegate half the role catalogue.
 */
export async function heldPermissions(db: Db, ctx: CanContext): Promise<Set<string>> {
  if (ctx.user.isSuperAdmin) return new Set(['*']);
  return grantedPermissions(db, ctx);
}

// Everything a person can do in one scope. Used by /me/permissions so the client can
// mirror the rules for UX - never as the boundary, which stays server-side.
export async function permissionsFor(db: Db, ctx: CanContext): Promise<string[]> {
  if (ctx.user.isSuperAdmin) return ['*'];
  const granted = [...(await grantedPermissions(db, ctx))] as PermissionCode[];
  // Filtered through the same module gate `can()` applies, so the client's
  // mirror of the rules cannot show a person a control that the server will then
  // refuse - which is the failure J6-E2-S2 is specifically about.
  const out: string[] = [];
  for (const code of granted) {
    if (!(await moduleBlocks(db, code, {
      userId: ctx.user.id,
      organizationId: ctx.scope?.organizationId,
      isSuperAdmin: ctx.user.isSuperAdmin,
    }))) out.push(code);
  }
  return out;
}
