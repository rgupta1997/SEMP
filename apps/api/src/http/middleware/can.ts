import type { PermissionCode } from '@semp/shared';
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

// Membership role -> the role row that says what it grants. An organisation can edit
// those rows; it cannot invent a fourth kind of membership, which is why this mapping
// is code and the grants behind it are data.
// The membership strings are NOT changing - 'member' is written by the join and
// invite paths and read by the notification audience resolver. Only the roles they
// point at were renamed (org_owner -> owner, org_member -> viewer), so this mapping
// is the single place that moves.
export const MEMBERSHIP_ROLE_CODES: Record<string, string> = {
  owner: 'owner',
  admin: 'org_admin',
  member: 'viewer',
};

// Which roles does this person hold in this scope, and what do those roles grant?
// One query per scope; the result is small and the call sites are per-request.
async function grantedPermissions(db: Db, ctx: CanContext): Promise<Set<string>> {
  const { user, scope } = ctx;
  const roleIds: string[] = [];
  const roleCodes: string[] = [];

  if (scope?.organizationId) {
    const rows = await db.user_org_roles.findMany({
      where: { user_id: user.id, organization_id: scope.organizationId },
      select: { role_id: true },
    });
    roleIds.push(...rows.map((r) => r.role_id));

    // Implied by membership. Only active members: a pending or removed member holds
    // no role, which is the same thing the hard-coded rules checked.
    const membership = await db.organization_members.findFirst({
      where: { user_id: user.id, organization_id: scope.organizationId, status: 'active' },
      select: { role: true },
    });
    const implied = membership?.role ? MEMBERSHIP_ROLE_CODES[membership.role] : undefined;
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
    for (const p of (r.permission_ids as unknown as string[] | null) ?? []) {
      if (typeof p === 'string') granted.add(p);
    }
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
