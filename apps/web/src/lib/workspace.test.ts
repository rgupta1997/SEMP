import { describe, it, expect } from 'vitest';
import type { CapabilityKey } from '@semp/entitlements';
import { EVENT_VIEW, NAV, ROLE_NAV, hrefFor, landingFor, resolveNav, type WorkspaceContext } from './workspace';

// Every person-level fact on, so a test about ROLES is not also a test about facts.
const OFFICIATES = { officiates: true };
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
    const items = resolveNav(ctx({ kind: 'personal', roleCodes: [] }), ALL, OFFICIATES);
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

  it('and still gives the same official the match, and only the match', () => {
    // What is on, what happened, where that leaves the table. An official has no
    // business in the event's approvals, communications or certificates.
    const items = resolveNav(ctx({ id: 'e1', kind: 'event', roleCodes: ['official'] }), NONE);
    expect(keys(items)).toEqual(['overview', 'schedule', 'results', 'standings']);
  });
});

describe('being involved in an event without holding a role in it', () => {
  // A player on an entered team and a member of an enrolled institution hold no
  // event role. Treating that as "nobody" gave them a workspace with no sidebar;
  // treating it as "no filter" would have offered them Setup and Settings.
  const involved = (roleCodes: string[]) => resolveNav(ctx({ id: 'e1', kind: 'event', roleCodes }), NONE);

  it('shows the event as published, and none of the operations that run it', () => {
    expect(keys(involved([]))).toEqual(EVENT_VIEW);
    for (const op of ['setup', 'settings', 'organisers', 'approvals', 'communications', 'certificates']) {
      expect(keys(involved([])), op).not.toContain(op);
    }
  });

  it('reads player and member as no role rather than as an unknown one', () => {
    // They say how somebody reached the event, not what they hold in it.
    expect(keys(involved(['player', 'member']))).toEqual(EVENT_VIEW);
  });

  it.each([['owner'], ['org_admin'], ['sports_admin'], ['viewer']])(
    'does not let the organisation role %s decide an event',
    (code) => {
      // An event role overrides an org one, and holding only an org role in an
      // event is holding nothing there. This is the case that was reported: the
      // owner of an enrolled institution opened an event and was handed every
      // organiser operation in it, because `owner` is unrestricted - in its own
      // context.
      expect(keys(involved([code]))).toEqual(EVENT_VIEW);
    },
  );

  it('every key in the view set is a section that exists', () => {
    // The list is written out rather than derived, so it can name a tab that was
    // renamed or removed - which reads as "withheld" and is invisible until
    // somebody notices the gap.
    const sections = new Set(keys(NAV.event));
    for (const key of EVENT_VIEW) expect(sections, key).toContain(key);
  });

  it('leaves the personal context unfiltered', () => {
    expect(keys(resolveNav(ctx({ id: 'me', kind: 'personal', roleCodes: [] }), ALL, OFFICIATES))).toEqual(keys(NAV.personal));
  });

  it('does NOT treat the platform super admin as holding no event role', () => {
    // `super_admin` is not an org role standing in an org's shoes - it is platform
    // wide, and there is no event role for it to be overridden by. Filtering it out
    // with the org roles collapsed the super admin's event nav to the published
    // five, so they could open a championship and find no Setup tab, while
    // ROLE_NAV.super_admin = null says they see everything.
    const nav = keys(involved(['super_admin']));
    expect(nav).toEqual(keys(NAV.event));
    for (const op of ['setup', 'settings', 'organisers', 'communications', 'certificates']) {
      expect(nav, op).toContain(op);
    }
  });

  it('still lets an event role narrow a super admin who also holds one', () => {
    // Unrestricted wins when held alongside a narrower role - same rule as an
    // organiser who is also an official.
    expect(keys(involved(['super_admin', 'official']))).toEqual(keys(NAV.event));
  });
});

