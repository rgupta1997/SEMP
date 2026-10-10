import { foldRally, resultEnvelope, type RallyLog } from './rally-kernel.js';
import { canonicalRacquetSport } from './racquet-presets.js';
import { formatForPairing } from './serve-resolvers.js';
import { CHESS_ENDINGS, isChessSport, whiteOnBoard, type ChessEnding } from './chess.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import { playersPerSide, readLineup, resolveMatchLineup, type RubberLineup } from './tie.js';
import type { MatchPosition } from './enums.js';

// ============================================================================
// Who played what, in one locked fixture.
//
// A team tie is several contests (rubbers) and a player's career is built from the
// ones THEY played. A single racquet match is one contest between the named players.
// The win/loss record, the stat lines and the event rows all read this, so they can
// never disagree about who played.
//
// `legacy` means the fixture predates lineups (or is not a racquet single / tie):
// callers keep their old whole-team behaviour rather than erasing old records.
// ============================================================================

export interface PlayedContest {
  /** null for a single match; the rubber's key ('ms', 'xd' ...) in a tie. */
  rubberKey: string | null;
  rubberLabel: string | null;
  /** User ids per side, in nominated order. */
  lineup: RubberLineup;
  /** The contest's winner; null while undecided or drawn. */
  winner: Side | null;
  /** Finished level - a drawn chess board. */
  drawn?: boolean;
  /** 1-based position of the rubber in the tie: a chess board number. */
  order?: number;
  /** Chess: the side with the white pieces in this contest, when it was recorded. */
  white?: Side;
  /** Chess: how the game ended, when the scorer said. */
  ending?: ChessEnding;
  log: RallyLog;
  /** The rules it was played under, when it was scored point by point. */
  format: ScoringFormat | null;
  firstServer: Side;
  /** Units won per side (games, frames, boards), home first. null when unknown. */
  score: [number, number] | null;
}

export type PlayedContests = { kind: 'contests'; contests: PlayedContest[] } | { kind: 'legacy' };

const side = (v: unknown): Side | null => (v === 'A' || v === 'B' ? v : null);
const logOf = (v: unknown): RallyLog =>
  Array.isArray(v) ? v.filter((e) => !!e && typeof e === 'object' && typeof (e as { t?: unknown }).t === 'string') : [];

// Read under the lineup's own serve rules, as the console scored it: a tie rubber freezes
// the doubles format, and a singles side-out rubber folded as doubles gets the wrong score.
function scoreOf(format: ScoringFormat | null, log: RallyLog, firstServer: Side, lineup: RubberLineup, legacy?: { segsA?: unknown; segsB?: unknown }): [number, number] | null {
  if (format && log.length) {
    const played = formatForPairing(format, lineup);
    const h = resultEnvelope(played, foldRally(played, log, firstServer).state).headline;
    return [h[0], h[1]];
  }
  const a = Number(legacy?.segsA), b = Number(legacy?.segsB);
  return Number.isFinite(a) && Number.isFinite(b) && a + b > 0 ? [a, b] : null;
}

export function playedContests(input: {
  liveState: unknown;
  sportName: string | null;
  /** The discipline's entry type: individual | doubles | team. */
  entryType: string | null;
  /** Each side's squad, by user id. */
  roster: RubberLineup;
  /** The fixture's winner, for a single match. */
  matchWinner: Side | null;
}): PlayedContests {
  const ls = (input.liveState ?? {}) as Record<string, any>;
  const rubbers: any[] | null = Array.isArray(ls.tie?.rubbers) ? ls.tie.rubbers : null;

  if (rubbers) {
    // A tie nobody named anyone in is an old (or fully skipped) one: keep it as it was.
    const touched = rubbers.some((r) => readLineup(r?.lineup) || r?.lineupSkipped === true);
    if (!touched) return { kind: 'legacy' };
    const contests: PlayedContest[] = [];
    for (const [i, r] of rubbers.entries()) {
      const lineup = readLineup(r?.lineup);
      if (!lineup || r?.status === 'dead') continue;
      const format = r?.format && typeof r.format === 'object' ? (r.format as ScoringFormat) : null;
      const log = logOf(r?.rally);
      const firstServer = side(r?.firstServer) ?? 'A';
      contests.push({
        rubberKey: typeof r?.key === 'string' ? r.key : null,
        rubberLabel: typeof r?.label === 'string' ? r.label : null,
        lineup,
        winner: side(r?.winner),
        ...(r?.drawn === true && !side(r?.winner) ? { drawn: true } : {}),
        order: i + 1,
        // Chess colours: the home side has white on board 1 unless the tie says otherwise.
        ...(side(ls.tie?.firstWhite) || isChessSport(input.sportName)
          ? { white: whiteOnBoard(side(ls.tie?.firstWhite) ?? 'A', i) } : {}),
        ...(typeof r?.ending === 'string' && r.ending in CHESS_ENDINGS ? { ending: r.ending as ChessEnding } : {}),
        log,
        format,
        firstServer,
        score: scoreOf(format, log, firstServer, lineup, r?.state),
      });
    }
    return { kind: 'contests', contests };
  }

  // Only racquet singles/doubles have a lineup; a team sport's whole sheet takes the field.
  if (!canonicalRacquetSport(input.sportName)) return { kind: 'legacy' };
  const who = resolveMatchLineup(ls, input.roster, playersPerSide(input.entryType));
  if (who.source === 'legacy') return { kind: 'legacy' };
  if (!who.lineup) return { kind: 'contests', contests: [] };
  const format = ls.format && typeof ls.format === 'object' ? (ls.format as ScoringFormat) : null;
  const log = logOf(ls.rally);
  const firstServer = side(ls.firstServer) ?? 'A';
  return {
    kind: 'contests',
    contests: [{
      rubberKey: null, rubberLabel: null, lineup: who.lineup, winner: input.matchWinner,
      log, format, firstServer, score: scoreOf(format, log, firstServer, who.lineup),
    }],
  };
}

/** One player's view of a contest: their side, partner and opponents. */
export function seatIn(contest: PlayedContest, userId: string): {
  side: Side; partner: string | null; opponents: string[]; position: MatchPosition;
} | null {
  const s: Side | null = contest.lineup.A.includes(userId) ? 'A' : contest.lineup.B.includes(userId) ? 'B' : null;
  if (!s) return null;
  const mine = contest.lineup[s];
  return {
    side: s,
    partner: mine.find((id) => id !== userId) ?? null,
    opponents: contest.lineup[s === 'A' ? 'B' : 'A'],
    position: mine.length > 1 ? 'doubles' : 'singles',
  };
}
