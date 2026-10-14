import { describe, it, expect } from 'vitest';
import { liveWriteAffectsStandings } from './standings-trigger.js';

const live = { status: 'live', has_event_standings: false };

describe('liveWriteAffectsStandings', () => {
  it('skips a point tap on a live head-to-head match', () => {
    // What the console sends on every tap: score + the unchanged status + live_state.
    expect(liveWriteAffectsStandings(live, {
      status: 'live', live_state: { sets: [[3, 2]] },
    })).toBe(false);
  });

  it('skips a live match being postponed or kicked off - both stay "not yet played"', () => {
    expect(liveWriteAffectsStandings(live, { status: 'postponed' })).toBe(false);
    expect(liveWriteAffectsStandings({ status: 'scheduled', has_event_standings: false }, { status: 'live' })).toBe(false);
  });

  it('rebuilds when a match finishes, is walked over or cancelled', () => {
    for (const status of ['completed', 'walkover', 'cancelled', 'bye']) {
      expect(liveWriteAffectsStandings(live, { status })).toBe(true);
    }
  });

  it('rebuilds when a finished match is reopened or its result is edited', () => {
    const done = { status: 'completed', has_event_standings: false };
    expect(liveWriteAffectsStandings(done, { status: 'live' })).toBe(true);
    expect(liveWriteAffectsStandings(done, { live_state: { custom_points: null } })).toBe(true);
  });

  it('rebuilds a ranking event that writes, keeps or clears eventStandings while live', () => {
    expect(liveWriteAffectsStandings(live, { live_state: { eventStandings: [{ orgId: 'o', points: 5 }] } })).toBe(true);
    const ranked = { status: 'live', has_event_standings: true };
    expect(liveWriteAffectsStandings(ranked, { status: 'live' })).toBe(true);
    expect(liveWriteAffectsStandings(ranked, { live_state: {} })).toBe(true);
  });

  it('treats an empty eventStandings list as none', () => {
    expect(liveWriteAffectsStandings(live, { live_state: { eventStandings: [] } })).toBe(false);
  });

  it('rebuilds when the fixture could not be read', () => {
    expect(liveWriteAffectsStandings(undefined, { status: 'live' })).toBe(true);
  });
});
