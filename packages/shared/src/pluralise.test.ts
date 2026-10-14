import { describe, expect, it } from 'vitest';
import { pluralise, UNIT_LABEL_PRESETS } from './org-structure.js';

describe('pluralise - the level names an institution types', () => {
  it('pluralises singular names', () => {
    expect(pluralise('Campus')).toBe('Campuses');
    expect(pluralise('Department')).toBe('Departments');
    expect(pluralise('Batch')).toBe('Batches');
    expect(pluralise('Class')).toBe('Classes');
    expect(pluralise('Branch')).toBe('Branches');
    expect(pluralise('Office')).toBe('Offices');
    expect(pluralise('Faculty')).toBe('Faculties');
    expect(pluralise('Bus')).toBe('Buses');
  });

  it('leaves an already-plural name alone (was "Teamses")', () => {
    expect(pluralise('Teams')).toBe('Teams');
    expect(pluralise('Houses')).toBe('Houses');
    expect(pluralise('Departments')).toBe('Departments');
  });

  it('keeps every preset label reading right', () => {
    for (const p of UNIT_LABEL_PRESETS) {
      for (const label of [p.labels.campus, p.labels.department]) {
        expect(pluralise(label), label).not.toMatch(/(ses|ies)es$|ss$/);
        expect(pluralise(label), label).not.toBe(label);
      }
    }
  });
});
