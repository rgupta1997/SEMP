import { describe, expect, it } from 'vitest';
import { liftsBreakdown, liftsTotal, withLift, type ParticipantResult } from './event-scoring.js';

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
});
