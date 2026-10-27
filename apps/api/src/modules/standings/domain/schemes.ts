import {
  knockoutRoundSize, KNOCKOUT_ROUND, FINALIST_DETAIL_KEY, THIRD_PLACE_ROUND, findTieResolution,
  groupRankingFor, isKnockoutRound, type GroupRanking, type StandingsRule, type StandingsPlacement,
  type StandingsTiebreaker, type TieResolution,
} from '@semp/shared';

// Pure standings computation. A scheme turns a single draw's (tournament_discipline)
// completed fixtures into per-CONTINGENT tallies. The service aggregates these
// tallies across draws into the championship / tournament / sport scopes and ranks
// them. No DB access here so the logic is unit-testable in isolation.
//
// `entity_id` is deliberately opaque here. It used to be an organisation id, and
// naming it that was what made intra-organisation events impossible to express:
// every campus of one institution carries the same organisation id, so the table
// collapsed to one row. The service now resolves each side to a contingent key -
// the unit when there is one, the organisation otherwise (@semp/shared
// `contingentKey`) - and this layer never learns which of the two it was handed.
// That is the point: the ranking maths is identical either way, and a scheme that
// could tell them apart would eventually treat them differently.

// The minimal fixture shape a scheme needs. The service maps each side's team to the
// CONTINGENT it plays for - a campus, a department, or the organisation itself -
// before handing rows over.
export interface SchemeFixture {
  status: string;
  round: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_entity_id: string | null;
  away_entity_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  // Organiser-entered championship points per side - used only by the 'custom' scheme.
  home_points?: number | null;
  away_points?: number | null;
  /** Abandoned as "no result": both sides share the draw points, whatever the score. */
  no_result?: boolean;
  /** Stage metadata: which pool and which stage of a multi-stage draw. */
  pool_number?: number | null;
  stage_sequence?: number | null;
}

export interface EntityTally {
  entity_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  // Internal sort aids (goals for/against) - not persisted as columns.
  gf: number;
  ga: number;
  // Walkovers lost - a side whose every result is one is a no-show (no participation).
  wo: number;
  // Scheme-specific counts surfaced to the UI (e.g. { gold: 2 }, { semi_finalist: 1 }).
  detail: Record<string, number>;
  // Assigned by rankBy once a scope is fully accumulated.
  rank?: number;
}

function emptyTally(entity_id: string): EntityTally {
  return { entity_id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, gf: 0, ga: 0, wo: 0, detail: {} };
}

// A result that counts: a played match, or a walkover with its winner (a forfeit is a
// win for one side and a loss for the other; it has no score, so goals are untouched).
const isResult = (f: SchemeFixture): boolean =>
  f.status === 'completed' || (f.status === 'walkover' && !!f.winner_team_id);

// Core W/D/L counter shared by every scheme - counts played/won/drawn/lost and
// goals for/against, and awards `win`/`draw`/`loss` points. Returns a keyed map so
// callers can layer scheme-specific points on top.
function leagueTally(fixtures: SchemeFixture[], win: number, draw: number, loss: number): Map<string, EntityTally> {
  const table = new Map<string, EntityTally>();
  const ensure = (entityId: string) => {
    let row = table.get(entityId);
    if (!row) { row = emptyTally(entityId); table.set(entityId, row); }
    return row;
  };

  for (const f of fixtures) {
    if (!isResult(f)) continue;
    const home = f.home_entity_id ? ensure(f.home_entity_id) : null;
    const away = f.away_entity_id ? ensure(f.away_entity_id) : null;
    if (!home && !away) continue;
    if (home) home.played++;
    if (away) away.played++;
    // A walkover's scoreline (2-0 by policy) is not play: it stays out of score difference.
    const played = f.status !== 'walkover';
    if (played && home && f.home_score != null) { home.gf += f.home_score; home.ga += f.away_score ?? 0; }
    if (played && away && f.away_score != null) { away.gf += f.away_score; away.ga += f.home_score ?? 0; }

    const isDraw = f.winner_team_id == null
      && (f.no_result === true || (f.home_score != null && f.away_score != null && f.home_score === f.away_score));
    if (isDraw) {
      if (home) { home.drawn++; home.points += draw; }
      if (away) { away.drawn++; away.points += draw; }
    } else if (f.winner_team_id) {
      const homeWon = f.winner_team_id === f.home_team_id;
      if (home) { if (homeWon) { home.won++; home.points += win; } else { home.lost++; home.points += loss; } }
      if (away) { if (!homeWon) { away.won++; away.points += win; } else { away.lost++; away.points += loss; } }
      if (!played) { const loser = homeWon ? away : home; if (loser) loser.wo++; }
    }
  }
  return table;
}

