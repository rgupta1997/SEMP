import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CapabilityKey } from '@semp/entitlements';
import { useAuth } from './auth';
import { useApi } from './hooks';
import { EVENT_ROLE_CODES, landingFor, type ContextKind, type NavFacts, type WorkspaceContext } from './workspace';

// Turning one account into the list of workspaces it can enter.
//
// The contexts are derived, not stored: they are whatever this person's memberships
// and role grants add up to right now. Storing them would mean a role granted in
// another tab leaves a stale list until sign-out.
//
// Only the CHOICE is persisted, and only per account - switching to your other
// account under Option B must not drop you into the previous one's organisation.

const KEY = 'semp_context';

/** One fixture this person has been assigned to officiate. */
interface AssignedFixture {
  id: string;
  status: string;
  scheduled_at: string | null;
  teams_fixtures_home_team_idToteams?: { name?: string } | null;
  teams_fixtures_away_team_idToteams?: { name?: string } | null;
  tournament_disciplines?: {
    tournament_sports?: { sports?: { name?: string } | null } | null;
  } | null;
}

interface EntitlementSnapshot {
  org: { tier: string; capabilities: CapabilityKey[] };
  personal: { tier: string; capabilities: CapabilityKey[] };
}

/** One row of GET /championships/mine - every event this person is involved in. */
interface MyEvent {
  id: string;
  name: string;
  status: string;
  /** organiser / official / poc / captain / participant, plus player / member. */
  my_roles: string[];
}

