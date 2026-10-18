import { describe, expect, it } from 'vitest';
import { citiesLabel, normaliseCities } from './host-cities.js';

describe('host cities', () => {
  it('trims, drops blanks and removes case-only duplicates, keeping the first spelling', () => {
    expect(normaliseCities(['  Mumbai ', '', 'Pune', 'mumbai', 'New   Delhi'])).toEqual(['Mumbai', 'Pune', 'New Delhi']);
  });

  it('joins for the legacy venue column', () => {
    expect(citiesLabel(['Mumbai', 'Pune'])).toBe('Mumbai, Pune');
    expect(citiesLabel([])).toBe('');
  });
});
