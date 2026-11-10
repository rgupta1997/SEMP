import { describe, expect, it } from 'vitest';
import { liftsBreakdown, liftsTotal, withLift, type ParticipantResult } from './event-scoring.js';
import { foldCareerStats, statSpecFor } from './stat-registry.js';

const lifter = (): ParticipantResult => ({ id: 'a', name: 'A', marks: { m63: 300 } });

describe('powerlifting lifts', () => {
  it('fills the total only once all three lifts are in', () => {
    let p = withLift(lifter(), 'm63', 'squat', 120);
    expect(p.marks.m63).toBeNull();
    p = withLift(p, 'm63', 'bench', 80.5);
    p = withLift(p, 'm63', 'deadlift', 150.25);
    expect(p.marks.m63).toBe(350.75);
    expect(liftsBreakdown(p, 'm63')).toBe('S 120 · B 80.5 · D 150.25');
  });
  it('clearing every lift drops them and leaves the total to be typed', () => {
    let p = withLift(lifter(), 'm63', 'squat', 120);
    p = withLift(p, 'm63', 'squat', null);
    expect(p.lifts?.m63).toBeUndefined();
    expect(p.marks.m63).toBeNull();
    expect(liftsBreakdown(p, 'm63')).toBeNull();
  });
  it('sums partial lifts without calling them complete', () => {
    expect(liftsTotal({ squat: 100, bench: 60 })).toEqual({ sum: 160, any: true, complete: false });
    expect(liftsTotal(undefined)).toEqual({ sum: 0, any: false, complete: false });
  });
  it('career stats keep the best and average of each lift across events', () => {
    const spec = statSpecFor('Powerlifting')!;
    const career = foldCareerStats(spec, [
      { mark: 430, rank: 1, squat: 150, bench: 100, deadlift: 180 },
      { mark: 445, rank: 2, squat: 160, bench: 95, deadlift: 190 },
      { squat: 170 },
    ]);
    expect(career).toMatchObject({
      personal_best: 445, best_squat: 170, best_bench: 100, best_deadlift: 190,
      // Each average is over the events that recorded that lift.
      average_squat: 160, average_bench: 97.5, average_deadlift: 185,
    });
  });
});