describe('items that depend on the person rather than the context', () => {
  const personal = (facts?: { officiates?: boolean }) =>
    keys(resolveNav(ctx({ id: 'me', kind: 'personal', roleCodes: [] }), ALL, facts));

  it('hides Officiating from somebody who officiates nothing', () => {
    // The personal context has no roles, so it is not role-filtered - which meant
    // every account in the institution carried a tab to a page built for its
    // handful of officials, and empty for everyone else.
    expect(personal({ officiates: false })).not.toContain('officiating');
  });

  it('shows it to somebody who does', () => {
    expect(personal({ officiates: true })).toContain('officiating');
  });

  it('hides it when the caller passes no facts at all', () => {
    // The safe direction: a call site that forgot shows too little, not too much.
    expect(personal()).not.toContain('officiating');
  });

  it('does not send anybody to a landing page they cannot see', () => {
    // landingFor picks the first item, so it has to apply the same filter -
    // otherwise the switcher drops an official-less account on /officiating.
    const me = ctx({ id: 'me', kind: 'personal', roleCodes: [] });
    for (const facts of [{ officiates: false }, { officiates: true }]) {
      const landing = landingFor(me, ALL, facts);
      expect(resolveNav(me, ALL, facts).map((i) => hrefFor(me, i))).toContain(landing);
    }
  });

  it('leaves the rest of the personal nav alone either way', () => {
    const others = keys(NAV.personal).filter((k) => k !== 'officiating');
    expect(personal({ officiates: false })).toEqual(others);
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

  // Run over BOTH event kinds. It used to cover only `event`, and that is exactly
  // how the draft nav shipped broken: `eventDraft` offered two items to everybody,
  // so an organiser's sidebar hid nine sections their own URL guard opened. The
  // sidebar and the URL disagreeing IS the bug, and parametrising the kind is what
  // makes the test able to see it.
  it.each([['event'], ['eventDraft']] as const)(
    'opens exactly what the sidebar offers, for every role (%s)',
    (kind) => {
      // The two answers come from the same lists and must not be able to drift: a
      // section the sidebar hides but the URL opens is an access bug, and one the
      // sidebar offers but the URL refuses is a dead link.
      for (const roleCodes of [[], ['player', 'member'], ['owner'], ['organiser'], ['official'], ['poc'], ['captain'], ['participant']]) {
        const offered = new Set(keys(resolveNav(ctx({ id: 'e1', kind, roleCodes }), NONE)));
        // Iterated over the FULL event nav, not over this kind's own list.
        //
        // That distinction is the whole point. Walking `NAV[kind]` only ever asks
        // about the sections the kind already offers, so a draft nav trimmed to two
        // items would check those two, find them both openable, and pass - which is
        // precisely how the broken draft nav shipped under a green suite. The URL
        // guard is kind-agnostic, so the full list is the right question to ask of
        // both kinds.
        for (const item of NAV.event) {
          expect(mayOpenSegment(roleCodes, seg(item.to)), `${kind} · ${roleCodes.join(',') || 'no role'} → ${item.key}`)
            .toBe(offered.has(item.key));
        }
      }
    },
  );

  it('gives an organiser the whole event on a DRAFT', () => {
    // The specific regression: a draft is not published, but "you are running it"
    // is a fact about the person, not about the event. An organiser building an
    // event needs Setup, the organising team, the schedule and the settings -
    // those are what building it means.
    const offered = keys(resolveNav(ctx({ id: 'e1', kind: 'eventDraft', roleCodes: ['organiser'] }), NONE));
    for (const key of ['setup', 'organisers', 'schedule', 'settings', 'results', 'standings']) {
      expect(offered, `organiser should reach ${key} on a draft`).toContain(key);
    }
  });

  it('still holds a draft back from somebody with no role in it', () => {
    const offered = keys(resolveNav(ctx({ id: 'e1', kind: 'eventDraft', roleCodes: [] }), NONE));
    expect(offered).not.toContain('settings');
    expect(offered).not.toContain('setup');
  });

  it('refuses somebody holding no role in this event', () => {
    expect(mayOpenSegment([], 'settings')).toBe(false);
  });

  it('opens the overview to somebody holding no role here', () => {
    // The overview is the front page of the event AND the page every refusal
    // above redirects to. Refusing it sent people to the page that had just
    // refused them, so the workspace rendered nothing at all.
    expect(mayOpenSegment([], '')).toBe(true);
  });

  it('never refuses its own redirect target', () => {
    // The invariant behind the case above, stated for every role: whatever the
    // guard turns away, it must be willing to open where it sends them.
    for (const codes of [[], ['official'], ['captain'], ['participant'], ['poc'], ['organiser']]) {
      expect(mayOpenSegment(codes, ''), `${codes.join(',') || 'no role'}`).toBe(true);
    }
  });

  it('allows a segment it has never heard of', () => {
    // An unknown URL is a routing question, answered by the router's own 404.
    // Refusing here would turn every new section into an access bug until somebody
    // remembered to list it.
    expect(mayOpenSegment(['participant'], 'some-future-page')).toBe(true);
  });
});