const isNoShow = (t: EntityTally) => t.played > 0 && t.wo === t.played;

// ---------- Group / league table ranking ----------

function metric(r: EntityTally, t: StandingsTiebreaker): number {
  switch (t) {
    case 'points': return r.points;
    case 'wins': return r.won;
    case 'lost': return -r.lost; // fewer losses ranks higher
    case 'score_diff': return r.gf - r.ga;
    case 'score_for': return r.gf;
    case 'head_to_head': return 0; // needs the fixtures - handled by rankGroup
  }
}

// Stable split of a block into runs of equal value, best first.
function splitBy(block: EntityTally[], value: (r: EntityTally) => number): EntityTally[][] {
  const sorted = [...block].sort((a, b) => value(b) - value(a));
  const out: EntityTally[][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && value(last[0]) === value(r)) last.push(r); else out.push([r]);
  }
  return out;
}

// Head-to-head = a mini-table of only the matches between the tied teams. If it splits
// them into a smaller tie, the mini-table is re-run for just those teams.
function headToHead(block: EntityTally[], fixtures: SchemeFixture[], pts: GroupRanking): EntityTally[][] {
  const ids = new Set(block.map((r) => r.entity_id));
  const mini = leagueTally(fixtures.filter((f) => ids.has(f.home_entity_id ?? '') && ids.has(f.away_entity_id ?? '')), pts.win, pts.draw, pts.loss);
  const parts = splitBy(block, (r) => mini.get(r.entity_id)?.points ?? 0);
  if (parts.length === 1) return parts;
  return parts.flatMap((p) => (p.length > 1 ? headToHead(p, fixtures, pts) : [p]));
}

/** Orders rows into blocks; a block of 2+ is still level on every tie-breaker. */
export function tieBlocks(rows: EntityTally[], tiebreakers: StandingsTiebreaker[], fixtures: SchemeFixture[] = [], pts?: GroupRanking): EntityTally[][] {
  let blocks = [rows];
  for (const tb of tiebreakers) {
    if (tb === 'head_to_head' && (!pts || fixtures.length === 0)) continue;
    blocks = blocks.flatMap((b) => (b.length < 2 ? [b] : tb === 'head_to_head' ? headToHead(b, fixtures, pts!) : splitBy(b, (r) => metric(r, tb))));
  }
  return blocks;
}

export interface RankedGroup {
  /** Best first, ranks 1..n. Inside an unresolved tie the order is arbitrary. */
  rows: EntityTally[];
  /** Blocks still level after tie-breakers and with no hand-picked order. */
  ties: string[][];
}

/** A hand-picked order for a tied set, or undefined when none is saved. */
export type TieResolver = (entities: string[]) => string[] | undefined;

/** Ranks one group / league table: match points, the tie-breaker order, then saved resolutions. */
export function rankGroup(fixtures: SchemeFixture[], ranking: GroupRanking, resolve?: TieResolver): RankedGroup {
  const table = leagueTally(fixtures, ranking.win, ranking.draw, ranking.loss);
  const rows: EntityTally[] = [];
  const ties: string[][] = [];
  for (const block of tieBlocks([...table.values()], ranking.tiebreakers, fixtures, ranking)) {
    if (block.length === 1) { rows.push(block[0]); continue; }
    const ids = block.map((r) => r.entity_id);
    const order = resolve?.(ids);
    if (order) rows.push(...order.map((id) => block.find((r) => r.entity_id === id)!));
    else { ties.push(ids); rows.push(...block); }
  }
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows, ties };
}

export const resolverFor = (resolutions: TieResolution[] | undefined, scope: 'pool' | 'placing', stage: number, pool: number | null): TieResolver =>
  (entities) => findTieResolution(resolutions ?? [], scope, stage, pool, entities)?.order;

