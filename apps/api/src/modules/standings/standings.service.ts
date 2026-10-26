import {
  KNOCKOUT_ROUND, DEFAULT_STANDINGS_RULE, chessStandingsRule, formatPoints, groupRankingFor, inheritRanking,
  isChessSport, isNoResult, readTieResolutions, stageConfigSchema, standingsRuleSchema, type StandingsRule,
  type StandingsAggScope, type StandingsScheme, type StandingsTiebreaker,
} from '@semp/shared';
import type { Db, Prisma } from '../../infra/prisma.js';
import { contingentKey, type ContingentRef } from '@semp/shared';
import { assignStageSequence } from '../fixtures/domain/stage-tree.js';
import { SCORED_STATUSES, accumulate, drawContext, rankBy, runScheme, type EntityTally, type SchemeContext, type SchemeFixture } from './domain/schemes.js';
import { convertEventTotals, type EventTotal } from './domain/event-conversion.js';

// One accumulator bucket = one standings table (a scope + scope_id pair).
interface Bucket {
  scope_type: StandingsAggScope;
  scope_id: string | null;
  rows: Map<string, EntityTally>;
}

const bucketKey = (scope: StandingsAggScope, id: string | null) => `${scope}|${id ?? ''}`;

// Parse a stored config jsonb into a typed rule, falling back to the default on any
// malformed/legacy row so a bad edit can never break recompute.
function parseRule(config: unknown): StandingsRule {
  const parsed = standingsRuleSchema.safeParse(config);
  return parsed.success ? parsed.data : DEFAULT_STANDINGS_RULE;
}

// A championship's saved rules, indexed for most-specific-wins resolution.
interface RuleIndex {
  byDiscipline: Map<string, StandingsRule>;
  byFormat: Map<string, StandingsRule>;
  championshipRule: StandingsRule | undefined;
  defaultRule: StandingsRule;
}

export async function loadRuleIndex(prisma: Db, championshipId: string): Promise<RuleIndex> {
  const ruleRows = await prisma.standings_rules.findMany({ where: { championship_id: championshipId } });
  const byDiscipline = new Map<string, StandingsRule>();
  const byFormat = new Map<string, StandingsRule>();
  let championshipRule: StandingsRule | undefined;
  for (const r of ruleRows) {
    const rule = parseRule(r.config);
    if (r.scope_type === 'discipline' && r.scope_id) byDiscipline.set(r.scope_id, rule);
    else if (r.scope_type === 'format' && r.scope_id) byFormat.set(r.scope_id, rule);
    else if (r.scope_type === 'championship') championshipRule = rule;
  }
  return { byDiscipline, byFormat, championshipRule, defaultRule: championshipRule ?? DEFAULT_STANDINGS_RULE };
}

/** The tables' rule for one draw: discipline, then format, then the fallback below. */
export function ruleFromIndex(
  index: RuleIndex, disciplineId: string | null, formatId: string | null, sportName?: string | null, entryType?: string | null,
): StandingsRule {
  const byFormat = formatId ? index.byFormat.get(formatId) : undefined;
  const rule = (disciplineId ? index.byDiscipline.get(disciplineId) : undefined)
    ?? byFormat
    ?? fallbackRuleFor(index.defaultRule, sportName, entryType);
  return inheritRanking(rule, byFormat, index.championshipRule);
}

// Resolve the full editable rule for a draw (most-specific-wins: discipline → format →
// championship default → built-in default). Shared by the scheme helper below, the
// stage resolver and the scoring endpoint (which needs a ranking rule's place points).
export async function resolveRuleForDraw(
  prisma: Db, championshipId: string, disciplineId: string | null, formatId: string | null,
  /** A chess draw ranks by chess points unless the organiser set a rule for it. */
  chess?: { team: boolean },
): Promise<StandingsRule> {
  const { byDiscipline, byFormat, championshipRule } = await loadRuleIndex(prisma, championshipId);
  const formatRule = formatId ? byFormat.get(formatId) : undefined;
  return inheritRanking(
    (disciplineId ? byDiscipline.get(disciplineId) : undefined) ??
    formatRule ??
    // Ahead of the championship default: that one is set for the points table across
    // sports, and 3/1/0 makes a chess draw a third of a win instead of half.
    (chess ? chessStandingsRule(chess.team) : undefined) ??
    championshipRule ?? DEFAULT_STANDINGS_RULE,
    formatRule, championshipRule,
  );
}

