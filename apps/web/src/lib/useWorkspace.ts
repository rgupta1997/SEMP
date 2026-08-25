import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { CapabilityKey } from '@semp/entitlements';
import { useAuth } from './auth';
import { useApi } from './hooks';
import { landingFor, type ContextKind, type WorkspaceContext } from './workspace';

// Turning one account into the list of workspaces it can enter.
//
// The contexts are derived, not stored: they are whatever this person's memberships
// and role grants add up to right now. Storing them would mean a role granted in
// another tab leaves a stale list until sign-out.
//
// Only the CHOICE is persisted, and only per account - switching to your other
// account under Option B must not drop you into the previous one's organisation.

const KEY = 'semp_context';

interface EntitlementSnapshot {
  org: { tier: string; capabilities: CapabilityKey[] };
  personal: { tier: string; capabilities: CapabilityKey[] };
}

export function useWorkspace() {
  const { ctx } = useAuth();
  const ent = useApi<EntitlementSnapshot>('/me/entitlements', !!ctx);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { pathname } = useLocation();

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

    // An assignment is the tightest scope in the product: one match, nothing else.
    const assignments: WorkspaceContext[] = (ctx.official_championship_ids ?? [])
      .filter((id: string) => !events.some((e) => e.id === id))
      .map((id: string) => ({
        id, kind: 'assignment' as const, name: 'Officiating', roleCodes: ['official'], sub: 'Assigned match',
      }));

    return [personal, ...orgs, ...events, ...assignments];
  }, [ctx]);

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

  return {
    contexts,
    active,
    granted,
    switchTo,
    /** Where a context opens - its first item this role can actually use. */
    landing: active ? landingFor(active, granted) : '/home',
    loading: ent.isLoading,
    tiers: ent.data ? { org: ent.data.org.tier, personal: ent.data.personal.tier } : null,
  };
}
