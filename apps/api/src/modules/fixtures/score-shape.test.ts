import { describe, expect, it } from 'vitest';
import { assertScoreShape, hasHalfScore } from './score-shape.js';

const dbFor = (sport: string) => ({
  fixtures: { findUnique: async () => ({ tournament_disciplines: { tournament_sports: { sports: { name: sport } } } }) },
  tournament_disciplines: { findUnique: async () => ({ tournament_sports: { sports: { name: sport } } }) },
}) as any;

describe('half-point scores', () => {
  it('only a fractional score needs checking', () => {
    expect(hasHalfScore({ home_score: 3, away_score: 1 })).toBe(false);
    expect(hasHalfScore({ home_score: null })).toBe(false);
    expect(hasHalfScore({ home_score: 2.5, away_score: 1.5 })).toBe(true);
  });

  it('are allowed in chess', async () => {
    await expect(assertScoreShape(dbFor('Chess'), { home_score: 2.5, away_score: 1.5 }, { fixtureId: 'f' })).resolves.toBeUndefined();
  });

  it('are refused in every other sport, which scores in whole numbers', async () => {
    await expect(assertScoreShape(dbFor('Boxing'), { home_score: 2.5, away_score: 1 }, { fixtureId: 'f' }))
      .rejects.toThrow(/only used in chess/);
    await expect(assertScoreShape(dbFor('Badminton'), { home_score: 0.5 }, { tournamentDisciplineId: 'td' }))
      .rejects.toThrow(/only used in chess/);
  });

  it('whole numbers never touch the database', async () => {
    await expect(assertScoreShape({} as any, { home_score: 21, away_score: 19 }, { fixtureId: 'f' })).resolves.toBeUndefined();
  });
});
