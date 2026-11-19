import { describe, expect, it } from 'vitest';
import { statSpecFor } from '@semp/shared';
import { attributionError, manualStatSpec, manualTimeline, pointsFromEvents, seedManualEvents, type ManualEvent } from './ManualStatsPanel';

const goal = (side: 'A' | 'B', playerId: string, minute?: number): ManualEvent =>
  ({ t: 'point', side, pts: 1, kind: 'goal', label: 'Goal', playerId, playerName: playerId, ...(minute != null ? { minute } : {}) });

describe('final-score stats', () => {
  it('is offered for football and kabaddi, not racquet sports or cricket', () => {
    expect(manualStatSpec('Football')).not.toBeNull();
    expect(manualStatSpec('Kabaddi')).not.toBeNull();
    expect(manualStatSpec('Badminton')).toBeNull();
    expect(manualStatSpec('Cricket')).toBeNull();
  });

  it('seeds from typed stats first, else lifts attributed actions out of the live log', () => {
    expect(seedManualEvents({ manualEvents: [goal('A', 'a1')], rally: [goal('B', 'b1')] })).toHaveLength(1);
    const lifted = seedManualEvents({
      rally: [
        { t: 'clockStart' },
        { t: 'point', side: 'A' }, // a bare +1 credits nobody: not a stat
        { t: 'point', side: 'A', pts: 0, kind: 'yellow', playerId: 'a1', rescinded: { reason: 'wrong player' } },
        goal('B', 'b1'),
      ],
    });
    expect(lifted.map((e) => e.playerId)).toEqual(['b1']);
  });

  it('refuses more goals than the score, allows fewer', () => {
    const spec = statSpecFor('Football');
    const events = [goal('A', 'a1'), goal('A', 'a2')];
    expect(pointsFromEvents(events)).toEqual([2, 0]);
    expect(attributionError(spec, events, [1, 0], ['Home', 'Away'])).toMatch(/Home/);
    expect(attributionError(spec, events, [3, 0], ['Home', 'Away'])).toBeNull();
    // An untyped score is not checked yet.
    expect(attributionError(spec, events, [null, null], ['Home', 'Away'])).toBeNull();
  });

  it('writes the timeline newest first, in minute order', () => {
    const t = manualTimeline([goal('A', 'a1', 60), goal('B', 'b1', 10)]);
    expect(t.map((e) => e.t)).toEqual(["60'", "10'"]);
    expect(t[0].playerId).toBe('a1');
  });
});
