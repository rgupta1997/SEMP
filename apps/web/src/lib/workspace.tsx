import { useCallback, useMemo } from 'react';
import { useAuth, type Organization } from './auth';

// Which product a person is looking at (J1-E7).
//
// The same account can be two quite different things: a player with a record and a
// fixture list, and the person who runs an institution. Those are not one screen with
// extra buttons - they have different homes, different navigation and different first
// questions ("when do I play?" vs "what needs me today?"). So the shell has a
// WORKSPACE, and everything downstream reads it.
//
// Staff is owner or admin. A plain member of an institution is a participant in it,
// not an operator of it, and giving them the operator shell would be a worse lie than
// hiding it - every tile would be empty or refused.

export type Workspace =
  | { kind: 'personal' }
  | { kind: 'organization'; id: string; organization: Organization };

const KEY = 'semp_workspace';
const STAFF_ROLES = ['owner', 'admin'];

export function useWorkspace() {
  const { ctx } = useAuth();

  /** Institutions this person operates, as opposed to belongs to. */
  const staffed = useMemo(
    () => (ctx?.organizations ?? [])
      .filter((m) => m.status === 'active' && STAFF_ROLES.includes(m.role))
      // A personal workspace is an implementation detail of solo entry (J3-E1). It is
      // never somewhere to "switch into" - the person is already there.
      .filter((m) => m.organization?.kind !== 'personal')
      .map((m) => m.organization),
    [ctx],
  );

  const stored = (() => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  })();

  const active: Workspace = useMemo(() => {
    if (stored === 'personal') return { kind: 'personal' };
    const chosen = stored ? staffed.find((o) => o.id === stored) : null;
    // Nobody has chosen, or they chose an institution they no longer staff: land in
    // the institution when there is exactly one, because that is what they signed in
    // to do. With several, the choice is real and personal is the safe default.
    const fallback = staffed.length === 1 ? staffed[0] : null;
    const org = chosen ?? fallback;
    return org ? { kind: 'organization', id: org.id, organization: org } : { kind: 'personal' };
  }, [stored, staffed]);

  const setWorkspace = useCallback((next: Workspace) => {
    try { localStorage.setItem(KEY, next.kind === 'personal' ? 'personal' : next.id); } catch { /* private mode */ }
    // A hard navigation, not a state update: the two shells render different route
    // trees, and letting React reconcile between them leaves the previous shell's
    // page mounted under the new navigation.
    window.location.assign(next.kind === 'personal' ? '/profile' : `/organizations/${next.id}/home`);
  }, []);

  return {
    workspace: active,
    staffedOrganizations: staffed,
    /** True when the switcher is worth rendering at all. */
    canSwitch: staffed.length > 0,
    setWorkspace,
    /** Modules this person may reach in the active institution (J6-E2). */
    modules: active.kind === 'organization' ? (ctx?.modules?.[active.id] ?? null) : null,
  };
}

/** Where a session should land, given what it is. */
export function workspaceHome(w: Workspace): string {
  return w.kind === 'organization' ? `/organizations/${w.id}/home` : '/profile';
}
