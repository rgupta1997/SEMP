export interface EventNavItem {
  segment: string;
  label: string;
  end?: boolean;
}

export const EVENT_NAV: EventNavItem[] = [
  { segment: '', label: 'Overview', end: true },
  { segment: 'setup', label: 'Setup' },
  { segment: 'team', label: 'Team' },
  { segment: 'approvals', label: 'Approvals' },
  { segment: 'participants', label: 'Participants' },
  { segment: 'officials', label: 'Officials' },
  { segment: 'schedule', label: 'Schedule' },
  { segment: 'standings', label: 'Standings' },
  { segment: 'settings', label: 'Settings' },
];

export function eventNavPath(eventId: string, segment: string) {
  return segment ? `/events/${eventId}/${segment}` : `/events/${eventId}`;
}

export function parseEventId(pathname: string): string | null {
  const m = pathname.match(/^\/events\/([^/]+)/);
  if (!m || m[1] === 'new') return null;
  return m[1];
}
