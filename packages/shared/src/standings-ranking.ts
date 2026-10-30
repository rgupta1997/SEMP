import { z } from 'zod';
import { STAGE_DEFAULT_TIEBREAKERS, STANDINGS_TIEBREAKER, type StandingsTiebreaker } from './enums.js';
import { canonicalTeamSport } from './team-presets.js';
import { canonicalRacquetSport } from './racquet-presets.js';
import { canonicalCricketSport } from './cricket-rules.js';
import { isChessSport } from './chess.js';
import type { StandingsRule } from './schemas.js';

// How teams are ranked INSIDE a group or league: the match points that build the table
// and the tie-breakers that order it. Separate from the championship tally (what each
// final placing is worth), which the standings rule decides.

export interface GroupRanking {
  win: number;
  draw: number;
  loss: number;
  tiebreakers: StandingsTiebreaker[];
}

export const groupRankingSchema = z.object({
  win: z.number().min(0).max(100),
  draw: z.number().min(0).max(100),
  loss: z.number().min(0).max(100),
  tiebreakers: z.array(z.enum(STANDINGS_TIEBREAKER)).min(1),
});

/** Sport families share how a table is read (goals, sets, games, rubbers...). */
export type RankingFamily = 'goals' | 'points' | 'sets' | 'games' | 'frames' | 'ties' | 'chess' | 'runs' | 'generic';

const FAMILY_BY_TEAM_SPORT: Record<string, RankingFamily> = {
  football: 'goals', futsal: 'goals', hockey: 'goals', handball: 'goals',
  basketball: 'points', frisbee: 'points', kabaddi: 'points', 'kho-kho': 'points',
  volleyball: 'sets', throwball: 'sets',
  // Carrom's headline is boards or games depending on the format, so it stays generic.
  carrom: 'generic', 'pool/snooker': 'frames',
};
// Sports whose TEAM event is a tie of rubbers, where the headline score is rubbers won.
const TIE_SPORTS = new Set(['carrom', 'pool/snooker']);

/** `entryType` matters for racquet / cue sports: singles score games, a team tie scores rubbers. */
export function rankingFamily(sport?: string | null, entryType?: string | null): RankingFamily {
  if (isChessSport(sport)) return 'chess';
  if (canonicalCricketSport(sport)) return 'runs';
  const team = canonicalTeamSport(sport);
  const racquet = !!canonicalRacquetSport(sport);
  if (entryType === 'team' && (racquet || TIE_SPORTS.has(team ?? ''))) return 'ties';
  if (racquet) return 'games';
  return (team && FAMILY_BY_TEAM_SPORT[team]) || 'generic';
}

const STANDARD_ORDER: StandingsTiebreaker[] = ['points', 'score_diff', 'score_for', 'head_to_head'];
// Carrom: matches won, then games won. Still level is a tie-break game, then a hand-picked order.
const CARROM_ORDER: StandingsTiebreaker[] = ['points', 'score_for'];
// Kho-kho: points, then ADT. Still level is a minimum chase, then a hand-picked order.
const KHO_ORDER: StandingsTiebreaker[] = ['points', 'adt'];

// Match points per sport, from the common rulebooks (IIMK uses the same values).
const POINTS_BY_TEAM_SPORT: Record<string, [number, number, number]> = {
  basketball: [2, 1, 0],
  'kho-kho': [2, 1, 0],
};

// Sports whose rulebooks never rank by total scored (games, sets, frames, rubbers, runs):
// only the difference matters there, so "score for" is not offered.
const NO_SCORE_FOR = new Set<RankingFamily>(['games', 'sets', 'frames', 'ties', 'runs']);
const withoutScoreFor = (order: StandingsTiebreaker[], family: RankingFamily) =>
  (NO_SCORE_FOR.has(family) ? order.filter((t) => t !== 'score_for') : order);