/**
 * The tables' fallback for a draw with no rule of its own. Chess swaps a points-table
 * default for 2/1/0 (as pool seeding does); a places/medal championship scheme is kept.
 */
function fallbackRuleFor(defaultRule: StandingsRule, sportName?: string | null, entryType?: string | null): StandingsRule {
  return isChessSport(sportName) && defaultRule.scheme === 'league_points'
    ? chessStandingsRule(entryType === 'team')
    : defaultRule;
}

export async function resolveSchemeForDraw(
  prisma: Db, championshipId: string, disciplineId: string | null, formatId: string | null,
): Promise<StandingsScheme> {
  return (await resolveRuleForDraw(prisma, championshipId, disciplineId, formatId)).scheme;
}

// ---------- One draw's input to a scheme ----------

/** Fixture columns every scheme read needs (all statuses: the context reads the unplayed ones). */
export const DRAW_FIXTURE_FIELDS = {
  status: true, round: true, pool_number: true, stage_sequence: true,
  home_team_id: true, away_team_id: true, home_score: true, away_score: true, winner_team_id: true, live_state: true,
} as const;

interface DrawFixtureRow {
  status: string; round: string | null; pool_number: number | null; stage_sequence: number | null;
  home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null;
  winner_team_id: string | null; live_state: unknown;
}

export function toSchemeFixture(f: DrawFixtureRow, homeKey: string | null, awayKey: string | null): SchemeFixture {
  const cp = (f.live_state as any)?.custom_points ?? null;
  return {
    status: f.status, round: f.round,
    home_team_id: f.home_team_id, away_team_id: f.away_team_id,
    home_entity_id: homeKey, away_entity_id: awayKey,
    home_score: f.home_score, away_score: f.away_score,
    winner_team_id: f.winner_team_id,
    home_points: typeof cp?.home === 'number' ? cp.home : null,
    away_points: typeof cp?.away === 'number' ? cp.away : null,
    no_result: isNoResult(f.live_state),
    pool_number: f.pool_number, stage_sequence: f.stage_sequence,
  };
}

/** The fixtures a scheme scores plus what it needs to know about the rest of the draw. */
export function schemeInput(
  formatConfig: unknown, sportName: string | null | undefined, rule: StandingsRule, all: SchemeFixture[],
): { fixtures: SchemeFixture[]; ctx: SchemeContext } {
  const parsed = stageConfigSchema.safeParse(formatConfig);
  const tree = parsed.success ? assignStageSequence(parsed.data.root) : null;
  const rankingFor = (stage: number) => {
    const node = tree?.bySequence.get(stage)?.node;
    return groupRankingFor(rule, sportName, node?.type === 'group' ? node : undefined);
  };
  return {
    fixtures: all.filter((f) => SCORED_STATUSES.includes(f.status)),
    ctx: drawContext(all, rankingFor, readTieResolutions(formatConfig)),
  };
}

// Count completed matches in a scope (championship / tournament / sport). Each fixture is
// counted ONCE (summing per-org `played` double-counts every head-to-head match), and
// byes are excluded - a bye is an auto-advance, not a played match. Walkovers count (a
// forfeit is still a real result).
export async function countCompletedMatches(
  prisma: Db, championshipId: string,
  scope: 'championship' | 'tournament' | 'sport' = 'championship', scopeId: string | null = null,
): Promise<number> {
  return prisma.fixtures.count({
    where: {
      status: { in: ['completed', 'walkover'] },
      tournament_disciplines: {
        tournament_sports: {
          tournaments: { championship_id: championshipId },
          ...(scope === 'tournament' && scopeId ? { tournament_id: scopeId } : {}),
          ...(scope === 'sport' && scopeId ? { sport_id: scopeId } : {}),
        },
      },
    },
  });
}

// ---------- Event sports ----------

interface EventFixtureRow {
  live_state: unknown;
  tournament_discipline_id: string;
  tournament_disciplines: {
    discipline_id: string | null; format_id: string | null;
    disciplines: { name: string; entry_type: string | null } | null;
    tournament_sports: { sport_id: string; tournament_id: string; format_id: string | null; sports: { name: string } | null };
  } | null;
}

