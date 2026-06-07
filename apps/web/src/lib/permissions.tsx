import type { ReactNode } from 'react';
import { useAuth, type AppRole } from './auth';

// Capability codes (entity.action). Client checks are UX-only — the API must
// still enforce every mutation server-side. Resolved from the auth context:
// super admins can do everything; otherwise capability follows the user's
// roles, institution staff/captain status, and account type.
export type Capability =
  | 'event.create'
  | 'event.manage'        // edit/delete/setup/schedule an event
  | 'enrollment.approve'
  | 'official.assign'
  | 'fixture.manage'
  | 'fixture.score'
  | 'team.manage'         // create/edit teams for an institution
  | 'roster.manage'       // add/remove members, lock roster
  | 'masterdata.manage';  // platform sports/disciplines/formats/roles/users

export function usePermissions() {
  const { ctx, availableRoles } = useAuth();
  const isSuper = !!ctx?.user.is_super_admin;
  const has = (r: AppRole) => availableRoles.includes(r);
  const isInstitutionStaff = ctx?.user.account_type === 'institution';
  const isCaptain = !!ctx?.memberships?.some((m) => m.role === 'captain' || m.role === 'vice_captain');

  const can = (cap: Capability): boolean => {
    if (isSuper) return true;
    switch (cap) {
      case 'event.create':
      case 'event.manage':
      case 'enrollment.approve':
      case 'official.assign':
      case 'fixture.manage':
        return has('organiser');
      case 'fixture.score':
        return has('official');
      case 'team.manage':
      case 'roster.manage':
        return isInstitutionStaff || isCaptain;
      case 'masterdata.manage':
        return false; // platform master data is system-admin only (covered by isSuper)
      default:
        return false;
    }
  };

  return { can, isSuper, isCaptain, isInstitutionStaff, has };
}

// Declarative action gate: renders children only if the capability is granted.
export function Can({ perform, children, fallback = null }:
  { perform: Capability; children: ReactNode; fallback?: ReactNode }) {
  const { can } = usePermissions();
  return <>{can(perform) ? children : fallback}</>;
}
