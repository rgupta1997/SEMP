import { describe, expect, it } from 'vitest';
import {
  ICF_CARROM_RULES, carromBoardPoints, carromHeadline, carromLineStats, carromMatch, carromRulesOf, isCarromSport, queenCoversFor,
  type CarromBoard, type QueenCover,
} from './carrom.js';
import { presetByKey } from './racquet-presets.js';
import { foldCareerStats, statSpecFor } from './stat-registry.js';
import { toCategoryRow } from './category-lines.js';
import { tieTemplateFor } from './tie-templates.js';
import { decideRubber, hydrateTie, initTie, reopenRubber } from './tie.js';
import { playedContests } from './played-contests.js';

const b = (winner: 'A' | 'B', coinsLeft: number, queen: QueenCover = 'loser'): CarromBoard => ({ winner, coinsLeft, queen });
const R = ICF_CARROM_RULES;

describe('a carrom board', () => {
  it('is worth the loser\'s coins left, plus 3 if the winner covered the queen', () => {
    expect(carromBoardPoints(b('A', 5), 0, R)).toBe(5);
    expect(carromBoardPoints(b('A', 5, 'winner'), 0, R)).toBe(8);
    expect(carromBoardPoints(b('A', 9, 'winner'), 0, R)).toBe(12);
  });

  it('stops counting the queen once the winner is on 22', () => {
    expect(carromBoardPoints(b('A', 2, 'winner'), 21, R)).toBe(5);
    expect(carromBoardPoints(b('A', 2, 'winner'), 22, R)).toBe(2);
  });
});

describe('an ICF game: 25 points or 8 boards', () => {
  it('is won on reaching 25, and the score is capped there', () => {
    const m = carromMatch([b('A', 9, 'winner'), b('A', 9, 'winner'), b('A', 9)], R);
    expect(m.games[0]).toMatchObject({ score: [25, 0], winner: 'A' });
  });

  it('after 8 boards goes to the higher score', () => {
    const eight = [b('A', 2), b('B', 1), b('A', 2), b('B', 1), b('A', 2), b('B', 1), b('A', 2), b('B', 1)];
    expect(carromMatch(eight, R).games[0]).toMatchObject({ score: [8, 4], winner: 'A' });
  });

  it('level after 8 boards plays a tie-breaker board, which decides it', () => {
    const level = [b('A', 2), b('B', 2), b('A', 2), b('B', 2), b('A', 2), b('B', 2), b('A', 2), b('B', 2)];
    const m = carromMatch(level, R);
    expect(m.games[0]).toMatchObject({ score: [8, 8], winner: null, tieBreak: true });
    expect(m.current).toMatchObject({ game: 1, board: 9, tieBreak: true });
    expect(carromMatch([...level, b('B', 1)], R).games[0]).toMatchObject({ winner: 'B' });
  });

  it('alternates the break every board, and each game is opened by the other player', () => {
    const m = carromMatch([b('A', 9, 'winner'), b('A', 9, 'winner'), b('A', 9), b('B', 1)], R, 'A');
    expect(m.games[0].boards.map((x) => x.breaker)).toEqual(['A', 'B', 'A']);
    expect(m.games[1].boards[0].breaker).toBe('B');
    expect(m.nextBreaker).toBe('A');
  });
});

describe('a carrom match', () => {
  const game = (w: 'A' | 'B') => [b(w, 9, 'winner'), b(w, 9, 'winner'), b(w, 9)];

  it('is best of 3 games, headlined in games, and ignores boards after it is decided', () => {
    const m = carromMatch([...game('A'), ...game('B'), ...game('A'), b('B', 9)], R);
    expect(m).toMatchObject({ gamesWon: [2, 1], winner: 'A', decided: true });
    expect(m.games).toHaveLength(3);
    expect(carromHeadline(m, R)).toEqual([2, 1]);
  });

  it('a one-game match is headlined in that game\'s points', () => {
    const single = { ...R, gamesToWin: 1, gameTarget: 29, maxBoards: null };
    const m = carromMatch([b('A', 9, 'winner'), b('B', 4), b('A', 9, 'winner'), b('A', 9)], single);
    expect(m.decided).toBe(true);
    expect(carromHeadline(m, single)).toEqual([29, 4]);
  });

  it('boards-only formats count boards, not points', () => {
    const rules = carromRulesOf(presetByKey('boards_bo5'));
    const m = carromMatch([b('A', 0), b('B', 0), b('A', 0), b('A', 0)], rules);
    expect(m).toMatchObject({ gamesWon: [3, 1], winner: 'A' });
  });
});

