import { describe, expect, it } from 'vitest';
import { formatTime, hasResultIn, moveUnplacedTo, parseTimeInput, readTimeInput, subEventResults, type EventState } from './event';

// Sheet SW03: a typo is refused with a reason, never read as some other time.
describe('reading a typed time', () => {
  it('takes plain seconds and minutes:seconds', () => {
    expect(readTimeInput('31.45')).toEqual({ value: 31.45, error: null });
    expect(readTimeInput('1:02.45').value).toBeCloseTo(62.45);
    expect(readTimeInput(' 0:59.9 ').value).toBeCloseTo(59.9);
    expect(readTimeInput('')).toEqual({ value: null, error: null });
  });

  it('refuses 0 and negative times', () => {
    expect(readTimeInput('0').error).toMatch(/more than 0/);
    expect(readTimeInput('0:00').error).toMatch(/more than 0/);
    expect(readTimeInput('-12').error).toBeTruthy();
    expect(parseTimeInput('0')).toBeNull();
  });

  it('refuses 60 or more seconds after the colon, and a second colon', () => {
    expect(readTimeInput('1:75').error).toMatch(/under 60/);
    expect(readTimeInput('1:60').error).toMatch(/under 60/);
    expect(readTimeInput('1:02:03').error).toBeTruthy();
    expect(readTimeInput('1:').error).toBeTruthy();
    expect(readTimeInput('abc').error).toBeTruthy();
    expect(readTimeInput('1.2.3').error).toBeTruthy();
  });

  it('round-trips with the display format', () => {
    for (const t of [28.5, 62.45, 125.3]) expect(parseTimeInput(formatTime(t))).toBeCloseTo(t);
  });
});

// SW05: the race results list who had a DNS / DNF / DQ, after the placed finishers.
describe('race results with statuses', async () => {
  const { subEventResults, hydrateEvent } = await import('./event');
  const spec = {
    entry: 'perAthlete', subEvents: [{ key: 'r', label: '50m Free' }],
    result: { resultType: 'time', winnerIs: 'min', unit: 's', aggregate: 'medals', medalPoints: [5, 3, 1] },
  } as any;

  it('keeps the status through saving and shows it with no rank or points', () => {
    const state = hydrateEvent({ participants: [
      { id: 'a', name: 'Rahul', marks: { r: 28.1 }, statuses: { r: 'DQ' } },
      { id: 'b', name: 'Arjun', marks: { r: 29.5 } },
    ] });
    expect(state.participants[0].statuses).toEqual({ r: 'DQ' });
    const [block] = subEventResults(spec, state);
    expect(block.rows).toEqual([
      expect.objectContaining({ rank: 1, name: 'Arjun', points: 5 }),
      expect.objectContaining({ rank: null, name: 'Rahul', status: 'DQ', points: 0 }),
    ]);
  });
});

// Powerlifting "Whole sport": one screen, the class picker as a filter.
describe('switching weight class on one screen', () => {
  const lifter = (id: string, category: string | null, marks: Record<string, number | null> = {}, statuses?: Record<string, 'DQ'>) =>
    ({ id, name: id, phone: null, org: null, orgId: `o-${id}`, category, marks, ...(statuses ? { statuses } : {}) });
  const entered: EventState = {
    participants: [lifter('Rahul', 'm66', { m66: 400 }), lifter('Arjun', 'm66', { m66: 380 }), lifter('Neel', 'm66', {}, { m66: 'DQ' }),
      lifter('Vikram', 'm66'), lifter('Karan', 'm66', { m66: null })],
  };

  it('keeps every lifter with a result (a total or a status) in the class it was entered in', () => {
    const next = moveUnplacedTo(entered, 'm74');
    expect(next.participants.map((p) => [p.id, p.category])).toEqual([['Rahul', 'm66'], ['Arjun', 'm66'], ['Neel', 'm66'], ['Vikram', 'm74'], ['Karan', 'm74']]);
    expect(next.participants[0].marks).toEqual({ m66: 400 });
    expect(hasResultIn(next.participants[2], 'm66')).toBe(true);
    expect(hasResultIn(next.participants[4], 'm74')).toBe(false);
  });

  it('ranks each class on its own after the switch', () => {
    const next = moveUnplacedTo(entered, 'm74');
    next.participants[3] = { ...next.participants[3], marks: { m74: 450 } };
    const spec = { subEvents: [{ key: 'm66', label: '66kg' }, { key: 'm74', label: '74kg' }], result: { resultType: 'weight' as const, winnerIs: 'max' as const, unit: 'kg' as const, aggregate: 'medals' as const, medalPoints: [10, 7, 4] } };
    const blocks = subEventResults(spec, next);
    expect(blocks.map((b) => [b.label, b.rows.map((r) => `${r.name}:${r.rank ?? r.status}`)])).toEqual([
      ['66kg', ['Rahul:1', 'Arjun:2', 'Neel:DQ']],
      ['74kg', ['Vikram:1']],
    ]);
  });
});

