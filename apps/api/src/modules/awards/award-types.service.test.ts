import { describe, it, expect } from 'vitest';
import { whyNotOffered } from './award-types.service.js';

const base = {
  is_active: true,
  levels: ['match'],
  all_sports: false,
  championship_id: null as string | null,
  sport_ids: ['football'],
};

describe('whyNotOffered', () => {
  it('offers a mapped type at its level', () => {
    expect(whyNotOffered(base, { level: 'match', sportId: 'football' })).toBeNull();
  });

  it('rejects a sport the type is not mapped to', () => {
    expect(whyNotOffered(base, { level: 'match', sportId: 'kabaddi' })).toBe('is not offered for this sport');
  });

  it('offers an all-sports type for any sport', () => {
    expect(whyNotOffered({ ...base, all_sports: true, sport_ids: [] }, { level: 'match', sportId: 'kabaddi' })).toBeNull();
  });

  it('rejects the wrong level', () => {
    expect(whyNotOffered(base, { level: 'championship', sportId: 'football' })).toBe('is not given at championship level');
  });

  it('rejects an inactive type', () => {
    expect(whyNotOffered({ ...base, is_active: false }, { level: 'match', sportId: 'football' })).toBe('is no longer offered');
  });

  it("rejects another event's custom type and accepts its own", () => {
    const custom = { ...base, championship_id: 'ev1' };
    expect(whyNotOffered(custom, { level: 'match', sportId: 'football', championshipId: 'ev2' })).toBe('belongs to another event');
    expect(whyNotOffered(custom, { level: 'match', sportId: 'football', championshipId: 'ev1' })).toBeNull();
  });

  it('skips the sport check when the award is not tied to one sport', () => {
    expect(whyNotOffered({ ...base, levels: ['championship'] }, { level: 'championship', sportId: null })).toBeNull();
  });

  it('offers a type mapped to any one of the sports in a tournament or event', () => {
    const t = { ...base, levels: ['tournament'] };
    expect(whyNotOffered(t, { level: 'tournament', sportIds: ['kabaddi', 'football'] })).toBeNull();
    expect(whyNotOffered(t, { level: 'tournament', sportIds: ['kabaddi'] })).toBe('is not offered for any sport here');
  });
});
