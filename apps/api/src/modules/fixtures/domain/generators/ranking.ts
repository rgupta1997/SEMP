import type { GeneratedFixture, TeamRef } from './types.js';

// A ranking event (powerlifting / swimming / athletics): there are no head-to-head
// matches - every competitor performs and the result is a single ranking. We model the
// whole event as ONE team-less fixture that the multi-competitor event console scores
// (live_state.eventRanking / live_state.event); its org points feed into standings.
// Teams/params are ignored - the event has no bracket and no pairings.
export function generateRanking(_teams: TeamRef[], _params: Record<string, unknown>): GeneratedFixture[] {
  return [{
    round: 'Event',
    poolNumber: null,
    bracketPosition: null,
    homeTeamId: null,
    awayTeamId: null,
    status: 'scheduled',
  }];
}