// Map each team to the contingent it plays for, across all fixtures in the draw
// (either side).
function teamEntityMap(fixtures: SchemeFixture[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fixtures) {
    if (f.home_team_id && f.home_entity_id) m.set(f.home_team_id, f.home_entity_id);
    if (f.away_team_id && f.away_entity_id) m.set(f.away_team_id, f.away_entity_id);
  }
  return m;
}

// Knockout placement candidates a completed fixture implies. A team's placement is
// the best-scoring of its candidates, so points accrue progressively as a "floor":
// the moment a team wins through to the next stage it earns that stage's minimum
// placement (the worst a team at that stage can finish), then upgrades it when the
// stage's own match resolves. Winning a QF means you've *reached* the semis, so you
// bank the semi-finalist floor right away - without waiting for the final to be
// played. Taking the best of all candidates sidesteps ordering concerns between
// rounds (a 3rd-place win beats the semi_finalist floor; a final win beats the
// runner_up floor banked for reaching the final).
function placementCandidates(f: SchemeFixture): Array<[string, StandingsPlacement]> {
  // A bye auto-advances its lone team to the next round with no opponent and no
  // result, so it earns the same "reached the next stage" floor a winner of this
  // round would. Byes only ever occur in the opening round (knockout.ts).
  if (f.status === 'bye') {
    const team = f.home_team_id ?? f.away_team_id;
    if (!team) return [];
    switch (f.round) {
      case KNOCKOUT_ROUND.semiFinal: return [[team, 'runner_up']]; // bye into the final
      case KNOCKOUT_ROUND.quarterFinal: return [[team, 'semi_finalist']]; // bye into the semis
      default: return []; // earlier rounds (R16, R32, …) have no canonical placement
    }
  }
  if (!f.winner_team_id) return [];
  const winner = f.winner_team_id;
  const loser = f.home_team_id === winner ? f.away_team_id : f.home_team_id;
  const out: Array<[string, StandingsPlacement]> = [];
  switch (f.round) {
    case KNOCKOUT_ROUND.final:
      out.push([winner, 'winner']);
      if (loser) out.push([loser, 'runner_up']);
      break;
    case THIRD_PLACE_ROUND:
      out.push([winner, 'third_place']);
      if (loser) out.push([loser, 'fourth_place']);
      break;
    case KNOCKOUT_ROUND.semiFinal:
      out.push([winner, 'runner_up']); // reached the final → runner-up floor
      if (loser) out.push([loser, 'semi_finalist']);
      break;
    case KNOCKOUT_ROUND.quarterFinal:
      out.push([winner, 'semi_finalist']); // reached the semis → semi-finalist floor
      if (loser) out.push([loser, 'quarter_finalist']);
      break;
    default:
      break; // earlier rounds (R16, R32, …) don't map to a canonical placement
  }
  return out;
}

// --- the three schemes ---

function leaguePointsScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'league_points' }>): EntityTally[] {
  return [...leagueTally(fixtures, rule.win, rule.draw, rule.loss).values()];
}

// Placement specificity, best (most decisive) first. A team's final placement is the
// most specific one it earned that the rule actually scores - so a 3rd-place playoff
// loss (fourth_place) beats the generic semi_finalist, yet a config that omits
// third/fourth gracefully falls back to semi_finalist.
const PLACEMENT_SPECIFICITY: StandingsPlacement[] = [
  'winner', 'runner_up', 'third_place', 'fourth_place', 'semi_finalist', 'quarter_finalist',
];

export interface SchemeContext {
  /** Ranking for a table stage (by stage_sequence). Unset = the rule's ranking or 3/1/0. */
  rankingFor?: (stage: number) => GroupRanking;
  resolutions?: TieResolution[];
  /** Knockout size from its first round (Final 2, SF 4...) and the teams already in it. */
  knockout?: { size: number; teams: Set<string>; hasThirdPlace: boolean };
  /** No league / group match is still to be played. */
  tablesComplete?: boolean;
  /** Stages that decide placings (the Cup, not a Plate). Unset = every stage. */
  placingStages?: Set<number> | null;
}

const POSITION_PLACEMENT: StandingsPlacement[] = ['winner', 'runner_up', 'third_place', 'fourth_place'];

/**
 * A placing tie the tie-breakers couldn't split. The teams share the better place (IIMK:
 * level teams get the same position) until the organiser sets an order, which then applies.
 */
export interface PendingPlacingTie { stage: number; entities: string[]; from: number; to: number }

