import type { CapabilityKey } from '@semp/entitlements';

// The workspace model: which context you are in, what you may see in it, and what
// your subscription makes available at all.
//
// The breakdown states this as four rules, and this file is three of them:
//
//   Context       decides what you SEE      - NAV, keyed by context kind
//   Role          decides what you MAY DO   - ROLE_NAV, filtered again per role
//   Subscription  decides what EXISTS       - `needs`, a capability gate
//
// Filtering twice and then gating is the single most important nav rule in the
// product. Getting it wrong in either direction is bad in a different way: too
// permissive shows someone a page that will refuse them, too strict hides a page
// they are paying for.

export type ContextKind = 'personal' | 'org' | 'orgGuest' | 'event' | 'eventDraft' | 'assignment';

export interface NavItem {
  /** Stable key, used by ROLE_NAV. Not the route - routes change, meanings do not. */
  key: string;
  label: string;
  /** Route within the context. `:id` is substituted with the context's id. */
  to: string;
  /** Capability this item needs. Absent means everyone in the context sees it. */
  needs?: CapabilityKey;
  end?: boolean;
}

/**
 * What each kind of context offers, before role or tier is considered.
 *
 * Guest and draft are deliberately tiny. A non-member looking at an organisation
 * gets two items, not a hidden nine - a nav that lists what you cannot open is a
 * worse experience than one that is honestly small.
 */
export const NAV: Record<ContextKind, NavItem[]> = {
  personal: [
    { key: 'home', label: 'My Game', to: '/home', end: true },
    { key: 'events', label: 'My Events', to: '/championships' },
    { key: 'profile', label: 'My Sports Profile', to: '/profile' },
    { key: 'discover', label: 'Discover', to: '/discover' },
    { key: 'officiating', label: 'Officiating', to: '/officiating' },
    { key: 'orgs', label: 'Organizations', to: '/organizations' },
    { key: 'help', label: 'Help & guides', to: '/help' },
  ],
  org: [
    { key: 'dashboard', label: 'Dashboard', to: '/organizations/:id/overview' },
    { key: 'players', label: 'Players', to: '/organizations/:id/students' },
    { key: 'teams', label: 'Teams', to: '/organizations/:id/teams' },
    { key: 'events', label: 'Events', to: '/organizations/:id/events' },
    { key: 'discover', label: 'Discover', to: '/discover' },
    { key: 'achievements', label: 'Achievements', to: '/organizations/:id/achievements' },
    { key: 'certificates', label: 'Certificates', to: '/organizations/:id/certificates' },
    // The whole Reports page sits behind advanced_reports - a locked page here names
    // the capability, never the price.
    { key: 'reports', label: 'Reports', to: '/organizations/:id/reports', needs: 'advanced_reports' },
    { key: 'admin', label: 'Administration', to: '/organizations/:id/members' },
  ],
  orgGuest: [
    { key: 'publicorg', label: 'Organization', to: '/organizations/:id/public' },
    { key: 'events', label: 'Public events', to: '/organizations/:id/public/events' },
  ],
  event: [
    { key: 'overview', label: 'Overview', to: '/championships/:id' },
    { key: 'setup', label: 'Setup', to: '/championships/:id/setup' },
    { key: 'organisers', label: 'Organising team', to: '/championships/:id/organisers' },
    { key: 'approvals', label: 'Approvals', to: '/championships/:id/approvals' },
    { key: 'participants', label: 'Participants', to: '/championships/:id/participants' },
    { key: 'schedule', label: 'Schedule', to: '/championships/:id/schedule' },
    { key: 'results', label: 'Results', to: '/championships/:id/results' },
    { key: 'standings', label: 'Standings', to: '/championships/:id/standings' },
    { key: 'communications', label: 'Communications', to: '/championships/:id/communications' },
    { key: 'certificates', label: 'Certificates', to: '/championships/:id/certificates' },
    { key: 'settings', label: 'Settings', to: '/championships/:id/settings' },
  ],
  eventDraft: [
    { key: 'overview', label: 'Overview', to: '/championships/:id' },
    { key: 'setup', label: 'Event setup', to: '/championships/:id/setup' },
  ],
  assignment: [
    { key: 'matchops', label: 'Match Operations', to: '/score/:id' },
    { key: 'help', label: 'Guides', to: '/help' },
  ],
};

