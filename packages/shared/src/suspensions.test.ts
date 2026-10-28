import { describe, expect, it } from 'vitest';
import type { RallyEvent, RallyLog } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { activeSuspensions, cardRulesFor, escalatedCard, matchTimeAt } from './suspensions.js';

// Wall-clock instants a minute apart, so match time is easy to read.
const T0 = Date.parse('2026-10-28T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const start = (min: number): RallyEvent => ({ t: 'clockStart', at: at(min) });
const pause = (min: number): RallyEvent => ({ t: 'clockPause', at: at(min) });
const endP = (min: number): RallyEvent => ({ t: 'endPeriod', at: at(min) });
const card = (kind: string, min: number, playerId = 'p1', side: 'A' | 'B' = 'A'): RallyEvent =>
  ({ t: 'point', side, pts: 0, kind, playerId, playerName: playerId.toUpperCase(), at: at(min) });
const now = (min: number) => T0 + min * 60_000;

describe('card rules', () => {
  it('hockey gets green 2 and yellow 5; the five-a-side presets also escalate', () => {
    expect(cardRulesFor(presetByKey('fih_4x15')!)).toEqual({ minutes: { green: 2, yellow: 5 }, escalate: false });
    expect(cardRulesFor(presetByKey('hockey5_4x8')!)).toEqual({ minutes: { green: 2, yellow: 5 }, escalate: true });
    expect(cardRulesFor(presetByKey('hockey5_4x8_final')!)?.escalate).toBe(true);
  });

  it('football has none unless its rules sheet sets them', () => {
    const fb = { sport: 'football', rulesSheet: {} };
    expect(cardRulesFor(fb)).toBeNull();
    expect(cardRulesFor({ ...fb, rulesSheet: { cardSuspensionMinutes: { yellow: 10 } } })).toEqual({ minutes: { yellow: 10 }, escalate: false });
  });
});

describe('match time', () => {
  it('counts only while the clock runs, across periods', () => {
    const log: RallyLog = [start(0), pause(3), start(5), endP(9), start(12)];
    // 3 + 4 in the first period, then 2 minutes into the second.
    expect(matchTimeAt(log, log.length, now(14))).toBe(9 * 60_000);
    // Before the pause event: 3 minutes run.
    expect(matchTimeAt(log, 1, now(99))).toBe(3 * 60_000);
  });
});

describe('suspensions', () => {
  const rules = cardRulesFor(presetByKey('hockey5_4x8')!)!;

  it('a green is off for 2 minutes of match time, paused with the clock', () => {
    const log: RallyLog = [start(0), card('green', 1)];
    expect(activeSuspensions(log, rules, now(2))).toEqual([expect.objectContaining({ playerId: 'p1', card: 'green', remainingMs: 60_000 })]);
    // Clock stopped at 2: the minute left does not run down while play is stopped.
    const paused = [...log, pause(2)];
    expect(activeSuspensions(paused, rules, now(10))[0].remainingMs).toBe(60_000);
    expect(activeSuspensions(log, rules, now(3))).toEqual([]);
  });

  it('a yellow carries over a quarter break', () => {
    const log: RallyLog = [start(0), card('yellow', 6), endP(8), start(9)];
    // 2 minutes served before the break, 1 after: 2 left.
    expect(activeSuspensions(log, rules, now(10))[0].remainingMs).toBe(2 * 60_000);
  });

  it('a red is off for the match; a later card replaces an earlier timer', () => {
    const log: RallyLog = [start(0), card('green', 1, 'p2', 'B'), card('red', 2), card('yellow', 2.5, 'p2', 'B')];
    const off = activeSuspensions(log, rules, now(3));
    expect(off.find((s) => s.playerId === 'p1')).toMatchObject({ card: 'red', remainingMs: Infinity });
    expect(off.find((s) => s.playerId === 'p2')).toMatchObject({ card: 'yellow', side: 'B', remainingMs: 4.5 * 60_000 });
  });
});

describe('escalation', () => {
  const rules = cardRulesFor(presetByKey('hockey5_4x8')!)!;

  it('a second green is a yellow, a second yellow a red', () => {
    expect(escalatedCard([], rules, 'p1', 'green')).toBe('green');
    expect(escalatedCard([card('green', 1)], rules, 'p1', 'green')).toBe('yellow');
    expect(escalatedCard([card('yellow', 1)], rules, 'p1', 'yellow')).toBe('red');
    // Green, then a second green made yellow: a third green climbs to red.
    expect(escalatedCard([card('green', 1), card('yellow', 3)], rules, 'p1', 'green')).toBe('red');
    // Another player's cards don't count.
    expect(escalatedCard([card('green', 1, 'p2')], rules, 'p1', 'green')).toBe('green');
  });

  it('only where the format asks for it', () => {
    const fih = cardRulesFor(presetByKey('fih_4x15')!)!;
    expect(escalatedCard([card('green', 1)], fih, 'p1', 'green')).toBe('green');
  });
});
