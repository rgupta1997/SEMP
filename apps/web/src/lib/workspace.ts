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
  /**
   * A fact about the PERSON that has to hold for this item to appear at all.
   *
   * Deliberately not the same as `needs`. A capability you lack is rendered
   * LOCKED, because the product does the thing and you may well want it. A
   * section that would be empty because you hold no assignments is not locked and
   * not for sale - it is simply not yours, and showing it to everybody sends the
   * whole institution to a page built for its handful of officials.
   */
  when?: NavFactKey;
  end?: boolean;
}

/**
 * Facts about the person, as opposed to the context they are standing in.
 *
 * One entry so far, and it is worth stating why it is not a role: officiating is
 * not something you ARE in your own space, it is something you have been given.
 * The list lives in `official_championship_ids` on the auth context, which is the
 * same gate GET /me/officiating applies - so the tab is present exactly when the
 * page behind it has something in it.
 */
export interface NavFacts {
  /** Is this person on any championship's officials list? */
  officiates?: boolean;
}

export type NavFactKey = keyof NavFacts;

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
    { key: 'officiating', label: 'Officiating', to: '/officiating', when: 'officiates' },
    { key: 'orgs', label: 'Organizations', to: '/organizations' },
    { key: 'help', label: 'Help & guides', to: '/help' },
  ],
  org: [
    { key: 'dashboard', label: 'Dashboard', to: '/organizations/:id/overview' },
    { key: 'players', label: 'Players', to: '/organizations/:id/students' },
    // Campuses & units is a WORKING screen, not a setting: it answers "who belongs
    // where", and a player can only be picked for the unit they belong to. It sat
    // inside Administration, which is where things go to be configured once and
    // never reopened - the wrong home for the screen an organiser has to get right
    // before an internal championship can run at all.
    { key: 'structure', label: 'Campuses & Units', to: '/organizations/:id/campuses' },
    { key: 'teams', label: 'Teams', to: '/organizations/:id/teams' },
    { key: 'events', label: 'Events', to: '/organizations/:id/events' },
    { key: 'discover', label: 'Discover', to: '/discover' },
    { key: 'achievements', label: 'Achievements', to: '/organizations/:id/achievements' },
    { key: 'certificates', label: 'Certificates', to: '/organizations/:id/certificates' },
    // The whole Reports page sits behind advanced_reports - a locked page here names
    // the capability, never the price.
    { key: 'reports', label: 'Reports', to: '/organizations/:id/reports', needs: 'advanced_reports' },
    { key: 'admin', label: 'Administration', to: '/organizations/:id/admin' },
  ],
  orgGuest: [
    // `end` matters wherever one item's path is a prefix of another's: without it
    // this stays highlighted while you are on Public events, and the sidebar reports
    // you are in two places at once.
    { key: 'publicorg', label: 'Organization', to: '/organizations/:id/public', end: true },
    { key: 'events', label: 'Public events', to: '/organizations/:id/public/events' },
  ],
  event: [
    // The event root is a prefix of every other section here, so it must match
    // exactly - see the note on the guest nav above.
    { key: 'overview', label: 'Overview', to: '/championships/:id', end: true },
    { key: 'setup', label: 'Setup', to: '/championships/:id/setup' },
    { key: 'organisers', label: 'Organising team', to: '/championships/:id/organisers' },
    { key: 'participants', label: 'Participants', to: '/championships/:id/participants' },
    { key: 'schedule', label: 'Schedule', to: '/championships/:id/schedule' },
    { key: 'results', label: 'Results', to: '/championships/:id/results' },
    { key: 'standings', label: 'Standings', to: '/championships/:id/standings' },
    { key: 'communications', label: 'Communications', to: '/championships/:id/communications' },
    { key: 'certificates', label: 'Certificates', to: '/championships/:id/certificates' },
    { key: 'settings', label: 'Settings', to: '/championships/:id/settings' },
  ],
  /**
   * A DRAFT event offers the same sections as a live one.
   *
   * It used to offer two - Overview and Event setup - and that was wrong for the
   * only person who is ever in a draft: the organiser who just created it. They
   * need the organising team, the officials, the schedule and the settings while
   * the event is still being built; those are exactly the things "being built"
   * means. Cutting the list here also cut it for them, because `resolveNav`
   * filters the CONTEXT's list by role, so a role that opens everything still
   * cannot open what the context never offered.
   *
   * Restricting the draft is ROLE_NAV's job, and it already does it: anybody
   * without an event role gets EVENT_VIEW, which on a draft is five honestly
   * empty pages rather than a nav that pretends the event has no settings.
   */
  eventDraft: [
    { key: 'overview', label: 'Overview', to: '/championships/:id', end: true },
    { key: 'setup', label: 'Event setup', to: '/championships/:id/setup' },
    { key: 'organisers', label: 'Organising team', to: '/championships/:id/organisers' },
    { key: 'participants', label: 'Participants', to: '/championships/:id/participants' },
    { key: 'schedule', label: 'Schedule', to: '/championships/:id/schedule' },
    { key: 'results', label: 'Results', to: '/championships/:id/results' },
    { key: 'standings', label: 'Standings', to: '/championships/:id/standings' },
    { key: 'communications', label: 'Communications', to: '/championships/:id/communications' },
    { key: 'certificates', label: 'Certificates', to: '/championships/:id/certificates' },
    { key: 'settings', label: 'Settings', to: '/championships/:id/settings' },
  ],
  assignment: [
    { key: 'matchops', label: 'Match Operations', to: '/score/:id' },
    { key: 'help', label: 'Guides', to: '/help' },
  ],
};