const EVENT_FIXTURE_SELECT = {
  live_state: true,
  tournament_discipline_id: true,
  tournament_disciplines: {
    select: {
      discipline_id: true, format_id: true,
      disciplines: { select: { name: true, entry_type: true } },
      tournament_sports: { select: { sport_id: true, tournament_id: true, format_id: true, sports: { select: { name: true } } } },
    },
  },
} as const;

interface EventContribution {
  fixture: EventFixtureRow;
  /** Raw per-contingent event points and medals from this fixture. */
  tallies: EntityTally[];
  /** Set when the rule converts this sport's totals into a sport placing. */
  converted: boolean;
}

interface ConvertedGroup { sport_id: string; tournament_id: string; sport: string; group: string; tallies: EntityTally[] }

// Every ranking-event fixture's contribution, and each converted group's sport placings.
// The raw points stay in the sport table; a converted sport adds only its placing to the
// championship and tournament tables.
function eventContributions(
  rows: EventFixtureRow[], index: RuleIndex, keyOf: (side: { organization_id: string; org_unit_id: string | null }) => string | null,
): { contributions: EventContribution[]; groups: ConvertedGroup[] } {
  const contributions: EventContribution[] = [];
  const groupTotals = new Map<string, { meta: Omit<ConvertedGroup, 'tallies'>; places: number[]; participation: number; totals: Map<string, EventTotal> }>();
  for (const f of rows) {
    const list = (f.live_state as any)?.eventStandings;
    const td = f.tournament_disciplines;
    if (!Array.isArray(list) || list.length === 0 || !td) continue;
    const ts = td.tournament_sports;
    const tallies: EntityTally[] = [];
    for (const c of list) {
      if (!c?.orgId) continue;
      const detail: Record<string, number> = {};
      if (c.gold) detail.gold = c.gold;
      if (c.silver) detail.silver = c.silver;
      if (c.bronze) detail.bronze = c.bronze;
      // A ranking event's console writes one contribution per competing side. In an
      // intra championship that side is a campus or a department, so the row carries
      // `unitId` beside `orgId`; an inter-organisation console omits it and the key
      // falls back to the organisation exactly as before.
      const key = keyOf({ organization_id: c.orgId, org_unit_id: c.unitId ?? null });
      if (!key) continue;
      tallies.push({
        entity_id: key, played: 0, won: 0, drawn: 0, lost: 0,
        points: typeof c.points === 'number' ? c.points : 0, gf: 0, ga: 0, wo: 0, detail,
      });
    }
    if (tallies.length === 0) continue;
    const rule = ruleFromIndex(index, td.discipline_id, td.format_id ?? ts.format_id, ts.sports?.name, td.disciplines?.entry_type);
    const convert = rule.scheme === 'ranking' ? rule.convert : undefined;
    contributions.push({ fixture: f, tallies, converted: !!convert });
    if (!convert) continue;
    for (const g of convert.groups) {
      const key = `${ts.tournament_id}|${ts.sport_id}|${g.name.toLowerCase()}`;
      let acc = groupTotals.get(key);
      if (!acc) {
        acc = { meta: { sport_id: ts.sport_id, tournament_id: ts.tournament_id, sport: ts.sports?.name ?? 'Event', group: g.name }, places: convert.places, participation: convert.participation, totals: new Map() };
        groupTotals.set(key, acc);
      }
      for (const t of tallies) {
        const row = acc.totals.get(t.entity_id) ?? { entity_id: t.entity_id, points: 0, gold: 0, silver: 0 };
        row.points += t.points * g.share;
        row.gold += t.detail.gold ?? 0;
        row.silver += t.detail.silver ?? 0;
        acc.totals.set(t.entity_id, row);
      }
    }
  }
  const groups = [...groupTotals.values()].map((g) => ({ ...g.meta, tallies: convertEventTotals([...g.totals.values()], g.places, g.participation) }));
  return { contributions, groups };
}

