import { NAV, ROLE_NAV } from './workspace';

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
 * Unknown segments are allowed through: a URL this file has never heard of is a
 * routing question, answered by the router's own 404, not a permission question.
 * Refusing them here would turn every new section into an access bug until
 * somebody remembered to list it.
 */
export function mayOpenSegment(roleCodes: string[], segment: string): boolean {
  const key = keyForSegment(segment);
  if (!key) return true;
  if (roleCodes.length === 0) return false;
  // An unrestricted role opens everything; otherwise it is the union of what each
  // role held allows - the same rule the sidebar applies.
  if (roleCodes.some((c) => c in ROLE_NAV && ROLE_NAV[c] === null)) return true;
  const allowed = new Set(roleCodes.flatMap((c) => ROLE_NAV[c] ?? []));
  return allowed.has(key);
}
