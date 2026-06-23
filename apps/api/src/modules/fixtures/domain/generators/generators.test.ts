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
  it('4 teams -> 6 matches over 3 rounds', () => {
    const f = generateRoundRobin(teams(4));
    expect(f.filter((x) => x.status === 'scheduled')).toHaveLength(6);
    expect(new Set(f.map((x) => x.round)).size).toBe(3);
  });

  it('3 teams (odd) -> 3 real matches', () => {
    const f = generateRoundRobin(teams(3));
    expect(f.filter((x) => x.status === 'scheduled')).toHaveLength(3);
  });

  it('double round doubles the matches', () => {
    const single = generateRoundRobin(teams(4)).filter((x) => x.status === 'scheduled').length;
    const double = generateRoundRobin(teams(4), { doubleRound: true }).filter((x) => x.status === 'scheduled').length;
    expect(double).toBe(single * 2);
  });
});

describe('groups', () => {
  it('8 teams into 2 groups -> 12 round-robin matches with pool numbers', () => {
    const f = generateGroups(teams(8), { numGroups: 2 });
    expect(f).toHaveLength(12); // 2 groups of 4 -> 6 each
    expect(new Set(f.map((x) => x.poolNumber))).toEqual(new Set([1, 2]));
  });
});
