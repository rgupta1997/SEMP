// Does a write to PATCH /fixtures/:id/live need standings rebuilt?
//
// Standings read only (a) completed/walkover/bye fixtures, (b) whether a draw
// still has a scheduled/live/postponed fixture, and (c) live_state.eventStandings
// (see recomputeStandings). A point tap on a live head-to-head match - by far the
// most common write, since the console sends score+status on every tap - touches
// none of them, and the rebuild reads every fixture in the championship. So it is
// skipped for exactly that case, and runs for everything else.

// Statuses standings treat as "not yet played": they contribute nothing except
// keeping their draw undecided, and moving between them changes neither.
const PENDING_STATUSES = new Set(['scheduled', 'live', 'postponed']);

export interface FixtureStandingsView {
  status: string;
  /** live_state.eventStandings is a non-empty array. */
  has_event_standings: boolean;
}

export function liveWriteAffectsStandings(
  prior: FixtureStandingsView | undefined,
  body: { status?: unknown; live_state?: { eventStandings?: unknown; [key: string]: unknown } | null },
): boolean {
  if (!prior) return true; // can't tell - rebuild, as before
  const sent = body.live_state?.eventStandings;
  const nextHasEventStandings = 'live_state' in body
    ? Array.isArray(sent) && sent.length > 0
    : prior.has_event_standings;
  const nextStatus = typeof body.status === 'string' && body.status ? body.status : prior.status;
  return !PENDING_STATUSES.has(prior.status)
    || !PENDING_STATUSES.has(nextStatus)
    || prior.has_event_standings
    || nextHasEventStandings;
}
