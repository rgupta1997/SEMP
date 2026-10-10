import {
  CRICKET_CAREER_METRICS, COMPETITION_TIERS, TIER_META, isCricketSport, statSpecFor,
  type CompetitionTier, type MatchPosition,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

// ============================================================================
// A person's SPORT-LEVEL record, split by competition tier.
//
// The match page answers "what did I do in that game". This answers the question a
// profile is actually for: "what have I done in this sport" - and it refuses to
// answer it as one undifferentiated number.
//
// THE HIERARCHY. Every sport comes back with the combined record and, beneath it,
// the tiers that make it up: INTER (institution against institution) and INTRA
// (campuses or departments of one institution). Cricket has kept first-class, List A
// and T20 apart for a century because adding them together makes an average
// meaningless; the same is true of a hundred scored against another university and a
// hundred scored in an inter-hostel game.
//
// The rollup is READ, not computed. career_stats stores the 'all' row alongside its
// parts, written in the same transaction, so this endpoint cannot present a total
// that disagrees with the split beneath it.
//
// A TIER WITH NOTHING IN IT IS OMITTED, not shown as zeroes. Somebody who has only
// ever played inter-institution has no intra record - saying "0 played, 0 won" would
// invite the reader to think something is missing.
//
// TWO LEVELS DEEP. Under each sport sit its disciplines - Men's Singles, Men's
// Doubles - each with the same tier split, because "how do I do in singles" is a
// different question from "how do I do in this sport" and a player knows the
// difference. career_stats already keeps a `discipline` grain; this reads it rather
// than re-deriving anything.
// ============================================================================

export interface SportStatMetric {
  key: string;
  label: string;
  short: string;
  value: number;
  /** Ready-made display text, where the number alone would mislead - "5/23". */
  text?: string;
  /** A cricket high score that was unbeaten: printed 84*, not 84. */
  notOut?: boolean;
  /** Rendered as a percentage rather than a count. */
  percent?: boolean;
  /** Shown on the summary card rather than only in the full table. */
  headline?: boolean;
  /** false for runs conceded, errors, points lost - drives sort direction and colour. */
  higherIsBetter?: boolean;
}

export interface TierRecord {
  tier: 'all' | CompetitionTier;
  label: string;
  hint?: string;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  winPct: number | null;
  gold: number;
  silver: number;
  bronze: number;
  awards: number;
  firstOn: string | null;
  lastOn: string | null;
  /** The sport's own measures - runs, goals, aces, raid points. */
  metrics: SportStatMetric[];
}

export interface RubberRecord {
  /** The rubber's name in the tie - "Men's Singles". */
  label: string;
  played: number;
  won: number;
  lost: number;
}

export interface DisciplineRecord {
  disciplineId: string;
  discipline: string;
  overall: TierRecord;
  tiers: TierRecord[];
  /** For a team discipline: the tie rubbers this person played, so "Mixed" reads as what it was. */
  rubbers?: RubberRecord[];
}

export interface PositionRecord {
  position: MatchPosition;
  overall: TierRecord;
  tiers: TierRecord[];
}

export interface SportRecord {
  sportId: string;
  sport: string;
  /** The combined record. Always present; it is what the card leads with. */
  overall: TierRecord;
  /** Inter and intra, in that order, omitting any the person has never played. */
  tiers: TierRecord[];
  /** Men's Singles, Men's Doubles - most recently played first. */
  disciplines: DisciplineRecord[];
  /** Singles and doubles, across every discipline - racquet sports only, when known. */
  positions: PositionRecord[];
}

interface Row {
  sport_id: string;
  sport: string | null;
  discipline_id: string | null;
  discipline: string | null;
  grain: string;
  position: string | null;
  tier: string;
  played: number; won: number; lost: number; drawn: number;
  gold: number; silver: number; bronze: number; awards: number;
  first_on: Date | null; last_on: Date | null;
  stats: unknown;
}

export interface SportStatsFilter {
  /** One sport only. */
  sportId?: string | null;
  /** One discipline only - narrows the sport it belongs to. */
  disciplineId?: string | null;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Turn a stat bag into labelled, ordered metrics.
 *
 * Ordered by the REGISTRY, not by the bag's key order, so the same sport always
 * reads the same way and a metric added later appears in its intended place rather
 * than at the end. A zero is dropped: a career page listing "Double faults 0, Aces 0,
 * Lets 0" for somebody who has played one match reads as a broken screen.
 */
function metricsFor(sport: string | null, bag: Record<string, unknown>): SportStatMetric[] {
  // Cricket keeps its own descriptors: it has no entry in the stat registry, because
  // its figures come from three typed tables rather than from an attributed event
  // log. Reading `statSpecFor` first would return undefined and hand a batter a
  // profile with no runs on it.
  if (isCricketSport(sport)) return cricketMetrics(bag);
  const spec = statSpecFor(sport);
  if (!spec) return [];
  const out: SportStatMetric[] = [];
  for (const m of spec.metrics) {
    if (m.hidden) continue; // kept only to compute a rate
    const raw = bag[m.key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    // A rate of zero is meaningful (a 0% win rate is a fact); a count of zero is not.
    if (raw === 0 && m.aggregate !== 'rate') continue;
    out.push({
      key: m.key,
      label: m.label,
      short: m.short,
      value: m.percent ? Math.round(raw * 10) / 10 : raw,
      ...(m.percent ? { percent: true } : {}),
      ...(m.headline ? { headline: true } : {}),
      ...(m.higherIsBetter === false ? { higherIsBetter: false } : {}),
    });
  }
  return out;
}

/**
 * Cricket's career figures, in scorecard order.
 *
 * A high score is printed the way a scorecard prints it - 84* rather than 84 - so
 * the not-out flag becomes part of the value rather than a separate row nobody would
 * connect to it. Best bowling is one figure for the same reason: "5" and "23" apart
 * mean nothing; 5/23 is what a bowler quotes.
 */
function cricketMetrics(bag: Record<string, unknown>): SportStatMetric[] {
  const n = (k: string) => (typeof bag[k] === 'number' ? bag[k] as number : null);
  const out: SportStatMetric[] = [];

  for (const m of CRICKET_CAREER_METRICS) {
    // Folded into the figures they belong to rather than shown on their own.
    if (m.key === 'high_score_not_out' || m.key === 'best_bowling_runs') continue;

    const v = n(m.key);
    if (v === null) continue;
    // An average or a strike rate of zero is a fact; a count of zero is noise.
    if (v === 0 && !m.decimal && m.key !== 'ducks') continue;

    if (m.key === 'high_score') {
      out.push({ key: m.key, label: m.label, short: m.short, value: v, headline: true,
        ...(n('high_score_not_out') ? { notOut: true } : {}) } as SportStatMetric);
      continue;
    }
    if (m.key === 'best_bowling_wickets') {
      const runs = n('best_bowling_runs');
      if (v === 0) continue;
      out.push({
        key: 'best_bowling', label: 'Best bowling', short: 'BB',
        value: v, text: `${v}/${runs ?? 0}`,
      } as SportStatMetric);
      continue;
    }
    out.push({
      key: m.key, label: m.label, short: m.short,
      value: m.decimal ? Math.round(v * 100) / 100 : v,
      ...(m.headline ? { headline: true } : {}),
      ...(m.higherIsBetter === false ? { higherIsBetter: false } : {}),
    });
  }
  return out;
}

function toRecord(r: Row): TierRecord {
  const decided = r.won + r.lost;
  return {
    tier: r.tier as TierRecord['tier'],
    label: r.tier === 'all' ? 'Overall' : TIER_META[r.tier as CompetitionTier].label,
    ...(r.tier === 'all' ? {} : { hint: TIER_META[r.tier as CompetitionTier].hint }),
    played: r.played, won: r.won, lost: r.lost, drawn: r.drawn,
    // A win rate over nothing decided is unanswerable, not 0%.
    winPct: decided > 0 ? Math.round((r.won / decided) * 1000) / 10 : null,
    gold: r.gold, silver: r.silver, bronze: r.bronze, awards: r.awards,
    firstOn: day(r.first_on), lastOn: day(r.last_on),
    metrics: metricsFor(r.sport, (r.stats ?? {}) as Record<string, unknown>),
  };
}

/**
 * Every sport this person has a record in, most recently played first.
 *
 * Scoped to one institution when `organizationId` is given - career_stats is an
 * institution's view of a person, and somebody who has played for two has two
 * records. Without it, the sports are merged across institutions by summing, which
 * is what a personal profile wants.
 */
export async function sportRecordsFor(
  db: Db,
  userId: string,
  organizationId?: string | null,
  filter: SportStatsFilter = {},
): Promise<SportRecord[]> {
  // Both grains in one read: the sport totals and the disciplines under them. Two
  // queries could catch them mid-recompute and disagree.
  const sportFilter = filter.sportId ?? null;
  const discFilter = filter.disciplineId ?? null;

  const rows = organizationId
    ? await db.$queryRaw<Row[]>`
      select c.sport_id, s.name as sport, c.discipline_id, d.name as discipline,
             c.grain, c.position, c.tier, c.played, c.won, c.lost, c.drawn,
             c.gold, c.silver, c.bronze, c.awards, c.first_on, c.last_on, c.stats
      from career_stats c
      join sports s on s.id = c.sport_id
      left join disciplines d on d.id = c.discipline_id
      where c.user_id = ${userId}::uuid
        and c.organization_id = ${organizationId}::uuid
        and c.grain in ('sport', 'discipline', 'position')
        and (${sportFilter}::uuid is null or c.sport_id = ${sportFilter}::uuid)
        and (${discFilter}::uuid is null
             or c.discipline_id = ${discFilter}::uuid
             or c.grain = 'sport')
      order by c.last_on desc nulls last`
    : await db.$queryRaw<Row[]>`
      select c.sport_id, s.name as sport, c.discipline_id, d.name as discipline,
             c.grain, c.position, c.tier,
             sum(c.played)::int as played, sum(c.won)::int as won,
             sum(c.lost)::int as lost, sum(c.drawn)::int as drawn,
             sum(c.gold)::int as gold, sum(c.silver)::int as silver,
             sum(c.bronze)::int as bronze, sum(c.awards)::int as awards,
             min(c.first_on) as first_on, max(c.last_on) as last_on,
             -- One institution's bag is taken rather than merged: the bags hold
             -- rates as well as counts, and adding two win percentages together
             -- produces a number that means nothing.
             (array_agg(c.stats order by c.played desc))[1] as stats
      from career_stats c
      join sports s on s.id = c.sport_id
      left join disciplines d on d.id = c.discipline_id
      where c.user_id = ${userId}::uuid
        and c.grain in ('sport', 'discipline', 'position')
        and (${sportFilter}::uuid is null or c.sport_id = ${sportFilter}::uuid)
        and (${discFilter}::uuid is null
             or c.discipline_id = ${discFilter}::uuid
             or c.grain = 'sport')
      group by c.sport_id, s.name, c.discipline_id, d.name, c.grain, c.position, c.tier
      order by max(c.last_on) desc nulls last`;

  interface Node {
    sport: string;
    byTier: Map<string, Row>;
    discs: Map<string, { name: string; byTier: Map<string, Row>; last: Date | null }>;
    positions: Map<string, Map<string, Row>>;
  }
  const bySport = new Map<string, Node>();

  for (const r of rows) {
    const node = bySport.get(r.sport_id)
      ?? { sport: r.sport ?? 'Sport', byTier: new Map(), discs: new Map(), positions: new Map() };
    if (r.grain === 'sport') {
      node.byTier.set(r.tier, r);
    } else if (r.grain === 'position' && r.position) {
      const p = node.positions.get(r.position) ?? new Map<string, Row>();
      p.set(r.tier, r);
      node.positions.set(r.position, p);
    } else if (r.discipline_id) {
      const d = node.discs.get(r.discipline_id)
        ?? { name: r.discipline ?? 'Discipline', byTier: new Map(), last: r.last_on };
      d.byTier.set(r.tier, r);
      if (r.last_on && (!d.last || r.last_on > d.last)) d.last = r.last_on;
      node.discs.set(r.discipline_id, d);
    }
    bySport.set(r.sport_id, node);
  }

  /** The rollup plus the tiers actually played, in a fixed order. */
  const split = (byTier: Map<string, Row>) => ({
    all: byTier.get('all'),
    tiers: COMPETITION_TIERS
      .map((t) => byTier.get(t))
      .filter((r): r is Row => !!r && r.played > 0)
      .map(toRecord),
  });

  const out: SportRecord[] = [];
  for (const [sportId, node] of bySport) {
    const { all, tiers } = split(node.byTier);
    // No rollup means nothing has been recomputed since the tier column landed.
    // Skipping is better than presenting one tier as if it were the whole career.
    if (!all) continue;

    const disciplines: DisciplineRecord[] = [...node.discs.entries()]
      .map(([disciplineId, d]) => {
        const s2 = split(d.byTier);
        return s2.all
          ? { disciplineId, discipline: d.name, overall: toRecord(s2.all), tiers: s2.tiers, last: d.last }
          : null;
      })
      .filter((d): d is DisciplineRecord & { last: Date | null } => !!d)
      .sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0))
      .map(({ disciplineId, discipline, overall, tiers: t }) => ({ disciplineId, discipline, overall, tiers: t }));

    const positions: PositionRecord[] = (['singles', 'doubles'] as const).flatMap((position) => {
      const byTier = node.positions.get(position);
      const s2 = byTier ? split(byTier) : null;
      return s2?.all ? [{ position, overall: toRecord(s2.all), tiers: s2.tiers }] : [];
    });

    out.push({ sportId, sport: node.sport, overall: toRecord(all), tiers, disciplines, positions });
  }

  // Team disciplines say which rubbers were played inside them. Read from the timeline,
  // which carries the rubber's name on each per-rubber result.
  const rubbers = await rubbersByDiscipline(db, userId, organizationId ?? null, sportFilter);
  for (const s of out) {
    for (const d of s.disciplines) {
      const list = rubbers.get(d.disciplineId);
      if (list?.length) d.rubbers = list;
    }
  }
  return out;
}

/** Per discipline, the tie rubbers a person played and how each went. */
async function rubbersByDiscipline(
  db: Db, userId: string, organizationId: string | null, sportId: string | null,
): Promise<Map<string, RubberRecord[]>> {
  const rows = await db.$queryRaw<Array<{ discipline_id: string; label: string; played: number; won: number; lost: number }>>`
    select td.discipline_id, l.detail->>'rubber_label' as label,
           count(*)::int as played,
           count(*) filter (where l.detail->>'outcome' = 'won')::int as won,
           count(*) filter (where l.detail->>'outcome' = 'lost')::int as lost
    from lifetime_entries l
    join fixtures f on f.id = l.fixture_id
    join tournament_disciplines td on td.id = f.tournament_discipline_id
    where l.user_id = ${userId}::uuid
      and l.superseded_at is null
      and l.detail->>'rubber_label' is not null
      and td.discipline_id is not null
      and (${organizationId}::uuid is null or l.organization_id = ${organizationId}::uuid)
      and (${sportId}::uuid is null or l.sport_id = ${sportId}::uuid)
    group by td.discipline_id, l.detail->>'rubber_label'
    order by played desc, label`;
  const out = new Map<string, RubberRecord[]>();
  for (const r of rows) {
    out.set(r.discipline_id, [...(out.get(r.discipline_id) ?? []), { label: r.label, played: r.played, won: r.won, lost: r.lost }]);
  }
  return out;
}

export interface PersonRecord {
  userId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
}

/** One opposing side - a player in singles, a pair in doubles - and the record against it. */
export interface OpponentRecord {
  position: MatchPosition;
  userIds: string[];
  names: string[];
  /** Doubles: who they partnered in these matches. */
  partnerId: string | null;
  partnerName: string | null;
  played: number;
  won: number;
  lost: number;
}

/**
 * Who a person has played WITH (partners) and AGAINST (head-to-head), in one sport.
 * Head-to-head is keyed by the opposing SIDE, so each match appears once and rows sum to matches played.
 */
export async function playerRelationsFor(
  db: Db, userId: string, sportId: string | null, organizationId?: string | null,
): Promise<{ partners: PersonRecord[]; opponents: OpponentRecord[] }> {
  const org = organizationId ?? null;
  const partners = await db.$queryRaw<Array<{ user_id: string; name: string; played: number; won: number; lost: number }>>`
    select p.partner_user_id as user_id, u.name,
           count(*)::int as played,
           count(*) filter (where p.outcome = 'won')::int as won,
           count(*) filter (where p.outcome = 'lost')::int as lost
    from player_match_stats p
    join users u on u.id = p.partner_user_id
    where p.user_id = ${userId}::uuid
      and p.played = true and p.superseded_at is null
      and p.partner_user_id is not null
      and (${sportId}::uuid is null or p.sport_id = ${sportId}::uuid)
      and (${org}::uuid is null or p.organization_id = ${org}::uuid)
    group by p.partner_user_id, u.name
    order by played desc, won desc
    limit 20`;
  // Opposing side in a stable order, so a pair groups together whoever was listed first;
  // doubles rows are also keyed by partner ("with X vs Y / Z").
  const sides = await db.$queryRaw<Array<{ position: string | null; ids: string[]; partner: string | null; played: number; won: number; lost: number }>>`
    select p.position, o.ids, p.partner_user_id::text as partner,
           count(*)::int as played,
           count(*) filter (where p.outcome = 'won')::int as won,
           count(*) filter (where p.outcome = 'lost')::int as lost
    from player_match_stats p
    cross join lateral (
      select array_agg(x::text order by x) as ids from unnest(p.opponent_user_ids) as x
    ) o
    where p.user_id = ${userId}::uuid
      and p.played = true and p.superseded_at is null
      and o.ids is not null
      and (${sportId}::uuid is null or p.sport_id = ${sportId}::uuid)
      and (${org}::uuid is null or p.organization_id = ${org}::uuid)
    group by p.position, o.ids, p.partner_user_id
    order by played desc, won desc
    limit 30`;
  const ids = [...new Set(sides.flatMap((s) => (s.partner ? [...s.ids, s.partner] : s.ids)))];
  const people = ids.length
    ? await db.$queryRaw<Array<{ id: string; name: string }>>`
        select id::text, name from users where id = any(${ids}::uuid[])`
    : [];
  const nameOf = new Map(people.map((u) => [u.id, u.name]));

  const view = (r: { user_id: string; name: string; played: number; won: number; lost: number }): PersonRecord =>
    ({ userId: r.user_id, name: r.name, played: r.played, won: r.won, lost: r.lost });
  return {
    partners: partners.map(view),
    opponents: sides.map((s) => ({
      position: s.position === 'doubles' || s.ids.length > 1 ? 'doubles' : 'singles',
      userIds: s.ids,
      names: s.ids.map((id) => nameOf.get(id) ?? '-'),
      partnerId: s.partner,
      partnerName: s.partner ? nameOf.get(s.partner) ?? '-' : null,
      played: s.played, won: s.won, lost: s.lost,
    })),
  };
}

/**
 * The sports and disciplines this person has any record in, for a filter control.
 *
 * Read from the record itself rather than from the catalogue, so the filter can only
 * ever offer something the person has actually played - a dropdown listing
 * thirty-seven sports for somebody who has played two is a dropdown nobody uses.
 */
export async function sportStatsFilterOptions(
  db: Db, userId: string, organizationId?: string | null,
): Promise<Array<{ sportId: string; sport: string; disciplines: Array<{ id: string; name: string }> }>> {
  const rows = await db.$queryRaw<Array<{
    sport_id: string; sport: string; discipline_id: string | null; discipline: string | null;
  }>>`
    select distinct c.sport_id, s.name as sport, c.discipline_id, d.name as discipline
    from career_stats c
    join sports s on s.id = c.sport_id
    left join disciplines d on d.id = c.discipline_id
    where c.user_id = ${userId}::uuid
      and (${organizationId ?? null}::uuid is null or c.organization_id = ${organizationId ?? null}::uuid)
      and c.grain in ('sport', 'discipline')
    order by s.name, d.name`;

  const bySport = new Map<string, { sportId: string; sport: string; disciplines: Array<{ id: string; name: string }> }>();
  for (const r of rows) {
    const e = bySport.get(r.sport_id) ?? { sportId: r.sport_id, sport: r.sport, disciplines: [] };
    if (r.discipline_id && r.discipline && !e.disciplines.some((d) => d.id === r.discipline_id)) {
      e.disciplines.push({ id: r.discipline_id, name: r.discipline });
    }
    bySport.set(r.sport_id, e);
  }
  return [...bySport.values()];
}
