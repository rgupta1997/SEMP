import { describe, it, expect } from 'vitest';
import type { CapabilityKey } from '@semp/entitlements';
import { NAV, ROLE_NAV, hrefFor, landingFor, resolveNav, type WorkspaceContext } from './workspace';
import { mayOpenSegment } from './championship-nav';

// Nav resolution: the three filters that decide what somebody sees, and the guard
// that decides what they can open by URL.
//
// This file exists because the same small function produced three separate bugs in
// one sitting, each invisible until somebody clicked: the event root matched every
// section beneath it so Overview stayed lit everywhere; an official's role listed
// only event keys so the assignment context rendered an empty sidebar; and a
// context-scoped URL and the sidebar could disagree about which context you were in.
//
// None of those is caught by types. All of them are caught here.

const ctx = (over: Partial<WorkspaceContext>): WorkspaceContext => ({
  id: 'x', kind: 'org', name: 'Test', roleCodes: [], ...over,
});

const NONE = new Set<CapabilityKey>();
const ALL = new Set<CapabilityKey>(['advanced_reports', 'multi_campus', 'audit_logs'] as CapabilityKey[]);
const keys = (items: Array<{ key: string }>) => items.map((i) => i.key);

describe('resolveNav · role filter', () => {
  it('gives an unfiltered role the whole context', () => {
    const items = resolveNav(ctx({ roleCodes: ['owner'] }), ALL);
    expect(keys(items)).toEqual(keys(NAV.org));
  });

  it('narrows a restricted role to its own list', () => {
    const items = resolveNav(ctx({ roleCodes: ['billing_admin'] }), ALL);
    expect(keys(items)).toEqual(['dashboard', 'admin']);
  });

  it('unions two restricted roles rather than picking one', () => {
    // Somebody can be Sports Admin on one campus and Reporting Admin on another.
    // Taking the first would silently hide half of what they hold.
    const items = resolveNav(ctx({ roleCodes: ['billing_admin', 'reporting_admin'] }), ALL);
    expect(keys(items)).toContain('reports');
    expect(keys(items)).toContain('players');
  });

  it('lets an unrestricted role win over a narrow one held alongside it', () => {
    const items = resolveNav(ctx({ roleCodes: ['viewer', 'owner'] }), ALL);
    expect(keys(items)).toEqual(keys(NAV.org));
  });

  it('applies no role filter at all in the personal context', () => {
    const items = resolveNav(ctx({ kind: 'personal', roleCodes: [] }), ALL);
    expect(keys(items)).toEqual(keys(NAV.personal));
  });

  it('ignores role codes it has never heard of', () => {
    // A grant naming a role this build does not know must not blank the sidebar.
    const items = resolveNav(ctx({ roleCodes: ['dungeon_master'] }), ALL);
    expect(keys(items)).toEqual(keys(NAV.org));
  });
});

describe('resolveNav · capability filter', () => {
  it('shows a gated item locked rather than hiding it', () => {
    // Hiding it loses an upgrade rather than earning one: somebody who cannot find
    // a feature concludes the product does not have it.
    const items = resolveNav(ctx({ roleCodes: ['owner'] }), NONE);
    const reports = items.find((i) => i.key === 'reports');
    expect(reports).toBeDefined();
    expect(reports!.locked).toBe(true);
  });

  it('unlocks it once the capability is granted', () => {
    const items = resolveNav(ctx({ roleCodes: ['owner'] }), ALL);
    expect(items.find((i) => i.key === 'reports')!.locked).toBe(false);
  });

  it('never locks an item that needs nothing', () => {
    const items = resolveNav(ctx({ roleCodes: ['owner'] }), NONE);
    expect(items.filter((i) => i.locked).every((i) => !!i.needs)).toBe(true);
  });
});

describe('landingFor', () => {
  it('opens a context on its first item the role can actually use', () => {
    expect(landingFor(ctx({ id: 'o1', roleCodes: ['owner'] }), ALL)).toBe('/organizations/o1/overview');
  });

  it('skips a locked item rather than landing on a wall', () => {
    const reportingOnly = ctx({ id: 'o1', roleCodes: ['reporting_admin'] });
    // Its list starts at dashboard, so that is where it lands either way - the point
    // is that a locked first item would never be chosen.
    const landing = landingFor(reportingOnly, NONE);
    const chosen = resolveNav(reportingOnly, NONE).find((i) => hrefFor(reportingOnly, i) === landing);
    expect(chosen?.locked).toBe(false);
  });

  it('sends an assignment straight to its match console', () => {
    const assignment = ctx({ id: 'fix-1', kind: 'assignment', roleCodes: ['official'] });
    expect(landingFor(assignment, NONE)).toBe('/score/fix-1');
  });
});

describe('the assignment context is reachable', () => {
  // It was not. Its nav keys were missing from ROLE_NAV.official, so the context
  // existed with an empty sidebar and no way in.
  it('gives an official both of its items', () => {
    const items = resolveNav(ctx({ id: 'f1', kind: 'assignment', roleCodes: ['official'] }), NONE);
    expect(keys(items)).toEqual(['matchops', 'help']);
  });

  it('and still gives the same official the read-only event view', () => {
    const items = resolveNav(ctx({ id: 'e1', kind: 'event', roleCodes: ['official'] }), NONE);
    expect(keys(items)).toEqual(['overview', 'schedule', 'results']);
  });
});

describe('exact matching where one path prefixes another', () => {
  // Without `end`, the parent stays highlighted on every child route and the
  // sidebar reports you are in two places at once.
  it.each([
    ['event', NAV.event],
    ['eventDraft', NAV.eventDraft],
    ['orgGuest', NAV.orgGuest],
    ['personal', NAV.personal],
    ['org', NAV.org],
    ['assignment', NAV.assignment],
  ])('%s: any item whose path prefixes a sibling is marked end', (_kind, items) => {
    for (const item of items) {
      const isPrefix = items.some((o) => o !== item && o.to.startsWith(`${item.to}/`));
      if (isPrefix) expect(item.end, `${item.key} prefixes a sibling`).toBe(true);
    }
  });
});

describe('mayOpenSegment · the URL guard agrees with the sidebar', () => {
  const seg = (to: string) => (to.split('/championships/:id')[1] ?? '').replace(/^\//, '');

  it.each(NAV.event.map((i) => [i.key, seg(i.to)]))(
    'an organiser may open %s',
    (_key, segment) => expect(mayOpenSegment(['organiser'], segment)).toBe(true),
  );

  it('lets an official open exactly what their sidebar offers', () => {
    const offered = new Set(ROLE_NAV.official ?? []);
    for (const item of NAV.event) {
      expect(mayOpenSegment(['official'], seg(item.to))).toBe(offered.has(item.key));
    }
  });

  it('refuses somebody holding no role in this event', () => {
    expect(mayOpenSegment([], 'settings')).toBe(false);
  });

  it('allows a segment it has never heard of', () => {
    // An unknown URL is a routing question, answered by the router's own 404.
    // Refusing here would turn every new section into an access bug until somebody
    // remembered to list it.
    expect(mayOpenSegment(['participant'], 'some-future-page')).toBe(true);
  });
});