describe('choosing which races to run', async () => {
  const { chosenEvents, toggleEvent, hydrateEvent } = await import('./event');
  const keys = ['m25free', 'm50free', 'm25back'];
  const swimmer = (marks: Record<string, number | null>, statuses?: Record<string, 'DNS' | 'DNF' | 'DQ'>) =>
    ({ id: 'a', name: 'Aarav', marks, ...(statuses ? { statuses } : {}) });

  it('shows the picked races in the order picked, then any race that already has a result', () => {
    const state = { participants: [swimmer({ m25back: 20.1 })], events: ['m50free'] };
    expect(chosenEvents(state, keys)).toEqual(['m50free', 'm25back']);
  });

  it('drops unknown and repeated keys', () => {
    expect(chosenEvents({ participants: [], events: ['gone', 'm25free', 'm25free'] }, keys)).toEqual(['m25free']);
  });

  it('adds a race, and removing it clears its times and statuses only', () => {
    let state = toggleEvent({ participants: [swimmer({ m50free: 31 }, { m50free: 'DQ' })] }, keys, 'm25free');
    expect(chosenEvents(state, keys)).toEqual(['m50free', 'm25free']);
    state = { ...state, participants: [{ ...state.participants[0], marks: { ...state.participants[0].marks, m25free: 15.2 } }] };
    state = toggleEvent(state, keys, 'm50free');
    expect(state.participants[0].marks).toEqual({ m25free: 15.2 });
    expect(state.participants[0].statuses).toEqual({});
    expect(chosenEvents(state, keys)).toEqual(['m25free']);
  });

  it('keeps the picked races through saving and reloading', () => {
    expect(hydrateEvent({ participants: [], events: ['m25free', 7] }).events).toEqual(['m25free']);
    expect(hydrateEvent({ participants: [] }).events).toBeUndefined();
  });

  it('keeps races added from setup through a reload, so the next save does not wipe them', () => {
    const back = hydrateEvent({ participants: [], extraEvents: [{ key: 'jav', label: 'Javelin', resultType: 'distance' }, { key: 1, label: 'bad' }] });
    expect(back.extraEvents).toEqual([{ key: 'jav', label: 'Javelin', resultType: 'distance' }]);
  });
});

describe('who is in each race, and relays', async () => {
  const ev = await import('./event');
  const { rankSubEvent, aggregateEvent } = await import('@semp/shared');
  const sw = (id: string, org: string) => ({ id, name: id, phone: null, org, orgId: org, category: null, marks: {} as Record<string, number | null> });
  const squad = () => ({ participants: [sw('a1', 'NFC'), sw('a2', 'NFC'), sw('b1', 'RVI')] });
  const keys = ['m25f', 'relay4'];

  it('starts a race empty when an institute has several swimmers, full when each has one', () => {
    expect(ev.toggleRace(squad(), keys, 'm25f', false).lineups).toEqual({ m25f: [] });
    const solo = { participants: [sw('a1', 'NFC'), sw('b1', 'RVI')] };
    expect(ev.toggleRace(solo, keys, 'm25f', false).lineups).toBeUndefined();
    expect(ev.lineupOf(ev.toggleRace(solo, keys, 'm25f', false), 'm25f', false)).toEqual(['a1', 'b1']);
  });

  it('adds and removes swimmers, clearing a removed swimmer\'s time there', () => {
    let s = ev.toggleRace(squad(), keys, 'm25f', false);
    s = ev.setInLineup(s, 'm25f', false, 'a2', true);
    s = { ...s, participants: s.participants.map((p) => (p.id === 'a2' ? { ...p, marks: { m25f: 15.1 } } : p)) };
    expect(ev.lineupOf(s, 'm25f', false)).toEqual(['a2']);
    s = ev.setInLineup(s, 'm25f', false, 'a2', false);
    expect(ev.lineupOf(s, 'm25f', false)).toEqual([]);
    expect(s.participants.find((p) => p.id === 'a2')!.marks).toEqual({});
  });

  it('keeps anyone with a result in the race even if the stored list misses them', () => {
    const s = { ...squad(), lineups: { m25f: [] }, participants: [{ ...sw('a1', 'NFC'), marks: { m25f: 14 } }, sw('b1', 'RVI')] };
    expect(ev.lineupOf(s, 'm25f', false)).toEqual(['a1']);
  });

  it('gives a relay one row per institute, ranked and scored per institute', () => {
    let s = ev.toggleRace(squad(), keys, 'relay4', true);
    const rows = ev.raceField(s, true);
    expect(rows.map((r) => r.id)).toEqual(['relay:NFC', 'relay:RVI']);
    expect(ev.raceField(s, false).map((r) => r.id)).toEqual(['a1', 'a2', 'b1']);
    s = { ...s, participants: s.participants.map((p) => (p.id === 'relay:RVI' ? { ...p, marks: { relay4: 60 } } : p.id === 'relay:NFC' ? { ...p, marks: { relay4: 62 } } : p)) };
    const spec = { result: { resultType: 'time', winnerIs: 'min', aggregate: 'medals', medalPoints: [10, 7, 4] }, subEvents: [{ key: 'relay4', label: '4x25m Freestyle Relay', kind: 'relay' }] } as any;
    expect([...rankSubEvent(spec, s, 'relay4')]).toEqual([['relay:RVI', 1], ['relay:NFC', 2]]);
    expect(aggregateEvent(spec, s).map((r) => [r.key, r.points])).toEqual([['RVI', 10], ['NFC', 7]]);
  });

  it('caps the relay swimmers at its legs and reads legs from the label', () => {
    expect(ev.relayLegs("Men's 4x25m Medley Relay")).toBe(4);
    expect(ev.relayLegs('Relay')).toBe(4);
    const s = ev.setRelayMembers({ participants: [] }, 'relay4', 'relay:NFC', ['a', 'b', 'b', 'c', 'd', 'e'], 4);
    expect(s.relayMembers).toEqual({ relay4: { 'relay:NFC': ['a', 'b', 'c', 'd'] } });
  });

  it('removing a race clears its lineup and relay swimmers, and both survive saving', () => {
    let s = ev.toggleRace(squad(), keys, 'relay4', true);
    s = ev.setRelayMembers(s, 'relay4', 'relay:NFC', ['a1'], 4);
    const back = ev.hydrateEvent(JSON.parse(JSON.stringify({ ...s, lineups: { m25f: ['a1'] } })));
    expect(back.relayMembers).toEqual({ relay4: { 'relay:NFC': ['a1'] } });
    expect(back.lineups).toEqual({ m25f: ['a1'] });
    s = ev.toggleRace(s, keys, 'relay4', true);
    expect(s.relayMembers).toEqual({});
  });
});

