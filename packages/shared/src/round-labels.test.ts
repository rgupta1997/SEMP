import { describe, expect, it } from 'vitest';
import { isGroupBye, isKnockoutRound, isReservedRoundLabel } from './enums.js';
import { isGroupRound } from './tie-templates.js';

// A pool match's label is typed by hand; none of these may turn it into a knockout round.
describe('typed match labels', () => {
  it.each(['Final', 'final', ' FINAL ', 'SF', 'sf', 'QF', '3rd Place', '3rd place', 'R2', 'r16', ' R32'])(
    '"%s" is reserved for the Round picker', (label) => {
      expect(isReservedRoundLabel(label)).toBe(true);
    });

  it.each(['Pool A - Match 5', 'Round 2', 'Group A', 'Final group game', 'R1 Pool A', 'Semi Final', 'Match', ''])(
    '"%s" is an ordinary pool label', (label) => {
      expect(isReservedRoundLabel(label)).toBe(false);
      expect(isKnockoutRound(label)).toBe(false);
    });

  it('a default pool label plays every rubber in a team tie', () => {
    expect(isGroupRound('Match')).toBe(true);
    expect(isGroupRound('Round 2')).toBe(true);
  });
});

describe('group byes', () => {
  it('a bye in a group is a rest slot; a knockout bye is not', () => {
    expect(isGroupBye({ status: 'bye', round: 'Pool A - Match 1', bracket_position: null })).toBe(true);
    expect(isGroupBye({ status: 'bye', round: 'QF', bracket_position: 3 })).toBe(false);
    expect(isGroupBye({ status: 'bye', round: 'R16', bracket_position: null })).toBe(false);
    expect(isGroupBye({ status: 'scheduled', round: 'Pool A - Match 1' })).toBe(false);
  });
});