// Rebuild every standings table for a championship from its completed fixtures.
// Aggregates by CONTINGENT at three scopes (championship / tournament / sport), each
// draw scored by its resolved rule. Idempotent: wipes and re-inserts in one
// transaction.
//
// The contingent is the team's unit when it has one and its organisation otherwise.
// In an inter-organisation championship every team's unit is null, so the key IS the
// organisation id and this behaves exactly as it did before intra events existed -
// which is why the whole feature needed no change to the ranking maths.
export async function recomputeStandings(prisma: Db, championshipId: string): Promise<void> {
  const index = await loadRuleIndex(prisma, championshipId);
  const { defaultRule } = index;

  // Draws that still have an unplayed fixture - used to decide whether a discipline
  // is concluded (the medal scheme's position points are withheld until it is).
  const pending = await prisma.fixtures.groupBy({
    by: ['tournament_discipline_id'],
    where: {
      status: { in: ['scheduled', 'live', 'postponed'] },
      tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    },
  });
  const drawsWithPending = new Set(pending.map((p) => p.tournament_discipline_id));

  // Every draw in the championship with all its fixtures + each side's org. Unplayed
  // fixtures only feed the draw context (who is in the knockout, are the groups done).
  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    select: {
      id: true,
      discipline_id: true,
      format_id: true,
      format_config: true,
      disciplines: { select: { entry_type: true } },
      tournament_sports: { select: { sport_id: true, tournament_id: true, format_id: true, sports: { select: { name: true } } } },
      fixtures: {
        select: {
          ...DRAW_FIXTURE_FIELDS,
          teams_fixtures_home_team_idToteams: { select: { organization_id: true, org_unit_id: true } },
          teams_fixtures_away_team_idToteams: { select: { organization_id: true, org_unit_id: true } },
        },
      },
    },
  });

  const buckets = new Map<string, Bucket>();

  // Contingent key -> the pair it stands for. The scheme layer works in opaque keys,
  // but the standings ROW has to carry both columns: organization_id keeps every
  // existing foreign key and cascade intact, org_unit_id is what makes two campuses
  // of one institution two rows instead of one. Collected as the fixtures are read
  // so persistence never has to look a key back up.
  const refs = new Map<string, ContingentRef>();
  const keyOf = (side: { organization_id: string; org_unit_id: string | null } | null | undefined): string | null => {
    if (!side?.organization_id) return null;
    const ref: ContingentRef = { orgId: side.organization_id, unitId: side.org_unit_id ?? null };
    const key = contingentKey(ref);
    refs.set(key, ref);
    return key;
  };

  const ensureBucket = (scope: StandingsAggScope, id: string | null): Bucket => {
    const key = bucketKey(scope, id);
    let b = buckets.get(key);
    if (!b) { b = { scope_type: scope, scope_id: id, rows: new Map() }; buckets.set(key, b); }
    return b;
  };
  const drawScopes = new Map<string, { tournament_id: string; sport_id: string }>();

  for (const d of draws) {
    const ts = d.tournament_sports;
    drawScopes.set(d.id, { tournament_id: ts.tournament_id, sport_id: ts.sport_id });
    if (d.fixtures.length === 0) continue;
    const rule = ruleFromIndex(index, d.discipline_id, d.format_id ?? ts.format_id, ts.sports?.name, d.disciplines?.entry_type);
    const all = d.fixtures.map((f) => toSchemeFixture(f, keyOf(f.teams_fixtures_home_team_idToteams), keyOf(f.teams_fixtures_away_team_idToteams)));
    const { fixtures, ctx } = schemeInput(d.format_config, ts.sports?.name, rule, all);
    if (fixtures.length === 0) continue;

    // A discipline is "decided" once its final has been played, or once no fixtures
    // remain to be played. This now gates only the (legacy) medal scheme's positions;
    // the placement scheme accrues its floors live, round by round.
    const hasCompletedFinal = fixtures.some((f) => f.round === KNOCKOUT_ROUND.final && f.winner_team_id);
    const decided = hasCompletedFinal || !drawsWithPending.has(d.id);

    const tallies = runScheme(fixtures, rule, decided, ctx);
    if (tallies.length === 0) continue;

    accumulate(ensureBucket('championship', null).rows, tallies);
    accumulate(ensureBucket('tournament', ts.tournament_id).rows, tallies);
    accumulate(ensureBucket('sport', ts.sport_id).rows, tallies);
  }

  // ---- Multi-competitor ranking events (powerlifting / swimming / athletics) ----
  // These draws have no head-to-head fixtures; each event fixture stores a self-contained
  // per-org contribution (points + gold/silver/bronze) under live_state.eventStandings,
  // written by the event consoles. An event is scored in place (not "won"), so we read
  // live + completed and fold each org's contribution into the same buckets.
  const eventFixtures = await prisma.fixtures.findMany({
    where: {
      status: { in: ['live', 'completed'] },
      tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    },
    select: EVENT_FIXTURE_SELECT,
  });
  const events = eventContributions(eventFixtures as EventFixtureRow[], index, keyOf);
  for (const c of events.contributions) {
    const ts = c.fixture.tournament_disciplines!.tournament_sports;
    accumulate(ensureBucket('sport', ts.sport_id).rows, c.tallies);
    // A converted sport keeps its medals in the overall tables but scores its placing instead.
    const overall = c.converted ? c.tallies.map((t) => ({ ...t, points: 0, detail: { ...t.detail } })) : c.tallies;
    accumulate(ensureBucket('championship', null).rows, overall);
    accumulate(ensureBucket('tournament', ts.tournament_id).rows, overall);
  }
  for (const g of events.groups) {
    accumulate(ensureBucket('championship', null).rows, g.tallies);
    accumulate(ensureBucket('tournament', g.tournament_id).rows, g.tallies);
  }

  // ---- Organiser adjustments (deductions, forfeits, OC decisions) ----
  for (const a of await prisma.standings_adjustments.findMany({ where: { championship_id: championshipId } })) {
    const key = keyOf({ organization_id: a.organization_id, org_unit_id: a.org_unit_id });
    if (!key) continue;
    const tally: EntityTally = { entity_id: key, played: 0, won: 0, drawn: 0, lost: 0, points: a.points, gf: 0, ga: 0, wo: 0, detail: { adjustment: a.points } };
    accumulate(ensureBucket('championship', null).rows, [tally]);
    const scope = a.tournament_discipline_id ? drawScopes.get(a.tournament_discipline_id) : undefined;
    if (scope) {
      accumulate(ensureBucket('tournament', scope.tournament_id).rows, [tally]);
      accumulate(ensureBucket('sport', scope.sport_id).rows, [tally]);
    }
  }

  // Rank each scope by the championship default's tiebreakers (a single, predictable
  // ordering across mixed-scheme scopes), then flatten to rows for insertion.
  const tiebreakers: StandingsTiebreaker[] =
    defaultRule.scheme === 'league_points' ? defaultRule.tiebreakers : ['points', 'wins', 'lost', 'score_diff'];

  const data = [] as Array<{
    championship_id: string; scope_type: string; scope_id: string | null;
    organization_id: string; org_unit_id: string | null;
    played: number; won: number; drawn: number; lost: number; points: number; detail: object; rank: number;
  }>;
  for (const b of buckets.values()) {
    const rows = rankBy([...b.rows.values()], tiebreakers);
    for (const r of rows) {
      const ref = refs.get(r.entity_id);
      // A tally whose key was never registered cannot be written: organization_id is
      // NOT NULL and there is nothing honest to put in it. Skipping is right - the
      // only way to get here is a contribution referencing a side no fixture named.
      if (!ref) continue;
      data.push({
        championship_id: championshipId,
        scope_type: b.scope_type,
        scope_id: b.scope_id,
        organization_id: ref.orgId,
        org_unit_id: ref.unitId,
        played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, points: r.points,
        detail: r.detail,
        rank: r.rank ?? 0,
      });
    }
  }

  // Deliberately NOT wrapped in its own $transaction: this takes `Db`, so it can be
  // called inside the scorecard lock's transaction and commit or roll back with it.
  // A function that opens its own transaction cannot compose that way. Atomicity is
  // therefore the caller's to own - see the wrapper used by the live-scoring path.
  await prisma.standings.deleteMany({ where: { championship_id: championshipId } });
  if (data.length) await prisma.standings.createMany({ data });
}

