import {
  INSIGHT_RULES, canonicalRacquetSport, foldCareerStats, racquetInsights, statSpecFor,
  type InsightRate, type InsightReport, type StatBag,
} from '@semp/shared';
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

export async function sportInsightsFor(db: Db, userId: string, sportId: string): Promise<InsightReport | null> {
  const sport = await db.sports.findUnique({ where: { id: sportId }, select: { name: true } });
  // The rules read serve, receive, deuce and game points - racquet sports only.
  const spec = canonicalRacquetSport(sport?.name) ? statSpecFor(sport?.name) : undefined;
  if (!spec) return null;

  const [lines, results, positions] = await Promise.all([
    db.$queryRaw<Array<{ stats: StatBag }>>`
      select p.stats from player_match_stats p
      where p.user_id = ${userId}::uuid and p.sport_id = ${sportId}::uuid
        and p.played = true and p.superseded_at is null
      order by p.occurred_on desc, p.computed_at desc
      limit 500`,
    db.$queryRaw<Array<{ outcome: string | null }>>`
      select l.detail->>'outcome' as outcome from lifetime_entries l
      where l.user_id = ${userId}::uuid and l.sport_id = ${sportId}::uuid
        and l.superseded_at is null and l.kind = 'result'
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

  return racquetInsights({
    career,
    recent,
    earlier,
    recentMatches: recentCount,
    careerMatches: bags.length,
    results: results
      .map((r) => r.outcome)
      .filter((o): o is 'won' | 'lost' | 'drew' => o === 'won' || o === 'lost' || o === 'drew'),
    singles: positions.find((p) => p.position === 'singles'),
    doubles: positions.find((p) => p.position === 'doubles'),
    partners: relations.partners,
    // Doubles opponents are a pair; a rival is a single person, so singles only.
    opponents: relations.opponents.filter((o) => o.position === 'singles').map((o) => ({ ...o, name: o.names.join(' / ') })),
    percentiles: await percentilesFor(db, userId, sportId, career),
  });
}

/**
 * Where this player's rates sit among everyone else's in the sport, 0-100. Only
 * players with enough points count, so one lucky match does not set the bar.
 */
async function percentilesFor(
  db: Db, userId: string, sportId: string, mine: StatBag,
): Promise<Partial<Record<InsightRate, number>>> {
  const others = await db.$queryRaw<Array<Record<string, number>>>`
    select
      sum(coalesce((p.stats->>'service_points_won')::int, 0))::int as service_points_won,
      sum(coalesce((p.stats->>'service_points_played')::int, 0))::int as service_points_played,
      sum(coalesce((p.stats->>'return_points_won')::int, 0))::int as return_points_won,
      sum(coalesce((p.stats->>'return_points_played')::int, 0))::int as return_points_played,
      sum(coalesce((p.stats->>'points_won')::int, 0))::int as points_won,
      sum(coalesce((p.stats->>'points_lost')::int, 0))::int as points_lost
    from player_match_stats p
    where p.sport_id = ${sportId}::uuid and p.played = true and p.superseded_at is null
      and p.user_id <> ${userId}::uuid
    group by p.user_id`;

  const out: Partial<Record<InsightRate, number>> = {};
  for (const r of RATES) {
    const myDen = denominator(mine, r.of);
    if (myDen < INSIGHT_RULES.minPoints) continue;
    const my = (mine[r.won] ?? 0) / myDen;
    const field = others
      .filter((o) => denominator(o, r.of) >= INSIGHT_RULES.minPoints)
      .map((o) => (o[r.won] ?? 0) / denominator(o, r.of));
    // Too few others to call it a comparison.
    if (field.length < 5) continue;
    const below = field.filter((v) => v < my).length;
    const level = field.filter((v) => v === my).length;
    out[r.key] = Math.round(((below + level / 2) / field.length) * 100);
  }
  return out;
}
