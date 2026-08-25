import { describe, expect, it } from 'vitest';
import { generateManualKnockout } from './manual-knockout.js';

describe('manual knockout', () => {
  it('4 pairs -> 7 matches with QF/SF/Final', () => {
    const f = generateManualKnockout([
      { home: 'a', away: 'b' }, { home: 'c', away: 'd' }, { home: 'e', away: 'f' }, { home: 'g', away: 'h' },
    ]);
    expect(f).toHaveLength(7);
    expect(f.filter((x) => x.round === 'QF')).toHaveLength(4);
    expect(f.filter((x) => x.round === 'SF')).toHaveLength(2);
    expect(f.filter((x) => x.round === 'Final')).toHaveLength(1);
  });

  it('rejects a non-power-of-two pair count', () => {
    expect(() => generateManualKnockout([{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }, { home: 'e', away: 'f' }])).toThrow();
  });

  it('rejects a pair with both sides empty', () => {
    expect(() => generateManualKnockout([{ home: null, away: null }, { home: 'a', away: 'b' }])).toThrow();
  });

  it("a bye pair's lone entrant advances into the parent match's slot", () => {
    const f = generateManualKnockout([{ home: 'a', away: null }, { home: 'b', away: 'c' }]);
    const byPos = new Map(f.map((x) => [x.bracketPosition, x]));
    const bye = f.find((x) => x.status === 'bye')!;
    expect(bye.winnerToken).toBe('a');
    const parent = byPos.get(bye.feedsInto!);
    expect(parent).toBeDefined();
    expect([parent!.entrantHome, parent!.entrantAway]).toContain('a');
  });

  it('adds an unwired 3rd-place fixture when requested', () => {
    const f = generateManualKnockout(
      [{ home: 'a', away: 'b' }, { home: 'c', away: 'd' }, { home: 'e', away: 'f' }, { home: 'g', away: 'h' }],
      { thirdPlaceMatch: true },
    );
    expect(f).toHaveLength(8);
    expect(f.some((x) => x.round === '3rd Place')).toBe(true);
  });
});