// ---- Atomic wrappers, for callers that are NOT already inside a transaction ----
//
// recomputeStandings takes `Db` so the scorecard lock can compose it into its own
// transaction. That moves atomicity to the caller, and the delete-then-rebuild inside
// is exactly the sequence you do not want interrupted: a failure between the two
// leaves a championship with no standings at all. Every caller outside a transaction
// goes through these.

export async function recomputeStandingsAtomic(prisma: Prisma, championshipId: string): Promise<void> {
  await prisma.$transaction(async (tx) => { await recomputeStandings(tx, championshipId); });
}

export async function recomputeStandingsForFixtureAtomic(prisma: Prisma, fixtureId: string): Promise<void> {
  await prisma.$transaction(async (tx) => { await recomputeStandingsForFixture(tx, fixtureId); });
}

// Recompute triggered by a fixture write - resolves the owning championship and
// skips frozen (completed) championships so final standings don't move.
export async function recomputeStandingsForFixture(prisma: Db, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: { tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true, championships: { select: { status: true } } } } } } } } },
  });
  const t = fx?.tournament_disciplines?.tournament_sports?.tournaments;
  if (!t?.championship_id) return;
  if (t.championships?.status === 'completed') return; // frozen
  await recomputeStandings(prisma, t.championship_id);
}

