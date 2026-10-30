import { describe, expect, it } from 'vitest';
import { foldRally, type RallyEvent } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { shootoutState, tieProgress } from './tie-break.js';
import type { Side } from './scoring-rules.js';

const goal = (side: Side): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'goal' });
const half: RallyEvent = { t: 'endPeriod' };
const kick = (side: Side, scored: boolean): RallyEvent => ({ t: 'penaltyKick', side, scored });

// Sheet FU02: Inter-IIM futsal - two halves of 10, knockouts straight to 3 kicks.
describe('futsal presets', () => {
  it('groups: two halves of 10, a level game is a draw', () => {
    const f = presetByKey('futsal_2x10')!;
    expect(f.clock?.minutes).toBe(20);
    expect(foldRally(f, [goal('A'), goal('B'), half, half]).state).toMatchObject({ ended: true, outcome: 'draw' });
  });

  it('knockout: level after two halves goes straight to a 3-kick shoot-out', () => {
    const f = presetByKey('futsal_ko_2x10')!;
    const st = foldRally(f, [goal('A'), goal('B'), half, half]).state;
    expect(st.ended).toBe(false);
    expect(tieProgress(f, st, [1, 1]).phase).toBe('penalties');
    expect(f.tieBreak?.penalties?.kicks).toBe(3);
  });
});

// Sheet FU01: the toss decides who kicks first.
describe('shoot-out order', () => {
  it('home kicks first unless the toss says otherwise', () => {
    expect(shootoutState([], 3)).toMatchObject({ first: 'A', next: 'A' });
    const away = [{ t: 'shootoutFirst', side: 'B' } as RallyEvent];
    expect(shootoutState(away, 3)).toMatchObject({ first: 'B', next: 'B' });
    expect(shootoutState([...away, kick('B', true)], 3).next).toBe('A');
    expect(shootoutState([...away, kick('B', true), kick('A', false)], 3).next).toBe('B');
  });

  it('a toss recorded after the first kick changes nothing', () => {
    const log = [kick('A', true), { t: 'shootoutFirst', side: 'B' } as RallyEvent];
    expect(shootoutState(log, 3)).toMatchObject({ first: 'A', next: 'B' });
  });

  it('with the away side first, an unassailable lead still ends it early', () => {
    // B scores 3 of 3, A misses its first two: A cannot catch up.
    const log = [{ t: 'shootoutFirst', side: 'B' } as RallyEvent, kick('B', true), kick('A', false), kick('B', true), kick('A', false), kick('B', true)];
    expect(shootoutState(log, 3)).toMatchObject({ decided: true, winner: 'B' });
  });
});

// Sheet FB03: goal minutes run on across halves, as a scoresheet cites them.
describe('match minutes', () => {
  const at = (clockMs: number, kind = 'goal'): RallyEvent => ({ t: 'point', side: 'A', pts: 1, kind, clockMs } as RallyEvent);
  const end: RallyEvent = { t: 'endPeriod' };

  it('the second half carries on from the first, stoppage reads N+x', async () => {
    const { eventMinuteLabels } = await import('./match-clock.js');
    const f = presetByKey('fest_2x10')!; // two halves of 10
    const labels = eventMinuteLabels(f, [at(30_000), at(10 * 60_000 + 90_000), end, at(4 * 60_000 + 1), end]);
    expect(labels).toEqual(["1'", "10+2'", null, "15'", null]);
  });

  it('extra time follows regulation at its own length', async () => {
    const { eventMinuteLabels } = await import('./match-clock.js');
    const f = presetByKey('knockout_2x45_no_draw')!; // 2 x 45, extra 2 x 15
    const labels = eventMinuteLabels(f, [end, end, at(60_000), end, at(14 * 60_000)]);
    expect(labels.filter(Boolean)).toEqual(["92'", "120'"]);
  });

  it('an event with no clock time has no minute', async () => {
    const { eventMinuteLabels } = await import('./match-clock.js');
    expect(eventMinuteLabels(presetByKey('fest_2x10')!, [{ t: 'point', side: 'A', pts: 1 } as RallyEvent])).toEqual([null]);
  });
});

// Sheet FB05: Inter-IIM nine-a-side football.
describe('nine-a-side football presets', () => {
  const levelAfter = (f: ReturnType<typeof presetByKey>) => foldRally(f!, [goal('A'), goal('B'), half, half]).state;

  it('groups: 2 x 20, a level game is a draw, 9 playing and 7 substitutes', async () => {
    const { usualSide } = await import('./team-sheet.js');
    const f = presetByKey('football9_2x20')!;
    expect(f.clock?.minutes).toBe(40);
    expect(levelAfter(f)).toMatchObject({ ended: true, outcome: 'draw' });
    expect(usualSide('football', f.rulesSheet)).toEqual({ onField: 9, bench: 7 });
  });

  it('knockout and final: extra time 10 + 10, then penalties', () => {
    for (const [key, minutes] of [['football9_ko_2x20', 40], ['football9_final_2x30', 60]] as const) {
      const f = presetByKey(key)!;
      expect(f.clock?.minutes).toBe(minutes);
      const st = levelAfter(f);
      expect(tieProgress(f, st, [1, 1])).toMatchObject({ phase: 'extraTime', periodMs: 10 * 60_000 });
      expect(tieProgress(f, foldRally(f, [goal('A'), goal('B'), half, half, half, half]).state, [1, 1]).phase).toBe('penalties');
    }
  });
});
