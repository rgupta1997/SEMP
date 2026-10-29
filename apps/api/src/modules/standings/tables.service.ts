import {
  addAdt, adtOf, contingentKey, emptyAdt, findTieResolution, isKhoKhoFormat, isKnockoutRound, khoMatchAdt, parseStoredFormat,
  readRallyLog, readTieResolutions, tiebreakerLabel, type AdtTally,
  type GroupRanking, type StandingsScheme, type TieResolution,
} from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { NotFoundError } from '../../shared/errors.js';
import { rankGroup, resolverFor, tableAnalysis } from './domain/schemes.js';
import { DRAW_FIXTURE_FIELDS, loadRuleIndex, ruleFromIndex, schemeInput, toSchemeFixture } from './standings.service.js';

// The group / league tables of one draw, ranked exactly as advancement and the tally
// rank them, with the ties still waiting for a hand-picked order.

export interface TableRow {
  entity_id: string; name: string; short_name: string | null; rank: number;
  played: number; won: number; drawn: number; lost: number; points: number; score_for: number; score_against: number;
  /** Kho kho: average difference time over the pool's matches, seconds to 3 decimals; null when none could be read. */
  adt?: number | null;
  /** Some turn's clock was not run, so its full length was used. */
  adt_estimated?: boolean;
}
export interface PoolTable { pool: number | null; label: string; complete: boolean; rows: TableRow[]; ties: string[][] }
export interface DrawTables {
  draw_id: string;
  championship_id: string;
  sport: string | null;
  discipline: string | null;
  entry_type: string | null;
  scheme: StandingsScheme;
  stages: Array<{ stage: number; ranking: GroupRanking & { labels: string[] }; pools: PoolTable[] }>;
  placing_ties: Array<{ stage: number; entities: string[]; from: number; to: number }>;
  /** Teams from different groups compared for a placing, with what separated each pair. */
  cross_group: CrossGroupView[];
  resolutions: TieResolution[];
  names: Record<string, string>;
}

const SETTLED = new Set(['completed', 'walkover', 'bye', 'cancelled']);
export interface CrossGroupView {
  stage: number;
  kind: 'placings' | 'semi_losers';
  rows: Array<Omit<TableRow, 'rank'> & { pool: string; place: number | null }>;
  /** Between rows[i] and rows[i + 1]: the tie-breaker's name, "Hand-picked order", or null = still level. */
  decided_by: Array<string | null>;
}

const poolLabel = (pool: number | null) => (pool == null ? 'Table' : `Pool ${String.fromCharCode(64 + pool)}`);

