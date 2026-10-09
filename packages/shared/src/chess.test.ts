import { describe, expect, it } from 'vitest';
import { chessLineStats, chessMatchOutcome, describeTimeControl, endingsFor, formatPoints, gamePoints, whiteInGame, whiteOnBoard, type ChessGame } from './chess.js';
import { foldCareerStats, statSpecFor } from './stat-registry.js';
import { toCategoryRow } from './category-lines.js';
import { chessPresetForDiscipline } from './team-presets.js';
import { decideRubber, initTie, reopenRubber, tieOutcome, tieScore, tieTarget, tieWinner } from './tie.js';
import { tieTemplateFor } from './tie-templates.js';
import { playedContests } from './played-contests.js';
import { chessStandingsRule } from './schemas.js';
import type { TieSpec } from './scoring.js';

const g = (result: ChessGame['result'], white: ChessGame['white'] = 'A'): ChessGame => ({ white, result });

describe('a chess game', () => {
  it('is worth one point: 1-0, ½-½ or 0-1', () => {
    expect(gamePoints('A')).toEqual([1, 0]);
    expect(gamePoints('draw')).toEqual([0.5, 0.5]);
    expect(gamePoints('B')).toEqual([0, 1]);
  });

  it('offers only the endings that fit the result', () => {
    expect(endingsFor('draw')).toContain('stalemate');
    expect(endingsFor('draw')).not.toContain('checkmate');
    expect(endingsFor('A')).toContain('resignation');
    expect(endingsFor('A')).not.toContain('agreement');
  });

  it('writes halves the chess way and leaves whole numbers alone', () => {
    expect(formatPoints(2.5)).toBe('2½');
    expect(formatPoints(0.5)).toBe('½');
    expect(formatPoints(3)).toBe('3');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(null)).toBe('');
  });
});

describe('a chess match', () => {
  it('a single game: a win decides it, a draw is a drawn match', () => {
    expect(chessMatchOutcome([g('A')], 1)).toMatchObject({ points: [1, 0], winner: 'A', decided: true });
    expect(chessMatchOutcome([g('draw')], 1)).toMatchObject({ points: [0.5, 0.5], winner: null, drawn: true, decided: true });
  });

  it('three games: decided once a side cannot be caught', () => {
    expect(chessMatchOutcome([g('A'), g('A')], 3)).toMatchObject({ points: [2, 0], winner: 'A', decided: true });
    // 1½-½ is not over: winning game 3 levels it at 1½-1½.
    expect(chessMatchOutcome([g('A'), g('draw')], 3)).toMatchObject({ points: [1.5, 0.5], winner: null, decided: false });
    expect(chessMatchOutcome([g('A'), g('B')], 3)).toMatchObject({ winner: null, decided: false });
    expect(chessMatchOutcome([g('draw'), g('draw'), g('draw')], 3)).toMatchObject({ points: [1.5, 1.5], drawn: true });
  });

  it('colours alternate from whoever had white first', () => {
    expect([0, 1, 2].map((i) => whiteInGame('B', i))).toEqual(['B', 'A', 'B']);
    expect([0, 1, 2, 3].map((i) => whiteOnBoard('A', i))).toEqual(['A', 'B', 'A', 'B']);
  });
});

