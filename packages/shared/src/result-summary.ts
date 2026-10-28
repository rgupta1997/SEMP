import { boardsOnly, carromMatchOf, carromRulesOf, isCarromSport, readCarromState } from './carrom.js';
import { CHESS_ENDINGS, isChessSport, type ChessEnding } from './chess.js';
import { cornersLine, isHockeySport } from './hockey.js';
import { readRallyLog } from './rally-rows.js';

/**
 * A finished match's detail in one short line, home side first - shown under the bare
 * score on results lists so "2-1" also says how it went.
 *
 *   carrom, best of N   "25–18, 12–25, 25–20"   each game's points
 *   chess, one game     "checkmate"             how it ended, when recorded
 *   chess, best of N    "1–0, ½–½, 1–0"         each game's result
 *
 * null when there is nothing beyond the score to say (a one-game carrom match, a
 * boards-only format, a sport without detail here).
 */
export function resultSummary(sportName: string | null | undefined, liveState: unknown): string | null {
  const ls = (liveState ?? {}) as { carrom?: unknown; chess?: { games?: unknown }; format?: unknown };

  if (isCarromSport(sportName)) {
    const state = readCarromState(ls.carrom);
    if (!state?.boards.length) return null;
    const format = ls.format && typeof ls.format === 'object' && Array.isArray((ls.format as { levels?: unknown }).levels)
      ? ls.format as { levels: Array<{ target: number }>; rulesSheet?: Record<string, unknown> }
      : null;
    const rules = carromRulesOf(format);
    if (boardsOnly(rules) || rules.gamesToWin <= 1) return null;
    const games = carromMatchOf(state, rules).games.filter((g) => g.winner);
    return games.length ? games.map((g) => `${g.score[0]}–${g.score[1]}${g.retired ? ' (ret.)' : ''}`).join(', ') : null;
  }

  if (isChessSport(sportName)) {
    const games = Array.isArray(ls.chess?.games)
      ? (ls.chess!.games as Array<{ result?: unknown; ending?: unknown }>).filter((g) => g && (g.result === 'A' || g.result === 'B' || g.result === 'draw'))
      : [];
    if (games.length === 1) {
      const ending = games[0].ending;
      return typeof ending === 'string' && ending in CHESS_ENDINGS ? CHESS_ENDINGS[ending as ChessEnding].label.toLowerCase() : null;
    }
    if (games.length > 1) return games.map((g) => (g.result === 'A' ? '1–0' : g.result === 'B' ? '0–1' : '½–½')).join(', ');
  }

  // Hockey: the penalty corners each side won, and scored from.
  if (isHockeySport(sportName)) return cornersLine(readRallyLog(liveState));

  return null;
}