export async function readDrawTables(prisma: Db, drawId: string): Promise<DrawTables> {
  const side = {
    select: {
      organization_id: true, org_unit_id: true,
      organizations: { select: { name: true, short_name: true } },
      org_units: { select: { name: true, code: true } },
    },
  } as const;
  const td = await prisma.tournament_disciplines.findUnique({
    where: { id: drawId },
    select: {
      id: true, discipline_id: true, format_id: true, format_config: true, entry_type: true,
      disciplines: { select: { name: true, entry_type: true } },
      tournament_sports: { select: { format_id: true, sports: { select: { name: true } }, tournaments: { select: { championship_id: true } } } },
      fixtures: { select: { ...DRAW_FIXTURE_FIELDS, teams_fixtures_home_team_idToteams: side, teams_fixtures_away_team_idToteams: side } },
    },
  });
  const championshipId = td?.tournament_sports?.tournaments?.championship_id;
  if (!td || !championshipId) throw new NotFoundError('Tournament discipline');
  const sport = td.tournament_sports.sports?.name ?? null;
  const entryType = td.entry_type ?? td.disciplines?.entry_type ?? null;

  const names: Record<string, { name: string; short: string | null }> = {};
  const keyOf = (s: { organization_id: string; org_unit_id: string | null; organizations: { name: string; short_name: string | null } | null; org_units: { name: string; code: string | null } | null } | null) => {
    if (!s?.organization_id) return null;
    const key = contingentKey({ orgId: s.organization_id, unitId: s.org_unit_id ?? null });
    names[key] = { name: s.org_units?.name ?? s.organizations?.name ?? 'Unknown', short: s.org_units?.code ?? s.organizations?.short_name ?? null };
    return key;
  };

  const index = await loadRuleIndex(prisma, championshipId);
  const rule = ruleFromIndex(index, td.discipline_id, td.format_id ?? td.tournament_sports.format_id, sport, td.disciplines?.entry_type);
  const all = td.fixtures.map((f) => toSchemeFixture(f, keyOf(f.teams_fixtures_home_team_idToteams), keyOf(f.teams_fixtures_away_team_idToteams)));
  const { fixtures, ctx } = schemeInput(td.format_config, sport, rule, all);
  const resolutions = readTieResolutions(td.format_config);

  const tableAll = all.filter((f) => !isKnockoutRound(f.round));
  // Kho kho: each team's ADT inputs over a pool's finished matches, read off the turn logs.
  const kho = isKhoKhoFormat({ sport: sport ?? '' });
  const rawOf = new Map(all.map((f, i) => [f, td.fixtures[i]] as const));
  const adtFor = (poolAll: typeof all): Map<string, AdtTally> => {
    const sums = new Map<string, AdtTally>();
    for (const f of poolAll) {
      if (f.status !== 'completed' || !f.home_entity_id || !f.away_entity_id) continue;
      const live = rawOf.get(f)?.live_state as { format?: unknown } | null;
      const format = parseStoredFormat(live?.format);
      const m = format ? khoMatchAdt(format, readRallyLog(live)) : null;
      if (!m) continue;
      sums.set(f.home_entity_id, addAdt(sums.get(f.home_entity_id) ?? emptyAdt(), m.A));
      sums.set(f.away_entity_id, addAdt(sums.get(f.away_entity_id) ?? emptyAdt(), m.B));
    }
    return sums;
  };
  const stages = [...new Set(tableAll.map((f) => f.stage_sequence ?? 1))].sort((a, b) => a - b).map((stage) => {
    const ranking = ctx.rankingFor!(stage);
    const stageAll = tableAll.filter((f) => (f.stage_sequence ?? 1) === stage);
    const pools = [...new Set(stageAll.map((f) => f.pool_number ?? null))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((pool): PoolTable => {
      const poolAll = stageAll.filter((f) => (f.pool_number ?? null) === pool);
      const complete = poolAll.length > 0 && poolAll.every((f) => SETTLED.has(f.status));
      const g = rankGroup(fixtures.filter((f) => !isKnockoutRound(f.round) && (f.stage_sequence ?? 1) === stage && (f.pool_number ?? null) === pool), ranking, resolverFor(resolutions, 'pool', stage, pool));
      const adt = kho ? adtFor(poolAll) : null;
      const rows: TableRow[] = g.rows.map((r) => ({
        entity_id: r.entity_id, name: names[r.entity_id]?.name ?? 'Unknown', short_name: names[r.entity_id]?.short ?? null, rank: r.rank!,
        played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, points: r.points, score_for: r.gf, score_against: r.ga,
        ...(adt ? { adt: adt.has(r.entity_id) ? adtOf(adt.get(r.entity_id)!) : null, adt_estimated: !!adt.get(r.entity_id)?.estimated } : {}),
      }));
      // Teams yet to finish a match still belong on the table.
      const seen = new Set(rows.map((r) => r.entity_id));
      for (const f of poolAll) {
        for (const id of [f.home_entity_id, f.away_entity_id]) {
          if (!id || seen.has(id)) continue;
          seen.add(id);
          rows.push({ entity_id: id, name: names[id]?.name ?? 'Unknown', short_name: names[id]?.short ?? null, rank: rows.length + 1, played: 0, won: 0, drawn: 0, lost: 0, points: 0, score_for: 0, score_against: 0 });
        }
      }
      return { pool, label: poolLabel(pool), complete, rows, ties: complete ? g.ties : [] };
    });
    return { stage, ranking: { ...ranking, labels: ranking.tiebreakers.map((t) => tiebreakerLabel(t, sport, entryType)) }, pools };
  });

  const analysis = tableAnalysis(fixtures, rule, ctx);
  return {
    draw_id: td.id,
    championship_id: championshipId,
    sport,
    discipline: td.disciplines?.name ?? null,
    entry_type: entryType,
    scheme: rule.scheme,
    stages,
    placing_ties: analysis?.pending ?? [],
    cross_group: (analysis?.comparisons ?? []).map((c) => ({
      stage: c.stage,
      kind: c.kind,
      rows: c.order.map((id, i) => {
        const r = analysis!.records.get(id);
        return {
          entity_id: id, name: names[id]?.name ?? 'Unknown', short_name: names[id]?.short ?? null,
          pool: poolLabel(analysis!.poolOf.get(id) ?? null), place: c.places[i],
          played: r?.played ?? 0, won: r?.won ?? 0, drawn: r?.drawn ?? 0, lost: r?.lost ?? 0,
          points: r?.points ?? 0, score_for: r?.gf ?? 0, score_against: r?.ga ?? 0,
        };
      }),
      decided_by: c.decidedBy.map((d) => (d === 'resolution' ? 'Hand-picked order' : d ? tiebreakerLabel(d, sport, entryType) : null)),
    })),
    resolutions,
    names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.name])),
  };
}

/** Is this exact set of teams tied right now (a pool tie or a placing tie)? */
export function isCurrentTie(tables: DrawTables, scope: 'pool' | 'placing', stage: number, pool: number | null, order: string[]): boolean {
  const same = (ids: string[]) => ids.length === order.length && ids.every((id) => order.includes(id));
  if (scope === 'placing') return tables.placing_ties.some((t) => t.stage === stage && same(t.entities));
  const p = tables.stages.find((s) => s.stage === stage)?.pools.find((x) => x.pool === pool);
  return !!p?.ties.some(same);
}

/** A saved resolution for the same teams, which a new pick replaces. */
export const sameResolution = (r: TieResolution, scope: 'pool' | 'placing', stage: number, pool: number | null, order: string[]) =>
  !!findTieResolution([r], scope, stage, pool, order);