// One row of an org's standings breakdown: a single match it played in a draw, with
// the result and (for per-match schemes) the points that match contributed.
export interface BreakdownMatch {
  round: string | null;
  opponent: string;
  result: 'won' | 'lost' | 'drawn' | 'bye';
  score: string | null;
  points: number | null;
}
// An org's contribution from one draw (event = sport · discipline): the points/record
// that draw added to its scope total, plus the matches behind it.
export interface BreakdownEvent {
  draw_id: string;
  sport: string;
  discipline: string | null;
  scheme: StandingsScheme | 'adjustment';
  points: number;
  won: number;
  drawn: number;
  lost: number;
  detail: Record<string, number>;
  matches: BreakdownMatch[];
}

// Explain one org's standings total: which events (draws) contributed how many points
// and how. Re-runs the same per-draw scheme `recomputeStandings` uses (so the numbers
// match the table exactly), but keeps only the requested org and attaches its matches.
// Scope filters the draws the same way the materialized buckets are keyed: championship
// = all, tournament = that tournament's draws, sport = that sport's draws.
export async function readStandingsBreakdown(
  prisma: Db,
  championshipId: string,
  scope: StandingsAggScope,
  scopeId: string | null,
  /**
   * The CONTINGENT key whose contribution is being explained - a unit id in an
   * intra championship, an organisation id in an inter one. Named `entityId`
   * rather than `orgId` because passing an organisation id for an intra event
   * would silently match nothing and render an empty breakdown, which reads as
   * "this campus scored nothing" rather than as the bug it is.
   */
  entityId: string,
): Promise<BreakdownEvent[]> {
  const index = await loadRuleIndex(prisma, championshipId);

  // Pending fixtures gate the medal scheme's positions (same as recompute), so the
  // breakdown points match the table even before a discipline is decided.
  const pending = await prisma.fixtures.groupBy({
    by: ['tournament_discipline_id'],
    where: {
      status: { in: ['scheduled', 'live', 'postponed'] },
      tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    },
  });
  const drawsWithPending = new Set(pending.map((p) => p.tournament_discipline_id));

  const scopeFilter = {
    tournaments: { championship_id: championshipId, ...(scope === 'tournament' && scopeId ? { id: scopeId } : {}) },
    ...(scope === 'sport' && scopeId ? { sport_id: scopeId } : {}),
  };
  const sideSelect = {
    select: {
      organization_id: true, org_unit_id: true,
      organizations: { select: { name: true, short_name: true } },
      org_units: { select: { name: true, code: true } },
    },
  } as const;
  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: scopeFilter },
    select: {
      id: true,
      discipline_id: true,
      format_id: true,
      format_config: true,
      disciplines: { select: { name: true, entry_type: true } },
      tournament_sports: { select: { sport_id: true, tournament_id: true, format_id: true, sports: { select: { name: true } } } },
      fixtures: {
        select: { ...DRAW_FIXTURE_FIELDS, teams_fixtures_home_team_idToteams: sideSelect, teams_fixtures_away_team_idToteams: sideSelect },
      },
    },
  });

  // The same rule the recompute uses, restated locally: the unit wins when there is
  // one. It has to agree exactly with recomputeStandings or a breakdown would fail to
  // find the tally its own table displays.
  const sideKey = (side: { organization_id: string; org_unit_id: string | null } | null | undefined): string | null =>
    side?.organization_id ? contingentKey({ orgId: side.organization_id, unitId: side.org_unit_id ?? null }) : null;

  const events: BreakdownEvent[] = [];
  for (const d of draws) {
    if (d.fixtures.length === 0) continue;
    const ts = d.tournament_sports;
    const rule = ruleFromIndex(index, d.discipline_id, d.format_id ?? ts.format_id, ts.sports?.name, d.disciplines?.entry_type);
    const all = d.fixtures.map((f) => toSchemeFixture(f, sideKey(f.teams_fixtures_home_team_idToteams), sideKey(f.teams_fixtures_away_team_idToteams)));
    const { fixtures: schemeFixtures, ctx } = schemeInput(d.format_config, ts.sports?.name, rule, all);

    const hasCompletedFinal = schemeFixtures.some((f) => f.round === KNOCKOUT_ROUND.final && f.winner_team_id);
    const decided = hasCompletedFinal || !drawsWithPending.has(d.id);
    const tally = runScheme(schemeFixtures, rule, decided, ctx).find((t) => t.entity_id === entityId);
    if (!tally) continue; // this contingent didn't take part in / score from this draw

    // This contingent's own matches in the draw, oriented to it (its score first).
    const matches: BreakdownMatch[] = [];
    for (const f of d.fixtures) {
      if (!SCORED_STATUSES.includes(f.status)) continue;
      const isHome = sideKey(f.teams_fixtures_home_team_idToteams) === entityId;
      const isAway = sideKey(f.teams_fixtures_away_team_idToteams) === entityId;
      if (!isHome && !isAway) continue;
      const opp = isHome ? f.teams_fixtures_away_team_idToteams : f.teams_fixtures_home_team_idToteams;
      // The opponent is named by its contingent for the same reason the table is: in
      // an intra event every opponent's ORGANISATION is your own, so an org-named
      // breakdown would list "IIM Bangalore" as every opponent you ever played.
      const oppName = opp?.org_units?.name ?? opp?.organizations?.name ?? opp?.organizations?.short_name ?? null;
      const opponent = f.status === 'bye' ? 'Bye' : (oppName ?? 'TBD');
      const myScore = isHome ? f.home_score : f.away_score;
      const oppScore = isHome ? f.away_score : f.home_score;
      const score = myScore != null && oppScore != null ? `${formatPoints(myScore)}–${formatPoints(oppScore)}` : null;

      let result: BreakdownMatch['result'];
      let points: number | null = null;
      if (f.status === 'bye') {
        result = 'bye';
      } else {
        const myTeam = isHome ? f.home_team_id : f.away_team_id;
        if (f.winner_team_id == null && (isNoResult(f.live_state) || (myScore != null && oppScore != null && myScore === oppScore))) result = 'drawn';
        else if (f.winner_team_id === myTeam) result = 'won';
        else result = 'lost';
        // Per-match points only exist for the per-match schemes; placement/medal points
        // are earned at the draw level (stage reached / final rank), shown via `detail`.
        if (rule.scheme === 'league_points') points = result === 'won' ? rule.win : result === 'drawn' ? rule.draw : rule.loss;
        else if (rule.scheme === 'custom') { const cp = (f.live_state as any)?.custom_points ?? null; const v = isHome ? cp?.home : cp?.away; points = typeof v === 'number' ? v : null; }
      }
      matches.push({ round: f.round, opponent, result, score, points });
    }

    events.push({
      draw_id: d.id,
      sport: ts.sports?.name ?? 'Sport',
      discipline: d.disciplines?.name ?? null,
      scheme: rule.scheme,
      points: tally.points,
      won: tally.won, drawn: tally.drawn, lost: tally.lost,
      detail: tally.detail,
      matches,
    });
  }

  // Ranking events (no head-to-head) contribute via live_state.eventStandings, not the
  // per-draw scheme - append this contingent's per-sport contribution so the breakdown shows what
  // a powerlifting/swimming/athletics draw earned too (medals + points, no match list).
  const eventFx = await prisma.fixtures.findMany({
    where: { status: { in: ['live', 'completed'] }, tournament_disciplines: { tournament_sports: scopeFilter } },
    select: EVENT_FIXTURE_SELECT,
  });
  const converted = eventContributions(eventFx as EventFixtureRow[], index, (s) => sideKey(s));
  for (const c of converted.contributions) {
    const mine = c.tallies.find((t) => t.entity_id === entityId);
    if (!mine) continue;
    const td = c.fixture.tournament_disciplines!;
    events.push({
      draw_id: c.fixture.tournament_discipline_id,
      sport: td.tournament_sports.sports?.name ?? 'Event',
      discipline: td.disciplines?.name ?? null,
      scheme: 'medal',
      // Outside the sport table a converted sport scores its placing (below), not raw points.
      points: c.converted && scope !== 'sport' ? 0 : mine.points,
      won: 0, drawn: 0, lost: 0,
      detail: mine.detail,
      matches: [],
    });
  }
  if (scope !== 'sport') {
    for (const g of converted.groups) {
      const mine = g.tallies.find((t) => t.entity_id === entityId);
      if (!mine) continue;
      events.push({ draw_id: `${g.sport_id}:${g.group}`, sport: g.sport, discipline: `${g.group} placing`, scheme: 'ranking', points: mine.points, won: 0, drawn: 0, lost: 0, detail: mine.detail, matches: [] });
    }
  }

  // Organiser adjustments that land in this scope.
  const adjustments = await prisma.standings_adjustments.findMany({
    where: { championship_id: championshipId },
    include: { tournament_disciplines: { select: { disciplines: { select: { name: true } }, tournament_sports: { select: { sport_id: true, tournament_id: true, sports: { select: { name: true } } } } } } },
  });
  for (const a of adjustments) {
    if (contingentKey({ orgId: a.organization_id, unitId: a.org_unit_id }) !== entityId) continue;
    const ts = a.tournament_disciplines?.tournament_sports;
    if (scope === 'tournament' && ts?.tournament_id !== scopeId) continue;
    if (scope === 'sport' && ts?.sport_id !== scopeId) continue;
    events.push({
      draw_id: a.id, sport: 'Adjustment', discipline: [ts?.sports?.name, a.tournament_disciplines?.disciplines?.name, a.reason].filter(Boolean).join(' · '),
      scheme: 'adjustment', points: a.points, won: 0, drawn: 0, lost: 0, detail: { adjustment: a.points }, matches: [],
    });
  }

  // Biggest contributors first, then alphabetical for a stable order.
  events.sort((a, b) => b.points - a.points || a.sport.localeCompare(b.sport));
  return events;
}

