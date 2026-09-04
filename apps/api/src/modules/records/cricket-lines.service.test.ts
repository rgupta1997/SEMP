import { describe, expect, it } from 'vitest';
import { readCricketFormat, readCricketLog, readCricketSummary } from './cricket-lines.service.js';

// The writers are exercised against the real schema separately (they are almost all
// SQL). What is worth pinning here are the three READERS, because each one decides a
// branch that changes what gets written - and each has a failure mode that would be
// silent.

describe('reading the ball log', () => {
  it('takes a well-formed log', () => {
    const log = readCricketLog({ cricket: [{ t: 'ball', runs: 4 }, { t: 'setBowler', bowlerId: 'b1' }] });
    expect(log).toHaveLength(2);
  });

  it('survives a hand-edited live_state rather than throwing at lock time', () => {
    // A lock must not fail because somebody put something odd in a jsonb column.
    expect(readCricketLog(null)).toEqual([]);
    expect(readCricketLog({})).toEqual([]);
    expect(readCricketLog({ cricket: 'nonsense' })).toEqual([]);
    expect(readCricketLog({ cricket: [null, 42, 'x', { noType: true }, { t: 'ball', runs: 1 }] }))
      .toEqual([{ t: 'ball', runs: 1 }]);
  });
});

describe('reading the format', () => {
  it('prefers the frozen snapshot, so a played match stays reproducible', () => {
    const f = readCricketFormat({ format: { presetKey: 'cricket_super_over' } }, 'cricket');
    expect(f?.oversPerInnings).toBe(1);
  });

  it('falls back to the sport default when nothing was frozen', () => {
    expect(readCricketFormat(null, 'cricket')?.presetKey).toBe('cricket_t20');
    expect(readCricketFormat({}, 'box cricket')?.oversPerInnings).toBe(6);
  });

  it('treats an unusable snapshot as absent rather than resolving it wrong', () => {
    const f = readCricketFormat({ format: { kind: 'cricket', garbage: true } }, 'cricket');
    expect(f?.presetKey).toBe('cricket_t20');
  });
});

describe('reading a summary-entered scorecard', () => {
  it('takes the totals the manual form records', () => {
    const s = readCricketSummary({ runsA: 142, wktA: 7, ballsA: 90, runsB: 138, wktB: 10, ballsB: 88 });
    expect(s).toEqual({ runsA: 142, wktA: 7, ballsA: 90, runsB: 138, wktB: 10, ballsB: 88 });
  });

  it('refuses a state carrying no runs at all', () => {
    // THE important case. Without it an untouched fixture would write two 0/0
    // innings, which reads as a scored 0-0 draw - the exact phantom-draw bug that
    // reached the standings once already.
    expect(readCricketSummary(null)).toBeNull();
    expect(readCricketSummary({})).toBeNull();
    expect(readCricketSummary({ rally: [] })).toBeNull();
  });

  it('accepts a genuine nought and a one-sided entry', () => {
    // A side really can be bowled out for nought, and a match can be part-entered.
    expect(readCricketSummary({ runsA: 0, wktA: 10, ballsA: 42 })).toMatchObject({ runsA: 0, wktA: 10, runsB: 0 });
    expect(readCricketSummary({ runsB: 88 })).toMatchObject({ runsA: 0, runsB: 88 });
  });

  it('never passes a negative or a fraction to a checked column', () => {
    // Every one of these columns carries `check (x >= 0)`, so a bad value would
    // abort the insert and take the lock down with it.
    const s = readCricketSummary({ runsA: -5, wktA: 2.7, ballsA: -1, runsB: 10.4 })!;
    expect(s.runsA).toBe(0);
    expect(s.wktA).toBe(2);
    expect(s.ballsA).toBe(0);
    expect(s.runsB).toBe(10);
  });

  it('ignores a non-numeric value rather than storing NaN', () => {
    const s = readCricketSummary({ runsA: 40, wktA: 'three' as never, ballsA: null as never })!;
    expect(s.wktA).toBe(0);
    expect(s.ballsA).toBe(0);
  });
});
