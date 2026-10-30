import { describe, expect, it } from 'vitest';
import type { RallyEvent, RallyLog } from './rally-kernel.js';
import { presetByKey } from './racquet-presets.js';
import { activeSuspensions, cardRulesFor, escalatedCard, matchTimeAt, sentOffPlayers } from './suspensions.js';

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
    expect(cardRulesFor(presetByKey('fih_4x15')!)).toEqual({ minutes: { green: 2, yellow: 5 }, escalate: false, endsOnGoal: [], timed: true, steps: { green: 'yellow', yellow: 'red' } });
    expect(cardRulesFor(presetByKey('hockey5_4x8')!)).toEqual({ minutes: { green: 2, yellow: 5 }, escalate: true, endsOnGoal: [], timed: true, steps: { green: 'yellow', yellow: 'red' } });
    expect(cardRulesFor(presetByKey('hockey5_4x8_final')!)?.escalate).toBe(true);
  });

  it('football: no timers, but a second yellow escalates unless switched off', () => {
    const fb = { sport: 'football', rulesSheet: {} };
    expect(cardRulesFor(fb)).toEqual({ minutes: {}, escalate: true, endsOnGoal: [], timed: false, steps: { yellow: 'red2y' } });
    expect(cardRulesFor({ ...fb, rulesSheet: { cardEscalation: false } })).toBeNull();
    expect(cardRulesFor({ ...fb, rulesSheet: { cardSuspensionMinutes: { yellow: 10 } } })).toEqual({ minutes: { yellow: 10 }, escalate: true, endsOnGoal: [], timed: true, steps: { yellow: 'red2y' } });
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

// Sheet FU03: futsal's red card - 2 minutes short, over early if the other side scores.
describe('futsal red card', () => {
  const rules = cardRulesFor(presetByKey('futsal_2x10')!)!;
  const goal = (side: 'A' | 'B', min: number): RallyEvent => ({ t: 'point', side, pts: 1, kind: 'goal', playerId: 'x', at: at(min) });

  it('is a 2-minute sit-out, not off for the match', () => {
    expect(rules).toEqual({ minutes: { red: 2, red2y: 2 }, escalate: true, endsOnGoal: ['red', 'red2y'], timed: true, steps: { yellow: 'red2y' } });
    const log: RallyLog = [start(0), card('red', 1)];
    expect(activeSuspensions(log, rules, now(2))[0]).toMatchObject({ card: 'red', remainingMs: 60_000 });
    expect(activeSuspensions(log, rules, now(3))).toEqual([]);
  });

  it('ends at once when the other side scores, not when their own side does', () => {
    const own: RallyLog = [start(0), card('red', 1), goal('A', 1.5)];
    expect(activeSuspensions(own, rules, now(2))).toHaveLength(1);
    const against: RallyLog = [start(0), card('red', 1), goal('B', 1.5)];
    expect(activeSuspensions(against, rules, now(2))).toEqual([]);
  });

  it('hockey and football reds are still off for the match', () => {
    const hockey = cardRulesFor(presetByKey('fih_4x15')!)!;
    expect(activeSuspensions([start(0), card('red', 1)], hockey, now(30))[0].remainingMs).toBe(Infinity);
  });
});

// The format editor's card switches, for every sport with suspensions.
describe('card switches in the format editor', () => {
  it('hockey: timers on/off, green and yellow minutes, escalation', async () => {
    const { applyKnobs, describeKnobs, knobsFor, readKnobs } = await import('./format-knobs.js');
    const f = presetByKey('fih_4x15')!;
    const k = readKnobs(f);
    expect(k).toMatchObject({ cardSport: 'hockey', cardSuspensionsEnabled: true, greenSuspensionMinutes: 2, yellowSuspensionMinutes: 5, cardEscalationEnabled: false });
    expect(knobsFor(k).filter((s) => s.group === 'cards').map((s) => s.key))
      .toEqual(['cardSuspensionsEnabled', 'greenSuspensionMinutes', 'yellowSuspensionMinutes', 'cardEscalationEnabled']);
    const ten = applyKnobs(f, { ...k, yellowSuspensionMinutes: 10, cardEscalationEnabled: true });
    expect(cardRulesFor(ten)).toMatchObject({ minutes: { green: 2, yellow: 10 }, escalate: true, timed: true });
    expect(describeKnobs(readKnobs(ten))).toContain('green 2 / yellow 10 min off · repeat cards step up');
    // Timers off: nobody is timed, escalation still asks.
    const off = applyKnobs(f, { ...k, cardSuspensionsEnabled: false, cardEscalationEnabled: true });
    const rules = cardRulesFor(off)!;
    expect(rules).toMatchObject({ timed: false, escalate: true });
    expect(activeSuspensions([start(0), card('green', 1)], rules, now(2))).toEqual([]);
    expect(escalatedCard([card('green', 1)], rules, 'p1', 'green')).toBe('yellow');
    expect(cardRulesFor(applyKnobs(f, { ...k, cardSuspensionsEnabled: false }))).toBeNull();
  });

  it('futsal: red card on/off and its minutes', async () => {
    const { applyKnobs, knobsFor, readKnobs } = await import('./format-knobs.js');
    const f = presetByKey('futsal_2x10')!;
    const k = readKnobs(f);
    expect(knobsFor(k).filter((s) => s.group === 'cards').map((s) => s.key)).toEqual(['cardSuspensionsEnabled', 'cardEscalationEnabled', 'redSuspensionMinutes']);
    expect(cardRulesFor(applyKnobs(f, { ...k, redSuspensionMinutes: 3 }))?.minutes).toEqual({ red: 3, red2y: 3 });
    // Timers off: no strip, but the second yellow still asks.
    expect(cardRulesFor(applyKnobs(f, { ...k, cardSuspensionsEnabled: false }))).toMatchObject({ timed: false, escalate: true });
    expect(cardRulesFor(applyKnobs(f, { ...k, cardSuspensionsEnabled: false, cardEscalationEnabled: false }))).toBeNull();
  });

  it('no card section for football or other sports', async () => {
    const { knobsFor, readKnobs } = await import('./format-knobs.js');
    expect(knobsFor(readKnobs(presetByKey('ultimate_2x20')!)).some((s) => s.group === 'cards')).toBe(false);
  });
});

// Sheet FB01-FB02: football's second yellow, and who can't be picked after a red.
describe('football cards', () => {
  const rules = cardRulesFor(presetByKey('fest_2x10')!)!;

  it('a second yellow becomes a second-yellow red, not a direct red', () => {
    expect(escalatedCard([card('yellow', 1)], rules, 'p1', 'yellow')).toBe('red2y');
    expect(escalatedCard([], rules, 'p1', 'yellow')).toBe('yellow');
    expect(escalatedCard([card('yellow', 1)], rules, 'p1', 'red')).toBe('red');
  });

  it('a sent-off player is off for the match, either kind of red', () => {
    expect([...sentOffPlayers([card('red2y', 1), card('red', 2, 'p2')], rules)].sort()).toEqual(['p1', 'p2']);
    expect(activeSuspensions([start(0), card('red2y', 1)], rules, now(5))).toEqual([]);
  });

  it("futsal's timed red is not a sending-off", () => {
    const futsal = cardRulesFor(presetByKey('futsal_2x10')!)!;
    expect(sentOffPlayers([card('red', 1)], futsal).size).toBe(0);
    const hockey = cardRulesFor(presetByKey('fih_4x15')!)!;
    expect(sentOffPlayers([card('red', 1)], hockey).has('p1')).toBe(true);
  });

  it('the editor has one football switch: second yellow is a red', async () => {
    const { applyKnobs, knobsFor, readKnobs, describeKnobs } = await import('./format-knobs.js');
    const f = presetByKey('fest_2x10')!;
    const k = readKnobs(f);
    const specs = knobsFor(k).filter((s) => s.group === 'cards');
    expect(specs.map((s) => [s.key, s.label])).toEqual([['cardEscalationEnabled', 'Second yellow is a red']]);
    const off = applyKnobs(f, { ...k, cardEscalationEnabled: false });
    expect(cardRulesFor(off)).toBeNull();
    expect(describeKnobs(readKnobs(off))).toContain('second yellow not a red');
  });
});