// Read a materialized standings table, ordered by rank.
//
// Each row is labelled by its CONTINGENT. In an inter-organisation championship that
// is the institution and this returns what it always did. In an intra one it is the
// campus or department - and labelling those rows with the organisation instead
// would print the same name twelve times down the table, which is the bug the whole
// contingent model exists to remove.
//
// `organization` is still returned beside it. A campus row belongs to an
// institution, and the certificate, the logo and the drill-down all still need to
// know which.
export async function readStandings(prisma: Db, championshipId: string, scope: StandingsAggScope, scopeId: string | null) {
  const rows = await prisma.standings.findMany({
    where: { championship_id: championshipId, scope_type: scope, scope_id: scopeId },
    include: {
      organizations: { select: { id: true, name: true, short_name: true, logo_url: true } },
      org_units: { select: { id: true, name: true, code: true, type: true, parent_id: true } },
    },
    orderBy: [{ rank: 'asc' }, { points: 'desc' }],
  });

  // One extra hop for the campus a department sits under, so a department table can
  // read "Sales · Bangalore" rather than three identically-named Sales rows.
  const parentIds = [...new Set(rows.map((r) => r.org_units?.parent_id).filter((id): id is string => !!id))];
  const parents = parentIds.length
    ? await prisma.org_units.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
    : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    // The key the whole table is grouped by - what a client should use as its row id.
    entity_id: r.org_unit_id ?? r.organization_id,
    organization_id: r.organization_id,
    organization: r.organizations,
    org_unit_id: r.org_unit_id,
    org_unit: r.org_units
      ? {
        id: r.org_units.id,
        name: r.org_units.name,
        code: r.org_units.code,
        type: r.org_units.type,
        parent: r.org_units.parent_id ? parentName.get(r.org_units.parent_id) ?? null : null,
      }
      : null,
    // What to print. Resolved server-side so every surface - the table, the medal
    // tally, the public page, the export - cannot each pick a different answer.
    name: r.org_units?.name ?? r.organizations?.name ?? 'Unknown',
    short_name: r.org_units?.code ?? r.organizations?.short_name ?? null,
    played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
    points: r.points,
    detail: (r.detail ?? {}) as Record<string, number>,
    rank: r.rank,
  }));
}
