import { describe, it, expect, vi } from 'vitest';

// A squad someone has left counts only for the matches played while they were on it.

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test' }, isProduction: false }));
const { myFixturesWhere, playedWhileOn } = await import('./me.routes.js');

const LEFT = new Date('2026-10-20T00:00:00Z');
const before = new Date('2026-10-16T10:00:00Z');
const after = new Date('2026-10-25T10:00:00Z');

describe('playedWhileOn', () => {
  it('counts a match finished before they left', () => {
    expect(playedWhileOn({ status: 'completed', completed_at: before }, LEFT)).toBe(true);
  });
  it('does not count a match the team played after they left', () => {
    expect(playedWhileOn({ status: 'completed', completed_at: after }, LEFT)).toBe(false);
  });
  it('falls back to the scheduled time when there is no finish time', () => {
    expect(playedWhileOn({ status: 'walkover', completed_at: null, scheduled_at: after }, LEFT)).toBe(false);
    expect(playedWhileOn({ status: 'walkover', completed_at: null, scheduled_at: before }, LEFT)).toBe(true);
  });
  it('never counts a match not yet played', () => {
    expect(playedWhileOn({ status: 'scheduled', scheduled_at: before }, LEFT)).toBe(false);
  });
  it('counts every played match when the leave date is unknown (older rows)', () => {
    expect(playedWhileOn({ status: 'completed', completed_at: after }, null)).toBe(true);
  });
});

describe('myFixturesWhere', () => {
  it('a current squad gives all its matches; a left one only played matches up to the leave date', () => {
    const where = myFixturesWhere([
      { team_id: 'now', is_active: true, left_at: null },
      { team_id: 'old', is_active: false, left_at: LEFT },
    ]);
    expect(where.OR).toEqual(expect.arrayContaining([
      { home_team_id: { in: ['now'] } },
      { away_team_id: { in: ['now'] } },
      expect.objectContaining({ home_team_id: 'old', status: { in: ['completed', 'walkover'] }, OR: expect.any(Array) }),
    ]));
  });
  it('a left squad with no leave date keeps every played match', () => {
    const where = myFixturesWhere([{ team_id: 'old', is_active: false, left_at: null }]);
    expect(where.OR).toEqual([
      { home_team_id: 'old', status: { in: ['completed', 'walkover'] } },
      { away_team_id: 'old', status: { in: ['completed', 'walkover'] } },
    ]);
  });
  it('no squads matches nothing', () => {
    expect(myFixturesWhere([])).toEqual({ OR: [] });
  });
});
