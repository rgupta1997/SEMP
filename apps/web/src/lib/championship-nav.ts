import { EVENT_VIEW, NAV, ROLE_NAV, eventRoleCodes } from './workspace';

// Path helpers for the event workspace, and the one guard that stops somebody
// reaching a section by URL that their role does not show them.
//
// The nav itself is NOT defined here. It used to be - a second list, in a second
// vocabulary, disagreeing with the sidebar about whether the organising team lived
// at /team or /organisers and omitting two sections entirely. NAV.event in
// workspace.ts is the single definition, and the guard below is derived from it, so
// "what you can see" and "what you can open" cannot drift apart.

export function eventNavPath(eventId: string, segment: string) {
  return segment ? `/championships/${eventId}/${segment}` : `/championships/${eventId}`;
}

export function parseEventId(pathname: string): string | null {
  const m = pathname.match(/^\/championships\/([^/]+)/);
  if (!m || m[1] === 'new') return null;
  return m[1];
}

/** The section currently open under /championships/:id ('' = overview). */
export function parseEventSegment(pathname: string, eventId: string): string {
  const rest = pathname.split(`/championships/${eventId}`)[1] ?? '';
  return rest.replace(/^\//, '').split('/')[0] ?? '';
}

/** The nav key a URL segment belongs to. Overview is the empty segment. */
function keyForSegment(segment: string): string | null {
  const item = NAV.event.find((i) => {
    const tail = i.to.split('/championships/:id')[1] ?? '';
    return tail.replace(/^\//, '') === segment;
  });
  return item?.key ?? null;
}

/**
 * May somebody holding these event roles open this section?
 *
 * Holding NO event role is not the same as being refused: a player on an entered
 * team and a member of an enrolled institution are both involved in the event
 * without holding anything in it, and they get EVENT_VIEW - the event as
 * published, without any of the operations that run it.
 *
 * Unknown segments are allowed through: a URL this file has never heard of is a
 * routing question, answered by the router's own 404, not a permission question.
 * Refusing them here would turn every new section into an access bug until
 * somebody remembered to list it.
 */
export function mayOpenSegment(roleCodes: string[], segment: string): boolean {
  const key = keyForSegment(segment);
  if (!key) return true;
  // The overview is the event's front page, and it is where every refusal below
  // sends people. Refusing it too pointed somebody at the page that had just
  // refused them, so the whole workspace rendered nothing - which is what an
  // organisation member with no role in the event saw when they opened one.
  //
  // There is also nothing here to refuse: the server has already answered whether
  // this person may see this event at all, by answering the fetch or 404ing it.
  if (key === 'overview') return true;

  // Same three steps as resolveNav, on the same lists, in the same order - the
  // sidebar and the URL have to answer this identically or one of them is lying.
  //
  // Only the codes that decide an EVENT. That drops two kinds of thing: 'player'
  // and 'member', which say how somebody reached the event rather than what they
  // hold in it, and any organisation role, which an event role overrides.
  const codes = eventRoleCodes(roleCodes);
  if (codes.length === 0) return EVENT_VIEW.includes(key);
  if (codes.some((c) => ROLE_NAV[c] === null)) return true;
  const allowed = new Set(codes.flatMap((c) => ROLE_NAV[c] ?? []));
  return allowed.has(key);
}