export function defaultGroupRanking(sport?: string | null): GroupRanking {
  const family = rankingFamily(sport);
  if (family === 'chess') return { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'score_diff', 'score_for', 'head_to_head'] };
  if (family === 'runs') return { win: 2, draw: 1, loss: 0, tiebreakers: ['points', 'wins', 'score_diff', 'head_to_head'] };
  if (canonicalRacquetSport(sport) === 'squash') return { win: 2, draw: 1, loss: 0, tiebreakers: withoutScoreFor(STANDARD_ORDER, family) };
  const [win, draw, loss] = POINTS_BY_TEAM_SPORT[canonicalTeamSport(sport) ?? ''] ?? [3, 1, 0];
  if (canonicalTeamSport(sport) === 'carrom') return { win, draw, loss, tiebreakers: CARROM_ORDER };
  if (canonicalTeamSport(sport) === 'kho-kho') return { win, draw, loss, tiebreakers: KHO_ORDER };
  return { win, draw, loss, tiebreakers: withoutScoreFor(STANDARD_ORDER, family) };
}

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * The ranking a group / league table actually uses. A stage set in Configure stages wins,
 * then the discipline's own ranking, then a match-points rule's W/D/L, then the sport default.
 * A stage tie-breaker order equal to a default (schema or sport) was never chosen by anyone,
 * so it doesn't override the Point System.
 */
export function groupRankingFor(
  rule: StandingsRule | null | undefined, sport?: string | null,
  stage?: { tiebreakers: StandingsTiebreaker[]; points?: { win: number; draw: number; loss: number } },
): GroupRanking {
  const sportDefault = defaultGroupRanking(sport);
  const own = rule?.scheme === 'placement' ? rule.ranking : undefined;
  const base: GroupRanking = own ? { win: own.win, draw: own.draw, loss: own.loss, tiebreakers: own.tiebreakers ?? sportDefault.tiebreakers }
    : rule?.scheme === 'league_points' ? { win: rule.win, draw: rule.draw, loss: rule.loss, tiebreakers: rule.tiebreakers }
    : sportDefault;
  if (!stage) return base;
  const points = stage.points ?? { win: base.win, draw: base.draw, loss: base.loss };
  const chosen = !sameOrder(stage.tiebreakers, STAGE_DEFAULT_TIEBREAKERS) && !sameOrder(stage.tiebreakers, sportDefault.tiebreakers);
  return { ...points, tiebreakers: chosen ? stage.tiebreakers : base.tiebreakers };
}

/** A placings rule with no table ranking of its own takes its parent's (format, then default). */
export function inheritRanking(rule: StandingsRule, ...parents: Array<StandingsRule | undefined>): StandingsRule {
  if (rule.scheme !== 'placement' || rule.ranking) return rule;
  const from = parents.find((p) => p?.scheme === 'placement' && p.ranking);
  return from?.scheme === 'placement' ? { ...rule, ranking: from.ranking } : rule;
}

// What each tie-breaker is called in a sport, so organisers read their own terms.
const LABELS: Record<RankingFamily, Partial<Record<StandingsTiebreaker, string>>> = {
  goals: { score_diff: 'Goal difference', score_for: 'Goals scored' },
  points: { score_diff: 'Point difference', score_for: 'Points scored' },
  sets: { score_diff: 'Set difference', score_for: 'Sets won' },
  games: { score_diff: 'Game difference', score_for: 'Games won' },
  frames: { score_diff: 'Frame difference', score_for: 'Frames won' },
  ties: { score_diff: 'Matches won (net)', score_for: 'Matches won' },
  chess: { score_diff: 'Game points (net)', score_for: 'Game points' },
  runs: { score_diff: 'Run difference', score_for: 'Runs scored' },
  generic: { score_diff: 'Score difference', score_for: 'Score for' },
};
const COMMON_LABELS: Record<StandingsTiebreaker, string> = {
  points: 'Points', wins: 'Wins', lost: 'Fewest losses', head_to_head: 'Head-to-head',
  score_diff: 'Score difference', score_for: 'Score for',
  frames_won: 'Frames won', ball_diff: 'Net ball difference',
  adt: 'ADT (average difference time)',
};

// A carrom tie's rubbers are "games" in the rulebook, not matches.
const CARROM_TIE_LABELS: Partial<Record<StandingsTiebreaker, string>> = { score_diff: 'Games won (net)', score_for: 'Games won' };

