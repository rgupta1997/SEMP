import type { Side } from './scoring-rules.js';

// ============================================================================
// Chess results (FIDE Laws of Chess, art. 5 and 6; Olympiad / team match rules).
//
// Nothing is counted during a chess game: only its result. A game is worth one point -
// 1-0, ½-½ or 0-1 - and a match or a team match is the sum of its games' points.
// Draws are the normal case, not an edge one, which is why every total here can hold
// a half. Stored as plain numbers (1.5); `formatPoints` writes them the chess way (1½).
// ============================================================================

export const CHESS_SPORT = 'chess';
export const isChessSport = (name?: string | null): boolean => (name ?? '').trim().toLowerCase() === CHESS_SPORT;

/** One game's result from the fixture's point of view: a side won, or it was drawn. */
export type ChessResult = Side | 'draw';

/** How a game ended. Optional on every game - the result is what scores. */
export const CHESS_ENDINGS = {
  checkmate: { label: 'Checkmate', drawn: false },
  resignation: { label: 'Resignation', drawn: false },
  time: { label: 'Lost on time', drawn: false },
  forfeit: { label: 'Forfeit / no-show', drawn: false },
  agreement: { label: 'Draw by agreement', drawn: true },
  stalemate: { label: 'Stalemate', drawn: true },
  repetition: { label: 'Threefold repetition', drawn: true },
  fifty_moves: { label: '50-move rule', drawn: true },
  insufficient: { label: 'Insufficient material', drawn: true },
  // FIDE 6.9: a flag fall is a draw when the opponent cannot possibly checkmate.
  time_vs_insufficient: { label: 'Time out vs insufficient material', drawn: true },
} as const;
export type ChessEnding = keyof typeof CHESS_ENDINGS;

/** The endings that fit a result: decisive ones for a win, drawn ones for a draw. */
export const endingsFor = (result: ChessResult): ChessEnding[] =>
  (Object.keys(CHESS_ENDINGS) as ChessEnding[]).filter((k) => CHESS_ENDINGS[k].drawn === (result === 'draw'));

export interface ChessGame {
  /** Which side had the white pieces. */
  white: Side;
  result: ChessResult;
  ending?: ChessEnding;
}

/** The points one game gives each side, home first. */
export const gamePoints = (result: ChessResult): [number, number] =>
  result === 'draw' ? [0.5, 0.5] : result === 'A' ? [1, 0] : [0, 1];

/**
 * A match of `gamesInMatch` games between the same two sides. Decided as soon as one
 * side has more than half the points (it cannot be caught), or once every game is
 * played - level then is a drawn match, settled by the organiser's tie-break if needed.
 */
export function chessMatchOutcome(games: ChessGame[], gamesInMatch: number): {
  points: [number, number]; winner: Side | null; drawn: boolean; decided: boolean;
} {
  const points: [number, number] = [0, 0];
  for (const g of games) {
    const [a, b] = gamePoints(g.result);
    points[0] += a;
    points[1] += b;
  }
  const half = gamesInMatch / 2;
  const winner: Side | null = points[0] > half ? 'A' : points[1] > half ? 'B' : null;
  const allPlayed = games.length >= gamesInMatch;
  const drawn = !winner && allPlayed && points[0] === points[1];
  // Every game played and one side ahead (a match with an even number of games).
  const ahead: Side | null = !winner && allPlayed && points[0] !== points[1] ? (points[0] > points[1] ? 'A' : 'B') : null;
  return { points, winner: winner ?? ahead, drawn, decided: !!(winner ?? ahead) || drawn };
}

/** Colours alternate game to game in a match, starting from whoever had white in game 1. */
export const whiteInGame = (firstWhite: Side, index: number): Side =>
  index % 2 === 0 ? firstWhite : firstWhite === 'A' ? 'B' : 'A';

/**
 * Olympiad colours: the team named first has white on boards 1 and 3, the other on
 * 2 and 4. `firstWhite` is who had white on board 1.
 */
export const whiteOnBoard = (firstWhite: Side, boardIndex: number): Side => whiteInGame(firstWhite, boardIndex);

/** The endings counted in career stats - the four a player is asked about most. */
const ENDING_STAT: Partial<Record<ChessEnding, string>> = {
  checkmate: 'wins_by_checkmate',
  resignation: 'wins_by_resignation',
  time: 'wins_on_time',
  agreement: 'draws_by_agreement',
};

/**
 * One player's counters from a match's games. Points are doubled so a half stays an
 * integer; the `_max_x2` counters (2 a game) are what score % is measured against, so
 * "score with white" means points won of points available with white.
 * A game with no recorded colour still counts - just not in either colour.
 */
export function chessLineStats(
  games: Array<{ result: ChessResult; white?: Side | null; ending?: ChessEnding }>,
  side: Side,
): Record<string, number> {
  const s: Record<string, number> = {};
  const add = (k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };
  for (const g of games) {
    const won = g.result === side;
    const pts = g.result === 'draw' ? 1 : won ? 2 : 0;
    add('chess_games'); add('chess_points_x2', pts); add('chess_points_max_x2', 2);
    add(g.result === 'draw' ? 'chess_draws' : won ? 'chess_wins' : 'chess_losses');
    if (g.white === 'A' || g.white === 'B') {
      const colour = g.white === side ? 'white' : 'black';
      add(`${colour}_games`); add(`${colour}_points_x2`, pts); add(`${colour}_points_max_x2`, 2);
    }
    // Wins by checkmate count for the winner; a draw by agreement for both.
    const stat = g.ending ? ENDING_STAT[g.ending] : undefined;
    if (stat && (g.result === 'draw' || won)) add(stat);
  }
  return s;
}

/**
 * "90+30" -> "90 min + 30 s a move". A format's time control, worded for the screen;
 * anything that is not base+increment is shown as written.
 */
export function describeTimeControl(tc: unknown): string | null {
  if (typeof tc !== 'string' || !tc.trim()) return null;
  const m = /^\s*(\d+)\s*\+\s*(\d+)\s*$/.exec(tc);
  if (!m) return tc.trim();
  const [, base, inc] = m;
  return Number(inc) > 0 ? `${base} min + ${inc} s a move` : `${base} min`;
}

/** 2.5 -> "2½", 0.5 -> "½", 3 -> "3". Whole numbers (every other sport) are untouched. */
export function formatPoints(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const whole = Math.floor(n);
  const half = Math.abs(n - whole - 0.5) < 1e-9;
  if (!half) return String(Math.round(n * 100) / 100);
  return whole === 0 ? '½' : `${whole}½`;
}
