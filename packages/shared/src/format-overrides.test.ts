import { describe, expect, it } from 'vitest';
import {
  applyOverrides, inheritedOverrides, isEmptyOverrides, parseOverrides,
} from './format-overrides.js';
import { presetByKey } from './racquet-presets.js';
import { scoringFormatSchema } from './scoring-rules.js';
import { tieProgress } from './tie-break.js';
import { foldRally } from './rally-kernel.js';
import type { RallyLog } from './rally-kernel.js';

const fmt = (k: string) => presetByKey(k)!;

describe('reading overrides off a column', () => {
  it('treats absent, empty and junk alike - the match just inherits', () => {
    expect(parseOverrides(null)).toBeNull();
    expect(parseOverrides({})).toBeNull();
    expect(parseOverrides([])).toBeNull();
    expect(parseOverrides('12 minutes')).toBeNull();
    expect(parseOverrides({ periodMinutes: 'twelve' })).toBeNull();
  });

  it('keeps the fields it understands', () => {
    expect(parseOverrides({ periodMinutes: 12, drawsAllowed: false }))
      .toEqual({ periodMinutes: 12, drawsAllowed: false });
  });

  // `false` is a real answer and `undefined` is "inherit" - collapsing the two is
  // how a knockout silently becomes drawable.
  it('does not mistake drawsAllowed:false for nothing set', () => {
    expect(isEmptyOverrides({ drawsAllowed: false })).toBe(false);
    expect(parseOverrides({ drawsAllowed: false })).toEqual({ drawsAllowed: false });
  });
});

describe('patching a resolved format', () => {
  const ko = fmt('fest_2x10_ko');

  it('returns the very same object when there is nothing to apply', () => {
    expect(applyOverrides(ko, null)).toBe(ko);
    expect(applyOverrides(ko, {})).toBe(ko);
  });

  // The stored number is the WHOLE MATCH; the organiser types one period. Getting
  // this backwards gives a two-half match a five-minute total.
  it('multiplies a per-period length back out to the match total', () => {
    const longer = applyOverrides(ko, { periodMinutes: 12 });
    expect(longer.clock?.minutes).toBe(24);
    expect(ko.clock?.minutes).toBe(20);            // the original is untouched
  });

  it('gives a clock to a format that had none rather than ignoring the request', () => {
    const untimed = { ...ko, clock: null };
    const timed = applyOverrides(untimed, { periodMinutes: 9 });
    expect(timed.clock?.minutes).toBe(18);
  });

  it('changes the length of extra time and keeps its period count', () => {
    const patched = applyOverrides(ko, { extraTimeMinutes: 7 });
    expect(patched.tieBreak?.extraTime).toEqual({ periods: 2, minutes: 7 });
    expect(patched.tieBreak?.penalties).toEqual({ kicks: 5 });
  });

  it('adds extra time to a format that declared none, defaulting to two periods', () => {
    const league = fmt('fifa_2x45');
    const patched = applyOverrides({ ...league, tieBreak: null }, { extraTimeMinutes: 4 });
    expect(patched.tieBreak?.extraTime).toEqual({ periods: 2, minutes: 4 });
  });

  it('turns draws on and off', () => {
    expect(applyOverrides(ko, { drawsAllowed: true }).endStates.drawsAllowed).toBe(true);
    const league = fmt('fifa_2x45');
    expect(applyOverrides(league, { drawsAllowed: false }).endStates.drawsAllowed).toBe(false);
  });

  it('applies several at once without one clobbering another', () => {
    const patched = applyOverrides(ko, { periodMinutes: 15, extraTimeMinutes: 6, drawsAllowed: true });
    expect(patched.clock?.minutes).toBe(30);
    expect(patched.tieBreak?.extraTime?.minutes).toBe(6);
    expect(patched.endStates.drawsAllowed).toBe(true);
  });

  it('still validates, so a patched format can be frozen into live_state', () => {
    const patched = applyOverrides(ko, { periodMinutes: 12, extraTimeMinutes: 6, drawsAllowed: false });
    expect(() => scoringFormatSchema.parse(patched)).not.toThrow();
  });
});

