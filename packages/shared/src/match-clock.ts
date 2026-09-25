import type { RallyEvent, RallyLog } from './rally-kernel.js';

/**
 * THE MATCH CLOCK.
 *
 * Read off the log rather than held in a field, because a field would have to be a
 * running interval somewhere - and an interval lives in one browser tab. Close the
 * tab, reload the page, hand the phone to the other official, and a field-based
 * clock is gone or wrong. Three events and the wall clock reconstruct it anywhere,
 * on any device, at any time.
 *
 * The events are:
 *
 *   clockStart    the whistle - time begins running from this instant
 *   clockPause    time stops; everything run so far is banked
 *   clockAdjust   an official says the clock now reads `toMs`, whatever it read
 *                 before. Banked time is replaced, not added to.
 *
 * Everything is scoped to the CURRENT PERIOD: each `endPeriod` resets the clock to
 * zero, because a second half starts at 0:00 and not at 45:00. (The scoreboard adds
 * the periods back up where a sport wants a running match time; football does not.)
 */

export interface ClockReading {
  /** Milliseconds run in the current period. */
  elapsedMs: number;
  running: boolean;
  /** The period's full length in ms, from the format's clock - 0 when untimed. */
  fullMs: number;
  /** Past full time, i.e. into stoppage. */
  overrun: boolean;
  /** Milliseconds past full time, 0 before it. */
  stoppageMs: number;
  /** True once anything has started it - the console shows "Start" until then. */
  started: boolean;
}

const ms = (at?: string): number | null => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
};

/**
 * The events of the period in progress: everything after the last `endPeriod`.
 *
 * A half that has been whistled is finished, and its clock with it - reading the
 * whole log would have the second half start wherever the first one stopped.
 */
export function currentPeriodEvents(log: RallyLog): RallyEvent[] {
  let from = 0;
  log.forEach((ev, i) => { if (ev.t === 'endPeriod') from = i + 1; });
  return log.slice(from);
}

/**
 * Fold the clock events of the current period into a reading.
 *
 * `now` is injected so this is a pure function of its inputs - the tests drive it
 * with fixed instants, and the console passes Date.now() on every tick.
 */
export function clockReading(log: RallyLog, fullMs: number, now: number): ClockReading {
  let banked = 0;
  let runningSince: number | null = null;
  let started = false;

  for (const ev of currentPeriodEvents(log)) {
    if (ev.t === 'clockStart') {
      started = true;
      // A second start without a pause is not an error worth throwing over - the
      // official double-tapped. The first one is the one that counts.
      if (runningSince === null) runningSince = ms(ev.at) ?? now;
    } else if (ev.t === 'clockPause') {
      if (runningSince !== null) {
        banked += Math.max(0, (ms(ev.at) ?? now) - runningSince);
        runningSince = null;
      }
    } else if (ev.t === 'clockAdjust') {
      // A correction REPLACES the time run so far. If the clock is running it keeps
      // running, from the corrected value - so fixing a clock mid-half does not
      // require stopping it first.
      started = true;
      banked = Math.max(0, ev.toMs);
      if (runningSince !== null) runningSince = ms(ev.at) ?? now;
    }
  }

  // CLAMP THE RUNNING PART, not just the total.
  //
  // `now` and an event's `at` are read from the clock a few milliseconds apart, and
  // the console sets `now` fractionally BEFORE it stamps the event it is pushing -
  // so immediately after a correction `now - runningSince` is briefly negative and
  // a clock set to 21:00 renders 20:59. Clamping the whole sum would not catch it,
  // because `banked` is large and positive; the running term is the one that can go
  // backwards. A clock must never tick backwards, however briefly.
  const running = runningSince === null ? 0 : Math.max(0, now - runningSince);
  const elapsedMs = Math.max(0, banked + running);
  const overrun = fullMs > 0 && elapsedMs >= fullMs;
  return {
    elapsedMs,
    running: runningSince !== null,
    fullMs,
    overrun,
    stoppageMs: overrun ? elapsedMs - fullMs : 0,
    started,
  };
}

/** mm:ss, zero padded, for the scoreboard. */
export function formatClock(msElapsed: number): string {
  const total = Math.max(0, Math.floor(msElapsed / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The minute an event is cited as, the way football cites it: the first sixty
 * seconds are the 1st minute, so 0:30 is 1' and 45:00 is 46'. A minute is what goes
 * on a scoresheet; the milliseconds are only there so this can be computed.
 */
export function matchMinute(msElapsed: number): number {
  return Math.floor(Math.max(0, msElapsed) / 60000) + 1;
}

/** "23'", or "45+2'" once the period is into stoppage. */
export function minuteLabel(msElapsed: number, fullMs: number): string {
  if (fullMs > 0 && msElapsed >= fullMs) {
    const full = Math.floor(fullMs / 60000);
    const extra = matchMinute(msElapsed - fullMs);
    return `${full}+${extra}'`;
  }
  return `${matchMinute(msElapsed)}'`;
}
