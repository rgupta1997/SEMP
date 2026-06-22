import { DEFAULT_STANDINGS_RULE, standingsRuleSchema, type StandingsRule, type StandingsAggScope, type StandingsScheme, type StandingsTiebreaker } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { accumulate, rankBy, runScheme, type OrgTally, type SchemeFixture } from './domain/schemes.js';

// One accumulator bucket = one standings table (a scope + scope_id pair).
interface Bucket {
  scope_type: StandingsAggScope;
  scope_id: string | null;
  rows: Map<string, OrgTally>;
}

const bucketKey = (scope: StandingsAggScope, id: string | null) => `${scope}|${id ?? ''}`;

// Parse a stored config jsonb into a typed rule, falling back to the default on any
// malformed/legacy row so a bad edit can never break recompute.
function parseRule(config: unknown): StandingsRule {
  const parsed = standingsRuleSchema.safeParse(config);
  return parsed.success ? parsed.data : DEFAULT_STANDINGS_RULE;
}

// Resolve the effective scoring scheme for a single draw (most-specific wins:
// discipline → format → championship default → built-in default). Shared with the
// result-entry paths so they can tell whether a draw expects hand-entered custom
// points (and remind the organiser when one is missing).
export async function resolveSchemeForDraw(
  prisma: Prisma, championshipId: string, disciplineId: string | null, formatId: string | null,
): Promise<StandingsScheme> {
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
  const rule =
    (disciplineId ? byDiscipline.get(disciplineId) : undefined) ??
    (formatId ? byFormat.get(formatId) : undefined) ??
    championshipRule ?? DEFAULT_STANDINGS_RULE;
  return rule.scheme;
}