describe('what the patched format actually does to a match', () => {
  const ko = fmt('fest_2x10_ko');
  const endHalf = { t: 'endPeriod' } as RallyLog[number];
  const goal = (side: 'A' | 'B') => ({ t: 'point', side, pts: 1, kind: 'goal' } as RallyLog[number]);

  it('a 12-minute override really gives the console 12-minute halves', () => {
    const patched = applyOverrides(ko, { periodMinutes: 12 });
    const fresh = foldRally(patched, [], 'A').state;
    expect(tieProgress(patched, fresh, [0, 0]).periodMs).toBe(12 * 60_000);
  });

  it('a 6-minute override really gives it 6-minute extra halves', () => {
    const patched = applyOverrides(ko, { extraTimeMinutes: 6 });
    const level: RallyLog = [goal('A'), goal('B'), endHalf, endHalf];
    const st = foldRally(patched, level, 'A').state;
    const p = tieProgress(patched, st, [1, 1]);
    expect(p.phase).toBe('extraTime');
    expect(p.periodMs).toBe(6 * 60_000);
  });

  // Allowing a draw on one knockout fixture must actually stop the chain, not just
  // relabel it - otherwise the console still marches into penalties.
  it('allowing a draw closes a level match instead of going to extra time', () => {
    const patched = applyOverrides(ko, { drawsAllowed: true });
    const level: RallyLog = [goal('A'), goal('B'), endHalf, endHalf];
    const st = foldRally(patched, level, 'A').state;
    expect(st.ended).toBe(true);
    expect(st.outcome).toBe('draw');
    expect(tieProgress(patched, st, [1, 1]).phase).toBe('done');
  });

  /**
   * Forbidding a draw on a format that declares no tie-break does NOT invent one.
   *
   * The match is simply left open for an organiser to settle - the behaviour that
   * existed before any of this, and the honest one: nobody asked for extra time, so
   * conjuring five minutes of it out of a single yes/no would be the console
   * deciding the rules of the competition on its own.
   */
  it('forbidding a draw leaves a chainless format open rather than inventing extra time', () => {
    const league = fmt('fifa_2x45');
    const patched = applyOverrides(league, { drawsAllowed: false });
    const level: RallyLog = [goal('A'), goal('B'), endHalf, endHalf];
    const st = foldRally(patched, level, 'A').state;
    expect(st.ended).toBe(false);
    expect(st.winner).toBeNull();
    expect(tieProgress(patched, st, [1, 1]).phase).toBe('regulation');
  });

  it('but set extra time alongside it and the chain runs', () => {
    const league = fmt('fifa_2x45');
    const patched = applyOverrides(league, { drawsAllowed: false, extraTimeMinutes: 4 });
    const level: RallyLog = [goal('A'), goal('B'), endHalf, endHalf];
    const st = foldRally(patched, level, 'A').state;
    const p = tieProgress(patched, st, [1, 1]);
    expect(p.phase).toBe('extraTime');
    expect(p.periodMs).toBe(4 * 60_000);
  });
});

describe('what the blank fields should say they will do', () => {
  it('reports the inherited answers, per period', () => {
    expect(inheritedOverrides(fmt('fest_2x10_ko'))).toEqual({
      periodMinutes: 10,            // 20 whole-match over 2 halves
      extraTimeMinutes: 5,
      drawsAllowed: false,
    });
    expect(inheritedOverrides(fmt('fifa_2x45'))).toMatchObject({
      periodMinutes: 45,
      drawsAllowed: true,
    });
  });

  it('says 0 extra minutes where a format declares no extra time', () => {
    expect(inheritedOverrides(fmt('fifa_2x45'))?.extraTimeMinutes).toBe(0);
  });

  it('has nothing to report without a format', () => {
    expect(inheritedOverrides(null)).toBeNull();
  });
});