describe('carrom career stats', () => {
  // Game 1 to A (A breaks boards 1 and 3, wins 3 boards), game 2 to B, game 3 (decider) to A.
  const boards: CarromBoard[] = [
    b('A', 9, 'winner'), b('B', 2, 'loser'), b('A', 9, 'winner'), { ...b('A', 9), slam: true, fouls: { A: 0, B: 2 } },
    b('B', 9, 'winner'), b('B', 9, 'winner'), b('B', 9),
    b('A', 9, 'winner'), b('A', 9, 'winner'), b('A', 9),
  ];
  const m = carromMatch(boards, R, 'A');

  it('counts real boards, games, points and the decider for each side', () => {
    expect(carromLineStats(m, R, 'A')).toMatchObject({
      boards_won: 6, boards_lost: 4,
      carrom_games: 3, carrom_games_won: 2, carrom_games_lost: 1,
      carrom_deciders: 1, carrom_deciders_won: 1,
      carrom_points_for: 66, carrom_points_against: 35, best_board: 12, slams: 1,
    });
    const bLine = carromLineStats(m, R, 'B');
    expect(bLine).toMatchObject({ boards_won: 4, carrom_games_won: 1, carrom_deciders: 1, carrom_fouls: 2 });
    expect(bLine.carrom_deciders_won).toBeUndefined();
  });

  it('credits the queen to whoever covered it, winner or loser', () => {
    // A: boards 1, 3, 8, 9 as winner, 2 and 7 as loser. B: 5, 6 as winner, 4 and 10 as loser.
    expect(carromLineStats(m, R, 'A').queens).toBe(6);
    expect(carromLineStats(m, R, 'B').queens).toBe(4);
  });

  it('tracks the break, so a win % on your own break can be shown', () => {
    const a = carromLineStats(m, R, 'A');
    expect(a.boards_broken).toBe(5);
    expect(a.board_wins_on_break).toBeGreaterThan(0);
  });

  it('folds into a career with the rates worked out', () => {
    const spec = statSpecFor('carrom')!;
    const career = foldCareerStats(spec, [carromLineStats(m, R, 'A'), carromLineStats(m, R, 'A')]);
    expect(career).toMatchObject({ boards_won: 12, board_win_pct: 60, game_win_pct: 66.7, carrom_points_per_board: 11, best_board: 12 });
  });

  it('lands in board_match_lines columns', () => {
    expect(toCategoryRow('carrom', carromLineStats(m, R, 'A'))!.row).toMatchObject({
      units_won: 6, carrom_games_won: 2, carrom_points_for: 66, slams: 1, queens: 6,
    });
  });

  it('a boards-only match records boards and no points', () => {
    const rules = carromRulesOf(presetByKey('boards_bo5'));
    const s = carromLineStats(carromMatch([b('A', 0), b('A', 0), b('A', 0)], rules), rules, 'A');
    expect(s).toMatchObject({ boards_won: 3 });
    expect(s.carrom_points_for).toBeUndefined();
    expect(s.carrom_games).toBeUndefined();
  });
});

describe('a queen left uncovered (house rules)', () => {
  const corporate = carromRulesOf(presetByKey('corp_bo3_21'));

  it('is offered only where covering is not compulsory', () => {
    expect(queenCoversFor(R)).toEqual(['winner', 'loser']);
    expect(queenCoversFor(corporate)).toEqual(['winner', 'loser', 'none']);
  });

  it('scores no queen points and credits the queen to nobody', () => {
    const board = b('A', 5, 'none');
    expect(carromBoardPoints(board, 0, corporate)).toBe(5);
    const m = carromMatch([board], corporate);
    expect(carromLineStats(m, corporate, 'A').queens).toBeUndefined();
    expect(carromLineStats(m, corporate, 'B').queens).toBeUndefined();
  });
});

describe('a carrom team tie', () => {
  const spec = tieTemplateFor('carrom')!.tie!;
  const boards = { boards: [b('A', 9, 'winner'), b('A', 9, 'winner'), b('A', 9)], firstBreak: 'B' as const };

  it('is an odd best-of in its fallback, not "best of 4 boards"', () => {
    expect(spec.rubbers.every((r) => r.contest.segMax % 2 === 1)).toBe(true);
  });

  it('keeps a rubber\'s boards across a reload, and a full reset clears them', () => {
    const s = initTie(spec);
    s.rubbers[0] = { ...s.rubbers[0], carrom: boards };
    const back = hydrateTie(JSON.parse(JSON.stringify(s)), spec);
    expect(back.rubbers[0].carrom).toEqual(boards);
    expect(reopenRubber(spec, back, 0, true).rubbers[0].carrom).toBeUndefined();
  });

  it('hands each rubber\'s boards to the career records', () => {
    let s = initTie(spec);
    s.rubbers[0] = { ...s.rubbers[0], lineup: { A: ['a1'], B: ['b1'] }, carrom: boards };
    s = decideRubber(spec, s, 0, 'A');
    const r = playedContests({ liveState: { tie: s }, sportName: 'carrom', entryType: 'team', roster: { A: ['a1'], B: ['b1'] }, matchWinner: null });
    expect(r.kind === 'contests' && r.contests[0].carrom?.boards).toHaveLength(3);
  });
});

describe('the carrom presets', () => {
  it('ICF reads as 25 points, best of 3, 8 boards, queen to 22', () => {
    expect(carromRulesOf(presetByKey('icf_bo3_boards'))).toEqual(ICF_CARROM_RULES);
  });

  it('knows carrom by name', () => {
    expect(isCarromSport(' Carrom ')).toBe(true);
    expect(isCarromSport('chess')).toBe(false);
  });
});