/**
 * The event as PUBLISHED: who is in it, when they play, what happened, and where
 * that leaves the table. What somebody sees when they are involved in an event
 * without running it.
 *
 * Everything left out is an operation rather than a view - approving entries,
 * naming the organising team, sending communications, issuing certificates,
 * configuring the event at all. Being an owner of an enrolled institution says
 * nothing about whether you may do any of that HERE, and until this list existed
 * it handed you all eleven sections: an event context with no role in it fell
 * through the "no role, no filter" branch meant for personal space.
 *
 * Written out rather than derived from NAV.event, because the safe default for a
 * section nobody has classified yet is to withhold it. A new tab is invisible to
 * viewers until somebody adds it here, which is a missing tab; the other way round
 * is an access bug.
 */
export const EVENT_VIEW = ['overview', 'participants', 'schedule', 'results', 'standings'];

/**
 * The roles that mean something INSIDE an event.
 *
 * An event context carries these and nothing else, which is how an event role
 * overrides an organisation one: being an Owner or Sports Admin at an institution
 * says what you may do THERE, and says nothing about an event you were entered
 * into as a Participant. Letting the org code through would quietly hand the
 * organiser's nav to anybody who happened to administer an institution.
 */
export const EVENT_ROLE_CODES = ['organiser', 'official', 'poc', 'captain', 'participant'];

/**
 * Of everything somebody holds, the part that decides an EVENT.
 *
 * Applied wherever an event's nav is resolved, so the override is structural
 * rather than a convention each caller has to remember. Without it, an Org Admin
 * who happened to be entered into an event got the organiser's whole nav there,
 * Settings included, because `org_admin` is an unrestricted role - in its own
 * context.
 */
export const eventRoleCodes = (roleCodes: string[]) => roleCodes.filter((c) => EVENT_ROLE_CODES.includes(c));

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
  sports_admin: ['dashboard', 'players', 'structure', 'teams', 'events', 'discover', 'achievements', 'certificates', 'admin'],
  billing_admin: ['dashboard', 'admin'],
  reporting_admin: ['dashboard', 'players', 'structure', 'achievements', 'reports', 'admin'],
  viewer: ['dashboard', 'events', 'achievements'],

  organiser: null,
  // An official's business is the match: what is on, what happened, and where that
  // leaves the table. Not the event's participants, approvals or communications.
  //
  // The list spans two contexts, because an official stands in two - the event and
  // the match console - and a list written for one of them emptied the other.
  official: ['overview', 'schedule', 'results', 'standings', 'matchops', 'help'],
  // Everyone else involved in an event sees the event, and operates none of it.
  captain: EVENT_VIEW,
  participant: EVENT_VIEW,
  // Deciding the field - invitations AND the applications queue - now lives on
  // Setup → Invite rather than on a section of its own, so there is no longer an
  // 'approvals' key to grant. A POC sees the event as published.
  poc: EVENT_VIEW,
};

export interface WorkspaceContext {
  id: string;
  kind: ContextKind;
  name: string;
  /**
   * Every role code this person holds here. Plural on purpose: someone can be a
   * member AND hold an explicit grant, or hold Sports Admin at two campuses, and
   * the nav has to be the union - exactly as the permission engine unions grants.
   */
  roleCodes: string[];
  /** What to show under the name in the switcher. */
  sub?: string;
  /** Organisations carry a verification state; it is a trust signal, not a gate. */
  verified?: boolean;
  /**
   * The institution's own colour, applied to the whole workspace while it is the
   * active context. Only organisations have one - an event borrows its host's
   * chrome rather than carrying a third brand into the same screen.
   */
  theme?: { brand?: string | null; logo_url?: string | null };
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
  facts: NavFacts = {},
): Array<NavItem & { locked: boolean }> {
  // Before any of the three filters: items that are not this person's at all.
  // Omitting `facts` therefore hides them, which is the safe direction - a caller
  // that forgot to pass it shows too little rather than too much.
  const all = (NAV[ctx.kind] ?? []).filter((i) => !i.when || !!facts[i.when]);

  // No role this map recognises. In the personal context that is the normal case -
  // there are no roles to hold there, so nothing is filtered.
  //
  // In an EVENT it means somebody involved without a role in it: a player on an
  // entered team, a member of an enrolled institution. They are not nobody, and
  // handing them the unfiltered nav offered them the organiser's whole console, so
  // they get the published view - the same list the URL guard gives them.
  const isEvent = ctx.kind === 'event' || ctx.kind === 'eventDraft';
  const held = isEvent ? eventRoleCodes(ctx.roleCodes) : ctx.roleCodes;
  const codes = held.filter((c) => c in ROLE_NAV);
  if (codes.length === 0) {
    const items = isEvent ? all.filter((i) => EVENT_VIEW.includes(i.key)) : all;
    return items.map((i) => ({ ...i, locked: !!i.needs && !granted.has(i.needs) }));
  }

  // A single unfiltered role (Owner, Org Admin, Organiser) opens the whole context,
  // and it wins over any narrower one held alongside it.
  const unrestricted = codes.some((c) => ROLE_NAV[c] === null);
  const union = new Set(codes.flatMap((c) => ROLE_NAV[c] ?? []));
  const byRole = unrestricted ? all : all.filter((i) => union.has(i.key));

  return byRole.map((i) => ({ ...i, locked: !!i.needs && !granted.has(i.needs) }));
}

/** Substitute the context id into an item's route. */
export const hrefFor = (ctx: WorkspaceContext, item: NavItem) => item.to.replace(':id', ctx.id);

/** Where a context opens: its first item the role can actually use. */
export function landingFor(ctx: WorkspaceContext, granted: ReadonlySet<CapabilityKey>, facts: NavFacts = {}): string {
  const items = resolveNav(ctx, granted, facts);
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