describe('a chess team match (Olympiad style)', () => {
  const spec = tieTemplateFor('chess')!.tie as TieSpec;

  it('is won on board points, every board played', () => {
    expect(spec.boardPoints).toBe(true);
    expect(spec.skipDeadRubbers).toBe(false);
    expect(tieTarget(spec)).toBe(2.5);
  });

  it('a drawn board is ½ each: 1, ½, ½, 0 is a 2-2 drawn match', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s = decideRubber(spec, s, 1, 'draw');
    s = decideRubber(spec, s, 2, 'draw');
    expect(tieWinner(spec, s)).toBeNull();
    s = decideRubber(spec, s, 3, 'B');
    expect(tieScore(spec, s)).toEqual({ a: 2, b: 2 });
    expect(tieOutcome(spec, s)).toMatchObject({ winner: null, drawn: true, decided: true });
  });

  it('2½-1½ wins the match', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s = decideRubber(spec, s, 1, 'A');
    s = decideRubber(spec, s, 2, 'draw');
    expect(tieScore(spec, s)).toEqual({ a: 2.5, b: 0.5 });
    expect(tieWinner(spec, s)).toBe('A');
    // The match is won, but the last board is still played - nothing is skipped.
    expect(s.rubbers[3].status).toBe('pending');
  });

  it('a board keeps how it ended until its result changes', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'draw');
    s = { ...s, rubbers: s.rubbers.map((r, i) => (i === 0 ? { ...r, ending: 'repetition' as const } : r)) };
    expect(decideRubber(spec, s, 0, 'draw').rubbers[0].ending).toBe('repetition');
    expect(decideRubber(spec, s, 0, 'A').rubbers[0].ending).toBeUndefined();
  });

  it('reopening a drawn board clears the draw', () => {
    const s = reopenRubber(spec, decideRubber(spec, initTie(spec), 0, 'draw'), 0);
    expect(s.rubbers[0].drawn).toBeUndefined();
    expect(tieScore(spec, s)).toEqual({ a: 0, b: 0 });
  });

  it('a draw is refused where the format has no draws', () => {
    const racquet = tieTemplateFor('badminton')!.tie as TieSpec;
    const s = initTie(racquet);
    expect(decideRubber(racquet, s, 0, 'draw')).toBe(s);
  });

  it('with no colour chosen, home has white on board 1 - so colour stats are never lost', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s.rubbers[0].lineup = { A: ['a1'], B: ['b1'] };
    s = decideRubber(spec, s, 1, 'B');
    s.rubbers[1].lineup = { A: ['a2'], B: ['b2'] };
    const played = playedContests({
      liveState: { tie: s }, sportName: 'chess', entryType: 'team',
      roster: { A: ['a1', 'a2'], B: ['b1', 'b2'] }, matchWinner: null,
    });
    if (played.kind !== 'contests') throw new Error('expected contests');
    expect(played.contests.map((c) => c.white)).toEqual(['A', 'B']);
  });

  it('each board credits its players with the result, board number and colour', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s = decideRubber(spec, s, 1, 'draw');
    s.rubbers[0].lineup = { A: ['a1'], B: ['b1'] };
    s.rubbers[1].lineup = { A: ['a2'], B: ['b2'] };
    const played = playedContests({
      liveState: { tie: { ...s, firstWhite: 'B' } }, sportName: 'chess', entryType: 'team',
      roster: { A: ['a1', 'a2'], B: ['b1', 'b2'] }, matchWinner: null,
    });
    expect(played.kind).toBe('contests');
    if (played.kind !== 'contests') return;
    expect(played.contests[0]).toMatchObject({ winner: 'A', order: 1, white: 'B' });
    expect(played.contests[1]).toMatchObject({ winner: null, drawn: true, order: 2, white: 'A' });
  });
});

describe('chess career counters', () => {
  // A three-game match: won with white by mate, drawn with black by agreement, lost with white.
  const games = [
    { result: 'A' as const, white: 'A' as const, ending: 'checkmate' as const },
    { result: 'draw' as const, white: 'B' as const, ending: 'agreement' as const },
    { result: 'B' as const, white: 'A' as const },
  ];

  it('counts every game, not just the match, split by colour', () => {
    expect(chessLineStats(games, 'A')).toMatchObject({
      chess_games: 3, chess_wins: 1, chess_draws: 1, chess_losses: 1,
      chess_points_x2: 3, chess_points_max_x2: 6,
      white_games: 2, white_points_x2: 2, white_points_max_x2: 4,
      black_games: 1, black_points_x2: 1, black_points_max_x2: 2,
      wins_by_checkmate: 1, draws_by_agreement: 1,
    });
  });

  it('gives the other side the mirror image, and a mate only to the winner', () => {
    const b = chessLineStats(games, 'B');
    expect(b).toMatchObject({ chess_wins: 1, chess_points_x2: 3, white_games: 1, black_games: 2, draws_by_agreement: 1 });
    expect(b.wins_by_checkmate).toBeUndefined();
  });

  it('folds into score % by colour over a career', () => {
    const spec = statSpecFor('chess')!;
    const career = foldCareerStats(spec, [chessLineStats(games, 'A'), chessLineStats([{ result: 'A', white: 'B' }], 'A')]);
    expect(career).toMatchObject({ chess_games: 4, chess_score_pct: 62.5, white_score_pct: 50, black_score_pct: 75, chess_draw_pct: 25 });
  });

  it('lands in the board table, a column per counter', () => {
    const r = toCategoryRow('chess', chessLineStats(games, 'A'))!;
    expect(r.unmapped).toEqual([]);
    expect(r.row).toMatchObject({ chess_games: 3, white_points_x2: 2, wins_by_checkmate: 1 });
  });

  it('a Rapid or Blitz draw with no format plays at its own pace', () => {
    expect(chessPresetForDiscipline('Rapid')?.rulesSheet?.timeControl).toBe('15+10');
    expect(chessPresetForDiscipline('U-14 Blitz')?.rulesSheet?.timeControl).toBe('3+2');
    expect(chessPresetForDiscipline('Standard')).toBeUndefined();
  });

  it('words the time control', () => {
    expect(describeTimeControl('90+30')).toBe('90 min + 30 s a move');
    expect(describeTimeControl('60+0')).toBe('60 min');
    expect(describeTimeControl('G/60')).toBe('G/60');
    expect(describeTimeControl(undefined)).toBeNull();
  });
});

describe('chess standings', () => {
  it('a draw is half a win, and a team match ranks by match points then board points', () => {
    const solo = chessStandingsRule(false);
    const team = chessStandingsRule(true);
    expect(solo).toMatchObject({ win: 2, draw: 1, loss: 0 });
    expect(team.tiebreakers.slice(0, 2)).toEqual(['points', 'score_diff']);
  });
});