/** Teams from different groups compared for placings, and what separated each pair. */
export interface CrossComparison {
  stage: number;
  kind: 'placings' | 'semi_losers';
  /** Compared contingents, best first. */
  order: string[];
  /** Place each one was given (null = none, or still waiting for an order). */
  places: Array<number | null>;
  /** Why order[i] is above order[i + 1]: a tie-breaker, a hand-picked order, or null = still level. */
  decidedBy: Array<StandingsTiebreaker | 'resolution' | null>;
}

export interface TableResult {
  placings: Map<string, StandingsPlacement[]>;
  pending: PendingPlacingTie[];
  /** Each contingent's record in the last table stage (for ranking semi-final losers). */
  records: Map<string, EntityTally>;
  /** Each contingent's pool in that stage. */
  poolOf: Map<string, number | null>;
  comparisons: CrossComparison[];
  stage: number;
}

/** The first tie-breaker on which two records differ. */
const separatedBy = (a: EntityTally, b: EntityTally, tbs: StandingsTiebreaker[]) =>
  tbs.find((t) => metric(a, t) !== metric(b, t)) ?? null;

const rankingOf = (rule: StandingsRule, ctx: SchemeContext, stage: number): GroupRanking =>
  ctx.rankingFor?.(stage) ?? groupRankingFor(rule);

