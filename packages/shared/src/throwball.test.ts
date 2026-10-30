import { describe, expect, it } from 'vitest';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { readKnobs } from './format-knobs.js';
import type { Side } from './scoring-rules.js';

const points = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side } as RallyEvent));

// Sheet TB01: Inter-IIM throwball, best of 3 with every set to 25.
describe('best of 3 sets to 25', () => {
  const f = presetByKey('tb_bo3_25_all')!;

  it('has no different deciding set', () => {
    expect(f.levels[0]).toMatchObject({ target: 25, winBy: 2 });
    expect(f.levels[0].deciderOverride).toBeUndefined();
    expect(readKnobs(f)).toMatchObject({ unitsToWin: 2, target: 25, deciderEnabled: false });
  });

  it('the third set also goes to 25, not 15', () => {
    const oneAll = [...points('A', 25), ...points('B', 25)];
    const at15 = foldRally(f, [...oneAll, ...points('A', 15)]).state;
    expect(at15.ended).toBe(false);
    expect(foldRally(f, [...oneAll, ...points('A', 25)]).state).toMatchObject({ ended: true, winner: 'A' });
  });
});

// Sheet VB01: Inter-IIM volleyball league (and every women's match), all sets to 25.
describe('volleyball best of 3 sets to 25', () => {
  const f = presetByKey('vb_bo3_25_all')!;

  it('has no shorter deciding set, and changes ends at 13 in the third', () => {
    expect(f.levels[0]).toMatchObject({ target: 25, winBy: 2, switchEndsAt: 13 });
    expect(f.levels[0].deciderOverride).toBeUndefined();
    expect(readKnobs(f)).toMatchObject({ unitsToWin: 2, target: 25, deciderEnabled: false });
  });

  it('the third set goes to 25', () => {
    const oneAll = [...points('A', 25), ...points('B', 25)];
    expect(foldRally(f, [...oneAll, ...points('A', 15)]).state.ended).toBe(false);
    expect(foldRally(f, [...oneAll, ...points('A', 25)]).state).toMatchObject({ ended: true, winner: 'A' });
  });

  it('the men\u2019s final keeps the FIVB best of 5 with a 15-point fifth set', () => {
    const fin = presetByKey('fivb_25_bo5')!;
    expect(readKnobs(fin)).toMatchObject({ unitsToWin: 3, target: 25, deciderEnabled: true, deciderTarget: 15 });
  });
});

// Sheet SQ02: Inter-IIM squash - PARS 11, 2 clear from 10-10, first to 21 if nobody gets clear.
describe('squash Inter-IIM preset', () => {
  const f = presetByKey('iim_pars11_bo3_cap21')!;
  const alternate = (n: number) => Array.from({ length: n }, () => [...points('A', 1), ...points('B', 1)]).flat();

  it('is best of 3 games to 11, win by 2, ceiling 21', () => {
    expect(readKnobs(f)).toMatchObject({ unitsToWin: 2, target: 11, winBy: 2, capEnabled: true, cap: 21 });
  });

  it('12-10 wins a game; level at 20-20 the next point wins at 21', () => {
    const st1 = foldRally(f, [...alternate(10), ...points('A', 2)]).state;
    expect(st1.score[1]).toEqual([1, 0]);
    const st2 = foldRally(f, [...alternate(20), ...points('B', 1)]).state;
    expect(st2.score[1]).toEqual([0, 1]);
  });
});