describe('races picked before lineups existed', async () => {
  const ev = await import('./event');
  const sw = (id: string, org: string, marks: Record<string, number | null> = {}) => ({ id, name: id, phone: null, org, orgId: org, category: null, marks });
  it('shows only swimmers with a result when an institute has several, everyone when each has one', () => {
    const big = { events: ['m100f'], participants: [sw('a1', 'NFC', { m100f: 40 }), sw('a2', 'NFC'), sw('b1', 'RVI')] };
    expect(ev.lineupOf(big, 'm100f', false)).toEqual(['a1']);
    const solo = { events: ['m100f'], participants: [sw('a1', 'NFC'), sw('b1', 'RVI')] };
    expect(ev.lineupOf(solo, 'm100f', false)).toEqual(['a1', 'b1']);
  });
  it('adds relay rows once, for every institute', () => {
    const s = ev.withRelayRows(ev.withRelayRows({ participants: [sw('a1', 'NFC'), sw('a2', 'NFC'), sw('b1', 'RVI')] }));
    expect(ev.raceField(s, true).map((r) => r.id)).toEqual(['relay:NFC', 'relay:RVI']);
  });
});

describe('one weight class per lifter', async () => {
  const ev = await import('./event');
  const l = (id: string, org: string, category: string | null = null, marks: Record<string, number | null> = {}) =>
    ({ id, name: id, phone: null, org, orgId: org, category, marks });
  const keys = ['m63', 'm74'];

  it('reads a class from each lifter, and adding a class starts it empty', () => {
    let s = ev.toggleRace({ participants: [l('a', 'NFC'), l('b', 'RVI')] }, keys, 'm63', false, true);
    expect(ev.lineupOf(s, 'm63', false, true)).toEqual([]);
    expect(s.lineups).toBeUndefined();
    s = ev.setInLineup(s, 'm63', false, 'a', true, true);
    expect(ev.lineupOf(s, 'm63', false, true)).toEqual(['a']);
  });

  it('moving a lifter to another class takes them out of the first and clears that total', () => {
    let s: EventState = { events: ['m63', 'm74'], participants: [l('a', 'NFC', 'm63', { m63: 410 }), l('b', 'RVI')] };
    s = ev.setInLineup(s, 'm74', false, 'a', true, true);
    expect(s.participants[0].category).toBe('m74');
    expect(s.participants[0].marks).toEqual({});
    expect(ev.lineupOf(s, 'm63', false, true)).toEqual([]);
    expect(ev.lineupOf(s, 'm74', false, true)).toEqual(['a']);
  });

  it('removing a class frees its lifters', () => {
    const s = ev.toggleRace({ events: ['m63'], participants: [l('a', 'NFC', 'm63', { m63: 400 })] }, keys, 'm63', false, true);
    expect(s.participants[0]).toMatchObject({ category: null, marks: {} });
  });
});