// Placings from the final league / group table, for positions no knockout match decides.
// Positions start after the teams that went through to the knockout, so with only a final
// the best group runners-up are 3rd and 4th; with no knockout the table is the result.
export function tablePlacings(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'placement' }>, ctx: SchemeContext): TableResult {
  const out: TableResult = { placings: new Map(), pending: [], records: new Map(), poolOf: new Map(), comparisons: [], stage: 1 };
  const tableFx = fixtures.filter((f) => !isKnockoutRound(f.round) && f.status !== 'bye');
  if (tableFx.length === 0 || !ctx.tablesComplete) return out;
  const stage = Math.max(...tableFx.map((f) => f.stage_sequence ?? 1));
  out.stage = stage;
  const stageFx = tableFx.filter((f) => (f.stage_sequence ?? 1) === stage);
  const ranking = rankingOf(rule, ctx, stage);
  const pools = [...new Set(stageFx.map((f) => f.pool_number ?? null))];

  const poolRank = new Map<string, number>();
  const poolTies: string[][] = [];
  const ranked = pools.map((pool) => {
    const g = rankGroup(stageFx.filter((f) => (f.pool_number ?? null) === pool), ranking, resolverFor(ctx.resolutions, 'pool', stage, pool));
    g.rows.forEach((r) => { poolRank.set(r.entity_id, r.rank!); out.records.set(r.entity_id, r); out.poolOf.set(r.entity_id, pool); });
    poolTies.push(...g.ties);
    return g;
  });
  if (!rule.table_placings) return out;

  const teamEntity = teamEntityMap(fixtures);
  const ko = ctx.knockout ?? { size: 0, teams: new Set<string>(), hasThirdPlace: false };
  const koEntities = new Set([...ko.teams].map((t) => teamEntity.get(t)).filter((e): e is string => !!e));
  if (ko.size > 0 && koEntities.size < ko.size) return out; // knockout not filled yet
  let pos = koEntities.size + 1;
  if (pos > POSITION_PLACEMENT.length) return out;

  const inPoolTie = (id: string) => poolTies.some((t) => t.includes(id));
  const remaining = (ids: string[]) => ids.filter((id) => !koEntities.has(id));
  // Ordered blocks of contingents still to place; `tied` = level with no saved order.
  const blocks: Array<{ ids: string[]; tied: boolean }> = [];
  const tiers: Array<Pick<CrossComparison, 'order' | 'decidedBy'>> = [];
  if (ranked.length === 1) {
    const rows = ranked[0].rows;
    for (let i = 0; i < rows.length;) {
      const tie = ranked[0].ties.find((t) => t.includes(rows[i].entity_id));
      const ids = remaining(tie ?? [rows[i].entity_id]);
      if (ids.length) blocks.push({ ids, tied: !!tie && ids.length > 1 });
      i += tie ? tie.length : 1;
    }
  } else {
    const cross = ranking.tiebreakers.filter((t) => t !== 'head_to_head');
    const crossOrder: StandingsTiebreaker[] = cross.length ? cross : ['points'];
    const resolve = resolverFor(ctx.resolutions, 'placing', stage, null);
    const maxRank = Math.max(...poolRank.values());
    for (let rank = 1; rank <= maxRank; rank++) {
      const tier = remaining([...poolRank].filter(([, r]) => r === rank).map(([id]) => id));
      if (tier.length === 0) continue;
      if (tier.some(inPoolTie)) {
        blocks.push({ ids: tier, tied: tier.length > 1 });
        if (tier.length > 1) tiers.push({ order: tier, decidedBy: tier.slice(1).map(() => null) });
        continue;
      }
      // Kept for the "ranking across groups" view: the order and what split each pair.
      const order: string[] = [];
      const decidedBy: CrossComparison['decidedBy'] = [];
      let prev: { id: string; block: number; resolved: boolean } | null = null;
      tieBlocks(tier.map((id) => out.records.get(id)!), crossOrder).forEach((b, bi) => {
        const ids = b.map((r) => r.entity_id);
        const picked = ids.length > 1 ? resolve(ids) : undefined;
        if (picked) picked.forEach((id) => blocks.push({ ids: [id], tied: false }));
        else blocks.push({ ids, tied: ids.length > 1 });
        for (const id of picked ?? ids) {
          if (prev) {
            decidedBy.push(prev.block !== bi ? separatedBy(out.records.get(prev.id)!, out.records.get(id)!, crossOrder) : prev.resolved ? 'resolution' : null);
          }
          order.push(id);
          prev = { id, block: bi, resolved: !!picked };
        }
      });
      if (tier.length > 1) tiers.push({ order, decidedBy });
    }
  }

  // With a knockout, a top-four table finish counts as reaching the semis. A pure league
  // has no semis, so a 4th place worth 0 falls to participation instead.
  const semis = ko.size > 0;
  const value = (p: number) => {
    const v = rule.points[POSITION_PLACEMENT[p - 1]] ?? 0;
    return v > 0 || p < 3 || !semis ? v : rule.points.semi_finalist ?? 0;
  };
  const placeOf = new Map<string, number>();
  const award = (id: string, p: number) => {
    const list: StandingsPlacement[] = [POSITION_PLACEMENT[p - 1]];
    if (p >= 3 && semis) list.push('semi_finalist'); // finished in the last four
    out.placings.set(id, list);
    placeOf.set(id, p);
  };
  for (const b of blocks) {
    if (pos > POSITION_PLACEMENT.length) break;
    const to = pos + b.ids.length - 1;
    const last = Math.min(to, POSITION_PLACEMENT.length);
    if (!b.tied) b.ids.forEach((id, i) => { if (pos + i <= last) award(id, pos + i); });
    else {
      // Level teams share the better place; listed so the organiser can still set an order.
      b.ids.forEach((id) => award(id, pos));
      const span = Array.from({ length: last - pos + 1 }, (_, i) => value(pos + i));
      if (span.some((v) => v !== span[0])) out.pending.push({ stage, entities: b.ids, from: pos, to: last });
    }
    pos = to + 1;
  }
  // Only comparisons that decided (or are holding up) a placing are worth showing.
  for (const t of tiers) {
    const places = t.order.map((id) => placeOf.get(id) ?? null);
    const waiting = out.pending.some((pt) => pt.entities.some((id) => t.order.includes(id)));
    if (places.some((pl) => pl != null) || waiting) out.comparisons.push({ stage, kind: 'placings', order: t.order, places, decidedBy: t.decidedBy });
  }
  return out;
}