export function tiebreakerLabel(tb: StandingsTiebreaker, sport?: string | null, entryType?: string | null): string {
  const family = rankingFamily(sport, entryType);
  if (family === 'ties' && canonicalTeamSport(sport) === 'carrom' && CARROM_TIE_LABELS[tb]) return CARROM_TIE_LABELS[tb]!;
  return LABELS[family][tb] ?? COMMON_LABELS[tb];
}

/** The tie-breakers an organiser can pick from, in a sensible display order. */
export const TIEBREAKER_OPTIONS: StandingsTiebreaker[] = ['points', 'score_diff', 'score_for', 'head_to_head', 'wins', 'lost'];
/** Read from the frames recorded in a pool team tie, so offered there only. */
export const POOL_TIE_TIEBREAKERS: StandingsTiebreaker[] = ['frames_won', 'ball_diff'];

/** The options that make sense for a sport. No sport (a default / format row) = all general ones. */
export function tiebreakerOptions(sport?: string | null, entryType?: string | null): StandingsTiebreaker[] {
  if (!sport) return TIEBREAKER_OPTIONS;
  // Carrom ranks on games won (Inter-IIM), so it keeps "score for" even as a team tie.
  const own = canonicalTeamSport(sport) === 'carrom' ? TIEBREAKER_OPTIONS : withoutScoreFor(TIEBREAKER_OPTIONS, rankingFamily(sport, entryType));
  if (canonicalTeamSport(sport) === 'kho-kho') return ['points', 'adt', ...own.filter((t) => t !== 'points')];
  return canonicalTeamSport(sport) === 'pool/snooker' && entryType === 'team' ? [...own, ...POOL_TIE_TIEBREAKERS] : own;
}

// ---------- Hand-picked tie resolutions ----------
// When tie-breakers can't separate teams, the organiser sets their order with a reason.
// Stored on the draw's format_config.tieResolutions; matched by the SET of tied teams, so
// a resolution stops applying by itself if later results change who is tied.

export const TIE_RESOLUTION_SCOPE = ['pool', 'placing'] as const;
export type TieResolutionScope = (typeof TIE_RESOLUTION_SCOPE)[number];

export const tieResolutionInputSchema = z.object({
  scope: z.enum(TIE_RESOLUTION_SCOPE),
  stage: z.number().int().min(1).default(1),
  pool: z.number().int().min(1).nullable().default(null),
  /** Contingent keys of the tied teams, best first. */
  order: z.array(z.string().min(1)).min(2).max(32),
  reason: z.string().trim().min(3).max(300),
});
export type TieResolutionInput = z.infer<typeof tieResolutionInputSchema>;

export interface TieResolution extends TieResolutionInput {
  id?: string;
  by: string | null;
  by_name?: string | null;
  at: string;
}

export function readTieResolutions(formatConfig: unknown): TieResolution[] {
  const list = (formatConfig as { tieResolutions?: unknown } | null)?.tieResolutions;
  return Array.isArray(list) ? (list as TieResolution[]).filter((r) => Array.isArray(r?.order)) : [];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The saved order for exactly this set of tied teams, if the organiser resolved it. */
export function findTieResolution(
  resolutions: TieResolution[], scope: TieResolutionScope, stage: number, pool: number | null, entities: string[],
): TieResolution | undefined {
  return resolutions.find((r) => r.scope === scope && (r.stage ?? 1) === stage
    && (scope === 'placing' || (r.pool ?? null) === pool) && sameSet(r.order, entities));
}

// ---------- Manual tally adjustments ----------

export const standingsAdjustmentInputSchema = z.object({
  organization_id: z.string().uuid(),
  org_unit_id: z.string().uuid().nullable().optional(),
  tournament_discipline_id: z.string().uuid().nullable().optional(),
  points: z.number().min(-1000).max(1000).refine((n) => n !== 0, 'Points cannot be 0')
    .refine((n) => Number.isInteger(n * 2), 'Use whole or half points'),
  reason: z.string().trim().min(3).max(300),
});
export type StandingsAdjustmentInput = z.infer<typeof standingsAdjustmentInputSchema>;
