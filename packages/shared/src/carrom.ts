import type { Side } from './scoring-rules.js';

// ============================================================================
// Carrom, scored the way it is played (ICF / AICF laws).
//
//   board  - one round, over when a player pockets all nine of their coins. The
//            winner scores 1 point per opponent coin left on the board, plus 3 for
//            the queen if the WINNER covered it - but only while their game score is
//            under 22. The loser of a board never scores on it.
//   game   - first to 25 points, or the higher score after 8 boards (a tie-break
//            board settles a level game).
//   match  - best of 3 games.
//
// Nothing is counted during play: the official records each board's result and the
// points follow from it - the way a carrom scoresheet is kept.
// ============================================================================

export const CARROM_SPORT = 'carrom';
export const isCarromSport = (name?: string | null): boolean => (name ?? '').trim().toLowerCase() === CARROM_SPORT;

/** Coins per player (or pair) - and so the most a board can be won by on coins. */
export const CARROM_COINS = 9;

/**
 * Who covered the queen on a board. The loser covering it scores nobody anything.
 * 'none' - left uncovered - only exists where covering is not compulsory (house rules);
 * under ICF a board cannot end with the queen uncovered.
 */
export const QUEEN_COVER = ['winner', 'loser', 'none'] as const;
export type QueenCover = (typeof QUEEN_COVER)[number];

export interface CarromBoard {
  winner: Side;
  /** The loser's coins still on the board when it ended, 0-9. Unused in boards-only formats. */
  coinsLeft: number;
  queen: QueenCover;
  /** All coins and the queen pocketed in one turn from the break. */
  slam?: boolean;
  /** Fouls (dues) per side on this board - recorded, they move no points. */
  fouls?: { A: number; B: number };
}

/** A carrom match as recorded - stored in live_state.carrom, or on a tie rubber. */
export interface CarromBoardsState {
  boards: CarromBoard[];
  /** Who broke (and so played white on) the first board - the toss. */
  firstBreak: Side;
}

/** A stored carrom state, tolerating anything malformed; null when there is none. */
export function readCarromState(raw: unknown): CarromBoardsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { boards?: unknown; firstBreak?: unknown };
  if (!Array.isArray(r.boards)) return null;
  const boards = r.boards.filter((b): b is CarromBoard =>
    !!b && typeof b === 'object' && ((b as CarromBoard).winner === 'A' || (b as CarromBoard).winner === 'B')
    && typeof (b as CarromBoard).coinsLeft === 'number');
  return { boards, firstBreak: r.firstBreak === 'B' ? 'B' : 'A' };
}

export interface CarromRules {
  /** Points that win a game (25 ICF). 1 or less = boards-only: each board is a point. */
  gameTarget: number;
  /** Games needed to win the match (2 = best of 3). */
  gamesToWin: number;
  /** A game ends after this many boards even short of the target (8 ICF); null = no limit. */
  maxBoards: number | null;
  queenPoints: number;
  /** The queen stops counting once the board winner's game score has reached this. */
  queenCutoff: number | null;
  /** ICF: a board cannot end with the queen uncovered, so 'none' is not offered. */
  queenMustBeCovered: boolean;
}

export const ICF_CARROM_RULES: CarromRules = {
  gameTarget: 25, gamesToWin: 2, maxBoards: 8, queenPoints: 3, queenCutoff: 22, queenMustBeCovered: true,
};

/** The queen choices a format offers. */
export const queenCoversFor = (rules: CarromRules): readonly QueenCover[] =>
  rules.queenMustBeCovered ? ['winner', 'loser'] : QUEEN_COVER;

/** The rules a carrom format describes: target and best-of from its levels, the rest from its rules sheet. */
export function carromRulesOf(format: { levels: Array<{ target: number }>; rulesSheet?: Record<string, unknown> } | null | undefined): CarromRules {
  if (!format?.levels?.length) return ICF_CARROM_RULES;
  const sheet = format.rulesSheet ?? {};
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const top = format.levels[format.levels.length - 1];
  return {
    gameTarget: format.levels[0].target,
    gamesToWin: format.levels.length > 1 ? top.target : 1,
    maxBoards: num(sheet.maxBoards),
    queenPoints: num(sheet.queenPoints) ?? 3,
    queenCutoff: num(sheet.queenCutoff),
    queenMustBeCovered: sheet.queenMustBeCovered === true,
  };
}

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

export const boardsOnly = (rules: CarromRules): boolean => rules.gameTarget <= 1;

/** Points a board is worth to its winner, given the winner's game score before it. */
export function carromBoardPoints(board: CarromBoard, winnerScoreBefore: number, rules: CarromRules): number {
  if (boardsOnly(rules)) return 1;
  const coins = Math.max(0, Math.min(CARROM_COINS, Math.round(board.coinsLeft)));
  const queen = board.queen === 'winner' && (rules.queenCutoff == null || winnerScoreBefore < rules.queenCutoff)
    ? rules.queenPoints : 0;
  return coins + queen;
}

export interface CarromGame {
  boards: Array<CarromBoard & { points: number; breaker: Side }>;
  score: [number, number];
  winner: Side | null;
  /** Level after the board limit: the next board is a tie-breaker. */
  tieBreak: boolean;
}