// No 3rd-place match: the two semi-final losers take 3rd and 4th by their group record.
function semiLoserPlacings(
  fixtures: SchemeFixture[], tables: TableResult, ranking: GroupRanking, ctx: SchemeContext,
): Map<string, StandingsPlacement> {
  const out = new Map<string, StandingsPlacement>();
  const sfs = fixtures.filter((f) => f.round === KNOCKOUT_ROUND.semiFinal && isResult(f) && f.winner_team_id);
  if (sfs.length !== 2) return out;
  const teamEntity = teamEntityMap(fixtures);
  const losers = sfs.map((f) => teamEntity.get((f.home_team_id === f.winner_team_id ? f.away_team_id : f.home_team_id) ?? ''));
  if (losers.some((e) => !e || !tables.records.has(e))) return out;
  const ids = losers as string[];
  const cross = ranking.tiebreakers.filter((t) => t !== 'head_to_head');
  const blocks = tieBlocks(ids.map((e) => tables.records.get(e)!), cross.length ? cross : ['points']);
  const split = blocks.length === 2;
  const order = split ? blocks.map((b) => b[0].entity_id) : resolverFor(ctx.resolutions, 'placing', tables.stage, null)(ids);
  const crossOrder: StandingsTiebreaker[] = cross.length ? cross : ['points'];
  tables.comparisons.push({
    stage: tables.stage, kind: 'semi_losers', order: order ?? ids, places: order ? [3, 4] : [3, 3],
    decidedBy: [split ? separatedBy(tables.records.get(order![0])!, tables.records.get(order![1])!, crossOrder) : order ? 'resolution' : null],
  });
  // Still level with no order set: both share 3rd until the organiser orders them.
  if (!order) {
    tables.pending.push({ stage: tables.stage, entities: ids, from: 3, to: 4 });
    ids.forEach((id) => out.set(id, 'third_place'));
    return out;
  }
  out.set(order[0], 'third_place');
  out.set(order[1], 'fourth_place');
  return out;
}

/** How table placings were worked out: ties waiting on an order, and cross-group comparisons. */
export function tableAnalysis(all: SchemeFixture[], rule: StandingsRule, ctx: SchemeContext): TableResult | null {
  if (rule.scheme !== 'placement') return null;
  const fixtures = all.filter((f) => !ctx.placingStages || ctx.placingStages.has(f.stage_sequence ?? 1));
  const tables = tablePlacings(fixtures, rule, ctx);
  if (rule.rank_semi_losers && !ctx.knockout?.hasThirdPlace) {
    semiLoserPlacings(fixtures, tables, rankingOf(rule, ctx, tables.stage), ctx);
  }
  return tables;
}

/** Placing ties waiting on a hand-picked order (shown on the group tables). */
export function pendingPlacingTies(all: SchemeFixture[], rule: StandingsRule, ctx: SchemeContext): PendingPlacingTie[] {
  return tableAnalysis(all, rule, ctx)?.pending ?? [];
}

function placementScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'placement' }>, ctx: SchemeContext = {}): EntityTally[] {
  // Base P/W/L from the results (no league points), then layer placement points. Knockout
  // placings accrue progressively round by round - each team holds the floor of the
  // highest stage it has reached (see placementCandidates), so the table is live
  // throughout the bracket rather than blank until the final.
  const table = leagueTally(fixtures, 0, 0, 0);
  const teamEntity = teamEntityMap(fixtures);
  const ensure = (entityId: string) => {
    let row = table.get(entityId);
    if (!row) { row = emptyTally(entityId); table.set(entityId, row); }
    return row;
  };
  // A Plate (consolation) bracket plays its own Final, but only the Cup decides placings.
  const placingFx = fixtures.filter((f) => !ctx.placingStages || ctx.placingStages.has(f.stage_sequence ?? 1));

  // "Both": league / group matches also earn their W/D/L points.
  if (rule.include_match_points) {
    const tableFx = fixtures.filter((f) => !isKnockoutRound(f.round));
    for (const stage of new Set(tableFx.map((f) => f.stage_sequence ?? 1))) {
      const r = rankingOf(rule, ctx, stage);
      for (const t of leagueTally(tableFx.filter((f) => (f.stage_sequence ?? 1) === stage), r.win, r.draw, r.loss).values()) {
        if (!t.points) continue;
        const row = ensure(t.entity_id);
        row.points += t.points;
        row.detail.match_points = (row.detail.match_points ?? 0) + t.points;
      }
    }
  }

  // All placements each contingent earned across the bracket and the tables. Byes count
  // here (they grant a reached-the-next-stage floor) even though leagueTally ignores them.
  const candidates = new Map<string, Set<StandingsPlacement>>();
  const add = (entityId: string, p: StandingsPlacement) => {
    let set = candidates.get(entityId);
    if (!set) { set = new Set(); candidates.set(entityId, set); }
    set.add(p);
  };
  for (const f of placingFx) {
    if (!isResult(f) && f.status !== 'bye') continue;
    for (const [teamId, placement] of placementCandidates(f)) {
      const entityId = teamEntity.get(teamId);
      if (entityId) add(entityId, placement);
    }
  }
  const tables = tablePlacings(placingFx, rule, ctx);
  for (const [entityId, list] of tables.placings) list.forEach((p) => add(entityId, p));
  if (rule.rank_semi_losers && !ctx.knockout?.hasThirdPlace) {
    for (const [entityId, p] of semiLoserPlacings(placingFx, tables, rankingOf(rule, ctx, tables.stage), ctx)) add(entityId, p);
  }

  // Only losing a played final makes a team runner-up; reaching it is still a floor.
  const finalLosers = new Set<string>();
  for (const f of placingFx) {
    if (!isResult(f) || f.round !== KNOCKOUT_ROUND.final || !f.winner_team_id) continue;
    const loser = f.home_team_id === f.winner_team_id ? f.away_team_id : f.home_team_id;
    const entityId = loser ? teamEntity.get(loser) : undefined;
    if (entityId) finalLosers.add(entityId);
  }

  // Contingents that banked a scored placement - they do NOT also get participation.
  // A placement worth 0 counts as no placement, so participation still applies.
  const placed = new Set<string>();
  for (const [entityId, earned] of candidates) {
    const chosen = PLACEMENT_SPECIFICITY.find((p) => earned.has(p) && (rule.points[p] ?? 0) > 0);
    if (!chosen) continue;
    const row = ensure(entityId);
    row.points += rule.points[chosen]!;
    // Same points either way; the label decides whether the medal tally counts a silver.
    const tableRunnerUp = tables.placings.get(entityId)?.includes('runner_up');
    const key = chosen === 'runner_up' && !finalLosers.has(entityId) && !tableRunnerUp ? FINALIST_DETAIL_KEY : chosen;
    row.detail[key] = (row.detail[key] ?? 0) + 1;
    placed.add(entityId);
  }

  // Participation is a consolation floor, not a universal top-up: it goes only to
  // contingents with no placement point to show for it (so if quarter-finalist points
  // are configured, QF losers take those instead). A no-show earns nothing.
  if (rule.participation > 0) {
    for (const row of table.values()) {
      if (placed.has(row.entity_id) || isNoShow(row)) continue;
      row.points += rule.participation;
      row.detail.participation = (row.detail.participation ?? 0) + 1;
    }
  }
  return [...table.values()];
}

// Custom: no auto formula. Base P/W/L is tallied for the display columns (with zero
// auto-points), then the organiser's hand-entered championship points per side are
// added on. A side with no points entered simply contributes nothing.
function customScheme(fixtures: SchemeFixture[]): EntityTally[] {
  const table = leagueTally(fixtures, 0, 0, 0);
  for (const f of fixtures) {
    if (!isResult(f)) continue;
    if (f.home_entity_id && f.home_points != null) { const row = table.get(f.home_entity_id); if (row) row.points += f.home_points; }
    if (f.away_entity_id && f.away_points != null) { const row = table.get(f.away_entity_id); if (row) row.points += f.away_points; }
  }
  return [...table.values()];
}

function medalScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'medal' }>, decided: boolean): EntityTally[] {
  // Rank contingents within the discipline by a standard 3/1/0 win record, then
  // award gold/silver/bronze points to the top three - but only once the discipline
  // is decided (the final has been played / every match is in).
  const rows = [...leagueTally(fixtures, 3, 1, 0).values()];
  rankBy(rows, ['points', 'wins', 'lost']);
  if (!decided) { rows.forEach((row) => { row.points = 0; }); return rows; }
  const medals = ['gold', 'silver', 'bronze'] as const;
  rows.forEach((row, i) => {
    if (i < medals.length && row.played > 0) {
      const label = medals[i];
      row.points = rule[label];
      row.detail[label] = (row.detail[label] ?? 0) + 1;
    } else {
      row.points = 0;
    }
  });
  return rows;
}