// Rebuild every standings table for a championship from its completed fixtures.
// Aggregates by organization at three scopes (championship / tournament / sport),
// each draw scored by its resolved rule. Idempotent: wipes and re-inserts in one
// transaction.
export async function recomputeStandings(prisma: Prisma, championshipId: string): Promise<void> {
  // Editable rules for this championship, indexed for most-specific-wins resolution.
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
  const defaultRule = championshipRule ?? DEFAULT_STANDINGS_RULE;

  // Draws that still have an unplayed fixture — used to decide whether a discipline
  // is concluded (the medal scheme's position points are withheld until it is).
  const pending = await prisma.fixtures.groupBy({
    by: ['tournament_discipline_id'],
    where: {
      status: { in: ['scheduled', 'live', 'postponed'] },
      tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    },
  });
  const drawsWithPending = new Set(pending.map((p) => p.tournament_discipline_id));

  // Every draw in the championship with its completed fixtures + each side's org.
  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    select: {
      id: true,
      discipline_id: true,
      format_id: true,
      tournament_sports: { select: { sport_id: true, tournament_id: true, format_id: true } },
      fixtures: {
        // Byes are unplayed but advance a team, so the placement scheme credits the
        // floor of the stage they reached — include them alongside completed results.
        where: { status: { in: ['completed', 'bye'] } },
        select: {
          status: true,
          round: true, home_team_id: true, away_team_id: true,
          home_score: true, away_score: true, winner_team_id: true, live_state: true,
          teams_fixtures_home_team_idToteams: { select: { organization_id: true } },
          teams_fixtures_away_team_idToteams: { select: { organization_id: true } },
        },
      },
    },
  });

  const buckets = new Map<string, Bucket>();
  const ensureBucket = (scope: StandingsAggScope, id: string | null): Bucket => {
    const key = bucketKey(scope, id);
    let b = buckets.get(key);
    if (!b) { b = { scope_type: scope, scope_id: id, rows: new Map() }; buckets.set(key, b); }
    return b;
  };

  for (const d of draws) {
    if (d.fixtures.length === 0) continue;
    const ts = d.tournament_sports;
    const effectiveFormatId = d.format_id ?? ts.format_id;
    const rule =
      (d.discipline_id ? byDiscipline.get(d.discipline_id) : undefined) ??
      (effectiveFormatId ? byFormat.get(effectiveFormatId) : undefined) ??
      defaultRule;

    const fixtures: SchemeFixture[] = d.fixtures.map((f) => {
      const cp = (f.live_state as any)?.custom_points ?? null;
      return {
        status: f.status,
        round: f.round,
        home_team_id: f.home_team_id,
        away_team_id: f.away_team_id,
        home_org_id: f.teams_fixtures_home_team_idToteams?.organization_id ?? null,
        away_org_id: f.teams_fixtures_away_team_idToteams?.organization_id ?? null,
        home_score: f.home_score,
        away_score: f.away_score,
        winner_team_id: f.winner_team_id,
        home_points: typeof cp?.home === 'number' ? cp.home : null,
        away_points: typeof cp?.away === 'number' ? cp.away : null,
      };
    });

    // A discipline is "decided" once its final has been played, or once no fixtures
    // remain to be played. This now gates only the (legacy) medal scheme's positions;
    // the placement scheme accrues its floors live, round by round.
    const hasCompletedFinal = fixtures.some((f) => f.round === 'Final' && f.winner_team_id);
    const decided = hasCompletedFinal || !drawsWithPending.has(d.id);

    const tallies = runScheme(fixtures, rule, decided);
    if (tallies.length === 0) continue;

    accumulate(ensureBucket('championship', null).rows, tallies);
    accumulate(ensureBucket('tournament', ts.tournament_id).rows, tallies);
    accumulate(ensureBucket('sport', ts.sport_id).rows, tallies);
  }

  // Rank each scope by the championship default's tiebreakers (a single, predictable
  // ordering across mixed-scheme scopes), then flatten to rows for insertion.
  const tiebreakers: StandingsTiebreaker[] =
    defaultRule.scheme === 'league_points' ? defaultRule.tiebreakers : ['points', 'wins', 'lost', 'score_diff'];

  const data = [] as Array<{
    championship_id: string; scope_type: string; scope_id: string | null; organization_id: string;
    played: number; won: number; drawn: number; lost: number; points: number; detail: object; rank: number;
  }>;
  for (const b of buckets.values()) {
    const rows = rankBy([...b.rows.values()], tiebreakers);
    for (const r of rows) {
      data.push({
        championship_id: championshipId,
        scope_type: b.scope_type,
        scope_id: b.scope_id,
        organization_id: r.organization_id,
        played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, points: r.points,
        detail: r.detail,
        rank: r.rank ?? 0,
      });
    }
  }

  await prisma.$transaction([
    prisma.standings.deleteMany({ where: { championship_id: championshipId } }),
    ...(data.length ? [prisma.standings.createMany({ data })] : []),
  ]);
}

// Recompute triggered by a fixture write — resolves the owning championship and
// skips frozen (completed) championships so final standings don't move.
export async function recomputeStandingsForFixture(prisma: Prisma, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: { tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true, championships: { select: { status: true } } } } } } } } },
  });
  const t = fx?.tournament_disciplines?.tournament_sports?.tournaments;
  if (!t?.championship_id) return;
  if (t.championships?.status === 'completed') return; // frozen
  await recomputeStandings(prisma, t.championship_id);
}

// Read a materialized standings table (org rows joined for display), ordered by rank.
export async function readStandings(prisma: Prisma, championshipId: string, scope: StandingsAggScope, scopeId: string | null) {
  const rows = await prisma.standings.findMany({
    where: { championship_id: championshipId, scope_type: scope, scope_id: scopeId },
    include: { organizations: { select: { id: true, name: true, short_name: true, logo_url: true } } },
    orderBy: [{ rank: 'asc' }, { points: 'desc' }],
  });
  return rows.map((r) => ({
    organization_id: r.organization_id,
    organization: r.organizations,
    played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
    points: r.points,
    detail: (r.detail ?? {}) as Record<string, number>,
    rank: r.rank,
  }));
}
