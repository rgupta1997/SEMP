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

describe('play order in a league', () => {
  it('sorts by round, then match, with the round\'s bye last', () => {
    const rounds = ['Round 2 - Match 1', 'Round 1 - Bye', 'Round 1 - Match 2', 'Round 10 - Match 1', 'Round 1 - Match 1'];
    expect(rounds.map((round) => ({ round })).sort(comparePlayOrder).map((f) => f.round))
      .toEqual(['Round 1 - Match 1', 'Round 1 - Match 2', 'Round 1 - Bye', 'Round 2 - Match 1', 'Round 10 - Match 1']);
  });
  it('older single-number labels still sort by their number', () => {
    expect(['Round 12', 'Round 3', 'Round 7'].map((round) => ({ round })).sort(comparePlayOrder).map((f) => f.round))
      .toEqual(['Round 3', 'Round 7', 'Round 12']);
  });
});
