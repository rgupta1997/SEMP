import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { grantsOfRoles, membershipRoleCode, type PermissionCode } from '@semp/shared';
import { useAuth } from './auth';
import { parseEventId } from './championship-nav';

// Capability codes (entity.action). Client checks are UX-only - the API must
// still enforce every mutation server-side. Capabilities are derived from the
// auth context: super admins can do everything; otherwise authority follows the
// championships the user organises and the organizations they own/administer.
export type Capability =
  | 'championship.create'        // host a brand-new championship (open to everyone)
  | 'championship.manage'        // edit/delete/setup/schedule a championship you organise
  | 'enrollment.approve'
  | 'official.assign'
  | 'fixture.manage'
  | 'fixture.score'
  | 'team.manage'         // create/edit teams for an organization
  | 'roster.manage'       // add/remove members, lock roster
  | 'masterdata.manage';  // platform sports/disciplines/formats/roles/users

export function usePermissions() {
  const { ctx } = useAuth();
  const { pathname } = useLocation();
  const isSuper = !!ctx?.user.is_super_admin;

  // Resolved by the server (manage-access.ts), for two reasons. It used to match
  // on the role's display NAME against a table with a rename screen, so renaming
  // "Organiser" silently revoked every organiser. And it could only ever see one
  // of the two ways of managing an event: an institution's owner manages the
  // events it hosts without holding an Organiser row on any of them.
  const managedIds = ctx?.managed_championship_ids ?? [];
  const organisesAny = managedIds.length > 0;
  const officialIds = ctx?.official_championship_ids ?? [];
  // By CODE, not display name - the roles table has a rename screen, and matching
  // on the label is how renaming a role silently revokes everybody holding it.
  const isOfficialAny = officialIds.length > 0 || !!ctx?.championship_roles?.some((r) => r.role.code === 'official');
  const isCaptain = !!ctx?.memberships?.some((m) => m.role === 'captain' || m.role === 'vice_captain');

  /**
   * Every role code this person holds per organisation - the membership one AND
   * anything granted through the Roles screen - resolved through the same ladder the
   * server uses.
   *
   * This is the fix for the half of RBAC that was decided client-side and got a
   * different answer. `canManageOrg` read `organization_members.role` and nothing
   * else, so a role the Owner granted widened the SIDEBAR (useWorkspace reads
   * ctx.org_roles) and not one control on the page behind it: an Org Admin by grant
   * saw Administration and found every button in it hidden. The server had the same
   * split, and orgPermission() closes it there.
   *
   * A mirror, never the boundary. /me/permissions answers authoritatively where a
   * screen needs the server's own word for it.
   */
  const rolesByOrg = new Map<string, string[]>();
  for (const m of ctx?.organizations ?? []) {
    if ((m as any).status && (m as any).status !== 'active') continue;
    const implied = membershipRoleCode(m.role);
    if (implied) rolesByOrg.set(m.organization_id, [...(rolesByOrg.get(m.organization_id) ?? []), implied]);
  }
  for (const g of (ctx as any)?.org_roles ?? []) {
    if (!g.code) continue;
    rolesByOrg.set(g.organization_id, [...(rolesByOrg.get(g.organization_id) ?? []), g.code]);
  }

  /** What this person holds in one organisation, by the ladder. */
  const orgPermissions = (id?: string | null): Set<PermissionCode> =>
    grantsOfRoles(id ? rolesByOrg.get(id) ?? [] : []);

  /** Does this person hold `permission` in this organisation (or in any of them)? */
  const hasOrgPermission = (permission: PermissionCode, id?: string | null): boolean => {
    if (isSuper) return true;
    if (id) return orgPermissions(id).has(permission);
    return [...rolesByOrg.keys()].some((orgId) => orgPermissions(orgId).has(permission));
  };

  const orgAdminAny = hasOrgPermission('org.manage');

  // Per-entity checks (preferred for new code).
  const organisesChampionship = (id?: string | null) => isSuper || (!!id && managedIds.includes(id));
  const canManageChampionship = (id?: string | null) => (id ? organisesChampionship(id) : isSuper || organisesAny);
  // "Manage this organisation" is `org.manage` - the permission, not the membership
  // string - so a granted Org Admin reaches the same controls a member one does.
  const canManageOrg = (id?: string | null) => hasOrgPermission('org.manage', id);
  // Owner-only actions stay OWNERSHIP, not a permission. Deleting the whole tenant is
  // not something a role should be able to be granted: it is the one act that ends
  // the account, and `security.manage` being the Owner's alone exists for the same
  // reason - somebody the Owner appointed, and can remove, must not be able to remove
  // the Owner's institution.
  const isOrgOwner = (id?: string | null) =>
    isSuper || (!!id && !!ctx?.organizations?.some((m) => m.organization_id === id && m.role === 'owner'));

  // The championship currently in the URL (if any) - lets the coarse capability
  // shim resolve against THIS championship, so management controls only show to
  // the people who actually manage it.
  const currentId = parseEventId(pathname);
  const managesCurrent = currentId ? organisesChampionship(currentId) : organisesAny;
  const scoresCurrent = currentId ? (organisesChampionship(currentId) || officialIds.includes(currentId)) : (organisesAny || isOfficialAny);

  // Likewise for the organization in the URL (/organizations/:orgId/...).
  const orgMatch = pathname.match(/^\/organizations\/([^/]+)/);
  const currentOrgId = orgMatch ? orgMatch[1] : null;
  const managesCurrentOrg = currentOrgId ? canManageOrg(currentOrgId) : orgAdminAny;

  // Capability shim used by the management pages. Championship-scoped capabilities
  // resolve against the championship in the URL; the API still enforces the precise
  // per-entity rule on every mutation.
  const can = (cap: Capability): boolean => {
    if (isSuper) return true;
    switch (cap) {
      case 'championship.create':
        return true; // anyone can host a championship
      case 'championship.manage':
      case 'enrollment.approve':
      case 'official.assign':
      case 'fixture.manage':
        return managesCurrent;
      case 'fixture.score':
        return scoresCurrent;
      case 'team.manage':
      case 'roster.manage':
        // `team.manage`, not "manages the organisation". A Sports Admin's whole job is
        // squads and rosters and it holds neither org.manage nor an owner/admin
        // membership, so the shim was hiding every control on the screens the role
        // exists for.
        return hasOrgPermission('team.manage', currentOrgId);
      case 'masterdata.manage':
        return false; // platform master data is system-admin only (covered by isSuper)
      default:
        return false;
    }
  };

  return {
    can, isSuper, isCaptain, organisesAny, orgAdminAny, isOfficialAny,
    canManageChampionship, canManageOrg, isOrgOwner, organisesChampionship,
    // The engine's own vocabulary, for screens that need a specific permission
    // rather than the coarse shim above.
    hasOrgPermission, orgPermissions,
  };
}

// Declarative action gate: renders children only if the capability is granted.
export function Can({ perform, children, fallback = null }:
  { perform: Capability; children: ReactNode; fallback?: ReactNode }) {
  const { can } = usePermissions();
  return <>{can(perform) ? children : fallback}</>;
}
