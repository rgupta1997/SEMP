import { describe, expect, it } from 'vitest';
import { comparePlayOrder } from './enums.js';

describe('play order', () => {
  it('lists group matches by pool and number, then knockouts up to the Final', () => {
    const rounds = ['Final', 'Pool A - Match 5', 'SF', 'Pool A - Match 2', '3rd Place', 'Pool B - Match 1', 'QF', 'Pool A - Match 4'];
    const pools: Record<string, number> = { 'Pool A - Match 5': 1, 'Pool A - Match 2': 1, 'Pool A - Match 4': 1, 'Pool B - Match 1': 2 };
    const sorted = rounds.map((round) => ({ round, pool_number: pools[round] ?? null })).sort(comparePlayOrder).map((f) => f.round);
    expect(sorted).toEqual(['Pool A - Match 2', 'Pool A - Match 4', 'Pool A - Match 5', 'Pool B - Match 1', 'QF', 'SF', '3rd Place', 'Final']);
  });
  it('a later stage comes after an earlier one', () => {
    const sorted = [{ round: 'Pool A - Match 1', stage_sequence: 2 }, { round: 'Pool A - Match 3', stage_sequence: 1 }].sort(comparePlayOrder);
    expect(sorted.map((f) => f.stage_sequence)).toEqual([1, 2]);
  });
});
