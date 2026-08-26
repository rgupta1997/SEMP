import { describe, expect, it } from 'vitest';
import { clashesByFixture, findClashes, type SchedulableFixture } from './clashes.js';

const at = (hhmm: string) => `2026-08-20T${hhmm}:00.000Z`;

const fixture = (over: Partial<SchedulableFixture> & { id: string }): SchedulableFixture => ({
  scheduledAt: at('10:00'),
  durationMinutes: 60,
  ...over,
});

describe('findClashes', () => {
  it('reports nothing when the same ground is used back to back', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('11:00'), groundId: 'court-1' }),
    ]);
    expect(clashes).toEqual([]);
  });

  it('flags a ground booked twice in overlapping windows', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:30'), groundId: 'court-1' }),
    ]);
    expect(clashes).toEqual([
      { kind: 'ground', fixture_id: 'a', other_fixture_id: 'b', subject_id: 'court-1' },
    ]);
  });

  it('flags a team playing in two draws at once, on different grounds', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1', teamIds: ['iimb', 'iima'] }),
      fixture({ id: 'b', scheduledAt: at('10:15'), groundId: 'court-2', teamIds: ['iimc', 'iimb'] }),
    ]);
    expect(clashes).toEqual([
      { kind: 'team', fixture_id: 'a', other_fixture_id: 'b', subject_id: 'iimb' },
    ]);
  });

  it('flags one official assigned to two overlapping matches', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), officialId: 'ref-1' }),
      fixture({ id: 'b', scheduledAt: at('10:30'), officialId: 'ref-1' }),
    ]);
    expect(clashes.map((c) => c.kind)).toEqual(['official']);
  });

  it('reports a pair that clashes on both ground and team once per reason', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1', teamIds: ['iimb', 'iima'] }),
      fixture({ id: 'b', scheduledAt: at('10:30'), groundId: 'court-1', teamIds: ['iimb', 'iimc'] }),
    ]);
    expect(clashes.map((c) => c.kind).sort()).toEqual(['ground', 'team']);
  });

  it('ignores unscheduled matches', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: null, groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: null, groundId: 'court-1' }),
      fixture({ id: 'c', scheduledAt: at('10:00'), groundId: 'court-1' }),
    ]);
    expect(clashes).toEqual([]);
  });

  it('ignores matches nobody turns up to', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:30'), groundId: 'court-1', status: 'cancelled' }),
      fixture({ id: 'c', scheduledAt: at('10:30'), groundId: 'court-1', status: 'bye' }),
    ]);
    expect(clashes).toEqual([]);
  });

  it('treats a match with no duration as occupying the default hour', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), durationMinutes: null, groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:45'), durationMinutes: null, groundId: 'court-1' }),
    ]);
    expect(clashes).toHaveLength(1);
    // ...and honours an explicit shorter one.
    expect(findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), durationMinutes: 30, groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:45'), durationMinutes: 30, groundId: 'court-1' }),
    ])).toEqual([]);
  });

  it('does not confuse different grounds, teams or officials', () => {
    const clashes = findClashes([
      fixture({ id: 'a', groundId: 'court-1', officialId: 'ref-1', teamIds: ['iimb'] }),
      fixture({ id: 'b', groundId: 'court-2', officialId: 'ref-2', teamIds: ['iima'] }),
    ]);
    expect(clashes).toEqual([]);
  });

  it('finds every pair when three matches share one ground', () => {
    const clashes = findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:20'), groundId: 'court-1' }),
      fixture({ id: 'c', scheduledAt: at('10:40'), groundId: 'court-1' }),
    ]);
    expect(clashes).toHaveLength(3);
  });
});

describe('clashesByFixture', () => {
  it('indexes a clash under both fixtures involved', () => {
    const byFixture = clashesByFixture(findClashes([
      fixture({ id: 'a', scheduledAt: at('10:00'), groundId: 'court-1' }),
      fixture({ id: 'b', scheduledAt: at('10:30'), groundId: 'court-1' }),
    ]));
    expect(Object.keys(byFixture).sort()).toEqual(['a', 'b']);
    expect(byFixture.a[0].kind).toBe('ground');
    expect(byFixture.b[0].kind).toBe('ground');
  });
});
