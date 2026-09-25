import { describe, expect, it } from 'vitest';
import { clockReading, currentPeriodEvents, formatClock, matchMinute, minuteLabel } from './match-clock.js';
import type { RallyLog } from './rally-kernel.js';

const T0 = Date.parse('2026-09-25T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const FULL = 45 * 60 * 1000;

describe('the match clock is read off the log', () => {
  it('reads zero, stopped and unstarted before the whistle', () => {
    const r = clockReading([], FULL, T0);
    expect(r).toMatchObject({ elapsedMs: 0, running: false, started: false, overrun: false });
  });

  it('runs from the instant of the start, not from when it is read', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }];
    expect(clockReading(log, FULL, T0 + 90_000).elapsedMs).toBe(90_000);
    expect(clockReading(log, FULL, T0 + 90_000).running).toBe(true);
  });

  it('banks the time run when paused, and stops moving', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }, { t: 'clockPause', at: at(60) }];
    // Read a long time later: a paused clock still reads one minute.
    expect(clockReading(log, FULL, T0 + 600_000).elapsedMs).toBe(60_000);
    expect(clockReading(log, FULL, T0 + 600_000).running).toBe(false);
  });

  it('adds the pieces back together across several stoppages', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) }, { t: 'clockPause', at: at(60) },
      { t: 'clockStart', at: at(100) }, { t: 'clockPause', at: at(130) },
    ];
    expect(clockReading(log, FULL, T0 + 900_000).elapsedMs).toBe(90_000);
  });

  /**
   * THE RELOAD. This is the whole reason the clock is events and not a field: the
   * reading is a function of the log and the wall clock, so a browser that has just
   * started up computes exactly what the one that recorded it would have shown.
   */
  it('survives a reload - the same log read fresh gives the same time', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }];
    const live = clockReading(log, FULL, T0 + 700_000);
    const reloaded = clockReading(JSON.parse(JSON.stringify(log)), FULL, T0 + 700_000);
    expect(reloaded).toEqual(live);
  });

  it('ignores a double start - the official tapped twice, the first one counts', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }, { t: 'clockStart', at: at(30) }];
    expect(clockReading(log, FULL, T0 + 60_000).elapsedMs).toBe(60_000);
  });

  it('ignores a pause that was never running', () => {
    const log: RallyLog = [{ t: 'clockPause', at: at(10) }];
    expect(clockReading(log, FULL, T0 + 60_000).elapsedMs).toBe(0);
  });
});

describe('an official correcting the clock', () => {
  it('REPLACES the time run, it does not add to it', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) }, { t: 'clockPause', at: at(600) },   // 10:00
      { t: 'clockAdjust', toMs: 8 * 60_000, at: at(601) },                 // "no, 8:00"
    ];
    expect(clockReading(log, FULL, T0 + 900_000).elapsedMs).toBe(8 * 60_000);
  });

  it('keeps running from the corrected value when the clock was not stopped', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) },
      { t: 'clockAdjust', toMs: 8 * 60_000, at: at(600) },
    ];
    // 8:00 at the moment of the fix, plus the 30s that have run since.
    expect(clockReading(log, FULL, T0 + 630_000).elapsedMs).toBe(8 * 60_000 + 30_000);
    expect(clockReading(log, FULL, T0 + 630_000).running).toBe(true);
  });

  it('can rescue a clock nobody started - the commonest mistake', () => {
    const log: RallyLog = [{ t: 'clockAdjust', toMs: 12 * 60_000, at: at(720) }];
    const r = clockReading(log, FULL, T0 + 720_000);
    expect(r).toMatchObject({ elapsedMs: 12 * 60_000, running: false, started: true });
  });

  // The console stamps the adjust event a beat AFTER it samples the wall clock, so
  // the reading can be asked for an instant that predates the correction. It must
  // still read 21:00, never 20:59 - a clock that ticks backwards is worse than one
  // that is wrong.
  it('never reads backwards when the correction is a hair ahead of the reading', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) },
      { t: 'clockAdjust', toMs: 21 * 60_000, at: at(600) },
    ];
    // Read 3ms BEFORE the adjustment's own timestamp.
    expect(clockReading(log, FULL, T0 + 600_000 - 3).elapsedMs).toBe(21 * 60_000);
    expect(formatClock(clockReading(log, FULL, T0 + 600_000 - 3).elapsedMs)).toBe('21:00');
  });

  it('will not be pushed below zero', () => {
    const log: RallyLog = [{ t: 'clockAdjust', toMs: -5000, at: at(10) }];
    expect(clockReading(log, FULL, T0 + 10_000).elapsedMs).toBe(0);
  });
});

describe('periods', () => {
  it('starts the second half at 0:00, not where the first one stopped', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) }, { t: 'clockPause', at: at(2700) },
      { t: 'endPeriod', at: at(2700) },
    ];
    expect(clockReading(log, FULL, T0 + 3000_000).elapsedMs).toBe(0);
    expect(clockReading(log, FULL, T0 + 3000_000).started).toBe(false);
  });

  it('scopes the reading to the events after the last whistle', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) }, { t: 'endPeriod', at: at(2700) },
      { t: 'clockStart', at: at(3000) },
    ];
    expect(currentPeriodEvents(log)).toHaveLength(1);
    expect(clockReading(log, FULL, T0 + 3060_000).elapsedMs).toBe(60_000);
  });

  it('counts past full time into stoppage rather than stopping dead', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }];
    const r = clockReading(log, FULL, T0 + FULL + 133_000);
    expect(r.overrun).toBe(true);
    expect(r.stoppageMs).toBe(133_000);
    expect(r.elapsedMs).toBe(FULL + 133_000);
  });

  it('never claims overrun on an untimed format', () => {
    const log: RallyLog = [{ t: 'clockStart', at: at(0) }];
    expect(clockReading(log, 0, T0 + 9_000_000).overrun).toBe(false);
  });

  it('is unmoved by the scoring events sharing the log', () => {
    const log: RallyLog = [
      { t: 'clockStart', at: at(0) },
      { t: 'point', side: 'A', pts: 1, kind: 'goal', at: at(30) },
      { t: 'point', side: 'B', pts: 1, kind: 'goal', at: at(90) },
    ];
    expect(clockReading(log, FULL, T0 + 120_000).elapsedMs).toBe(120_000);
  });
});

describe('how a time is written down', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(62_000)).toBe('1:02');
    expect(formatClock(45 * 60_000)).toBe('45:00');
  });

  // Football counts the first sixty seconds as the 1st minute - a goal at 0:30 is
  // a 1st-minute goal, and there is no 0th minute on any scoresheet.
  it('cites the minute the way a scoresheet does', () => {
    expect(matchMinute(0)).toBe(1);
    expect(matchMinute(59_000)).toBe(1);
    expect(matchMinute(60_000)).toBe(2);
    expect(matchMinute(22 * 60_000 + 30_000)).toBe(23);
  });

  it('writes stoppage as 45+2, not 47', () => {
    expect(minuteLabel(23 * 60_000, FULL)).toBe("24'");
    expect(minuteLabel(FULL, FULL)).toBe("45+1'");
    expect(minuteLabel(FULL + 90_000, FULL)).toBe("45+2'");
  });
});
