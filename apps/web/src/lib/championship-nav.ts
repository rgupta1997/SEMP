export interface EventNavItem {
  segment: string;
  label: string;
  end?: boolean;
  /** Management-only tab — hidden from users who don't organise the championship. */
  manage?: boolean;
}

export const EVENT_NAV: EventNavItem[] = [
  { segment: '', label: 'Overview', end: true },
  { segment: 'setup', label: 'Setup', manage: true },
  { segment: 'team', label: 'Organising team', manage: true },
  { segment: 'approvals', label: 'Approvals', manage: true },
  { segment: 'participants', label: 'Participants' },
  { segment: 'schedule', label: 'Schedule' },
  { segment: 'results', label: 'Results' },
  { segment: 'standings', label: 'Standings' },
  { segment: 'settings', label: 'Settings', manage: true },
];

// Segments only an organiser (or super admin) may open.
export const MANAGE_SEGMENTS = new Set(EVENT_NAV.filter((i) => i.manage).map((i) => i.segment));

export function eventNavPath(eventId: string, segment: string) {
  return segment ? `/championships/${eventId}/${segment}` : `/championships/${eventId}`;
}

export function parseEventId(pathname: string): string | null {
  const m = pathname.match(/^\/championships\/([^/]+)/);
  if (!m || m[1] === 'new') return null;
  return m[1];
}

// The tab segment currently active under /championships/:id ('' = overview).
export function parseEventSegment(pathname: string, eventId: string): string {
  const rest = pathname.split(`/championships/${eventId}`)[1] ?? '';
  return rest.replace(/^\//, '').split('/')[0] ?? '';
}
