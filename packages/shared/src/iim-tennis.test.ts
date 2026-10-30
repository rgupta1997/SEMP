import { describe, expect, it } from 'vitest';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { tieLayoutsFor } from './tie-templates.js';
import type { Side } from './scoring-rules.js';

const pts = (side: Side, n: number): RallyEvent[] => Array.from({ length: n }, () => ({ t: 'point', side } as RallyEvent));
// Love games: 4 points each.
const games = (side: Side, n: number): RallyEvent[] => pts(side, 4 * n);
const alt = (n: number): RallyEvent[] => Array.from({ length: n }, () => [...games('A', 1), ...games('B', 1)]).flat();
const play = (key: string, log: RallyEvent[]) => foldRally(presetByKey(key)!, log, 'A').state;

// Sheet TE01: Inter-IIM tennis.
describe('Inter-IIM men: one set to 6, 10-point tie-break at 6-6', () => {
  it('6-4 wins the match; 5-5 needs two clear', () => {
    expect(play('iim_men_set6_tb10', [...alt(4), ...games('A', 2)])).toMatchObject({ ended: true, winner: 'A' });
    expect(play('iim_men_set6_tb10', [...alt(5), ...games('A', 1)]).ended).toBe(false);
    expect(play('iim_men_set6_tb10', [...alt(5), ...games('A', 2)])).toMatchObject({ ended: true, winner: 'A' });
  });

  it('6-6 goes to a tie-break to 10, won by 2', () => {
    const sixAll = alt(6);
    expect(play('iim_men_set6_tb10', [...sixAll, ...pts('A', 7)]).ended).toBe(false);
    expect(play('iim_men_set6_tb10', [...sixAll, ...pts('A', 10)])).toMatchObject({ ended: true, winner: 'A' });
  });

  it('advantage scoring: 40-40 needs two clear points', () => {
    const deuce = [...pts('A', 3), ...pts('B', 3), ...pts('A', 1)];
    expect(play('iim_men_set6_tb10', deuce).score[1]).toEqual([0, 0]);
    expect(play('iim_men_set6_tb10', [...deuce, ...pts('A', 1)]).score[1]).toEqual([1, 0]);
  });

  it('the best-of-3 version needs two sets', () => {
    expect(play('iim_men_set6_tb10_bo3', games('A', 6)).ended).toBe(false);
    expect(play('iim_men_set6_tb10_bo3', games('A', 12))).toMatchObject({ ended: true, winner: 'A' });
  });
});

describe('Inter-IIM women: one set to 5, 7-point tie-break at 5-5', () => {
  it('5-3 wins; 4-4 needs 6-4; 5-5 goes to a tie-break to 7', () => {
    expect(play('iim_women_set5_tb7', [...alt(3), ...games('A', 2)])).toMatchObject({ ended: true, winner: 'A' });
    expect(play('iim_women_set5_tb7', [...alt(4), ...games('A', 1)]).ended).toBe(false);
    expect(play('iim_women_set5_tb7', [...alt(4), ...games('A', 2)])).toMatchObject({ ended: true, winner: 'A' });
    expect(play('iim_women_set5_tb7', [...alt(5), ...pts('B', 6)]).ended).toBe(false);
    expect(play('iim_women_set5_tb7', [...alt(5), ...pts('B', 7)])).toMatchObject({ ended: true, winner: 'B' });
  });
});

// Sheet TE02: the Inter-IIM tennis tie orders.
describe('Inter-IIM tennis tie layouts', () => {
  it('men MS, MD, MS and women WS, WD, WS', () => {
    const layouts = tieLayoutsFor('Tennis');
    expect(layouts.find((l) => l.key === 'iim_men')!.rubbers.map((r) => [r.label, r.size]))
      .toEqual([["Men's Singles 1", 1], ["Men's Doubles", 2], ["Men's Singles 2", 1]]);
    expect(layouts.find((l) => l.key === 'iim_women')!.rubbers.map((r) => r.size)).toEqual([1, 2, 1]);
  });
});
