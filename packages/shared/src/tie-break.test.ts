import { describe, expect, it } from 'vitest';
import { shootoutState, shootoutLine, tieProgress } from './tie-break.js';
import { foldRally } from './rally-kernel.js';
import { presetsFor, defaultFormatFor } from './racquet-presets.js';
import type { RallyLog } from './rally-kernel.js';
import type { Side } from './scoring-rules.js';

const kick = (side: Side, scored: boolean): RallyLog[number] => ({ t: 'penaltyKick', side, scored });
/** Alternating kicks from a compact string: 'XO' = A scored, B missed. */
const run = (s: string): RallyLog =>
  [...s].map((c, i) => kick(i % 2 === 0 ? 'A' : 'B', c === 'X'));

describe('the shoot-out alternates', () => {
  it('starts with A and alternates', () => {
    expect(shootoutState([], 5).next).toBe('A');
    expect(shootoutState(run('X'), 5).next).toBe('B');
    expect(shootoutState(run('XO'), 5).next).toBe('A');
  });

  // After an undo the next kicker must follow from the COUNT, not from whoever
  // happened to kick last before the removed one.
  it('recovers the right kicker after an undo', () => {
    const log = run('XOX');
    expect(shootoutState(log, 5).next).toBe('B');
    expect(shootoutState(log.slice(0, -1), 5).next).toBe('A');
  });

  it('tallies scored and taken per side', () => {
    const st = shootoutState(run('XXOX'), 5);
    expect(st.scored).toEqual([1, 2]);
    expect(st.taken).toEqual([2, 2]);
  });
});

describe('a shoot-out stops the moment it is decided', () => {
  // The rule most often got wrong: all ten kicks are NOT taken.
  it('ends early when the lead cannot be caught', () => {
    // A 3/3, B 0/3 with two kicks left: 3 > 0 + 2, so the last pair is never taken.
    const st = shootoutState(run('XOXOXO'), 5);
    expect(st.decided).toBe(true);
    expect(st.winner).toBe('A');
    expect(st.clinchedBy).toBe('A');
  });

  it('does not call it early while the trailing side can still catch up', () => {
    // A 3/3, B 0/2 looks decisive and is NOT: B has three kicks left, so 3 is not
    // more than 0 + 3. One kick earlier than the case above, and still live.
    const st = shootoutState(run('XOXOX'), 5);
    expect(st.decided).toBe(false);
    expect(st.winner).toBeNull();
  });

  it('decides on the opening round when both have taken five', () => {
    // A five from five, B four from five - and crucially not decided before the
    // final kick, so the whole round is genuinely played.
    const st = shootoutState(run('XXXXXXXXXO'), 5);
    expect(st.taken).toEqual([5, 5]);
    expect(st.scored).toEqual([5, 4]);
    expect(st.decided).toBe(true);
    expect(st.winner).toBe('A');
  });

  it('goes to sudden death when the opening round is level', () => {
    const st = shootoutState(run('XXXXOOXXOO'), 5);
    expect(st.scored).toEqual([3, 3]);
    expect(st.suddenDeath).toBe(true);
    expect(st.decided).toBe(false);
    expect(st.next).toBe('A');
  });

  it('does not end sudden death on a single kick - the pair must be split', () => {
    const level = run('XXXXOOXXOO');
    const afterA = shootoutState([...level, kick('A', true)], 5);
    expect(afterA.decided).toBe(false);   // B has not had their kick
    expect(afterA.next).toBe('B');

    const split = shootoutState([...level, kick('A', true), kick('B', false)], 5);
    expect(split.decided).toBe(true);
    expect(split.winner).toBe('A');
  });

  it('carries on when a sudden-death pair both score', () => {
    const level = run('XXXXOOXXOO');
    const st = shootoutState([...level, kick('A', true), kick('B', true)], 5);
    expect(st.decided).toBe(false);
    expect(st.suddenDeath).toBe(true);
  });

  it('writes the scoresheet line', () => {
    const st = shootoutState(run('XXXXXXXXXO'), 5);
    expect(shootoutLine(st, (x) => (x === 'A' ? 'Ashoka' : 'Rivera')))
      .toBe('Ashoka won 5–4 on penalties');
  });

  it('ignores the scoring events sharing the log', () => {
    const log: RallyLog = [
      { t: 'point', side: 'A', pts: 1, kind: 'goal' },
      ...run('XOX'),
    ];
    expect(shootoutState(log, 5).taken).toEqual([2, 1]);
  });
});

