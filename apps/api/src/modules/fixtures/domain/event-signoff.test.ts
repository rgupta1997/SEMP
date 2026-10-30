import { describe, expect, it } from 'vitest';
import { guardEventSignOff, isEventWrite } from './event-signoff.js';

const signedOff = { status: 'completed', live_state: { eventRanking: { rows: [] }, eventStandings: [{ orgId: 'A', points: 5 }] } };

describe('a late draft cannot undo a ranking sign-off', () => {
  it('keeps the event completed and its event points', () => {
    const draft = { status: 'scheduled', live_state: { eventRanking: { rows: [{ orgId: 'A', place: 2 }] } } };
    const out = guardEventSignOff(signedOff, draft);
    expect(out.status).toBeUndefined();
    expect(out.live_state).toEqual({ eventRanking: { rows: [{ orgId: 'A', place: 2 }] }, eventStandings: [{ orgId: 'A', points: 5 }] });
  });

  it("a detailed console's draft keeps its own points but not the old status", () => {
    const draft = { status: 'scheduled', live_state: { event: { participants: [] }, eventStandings: [{ orgId: 'A', points: 3 }] } };
    const out = guardEventSignOff(signedOff, draft);
    expect(out.status).toBeUndefined();
    expect(out.live_state?.eventStandings).toEqual([{ orgId: 'A', points: 3 }]);
  });

  it('a new sign-off goes through as sent', () => {
    const again = { status: 'completed', live_state: { eventRanking: { rows: [] }, eventStandings: [{ orgId: 'B', points: 5 }] } };
    expect(guardEventSignOff(signedOff, again)).toEqual(again);
  });

  it('an event not yet signed off saves drafts as before', () => {
    const draft = { status: 'scheduled', live_state: { eventRanking: { rows: [] } } };
    expect(guardEventSignOff({ status: 'scheduled', live_state: {} }, draft)).toBe(draft);
  });

  it('match consoles are untouched, even on a completed match', () => {
    const tap = { status: 'live', live_state: { rally: { a: 3, b: 2 } }, home_score: 0, away_score: 1 };
    expect(isEventWrite(tap)).toBe(false);
    expect(guardEventSignOff({ status: 'completed', live_state: {} }, tap)).toBe(tap);
  });
});
