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
