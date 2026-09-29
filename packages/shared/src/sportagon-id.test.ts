import { describe, expect, it } from 'vitest';
import { DEFAULT_ID_PREFIX, orgIdPrefix } from './sportagon-id.js';

describe('orgIdPrefix', () => {
  it('takes the initials of the first three words', () => {
    expect(orgIdPrefix('Aman enterprise org')).toBe('AEO');
  });

  it('skips joining words', () => {
    expect(orgIdPrefix('Northfield Institute of Technology')).toBe('NIT');
    expect(orgIdPrefix('The Mumbai Cricket Association')).toBe('MCA');
  });

  it('tops a short name up from its last word', () => {
    expect(orgIdPrefix('Sportagon')).toBe('SPO');
    expect(orgIdPrefix('Aman Enterprise')).toBe('AEN');
    expect(orgIdPrefix('IIM')).toBe('IIM');
  });

  it('ignores digits and punctuation', () => {
    expect(orgIdPrefix('St. Xavier’s College, 2024')).toBe('SXC');
  });

  it('pads a name too short to make three letters', () => {
    expect(orgIdPrefix('Q')).toBe('QXX');
  });

  it('falls back to the default when there is nothing to use', () => {
    expect(orgIdPrefix('')).toBe(DEFAULT_ID_PREFIX);
    expect(orgIdPrefix(null)).toBe(DEFAULT_ID_PREFIX);
    expect(orgIdPrefix('२०२४ क्रीड़ा')).toBe(DEFAULT_ID_PREFIX);
  });
});
