import { useCallback, useMemo } from 'react';
import { useAuth, type Organization } from './auth';

// Which institution a person is looking at, and what they are in it (J1-E7).
//
// There is ONE shell. A student, a captain and the sports office are not three
// products - they are one workspace seen from three positions, so the navigation is
// filtered by role and module rather than swapped for a different shell. Splitting
// them made a captain sign in and land somewhere that shared nothing with the place
// their sports office works in, which read as two unrelated apps.
//
// `role` rides along on the workspace because it decides what the nav offers and
// where sign-in lands: staff open on the institution's command centre, everybody
// else on their own game. The server is still the boundary - this only decides what
// gets drawn.

export type Workspace =
  | { kind: 'personal' }
  | { kind: 'organization'; id: string; role: string; organization: Organization };

const KEY = 'semp_workspace';
const STAFF_ROLES = ['owner', 'admin'];

/** Do they run this institution, as opposed to belong to it? */
export function isWorkspaceStaff(w: Workspace): boolean {
  return w.kind === 'organization' && STAFF_ROLES.includes(w.role);
}

export interface WorkspaceOption { id: string; role: string; organization: Organization }

export function useWorkspace() {
  const { ctx } = useAuth();

  /** Every institution this person is actively part of, whatever they are in it. */
  const options = useMemo<WorkspaceOption[]>(
    () => (ctx?.organizations ?? [])
      .filter((m) => m.status === 'active' && m.organization)
      // A personal workspace is an implementation detail of solo entry (J3-E1). It is
      // never somewhere to "switch into" - the person is already there.
      .filter((m) => m.organization?.kind !== 'personal')
      .map((m) => ({ id: m.organization_id, role: m.role, organization: m.organization }))
      // Operators first: somebody who runs one institution and studies at another
      // should find the one they run at the top of the list.
      .sort((a, b) => Number(STAFF_ROLES.includes(b.role)) - Number(STAFF_ROLES.includes(a.role))),
    [ctx],
  );

  /** The institution on the account itself - their college, not a team they play for. */
  const primaryOrgId = ctx?.organization?.id ?? ctx?.user.organization_id ?? null;

  const stored = (() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  })();

  const active: Workspace = useMemo(() => {
    // An institution is not a mode to opt out of: belonging to one IS the workspace.
    // Only somebody with no institution at all gets the personal shell, and a stale
    // "personal" choice from before the shells merged is ignored rather than obeyed.
    const chosen = stored ? options.find((o) => o.id === stored) : null;
    // Failing that, their HOME institution (`users.organization_id`), not whichever
    // membership the context happened to list first. A student who competes for a
    // section holds a membership in that section too - it is a real organisation in
    // this model, since sections are what enter championships against each other -
    // and landing them in it rather than in their college would be wrong every time.
    const home = primaryOrgId ? options.find((o) => o.id === primaryOrgId) : null;
    const m = chosen ?? home ?? options[0] ?? null;
    return m ? { kind: 'organization', id: m.id, role: m.role, organization: m.organization } : { kind: 'personal' };
  }, [stored, options, primaryOrgId]);

  const setWorkspace = useCallback((next: Workspace) => {
    try { localStorage.setItem(KEY, next.kind === 'personal' ? 'personal' : next.id); } catch { /* private mode */ }
    // A hard navigation, not a state update: switching institution changes every
    // org-scoped fetch on the page, and letting React reconcile leaves the previous
    // institution's data mounted under the new one's navigation.
    window.location.assign(workspaceHome(next));
  }, []);

  return {
    workspace: active,
    organizations: options,
    /** True when the switcher is worth rendering at all. */
    canSwitch: options.length > 1,
    isStaff: isWorkspaceStaff(active),
    setWorkspace,
    /** Modules this person may reach in the active institution (J6-E2). */
    modules: active.kind === 'organization' ? (ctx?.modules?.[active.id] ?? null) : null,
  };
}

/** Where a session should land, given what it is. */
export function workspaceHome(w: Workspace): string {
  // Everybody in an institution opens on its Home - same first screen, fewer things
  // on it for people with fewer decisions to make. Only somebody with no institution
  // at all lands on their own game, because there is nothing else to land on.
  return w.kind === 'organization' ? `/organizations/${w.id}/home` : '/profile';
}