export interface CarromMatch {
  games: CarromGame[];
  gamesWon: [number, number];
  winner: Side | null;
  decided: boolean;
  /** Who breaks the next board to be played. */
  nextBreaker: Side;
  /** Where the next board goes: the game in progress (or the next one) and its board number. */
  current: { game: number; board: number; tieBreak: boolean };
}

/**
 * Fold a match's boards, in play order, into games and a result.
 *
 * The break alternates every board; each new game is opened by the player who did not
 * open the last one. A game's score is capped at its target - 25 is the most a game
 * can be won by - and boards recorded after the match is decided are ignored.
 */
export function carromMatch(boards: CarromBoard[], rules: CarromRules, firstBreak: Side = 'A'): CarromMatch {
  const games: CarromGame[] = [];
  const won: [number, number] = [0, 0];
  let game: CarromGame = { boards: [], score: [0, 0], winner: null, tieBreak: false };
  let opener = firstBreak;
  let decided = false;

  for (const b of boards) {
    if (decided) break;
    const breaker = game.boards.length % 2 === 0 ? opener : other(opener);
    const wi = b.winner === 'A' ? 0 : 1;
    const points = carromBoardPoints(b, game.score[wi], rules);
    game.boards.push({ ...b, points, breaker });
    game.score[wi] = boardsOnly(rules) ? game.score[wi] + 1 : Math.min(rules.gameTarget, game.score[wi] + points);

    const played = game.boards.length;
    const reached = game.score[0] >= rules.gameTarget || game.score[1] >= rules.gameTarget;
    const limit = !boardsOnly(rules) && rules.maxBoards != null && played >= rules.maxBoards;
    if (reached || boardsOnly(rules)) {
      game.winner = game.score[0] >= rules.gameTarget ? 'A' : game.score[1] >= rules.gameTarget ? 'B' : b.winner;
    } else if (limit) {
      // Over the board limit: the higher score wins; level means the board just played
      // was a tie-breaker (it decides) or the next one will be.
      if (game.score[0] !== game.score[1]) game.winner = game.score[0] > game.score[1] ? 'A' : 'B';
      else if (game.tieBreak) game.winner = b.winner;
      else game.tieBreak = true;
      if (!game.winner && played > rules.maxBoards!) game.winner = b.winner;
    }
    if (game.winner) {
      won[game.winner === 'A' ? 0 : 1] += 1;
      games.push(game);
      decided = won[0] >= rules.gamesToWin || won[1] >= rules.gamesToWin;
      opener = other(opener);
      game = { boards: [], score: [0, 0], winner: null, tieBreak: false };
    }
  }
  const inProgress = !decided && game.boards.length > 0;
  if (inProgress) games.push(game);
  const nextBreaker = game.boards.length % 2 === 0 ? opener : other(opener);
  return {
    games,
    gamesWon: won,
    winner: decided ? (won[0] > won[1] ? 'A' : 'B') : null,
    decided,
    nextBreaker,
    current: { game: games.length + (inProgress ? 0 : 1), board: game.boards.length + 1, tieBreak: game.tieBreak },
  };
}

/**
 * One side's career counters from a match (both players of a doubles pair get the
 * same line). Boards here are real boards - the 25-point game is `carrom_games`.
 */
export function carromLineStats(m: CarromMatch, rules: CarromRules, side: Side): Record<string, number> {
  const s: Record<string, number> = {};
  const add = (k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };
  const points = !boardsOnly(rules);
  // Games-level counters only where a game is more than one board.
  if (points) {
    for (const g of m.games) {
      if (!g.winner) continue;
      add('carrom_games');
      add(g.winner === side ? 'carrom_games_won' : 'carrom_games_lost');
    }
    // The deciding game: the last one of a best-of-N that went the distance.
    const finished = m.games.filter((g) => g.winner);
    if (rules.gamesToWin > 1 && finished.length === rules.gamesToWin * 2 - 1) {
      add('carrom_deciders');
      if (finished[finished.length - 1].winner === side) add('carrom_deciders_won');
    }
  }
  s.boards_won = 0; s.boards_lost = 0;
  for (const g of m.games) {
    for (const b of g.boards) {
      const won = b.winner === side;
      add(won ? 'boards_won' : 'boards_lost');
      if (b.breaker === side) { add('boards_broken'); if (won) add('board_wins_on_break'); }
      if (points) {
        add(won ? 'carrom_points_for' : 'carrom_points_against', b.points);
        if (won) s.best_board = Math.max(s.best_board ?? 0, b.points);
        // Covered by me: as the winner, or as the loser who covered it for nothing.
        // Left uncovered ('none') credits nobody.
        if (b.queen !== 'none' && (b.queen === 'winner') === won) add('queens');
      }
      if (won && b.slam) add('slams');
      const f = b.fouls?.[side];
      if (f) add('carrom_fouls', f);
    }
  }
  return s;
}

/** The fixture's score: games won, or - in a one-game match - that game's points. */
export function carromHeadline(m: CarromMatch, rules: CarromRules): [number, number] {
  if (rules.gamesToWin <= 1 && m.games[0]) return [m.games[0].score[0], m.games[0].score[1]];
  return [m.gamesWon[0], m.gamesWon[1]];
}