/**
 * The second filter: what each role may reach inside a context.
 *
 * `null` means no filtering - Owner and the platform super admin see the whole nav
 * for whatever context they are in. Everyone else sees the intersection.
 *
 * Keyed by role CODE, not display name. A role renamed in the admin screen must not
 * silently change what its holders can see, which is the same reason authorisation
 * resolves roles by code.
 */
export const ROLE_NAV: Record<string, string[] | null> = {
  owner: null,
  super_admin: null,

  org_admin: null,
  sports_admin: ['dashboard', 'players', 'teams', 'events', 'discover', 'achievements', 'certificates', 'admin'],
  billing_admin: ['dashboard', 'admin'],
  reporting_admin: ['dashboard', 'players', 'achievements', 'reports', 'admin'],
  viewer: ['dashboard', 'events', 'achievements'],

  organiser: null,
  captain: ['overview', 'participants', 'schedule', 'results', 'standings'],
  official: ['overview', 'schedule', 'results'],
  participant: ['overview', 'schedule', 'results', 'standings'],
  poc: ['overview', 'approvals', 'participants', 'schedule', 'results', 'standings'],
};

export interface WorkspaceContext {
  id: string;
  kind: ContextKind;
  name: string;
  /** The role code this person holds here. Drives ROLE_NAV. */
  roleCode: string | null;
  /** What to show under the name in the switcher. */
  sub?: string;
  /** Organisations carry a verification state; it is a trust signal, not a gate. */
  verified?: boolean;
}

/**
 * Resolve the nav for one context. Three filters, in order, and the order matters:
 * role filtering happens on the context's own list, and the capability gate is last
 * so a locked item is one the role WOULD have had.
 *
 * A gated item is returned rather than dropped - the screen renders it locked and
 * naming the missing capability. Hiding it entirely would leave someone unable to
 * discover that the product does the thing at all, which is how you lose an upgrade
 * rather than earn one.
 */
export function resolveNav(
  ctx: WorkspaceContext,
  granted: ReadonlySet<CapabilityKey>,
): Array<NavItem & { locked: boolean }> {
  const all = NAV[ctx.kind] ?? [];
  const allowed = ctx.roleCode ? ROLE_NAV[ctx.roleCode] : undefined;
  const byRole = allowed == null ? all : all.filter((i) => allowed.includes(i.key));
  return byRole.map((i) => ({ ...i, locked: !!i.needs && !granted.has(i.needs) }));
}

/** Substitute the context id into an item's route. */
export const hrefFor = (ctx: WorkspaceContext, item: NavItem) => item.to.replace(':id', ctx.id);

/** Where a context opens: its first item the role can actually use. */
export function landingFor(ctx: WorkspaceContext, granted: ReadonlySet<CapabilityKey>): string {
  const items = resolveNav(ctx, granted);
  const first = items.find((i) => !i.locked) ?? items[0];
  return first ? hrefFor(ctx, first) : '/home';
}

/** Switcher grouping and tile colour, from the prototype. */
export const KIND_META: Record<ContextKind, { group: string; tile: string; ink: string }> = {
  personal: { group: 'Personal', tile: '#5CE1E6', ink: '#0A1A33' },
  org: { group: 'Organizations', tile: '#004AAD', ink: '#FFFFFF' },
  orgGuest: { group: 'Organizations', tile: '#6E7E96', ink: '#FFFFFF' },
  event: { group: 'Events', tile: '#159FA6', ink: '#FFFFFF' },
  eventDraft: { group: 'Events', tile: '#159FA6', ink: '#FFFFFF' },
  assignment: { group: 'Assignments', tile: '#E9920B', ink: '#FFFFFF' },
};
