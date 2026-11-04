import { describe, expect, it } from 'vitest';
import { quotient, rallyPointsOf } from './rally-points.js';
import { TEAM_PRESETS } from './team-presets.js';
import type { RallyEvent } from './rally-kernel.js';

const vb = TEAM_PRESETS.find((f) => f.presetKey === 'vb_bo3_25_all')!;
const points = (side: 'A' | 'B', n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side }) as RallyEvent);
// 25-20, then 23-25, then 25-18: A 73, B 63.
const rally = [
  ...points('B', 20), ...points('A', 25),
  ...points('A', 23), ...points('B', 25),
  ...points('B', 18), ...points('A', 25),
];

describe('rally points for the points quotient', () => {
  it('adds every set of a point-by-point match', () => {
    expect(vb).toBeDefined();
    expect(rallyPointsOf({ format: vb, rally })).toEqual([73, 63]);
  });

  it('has nothing to give for a match entered as a final score', () => {
    expect(rallyPointsOf({ format: vb })).toBeNull();
    expect(rallyPointsOf({ format: vb, rally: [] })).toBeNull();
    expect(rallyPointsOf(null)).toBeNull();
  });

  it('a quotient is won over lost; nothing lost is the best there is; nothing at all is no data', () => {
    expect(quotient(6, 4)).toBe(1.5);
    expect(quotient(4, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(quotient(0, 0)).toBeNull();
    expect(quotient(0, 3)).toBe(0);
  });
});
