import { describe, expect, it } from 'vitest';
import { generateGroups } from './groups.js';
import { generateKnockout } from './knockout.js';
import { generateRoundRobin } from './round-robin.js';
import type { TeamRef } from './types.js';

const teams = (n: number): TeamRef[] => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}` }));

describe('knockout', () => {
  it('8 teams -> 7 matches with QF/SF/Final', () => {
    const f = generateKnockout(teams(8));
    expect(f).toHaveLength(7);
    expect(f.filter((x) => x.round === 'QF')).toHaveLength(4);
    expect(f.filter((x) => x.round === 'SF')).toHaveLength(2);
    expect(f.filter((x) => x.round === 'Final')).toHaveLength(1);
  });

  it('adds a third-place match when requested', () => {
    const f = generateKnockout(teams(8), { thirdPlaceMatch: true });
    expect(f).toHaveLength(8);
    expect(f.some((x) => x.round === '3rd Place')).toBe(true);
  });

  it('6 teams -> padded to 8 with 2 byes in round one', () => {
    const f = generateKnockout(teams(6));
    expect(f).toHaveLength(7);
    const byes = f.filter((x) => x.status === 'bye');
    expect(byes).toHaveLength(2);
  });

  it('auto-advances each bye team into its next-round slot', () => {
    const f = generateKnockout(teams(6));
    const byPos = new Map(f.map((x) => [x.bracketPosition, x]));
    const byes = f.filter((x) => x.status === 'bye');
    for (const bye of byes) {
      const advancing = bye.homeTeamId ?? bye.awayTeamId;
      // The bye records its lone team as the winner...
      expect(bye.winnerTeamId).toBe(advancing);
      // ...and that team is seeded into the match it feeds.
      const parent = byPos.get(bye.feedsInto!);
      expect(parent).toBeDefined();
      expect([parent!.homeTeamId, parent!.awayTeamId]).toContain(advancing);
    }
  });

  it('wires feedsInto toward the final', () => {
    const f = generateKnockout(teams(4));
    const final = f.find((x) => x.round === 'Final')!;
    const sfs = f.filter((x) => x.round === 'SF');
    expect(sfs.every((s) => s.feedsInto === final.bracketPosition)).toBe(true);
  });

  it('rejects fewer than 2 teams', () => {
    expect(() => generateKnockout(teams(1))).toThrow();
  });
});

describe('round robin', () => {
  it('4 teams -> 6 matches, each with its own unique match label', () => {
    const f = generateRoundRobin(teams(4));
    expect(f.filter((x) => x.status === 'scheduled')).toHaveLength(6);
    // 4 teams play 2 simultaneous matches per round (3 rounds total) - every match
    // must still get its own label, not share one with the match playing alongside it.
    expect(new Set(f.map((x) => x.round)).size).toBe(6);
    expect(f.map((x) => x.round)).toEqual(['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Round 6']);
  });

  it('3 teams (odd) -> 3 real matches', () => {
    const f = generateRoundRobin(teams(3));
    expect(f.filter((x) => x.status === 'scheduled')).toHaveLength(3);
  });

  it('double round doubles the matches, continuing the match numbering into the second leg', () => {
    const single = generateRoundRobin(teams(4)).filter((x) => x.status === 'scheduled').length;
    const double = generateRoundRobin(teams(4), { doubleRound: true });
    const doubleScheduled = double.filter((x) => x.status === 'scheduled');
    expect(doubleScheduled).toHaveLength(single * 2);
    expect(new Set(double.map((x) => x.round)).size).toBe(double.length); // still all unique
  });
});

describe('groups', () => {
  it('8 teams into 2 groups -> 12 round-robin matches with pool numbers', () => {
    const f = generateGroups(teams(8), { numGroups: 2 });
    expect(f).toHaveLength(12); // 2 groups of 4 -> 6 each
    expect(new Set(f.map((x) => x.poolNumber))).toEqual(new Set([1, 2]));
  });

  it('every match within a pool gets its own unique label, even though some play simultaneously', () => {
    const f = generateGroups(teams(8), { numGroups: 2 });
    const poolA = f.filter((x) => x.poolNumber === 1).map((x) => x.round);
    expect(new Set(poolA).size).toBe(poolA.length); // 6 matches, 6 distinct labels
    expect(poolA).toEqual(['Pool A - Match 1', 'Pool A - Match 2', 'Pool A - Match 3', 'Pool A - Match 4', 'Pool A - Match 5', 'Pool A - Match 6']);
  });
});