export function useWorkspace() {
  const { ctx } = useAuth();
  const ent = useApi<EntitlementSnapshot>('/me/entitlements', !!ctx);
  // Assignments are per MATCH, which is the tightest scope in the product and the
  // only one whose nav goes straight to the console. Read from the fixtures this
  // person is actually the official on.
  // Only asked for when this person officiates somewhere - `official_championship_ids`
  // is already on the auth context, so the empty case costs nothing.
  const officiating = useApi<AssignedFixture[]>(
    '/me/officiating',
    (ctx?.official_championship_ids?.length ?? 0) > 0,
  );
  // Every event this account is involved in, whatever the involvement. The auth
  // context only carries assigned ROLES, which left the two commonest ways of
  // being in an event - playing for an entered team, belonging to an enrolled
  // institution - with no workspace to enter. People could open such an event
  // from My Events and arrive with the personal sidebar still showing.
  const mine = useApi<MyEvent[]>('/championships/mine', !!ctx);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // A context-scoped URL IS a context choice. Following a link to an event from a
  // notification, or deep-linking into an organisation, has to move the whole
  // workspace - otherwise the URL says one thing and the sidebar says another,
  // which breaks the second rule the product is built on.
  const routeContextId = useMemo(() => {
    const m = /^\/(?:organizations|championships)\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(pathname);
    return m ? m[1] : null;
  }, [pathname]);

  const contexts = useMemo<WorkspaceContext[]>(() => {
    if (!ctx?.user) return [];

    const personal: WorkspaceContext = {
      id: 'me', kind: 'personal', name: ctx.user.name, roleCodes: [],
      sub: 'My Space',
    };

    // Explicit grants, keyed by organisation. Several per org is normal - Sports
    // Admin at two campuses is two grants.
    const grantsByOrg = new Map<string, string[]>();
    for (const g of (ctx as any).org_roles ?? []) {
      if (!g.code) continue;
      grantsByOrg.set(g.organization_id, [...(grantsByOrg.get(g.organization_id) ?? []), g.code]);
    }

    const orgs: WorkspaceContext[] = (ctx.organizations ?? [])
      .filter((m: any) => m.status === 'active')
      .map((m: any) => ({
        id: m.organization_id,
        kind: 'org' as const,
        name: m.organization?.name ?? 'Organisation',
        // The implied role from membership, UNIONED with anything explicitly
        // granted. Union rather than override, because losing a grant must not
        // also strip the baseline access being a member already carries - and
        // because this is exactly what can() does on the server.
        roleCodes: [
          m.role === 'owner' ? 'owner' : m.role === 'admin' ? 'org_admin' : 'viewer',
          ...(grantsByOrg.get(m.organization_id) ?? []),
        ],
        sub: m.organization?.city ?? undefined,
        verified: m.organization?.verified ?? false,
      }));

    const events: WorkspaceContext[] = (ctx.championship_roles ?? []).map((r: any) => ({
      id: r.championship_id,
      kind: (r.championship?.status === 'draft' ? 'eventDraft' : 'event') as ContextKind,
      name: r.championship?.name ?? 'Event',
      roleCodes: r.role?.code ? [r.role.code] : [],
      sub: r.championship?.status ?? undefined,
    }));

    // The rest of them. Assigned roles arrive with the auth context, so they are
    // built above and appear instantly; these need a request, so they are merged in
    // rather than replacing the list - an organiser should not watch their own
    // events pop in a moment late.
    //
    // MERGED, not skipped. The auth context carries a SNAPSHOT of each event taken
    // when the session was last refreshed, so its `status` goes stale the moment
    // anybody changes it. `/championships/mine` is refetched on every status
    // transition and is therefore the fresher source - but this loop used to
    // `continue` past any event the auth context had already produced, so the stale
    // copy won and the fresh one was thrown away.
    //
    // The symptom was specific and awful: an organiser opened registration, the
    // header badge flipped to "Registration Open", and the sidebar kept rendering
    // the two-item DRAFT nav until they reloaded the page by hand. Invalidating
    // `mine` on the transition - which the callers do - could never have fixed it,
    // because the value was being discarded here.
    //
    // Only EVENT roles are carried. An event role overrides an organisation one:
    // administering an institution says nothing about an event you were entered
    // into, and 'player' / 'member' say how you got here rather than what you hold,
    // so both resolve to the view set instead of to an org role's nav.
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const c of mine.data ?? []) {
      const roleCodes = (c.my_roles ?? []).filter((r) => EVENT_ROLE_CODES.includes(r));
      const existing = byId.get(c.id);
      if (existing) {
        // Fresher facts about the EVENT replace the snapshot; the role codes are
        // unioned, because the auth row may carry a grant `mine` does not list.
        existing.kind = (c.status === 'draft' ? 'eventDraft' : 'event') as ContextKind;
        existing.name = c.name;
        existing.sub = c.status;
        existing.roleCodes = [...new Set([...existing.roleCodes, ...roleCodes])];
        continue;
      }
      const built: WorkspaceContext = {
        id: c.id,
        kind: (c.status === 'draft' ? 'eventDraft' : 'event') as ContextKind,
        name: c.name,
        roleCodes,
        sub: c.status,
      };
      byId.set(c.id, built);
      events.push(built);
    }

    // An assignment is the tightest scope in the product: one match, nothing else.
    //
    // It used to be built from championship ids, which made its Match Operations
    // link - /score/:id - point at a championship where the route expects a
    // fixture, and made every assignment duplicate an event context the person
    // already had. One row per match, and only matches still to be played:
    // a finished fixture is a record, not an assignment.
    const assignments: WorkspaceContext[] = (officiating.data ?? [])
      .filter((f) => {
        if (f.status === 'completed' || f.status === 'cancelled') return false;
        // A bye is a team advancing because there was nobody to play. There is no
        // match, so there is nothing to officiate - listing it as an assignment
        // sends somebody to a console for a game that will never be played.
        if (f.status === 'bye') return false;
        // A bracket slot with neither side decided is not yet a match anybody can
        // officiate. Listing it would fill the switcher with "TBD v TBD" and bury
        // the assignments that are real.
        return !!(f.teams_fixtures_home_team_idToteams || f.teams_fixtures_away_team_idToteams);
      })
      .map((f) => {
        const home = f.teams_fixtures_home_team_idToteams?.name ?? 'TBD';
        const away = f.teams_fixtures_away_team_idToteams?.name ?? 'TBD';
        const sport = f.tournament_disciplines?.tournament_sports?.sports?.name;
        const when = f.scheduled_at
          ? new Date(f.scheduled_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Time TBD';
        return {
          id: f.id,
          kind: 'assignment' as const,
          name: `${home} v ${away}`,
          roleCodes: ['official'],
          sub: [sport, when].filter(Boolean).join(' · '),
        };
      });

    return [personal, ...orgs, ...events, ...assignments];
  }, [ctx, officiating.data, mine.data]);

  // The stored choice is namespaced by account, so Option B's second account does
  // not inherit the first one's workspace.
  const storeKey = ctx?.user?.id ? `${KEY}:${ctx.user.id}` : null;

  useEffect(() => {
    if (!storeKey || contexts.length === 0) return;

    // The URL wins when it names a context this person actually holds, and the
    // choice is written through - so leaving that page keeps you where you went,
    // rather than snapping back to whatever you last picked from the switcher.
    if (routeContextId && contexts.some((c) => c.id === routeContextId)) {
      localStorage.setItem(storeKey, routeContextId);
      setActiveId(routeContextId);
      return;
    }
    const stored = localStorage.getItem(storeKey);
    setActiveId(stored && contexts.some((c) => c.id === stored) ? stored : contexts[0].id);
  }, [storeKey, contexts.length, routeContextId]);

  const active = contexts.find((c) => c.id === activeId) ?? contexts[0] ?? null;

  // What is true of this PERSON, for the nav items that depend on it rather than
  // on the context. Read from the auth context, so somebody added to an event's
  // officials list mid-session sees Officiating appear on the next /me rather than
  // having to sign in again.
  const navFacts = useMemo<NavFacts>(() => ({
    officiates: (ctx?.official_championship_ids?.length ?? 0) > 0,
  }), [ctx?.official_championship_ids]);

  /** Capabilities for the ladder governing the ACTIVE context, not the account. */
  const granted = useMemo<ReadonlySet<CapabilityKey>>(() => {
    if (!ent.data) return new Set<CapabilityKey>();
    const ladder = active?.kind === 'personal' ? ent.data.personal : ent.data.org;
    return new Set(ladder?.capabilities ?? []);
  }, [ent.data, active?.kind]);

  const switchTo = useCallback((id: string) => {
    if (storeKey) localStorage.setItem(storeKey, id);
    setActiveId(id);
  }, [storeKey]);

  /**
   * Open a context: make it active AND land on its own first page.
   *
   * Navigating without switching leaves the sidebar showing the workspace you
   * came from while the page shows the one you opened. The two disagree, and the
   * person is left looking at an event with no way to reach the rest of it.
   *
   * `from` is remembered on the location so the page you land on can offer a way
   * back that returns the workspace too, not just the URL.
   */
  const enter = useCallback((id: string, fallback: string, from?: string) => {
    const target = contexts.find((c) => c.id === id);
    switchTo(id);
    navigate(target ? landingFor(target, granted, navFacts) : fallback, from ? { state: { from } } : undefined);
  }, [contexts, granted, navFacts, switchTo, navigate]);

  /**
   * Go back to where somebody came from, workspace and all. A path naming a
   * context returns to it; anything else is personal space, which is where every
   * route that names no context lives.
   */
  const leaveTo = useCallback((path: string) => {
    const m = /^\/(?:organizations|championships)\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(path);
    switchTo(m && contexts.some((c) => c.id === m[1]) ? m[1] : 'me');
    navigate(path);
  }, [contexts, switchTo, navigate]);

  return {
    contexts,
    active,
    granted,
    navFacts,
    switchTo,
    enter,
    leaveTo,
    /** Where a context opens - its first item this role can actually use. */
    landing: active ? landingFor(active, granted, navFacts) : '/home',
    loading: ent.isLoading,
    tiers: ent.data ? { org: ent.data.org.tier, personal: ent.data.personal.tier } : null,
  };
}
