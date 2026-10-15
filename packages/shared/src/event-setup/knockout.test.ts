import { describe, expect, it } from 'vitest';
import type { SetupMatchRowSpec, SetupMatchSide } from './blueprint.js';
import { KnockoutSheetError, knockoutFromRows } from './knockout.js';

// "A" is squad A; "W:x" is the winner of match x.
const side = (s: string): SetupMatchSide => (s.startsWith('W:') ? { winnerOf: s.slice(2) } : { squadKey: s });
const rows = (spec: Array<[id: string, home: string, away: string]>): SetupMatchRowSpec[] =>
  spec.map(([matchId, h, a]) => ({ matchId, date: '2026-10-17', kickoff: '09:00', minutes: 25, groundKey: 'g1', home: side(h), away: side(a) }));

/** The product's own advancement arithmetic (apps/api fixtures/bracket.ts computeParentPosition). */
function parentOf(siblingCount: number, position: number): { parentPos: number; slot: 'home' | 'away' } | null {
  const size = siblingCount + 1;
  const rounds = Math.log2(size);
  const offsets: number[] = [];
  for (let r = 0, acc = 0; r < rounds; r++) { offsets.push(acc); acc += size / 2 ** (r + 1); }
  for (let r = 0; r < rounds - 1; r++) {
    const n = size / 2 ** (r + 1);
    if (position >= offsets[r] && position < offsets[r] + n) {
      const j = position - offsets[r];
      return { parentPos: offsets[r + 1] + Math.floor(j / 2), slot: j % 2 === 0 ? 'home' : 'away' };
    }
  }
  return null;
}

/** Every "Winner of" on the sheet must land, by the product's arithmetic, in the match that names it. */
function expectWiring(spec: SetupMatchRowSpec[]) {
  const k = knockoutFromRows(spec);
  const positioned = 2 ** k.rounds - 1;
  for (const r of spec) {
    for (const [s, slot] of [[r.home, 'home'], [r.away, 'away']] as const) {
      if (!('winnerOf' in s)) continue;
      const p = parentOf(positioned, k.positionOf.get(s.winnerOf)!);
      expect(p, `${s.winnerOf} -> ${r.matchId}`).toEqual({ parentPos: k.positionOf.get(r.matchId), slot });
    }
  }
  return k;
}

describe('knockoutFromRows', () => {
  it('reads a plain four-squad bracket', () => {
    const k = expectWiring(rows([['SF1', 'A', 'B'], ['SF2', 'C', 'D'], ['F', 'W:SF1', 'W:SF2']]));
    expect(k.rounds).toBe(2);
    expect(k.pairs).toEqual([{ home: 'A', away: 'B' }, { home: 'C', away: 'D' }]);
    expect(k.squads).toEqual(['A', 'B', 'C', 'D']);
  });

  it('turns a squad appearing in round two into a first-round bye (the WNS shape)', () => {
    const k = expectWiring(rows([
      ['R1-1', 'A', 'B'], ['R1-2', 'C', 'D'], ['R1-3', 'E', 'F'],
      ['R2-1', 'W:R1-1', 'W:R1-2'], ['R2-2', 'W:R1-3', 'G'],
      ['F', 'W:R2-1', 'W:R2-2'],
    ]));
    expect(k.rounds).toBe(3);
    expect(k.pairs).toEqual([
      { home: 'A', away: 'B' }, { home: 'C', away: 'D' }, { home: 'E', away: 'F' }, { home: 'G', away: null },
    ]);
  });

  it('accepts a round-two match between two squads that both had byes', () => {
    // 5 squads: A v B in round one; D and E both bye straight into round two.
    const k = expectWiring(rows([
      ['M1', 'A', 'B'],
      ['M2', 'W:M1', 'C'], ['M3', 'D', 'E'],
      ['F', 'W:M2', 'W:M3'],
    ]));
    expect(k.rounds).toBe(3);
    expect(k.pairs).toEqual([
      { home: 'A', away: 'B' }, { home: 'C', away: null }, { home: 'D', away: null }, { home: 'E', away: null },
    ]);
    expect(new Set(k.squads)).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
  });

  it('places every sheet match at the position the product advances its winner from', () => {
    // A 16-slot bracket with byes in both halves, written out of order.
    const spec = rows([
      ['QF2', 'W:R1-3', 'W:R1-4'], ['R1-1', 'A', 'B'], ['R1-2', 'C', 'D'], ['R1-3', 'E', 'F'],
      ['R1-4', 'G', 'H'], ['R1-5', 'I', 'J'], ['QF1', 'W:R1-1', 'W:R1-2'],
      ['QF3', 'W:R1-5', 'K'], ['QF4', 'L', 'M'], ['SF1', 'W:QF1', 'W:QF2'], ['SF2', 'W:QF3', 'W:QF4'],
      ['F', 'W:SF1', 'W:SF2'],
    ]);
    const k = expectWiring(spec);
    expect(k.rounds).toBe(4);
    expect(k.squads).toHaveLength(13);
  });

  const fails = (spec: Array<[string, string, string]>, re: RegExp) => {
    let err: unknown;
    try { knockoutFromRows(rows(spec)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(KnockoutSheetError);
    expect((err as Error).message).toMatch(re);
  };

  it('refuses a match id used twice', () => fails([['M1', 'A', 'B'], ['M1', 'C', 'D']], /used twice/));
  it('refuses a winner of a match that is not on the sheet', () => fails([['M1', 'A', 'B'], ['F', 'W:M1', 'W:M9']], /not a match on the sheet/));
  it('refuses two finals', () => fails([['M1', 'A', 'B'], ['M2', 'C', 'D']], /one final/));
  it('refuses a squad drawn twice', () => fails([['M1', 'A', 'B'], ['M2', 'A', 'C'], ['F', 'W:M1', 'W:M2']], /drawn twice/));
  it('refuses a squad entering two rounds in', () => fails([
    ['M1', 'A', 'B'], ['M2', 'C', 'D'], ['S1', 'W:M1', 'W:M2'], ['F', 'W:S1', 'I'],
  ], /more than one round in/));
  it('refuses a feeder from two rounds back', () => fails([
    ['M1', 'A', 'B'], ['M2', 'C', 'D'], ['M3', 'E', 'F'], ['M4', 'G', 'H'],
    ['S1', 'W:M1', 'W:M2'], ['F', 'W:S1', 'W:M3'], ['X', 'W:M4', 'I'],
  ], /final/));
});