describe('the phases of a level knockout', () => {
  const fest = presetsFor('football').find((f) => f.presetKey === 'fest_2x10_ko')!;
  const endHalf = { t: 'endPeriod' } as RallyLog[number];
  const goal = (side: Side) => ({ t: 'point', side, pts: 1, kind: 'goal' } as RallyLog[number]);

  it('defaults football to the 10-minute fest format', () => {
    const def = defaultFormatFor('football');
    expect(def?.presetKey).toBe('fest_2x10');
    expect(def?.clock?.minutes).toBe(20);              // 2 halves x 10
  });

  // THE DEFAULT MUST STILL BE DRAWABLE. A no-draw default would send every group
  // match of every fest to penalties, which is the opposite of what a group stage
  // is for - so the chain lives on the KNOCKOUT format, and the default carries it
  // inert.
  it('lets the default draw, and keeps the chain on the knockout format', () => {
    const def = defaultFormatFor('football')!;
    expect(def.endStates.drawsAllowed).toBe(true);
    expect(fest.endStates.drawsAllowed).toBe(false);
    expect(fest.clock?.minutes).toBe(20);
    expect(fest.tieBreak?.extraTime).toEqual({ periods: 2, minutes: 5 });
    expect(fest.tieBreak?.penalties).toEqual({ kicks: 5 });
  });

  it('never sends the drawable default to extra time', () => {
    const def = defaultFormatFor('football')!;
    const st = foldRally(def, [goal('A'), goal('B'), endHalf, endHalf], 'A').state;
    expect(st.ended).toBe(true);
    expect(st.outcome).toBe('draw');
    expect(tieProgress(def, st, [1, 1]).phase).toBe('done');
  });

  it('runs a 10-minute regulation half, then 5-minute extra halves', () => {
    const fresh = foldRally(fest, [], 'A').state;
    expect(tieProgress(fest, fresh, [0, 0]).periodMs).toBe(10 * 60_000);

    const levelAtFullTime: RallyLog = [goal('A'), goal('B'), endHalf, endHalf];
    const st = foldRally(fest, levelAtFullTime, 'A').state;
    const p = tieProgress(fest, st, [1, 1]);
    expect(p.phase).toBe('extraTime');
    expect(p.periodMs).toBe(5 * 60_000);
    expect(p.levelAfterRegulation).toBe(true);
  });

  it('stays in regulation while the halves are unplayed, level or not', () => {
    const st = foldRally(fest, [goal('A'), goal('B'), endHalf], 'A').state;
    expect(tieProgress(fest, st, [1, 1]).phase).toBe('regulation');
  });

  // The kernel must not award a level knockout - that is what leaves room for all
  // of this to happen at all.
  it('leaves a level knockout OPEN after regulation', () => {
    const st = foldRally(fest, [goal('A'), goal('B'), endHalf, endHalf], 'A').state;
    expect(st.ended).toBe(false);
    expect(st.winner).toBeNull();
  });

  it('ends the match outright when extra time is won', () => {
    const log: RallyLog = [goal('A'), goal('B'), endHalf, endHalf, goal('A'), endHalf, endHalf];
    const st = foldRally(fest, log, 'A').state;
    expect(st.ended).toBe(true);
    expect(st.winner).toBe('A');
    expect(tieProgress(fest, st, [2, 1]).phase).toBe('done');
  });

  it('reaches penalties only once both extra halves are played out', () => {
    const afterOne: RallyLog = [goal('A'), goal('B'), endHalf, endHalf, endHalf];
    const one = foldRally(fest, afterOne, 'A').state;
    expect(tieProgress(fest, one, [1, 1]).phase).toBe('extraTime');
    expect(tieProgress(fest, one, [1, 1]).extraPlayed).toBe(1);

    const afterBoth: RallyLog = [...afterOne, endHalf];
    const both = foldRally(fest, afterBoth, 'A').state;
    expect(tieProgress(fest, both, [1, 1]).phase).toBe('penalties');
  });

  it('never leaves a drawable league match looking for a tie-break', () => {
    const league = presetsFor('football').find((f) => f.presetKey === 'fifa_2x45')!;
    const st = foldRally(league, [{ t: 'endPeriod' }, { t: 'endPeriod' }], 'A').state;
    expect(st.ended).toBe(true);
    expect(st.outcome).toBe('draw');
    expect(tieProgress(league, st, [0, 0]).phase).toBe('done');
  });
});
