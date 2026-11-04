import { describe, expect, it } from 'vitest';
import { foldRally, formatResultUnit, setResultUnits, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';

const pts = (seq: string): RallyEvent[] => [...seq].map((c) => ({ t: 'point', side: c as 'A' | 'B' }));
const games = (order: string) => [...order].map((g) => g.repeat(4)).join('');

// A tennis result is told in sets ("6-5 (7-5)"), not the points of every game.
describe('set-based results', () => {
  const women = presetByKey('iim_women_set5_tb7')!;

  it('one set to 5 decided by a 7-point tie-break reads 6-5 (7-5)', () => {
    const log = pts(games('ABABABABAB') + 'AB'.repeat(5) + 'AA');
    const { state } = foldRally(women, log, 'A');
    expect(state.ended).toBe(true);
    const units = setResultUnits(women, state)!;
    expect(units).toEqual([{ score: [6, 5], tieBreak: [7, 5] }]);
    expect(units.map((u) => formatResultUnit(u))).toEqual(['6-5 (7-5)']);
  });

  it('a set won without a tie-break has no brackets', () => {
    const { state } = foldRally(women, pts(games('AAAAA')), 'A');
    expect(setResultUnits(women, state)!.map((u) => formatResultUnit(u))).toEqual(['5-0']);
  });

  it('formats without sets are left to the game scores', () => {
    const { state } = foldRally(presetByKey('bwf_official_3x21')!, pts('A'.repeat(42)), 'A');
    expect(setResultUnits(presetByKey('bwf_official_3x21')!, state)).toBeNull();
  });
});

describe('set-based results after a retirement', () => {
  const women = presetByKey('iim_women_set5_tb7')!;
  const retireAfter = (seq: string, winner: 'A' | 'B'): RallyEvent[] => [...pts(seq), { t: 'end', outcome: 'win', reason: 'retired', winner }];

  it('the open set is completed for the winner, matching the headline (5-1, not 2-1)', () => {
    const { state } = foldRally(women, retireAfter('AAAABBBBAAAABB', 'A'), 'A');
    expect(setResultUnits(women, state)!.map((u) => formatResultUnit(u))).toEqual(['5-1']);
  });

  it('a best-of-3 retirement adds the unplayed set', () => {
    const bo3 = presetByKey('iim_women_set5_tb7_bo3')!;
    const { state } = foldRally(bo3, retireAfter(games('AAAAA') + 'BBBB', 'A'), 'A');
    expect(setResultUnits(bo3, state)!.map((u) => formatResultUnit(u))).toEqual(['5-0', '5-1']);
  });
});
