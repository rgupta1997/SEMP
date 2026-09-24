import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRefetchCoalescer,
  NOTIFICATION_REFETCH_JITTER_MS,
} from './hooks.js';

// The behaviour that only misbehaves under load, which is the hardest kind to notice.
//
// A wide-audience notification pings every recipient's open tab at the same instant.
// Refetching immediately puts N simultaneous requests against an API throttled at
// 25 req/s with a burst of 50, so a single all-hands announcement 429s itself - and
// the bigger the audience, the more certainly it fails. Nothing about that shows up
// in manual testing with two browser tabs.
//
// `random` is injected so the spread can be asserted deterministically rather than
// hoped for; the default is Math.random.

let run: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  run = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a scheduled refetch does not fire immediately', () => {
  it('waits out the delay before running', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    c.schedule();

    // The whole point: nothing yet.
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never exceeds the configured window, across the whole random range', () => {
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 0.999]) {
      run.mockClear();
      const c = createRefetchCoalescer(run, 2_000, () => r);
      c.schedule();
      vi.advanceTimersByTime(2_000);
      expect(run, `r=${r}`).toHaveBeenCalledTimes(1);
    }
  });

  // The actual anti-stampede property: different tabs land at different times.
  it('spreads simultaneous tabs across the window instead of stacking them', () => {
    const firedAt: number[] = [];
    const start = Date.now();

    // 40 "tabs", each with its own random draw, all pinged in the same instant.
    for (let i = 0; i < 40; i++) {
      const r = i / 40;
      createRefetchCoalescer(
        () => firedAt.push(Date.now() - start),
        2_000,
        () => r,
      ).schedule();
    }

    vi.advanceTimersByTime(2_000);
    expect(firedAt).toHaveLength(40);

    // Bucketed into 200ms slices, they must occupy many slices rather than one.
    const slices = new Set(firedAt.map((t) => Math.floor(t / 200)));
    expect(slices.size).toBeGreaterThan(5);

    // And no single slice may hold most of them.
    const counts = new Map<number, number>();
    for (const t of firedAt) {
      const k = Math.floor(t / 200);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThan(firedAt.length / 2);
  });
});

describe('bursts coalesce', () => {
  it('collapses many pings in the window into one run', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    for (let i = 0; i < 10; i++) c.schedule();

    vi.advanceTimersByTime(2_000);

    // Ten pings, one refetch. The transport carries no payload, so a second
    // request would learn nothing the first did not.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not extend the delay when more pings arrive', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    c.schedule();

    vi.advanceTimersByTime(900);
    c.schedule(); // a debounce would restart the clock here; this must not
    vi.advanceTimersByTime(200);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('accepts a fresh ping once the previous run has fired', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);

    c.schedule();
    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(1);

    c.schedule();
    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('cancel', () => {
  it('stops a pending run - the unmount case', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    c.schedule();
    c.cancel();

    vi.advanceTimersByTime(10_000);

    // Running after unmount would refetch into a torn-down query client.
    expect(run).not.toHaveBeenCalled();
  });

  it('is safe with nothing pending, and safe twice', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    expect(() => { c.cancel(); c.cancel(); }).not.toThrow();
  });

  it('allows scheduling again after a cancel', () => {
    const c = createRefetchCoalescer(run, 2_000, () => 0.5);
    c.schedule();
    c.cancel();
    c.schedule();

    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('the default window', () => {
  // Fast enough to read as live against a 120s poll; slow enough to spread a
  // stampede across the API's 25 req/s throttle.
  it('is 2 seconds', () => {
    expect(NOTIFICATION_REFETCH_JITTER_MS).toBe(2_000);
  });

  it('is what schedule() uses when no delay is given', () => {
    const c = createRefetchCoalescer(run, undefined, () => 0.999);
    c.schedule();

    vi.advanceTimersByTime(NOTIFICATION_REFETCH_JITTER_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
