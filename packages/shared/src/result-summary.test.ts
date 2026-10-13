import { describe, expect, it } from 'vitest';
import { resultSummary } from './result-summary.js';
import { presetByKey } from './racquet-presets.js';

const board = (winner: 'A' | 'B', coinsLeft: number) => ({ winner, coinsLeft, queen: 'winner' as const });
const game = (w: 'A' | 'B') => [board(w, 9), board(w, 9), board(w, 9)];

describe('the result summary line', () => {
  it('carrom best of 3: each game\'s points, home first', () => {
    const ls = { format: presetByKey('icf_bo3_boards'), carrom: { firstBreak: 'A', boards: [...game('A'), ...game('B'), ...game('A')] } };
    expect(resultSummary('Carrom', ls)).toBe('25–0, 0–25, 25–0');
  });

  it('carrom one game: nothing beyond the score', () => {
    const ls = { format: presetByKey('corp_single_29'), carrom: { firstBreak: 'A', boards: game('A') } };
    expect(resultSummary('carrom', ls)).toBeNull();
  });

  it('chess one game: the ending, when recorded', () => {
    expect(resultSummary('Chess', { chess: { games: [{ result: 'A', ending: 'checkmate' }] } })).toBe('checkmate');
    expect(resultSummary('Chess', { chess: { games: [{ result: 'A' }] } })).toBeNull();
  });

  it('chess best of 3: each game\'s result', () => {
    const ls = { chess: { games: [{ result: 'A' }, { result: 'draw' }, { result: 'B' }] } };
    expect(resultSummary('chess', ls)).toBe('1–0, ½–½, 0–1');
  });

  it('any other sport, or no detail: nothing', () => {
    expect(resultSummary('Badminton', { rally: [] })).toBeNull();
    expect(resultSummary('carrom', null)).toBeNull();
  });
});