// Run the scheme matching `rule`. For league_points/medal/custom, participation is a
// flat top-up added to every contingent that took part; placement handles participation
// itself (a sub-semis consolation floor). `decided` gates only the medal scheme's
// position points until the discipline is concluded - placement now accrues live,
// round by round, and league points always have.
export function runScheme(fixtures: SchemeFixture[], rule: StandingsRule, decided = true, ctx: SchemeContext = {}): EntityTally[] {
  let tallies: EntityTally[];
  switch (rule.scheme) {
    case 'league_points': tallies = leaguePointsScheme(fixtures, rule); break;
    // Placement folds participation in itself (consolation floor for sub-semis exits),
    // so it returns directly rather than taking the universal top-up below.
    case 'placement': return placementScheme(fixtures, rule, ctx);
    case 'medal': tallies = medalScheme(fixtures, rule, decided); break;
    case 'custom': tallies = customScheme(fixtures); break;
    // Ranking events have no head-to-head fixtures - their points come from the event
    // console's eventStandings (folded in separately by the service). So a draw resolved
    // to a ranking rule contributes no auto points here (just P/W/L columns + participation).
    case 'ranking': tallies = [...leagueTally(fixtures, 0, 0, 0).values()]; break;
  }
  if (rule.participation > 0) {
    for (const t of tallies) {
      // A no-show earns nothing; a medallist already has its medal points.
      if (isNoShow(t) || t.detail.gold || t.detail.silver || t.detail.bronze) continue;
      t.points += rule.participation;
      t.detail.participation = (t.detail.participation ?? 0) + 1;
    }
  }
  return tallies;
}

// Merge a draw's tallies into a running per-scope accumulator (by contingent).
export function accumulate(acc: Map<string, EntityTally>, tallies: EntityTally[]): void {
  for (const t of tallies) {
    let row = acc.get(t.entity_id);
    if (!row) { row = emptyTally(t.entity_id); acc.set(t.entity_id, row); }
    row.played += t.played;
    row.won += t.won;
    row.drawn += t.drawn;
    row.lost += t.lost;
    row.points += t.points;
    row.gf += t.gf;
    row.ga += t.ga;
    row.wo += t.wo;
    for (const [k, v] of Object.entries(t.detail)) row.detail[k] = (row.detail[k] ?? 0) + v;
  }
}

// Sort rows in place by the ordered tiebreakers (descending "better first") and
// assign sequential ranks. Head-to-head needs fixtures, so across draws it is skipped.
/** Two rows level on every tie-breaker in the list. */
export const levelOn = (tiebreakers: StandingsTiebreaker[]) => (a: EntityTally, b: EntityTally) =>
  tiebreakers.every((t) => metric(a, t) === metric(b, t));

/** Rows already in order: level neighbours share the better rank (1, 2, 2, 4), as IIMK ranks ties. */
export function shareRanks(rows: EntityTally[], level: (a: EntityTally, b: EntityTally) => boolean): EntityTally[] {
  rows.forEach((r, i) => { r.rank = i > 0 && level(rows[i - 1], r) ? rows[i - 1].rank : i + 1; });
  return rows;
}

export function rankBy(rows: EntityTally[], tiebreakers: StandingsTiebreaker[]): EntityTally[] {
  rows.sort((a, b) => {
    for (const t of tiebreakers) {
      const d = metric(b, t) - metric(a, t);
      if (d !== 0) return d;
    }
    return 0;
  });
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

const SETTLED = new Set(['completed', 'walkover', 'bye', 'cancelled']);

/** Statuses a scheme scores. Everything else only feeds the draw context. */
export const SCORED_STATUSES = ['completed', 'walkover', 'bye'];

/** What a scheme needs to know about the whole draw, read from ALL its fixtures. */
export function drawContext(
  everything: SchemeFixture[], rankingFor: (stage: number) => GroupRanking, resolutions: TieResolution[],
  placingStages: Set<number> | null = null,
): SchemeContext {
  // Only the Cup side of the tree decides placings, so a Plate is left out here too.
  const all = everything.filter((f) => !placingStages || placingStages.has(f.stage_sequence ?? 1));
  const ko = all.filter((f) => isKnockoutRound(f.round) && f.round !== THIRD_PLACE_ROUND);
  return {
    rankingFor,
    resolutions,
    placingStages,
    knockout: {
      size: Math.max(0, ...ko.map((f) => knockoutRoundSize(f.round))),
      teams: new Set(ko.flatMap((f) => [f.home_team_id, f.away_team_id]).filter((t): t is string => !!t)),
      hasThirdPlace: all.some((f) => f.round === THIRD_PLACE_ROUND),
    },
    tablesComplete: all.filter((f) => !isKnockoutRound(f.round)).every((f) => SETTLED.has(f.status)),
  };
}
