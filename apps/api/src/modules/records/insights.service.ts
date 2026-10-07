import {
  INSIGHT_RULES, PLATFORM_NAME, canonicalRacquetSport, foldCareerStats, racquetInsights, statSpecFor,
  type InsightField, type InsightRate, type InsightReport, type StatBag, type TypicalKey,
} from '@semp/shared';
import { Prisma } from '@prisma/client';
import type { Db } from '../../infra/prisma.js';
import { playerRelationsFor } from './sport-stats.service.js';

// ============================================================================
// A player's insights in one sport: gathers the numbers racquetInsights reads.
//
// Career and recent come from the stat lines (matches scored point by point), results
// from the timeline (every result), and the yardstick from every other player with
// enough points in the sport.
// ============================================================================

const RATES: Array<{ key: InsightRate; won: string; of: string | [string, string] }> = [
  { key: 'service_win_pct', won: 'service_points_won', of: 'service_points_played' },
  { key: 'return_win_pct', won: 'return_points_won', of: 'return_points_played' },
  { key: 'point_win_pct', won: 'points_won', of: ['points_won', 'points_lost'] },
];

const denominator = (bag: StatBag, of: string | [string, string]) =>
  typeof of === 'string' ? (bag[of] ?? 0) : (bag[of[0]] ?? 0) + (bag[of[1]] ?? 0);

/** Singles or doubles only - the card follows the All / Singles / Doubles switch. */
export type InsightPosition = 'singles' | 'doubles';

export async function sportInsightsFor(
  db: Db, userId: string, sportId: string, position?: InsightPosition,
): Promise<InsightReport | null> {
  const sport = await db.sports.findUnique({ where: { id: sportId }, select: { name: true } });
  // The rules read serve, receive, deuce and game points - racquet sports only.
  const spec = canonicalRacquetSport(sport?.name) ? statSpecFor(sport?.name) : undefined;
  if (!spec) return null;

  // One format only: its stat lines, its results - and, below, other players' figures
  // in the same format, so singles is compared with singles.
  const onlyLines = position ? Prisma.sql`and p.position = ${position}` : Prisma.empty;
  const onlyResults = position ? Prisma.sql`and l.detail->>'position' = ${position}` : Prisma.empty;
  const [lines, results, positions] = await Promise.all([
    db.$queryRaw<Array<{ stats: StatBag; position: string | null }>>`
      select p.stats, p.position from player_match_stats p
      where p.user_id = ${userId}::uuid and p.sport_id = ${sportId}::uuid
        and p.played = true and p.superseded_at is null ${onlyLines}
      order by p.occurred_on desc, p.computed_at desc
      limit 500`,
    db.$queryRaw<Array<{ outcome: string | null }>>`
      select l.detail->>'outcome' as outcome from lifetime_entries l
      where l.user_id = ${userId}::uuid and l.sport_id = ${sportId}::uuid
        and l.superseded_at is null and l.kind = 'result' ${onlyResults}
      order by l.occurred_on desc, l.created_at desc
      limit 50`,
    db.$queryRaw<Array<{ position: string; played: number; won: number }>>`
      select l.detail->>'position' as position, count(*)::int as played,
             count(*) filter (where l.detail->>'outcome' = 'won')::int as won
      from lifetime_entries l
      where l.user_id = ${userId}::uuid and l.sport_id = ${sportId}::uuid
        and l.superseded_at is null and l.detail->>'position' in ('singles', 'doubles')
      group by l.detail->>'position'`,
  ]);

  const bags = lines.map((l) => (l.stats ?? {}) as StatBag);
  const career = foldCareerStats(spec, bags);
  const recentCount = Math.min(INSIGHT_RULES.recentMatches, bags.length);
  const recent = foldCareerStats(spec, bags.slice(0, recentCount));
  const earlier = foldCareerStats(spec, bags.slice(recentCount));
  const relations = await playerRelationsFor(db, userId, sportId);

  // Pressure figures (deuce, game points, deciders) belong to the PAIR in doubles. On a
  // format's own tab they are that format's; on All they come from the format the player
  // plays MOST - a doubles specialist with three singles matches is read from doubles.
  const singles = lines.filter((l) => l.position === 'singles').map((l) => (l.stats ?? {}) as StatBag);
  const doubles = lines.filter((l) => l.position === 'doubles').map((l) => (l.stats ?? {}) as StatBag);
  const fromSingles = { bag: foldCareerStats(spec, singles), matches: singles.length, pair: false };
  const fromDoubles = { bag: foldCareerStats(spec, doubles), matches: doubles.length, pair: true };
  const enough = (n: number) => n >= INSIGHT_RULES.minSplitMatches;
  const pressure = position === 'singles' ? fromSingles
    : position === 'doubles' ? fromDoubles
    : !singles.length && !doubles.length ? undefined
    // A format with too few matches never wins over one with enough; otherwise the one
    // played more, with a tie going to singles - those figures are wholly the player's.
    : enough(singles.length) !== enough(doubles.length) ? (enough(singles.length) ? fromSingles : fromDoubles)
    : singles.length >= doubles.length ? fromSingles : fromDoubles;

  return racquetInsights({
    career,
    recent,
    earlier,
    recentMatches: recentCount,
    careerMatches: bags.length,
    results: results
      .map((r) => r.outcome)
      .filter((o): o is 'won' | 'lost' | 'drew' => o === 'won' || o === 'lost' || o === 'drew'),
    // "Singles is your game" compares the two formats, so it only belongs on All.
    ...(position ? {} : {
      singles: positions.find((p) => p.position === 'singles'),
      doubles: positions.find((p) => p.position === 'doubles'),
    }),
    // Partners exist only in doubles; a rival is one person, so singles only.
    partners: position === 'singles' ? [] : relations.partners,
    opponents: position === 'doubles' ? [] : relations.opponents
      .filter((o) => o.position === 'singles').map((o) => ({ ...o, name: o.names.join(' / ') })),
    field: {
      ...(await fieldFor(db, userId, sportId, career, position)),
      // Said in every comparison: the whole platform, not the player's own organisation.
      group: `${position ? `${position} ` : ''}${(sport?.name ?? 'other').toLowerCase()} players on ${PLATFORM_NAME}`,
    },
    ...(pressure ? { pressure } : {}),
  });
}

