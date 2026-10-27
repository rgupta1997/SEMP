// A signed-off ranking event (swimming, powerlifting) must survive a late draft save.
// The event consoles autosave a draft two seconds after an edit, carrying the status and
// event data as they were when the page loaded; landing after "Save & sign off" it would
// put the event back to scheduled and erase its event points.

type LiveWrite = { status?: string; live_state?: Record<string, unknown> | null; [k: string]: unknown };

/** A live write from an event console: only they send `eventRanking` / `event`. */
export const isEventWrite = (body: LiveWrite | null | undefined): boolean =>
  !!body?.live_state && ('eventRanking' in body.live_state || 'event' in body.live_state);

/**
 * Against a completed event, an event-console write can't move the status back, and one
 * bringing no event points keeps the saved ones. Everything else passes through unchanged:
 * match writes, and status changes made elsewhere (the fixture editor, unlocking).
 */
export function guardEventSignOff<T extends LiveWrite>(
  current: { status: string; live_state: unknown } | null | undefined, body: T,
): T {
  if (!current || current.status !== 'completed' || !isEventWrite(body)) return body;
  const next: T = { ...body };
  if (next.status && next.status !== 'completed') delete next.status;
  const saved = (current.live_state as { eventStandings?: unknown } | null)?.eventStandings;
  if (Array.isArray(saved) && saved.length > 0 && !Array.isArray(next.live_state?.eventStandings)) {
    next.live_state = { ...next.live_state, eventStandings: saved };
  }
  return next;
}
