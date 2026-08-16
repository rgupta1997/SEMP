import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { ModuleKey } from '@semp/shared';
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

  const organisesAny = !!ctx?.championship_roles?.some((r) => r.role.name === 'Organiser');
  const officialIds = ctx?.official_championship_ids ?? [];
  const isOfficialAny = officialIds.length > 0 || !!ctx?.championship_roles?.some((r) => r.role.name === 'Official');
  const orgAdminAny = !!ctx?.organizations?.some((m) => m.role === 'owner' || m.role === 'admin');
  const isCaptain = !!ctx?.memberships?.some((m) => m.role === 'captain' || m.role === 'vice_captain');

  // Per-entity checks (preferred for new code).
  const organisesChampionship = (id?: string | null) =>
    isSuper || (!!id && !!ctx?.championship_roles?.some((r) => r.championship_id === id && r.role.name === 'Organiser'));
  const canManageChampionship = (id?: string | null) => (id ? organisesChampionship(id) : isSuper || organisesAny);
  const canManageOrg = (id?: string | null) =>
    isSuper || (id
      ? !!ctx?.organizations?.some((m) => m.organization_id === id && (m.role === 'owner' || m.role === 'admin'))
      : orgAdminAny);
  // Owner-only actions (e.g. deleting the whole org). Admins manage day-to-day.
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
        return managesCurrentOrg;
      case 'masterdata.manage':
        return false; // platform master data is system-admin only (covered by isSuper)
      default:
        return false;
    }
  };

  // ---- Module access (J6-E2) ---------------------------------------------
  // Which modules the institution has left switched on for this person's
  // audience, straight from the auth context so navigation is right on the first
  // paint. UX only: the server runs the same check inside can() and that is the
  // boundary.
  const modulesFor = (id?: string | null): ModuleKey[] | null => {
    const orgId = id ?? currentOrgId ?? ctx?.organization?.id ?? null;
    if (!orgId) return null;               // nothing org-scoped in play
    return (ctx?.modules?.[orgId] as ModuleKey[] | undefined) ?? null;
  };

  // Absent map = not configured = everything on. Only an explicit list can hide
  // something, so a context that has not loaded yet never blanks the navigation.
  const canOpenModule = (module: ModuleKey, id?: string | null): boolean => {
    if (isSuper) return true;
    const list = modulesFor(id);
    return !list || list.includes(module);
  };

  return {
    can, isSuper, isCaptain, organisesAny, orgAdminAny, isOfficialAny,
    canManageChampionship, canManageOrg, isOrgOwner, organisesChampionship,
    canOpenModule,
  };
}

// A whole area of the workspace an institution can switch off (J6-E2-S2).
// Renders a plain "not available" page rather than letting the route 403 or,
// worse, render an empty screen the person cannot explain.
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { canOpenModule } = usePermissions();
  if (canOpenModule(module)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-3 flex justify-center text-slate-400 dark:text-slate-500"><Lock size={28} aria-hidden /></div>
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Not available</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Your institution has turned this section off for your account. Ask a sports office
        administrator if you think you should have access.
      </p>
    </div>
  );
}

// Declarative action gate: renders children only if the capability is granted.
export function Can({ perform, children, fallback = null }:
  { perform: Capability; children: ReactNode; fallback?: ReactNode }) {
  const { can } = usePermissions();
  return <>{can(perform) ? children : fallback}</>;
}