/**
 * How this player compares with everyone else in the sport: where each rate sits
 * (0-100), how many players that is measured against, and the typical gap between
 * serve and receive. Only players with enough points count, so one lucky match does
 * not set the bar.
 */
async function fieldFor(
  db: Db, userId: string, sportId: string, mine: StatBag, position?: InsightPosition,
): Promise<InsightField> {
  // Like for like: on a format's tab, only other players' matches in that format.
  const onlyLines = position ? Prisma.sql`and p.position = ${position}` : Prisma.empty;
  const others = await db.$queryRaw<Array<Record<string, number>>>`
    select
      sum(coalesce((p.stats->>'service_points_won')::int, 0))::int as service_points_won,
      sum(coalesce((p.stats->>'service_points_played')::int, 0))::int as service_points_played,
      sum(coalesce((p.stats->>'return_points_won')::int, 0))::int as return_points_won,
      sum(coalesce((p.stats->>'return_points_played')::int, 0))::int as return_points_played,
      sum(coalesce((p.stats->>'points_won')::int, 0))::int as points_won,
      sum(coalesce((p.stats->>'points_lost')::int, 0))::int as points_lost,
      sum(coalesce((p.stats->>'game_points_won')::int, 0))::int as game_points_won,
      sum(coalesce((p.stats->>'game_points_played')::int, 0))::int as game_points_played,
      sum(coalesce((p.stats->>'game_points_saved')::int, 0))::int as game_points_saved,
      sum(coalesce((p.stats->>'game_points_faced')::int, 0))::int as game_points_faced,
      sum(coalesce((p.stats->>'deuce_points_won')::int, 0))::int as deuce_points_won,
      sum(coalesce((p.stats->>'deuce_points_played')::int, 0))::int as deuce_points_played
    from player_match_stats p
    where p.sport_id = ${sportId}::uuid and p.played = true and p.superseded_at is null
      and p.user_id <> ${userId}::uuid ${onlyLines}
    group by p.user_id`;

  const enough = (o: Record<string, number>, of: string | [string, string]) => denominator(o, of) >= INSIGHT_RULES.minPoints;
  const ratio = (o: Record<string, number>, won: string, of: string | [string, string]) => (o[won] ?? 0) / denominator(o, of);

  const percentiles: Partial<Record<InsightRate, number>> = {};
  const sizes: Partial<Record<InsightRate, number>> = {};
  for (const r of RATES) {
    if (!enough(mine, r.of)) continue;
    const my = ratio(mine, r.won, r.of);
    const field = others.filter((o) => enough(o, r.of)).map((o) => ratio(o, r.won, r.of));
    // Too few others to call it a comparison.
    if (field.length < INSIGHT_RULES.minFieldPlayers) continue;
    const below = field.filter((v) => v < my).length;
    const level = field.filter((v) => v === my).length;
    percentiles[r.key] = Math.round(((below + level / 2) / field.length) * 100);
    sizes[r.key] = field.length;
  }

  // The typical serve-minus-receive gap, as the median of other players' gaps: in
  // table tennis nearly everyone wins more on serve, so this is the yardstick for "unusual".
  const [serveRate, recvRate] = RATES;
  const gaps = others
    .filter((o) => enough(o, serveRate.of) && enough(o, recvRate.of))
    .map((o) => Math.round(ratio(o, serveRate.won, serveRate.of) * 100) - Math.round(ratio(o, recvRate.won, recvRate.of) * 100));
  const gap = gaps.length >= INSIGHT_RULES.minFieldPlayers ? { typical: median(gaps), players: gaps.length } : undefined;

  // The typical pressure rates, so "you convert 58%" is judged against what other
  // players convert rather than a line picked in advance.
  const typical: InsightField['typical'] = {};
  const PRESSURE: Array<[TypicalKey, string, string, number]> = [
    ['game_point_conversion', 'game_points_won', 'game_points_played', INSIGHT_RULES.minGamePoints],
    ['game_point_save', 'game_points_saved', 'game_points_faced', INSIGHT_RULES.minGamePoints],
    ['deuce', 'deuce_points_won', 'deuce_points_played', INSIGHT_RULES.minDeucePoints],
  ];
  for (const [key, won, of, min] of PRESSURE) {
    const pcts = others.filter((o) => (o[of] ?? 0) >= min).map((o) => Math.round(((o[won] ?? 0) / o[of]) * 100));
    if (pcts.length >= INSIGHT_RULES.minFieldPlayers) typical[key] = { pct: median(pcts), players: pcts.length };
  }

  return { percentiles, sizes, typical, ...(gap ? { gap } : {}) };
}

/** The middle value - robust to one player with a freak figure. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
