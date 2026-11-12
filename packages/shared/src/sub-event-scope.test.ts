import { describe, expect, it } from 'vitest';
import {
  disciplineResultType, effectiveEventSpec, mixesSubEvents, offeredToGender, subEventScopeOf, withExtraSubEvents,
} from './event-scoring.js';
import { eventTemplateFor } from './event-templates.js';

const swim = eventTemplateFor('Swimming')!.event!;
const athletics = eventTemplateFor('Athletics')!.event!;

describe('a named discipline running one race or all of them', () => {
  it('keeps one sub-event by default, as before', () => {
    expect(effectiveEventSpec(swim, { id: 'd1', name: "Men's 50m Freestyle" }).subEvents).toHaveLength(1);
    expect(effectiveEventSpec(swim, { id: 'd1', name: 'Men', scope: 'one' }).subEvents).toHaveLength(1);
  });

  it("'all' drops the template: its races are the disciplines picked in the console", () => {
    const base = effectiveEventSpec(swim, { id: 'd1', name: 'Men', scope: 'all' });
    expect(base.subEvents).toEqual([]);
    const withPicked = withExtraSubEvents(base, { extraEvents: [{ key: 'fly', label: 'Butterfly', resultType: 'time' }] });
    expect(withPicked.subEvents).toEqual([{ key: 'fly', label: 'Butterfly', resultType: 'time', winnerIs: 'min', unit: 's' }]);
  });

  it('whole sport and multi-race disciplines mix sub-events; a plain named one does not', () => {
    expect(mixesSubEvents({ id: null, name: null })).toBe(true);
    expect(mixesSubEvents({ id: 'd1', name: 'Men', scope: 'all' })).toBe(true);
    expect(mixesSubEvents({ id: 'd1', name: '66kg' })).toBe(false);
  });

  it('reads the saved scope, falling back to one', () => {
    expect(subEventScopeOf({ subEventScope: 'all' })).toBe('all');
    expect(subEventScopeOf({ subEventScope: 'men' })).toBe('one');
    expect(subEventScopeOf(null)).toBe('one');
  });
});

describe('gender of the races offered', () => {
  it('generic disciplines go to everyone; gendered ones only to their own', () => {
    expect(offeredToGender('men', null)).toBe(true);
    expect(offeredToGender('men', 'men')).toBe(true);
    expect(offeredToGender('men', 'women')).toBe(false);
    expect(offeredToGender('mixed', 'mixed')).toBe(true);
    expect(offeredToGender('mixed', 'men')).toBe(false);
  });

  it('a generic multi-race discipline offers every one', () => {
    expect(offeredToGender(null, 'women')).toBe(true);
  });
});

describe('how a discipline ranks', () => {
  it('its stored type wins, then its template namesake, then nothing (the sport default)', () => {
    expect(disciplineResultType(athletics, 'Javelin', 'distance')).toBe('distance');
    expect(disciplineResultType(athletics, 'Long Jump', null)).toBe('distance');
    expect(disciplineResultType(athletics, 'Javelin', null)).toBeUndefined();
  });

  it('a single named discipline with a stored type ranks by it, not the sport default', () => {
    const [se] = effectiveEventSpec(athletics, { id: 'jav', name: 'Javelin', resultType: 'distance' }).subEvents;
    expect(se).toMatchObject({ resultType: 'distance', winnerIs: 'max', unit: 'm' });
  });
});
