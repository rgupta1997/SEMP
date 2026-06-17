import type { StandingsRule, StandingsPlacement, StandingsTiebreaker } from '@semp/shared';

// Pure standings computation. A scheme turns a single draw's (tournament_discipline)
// completed fixtures into per-organization tallies. The service aggregates these
// tallies across draws into the championship / tournament / sport scopes and ranks
// them. No DB access here so the logic is unit-testable in isolation.

// The minimal fixture shape a scheme needs. The service maps each side's team to its
// organization (standings are org-level) before handing rows over.
export interface SchemeFixture {
  status: string;
  round: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_org_id: string | null;
  away_org_id: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
}

export interface OrgTally {
  organization_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  // Internal sort aids (goals for/against) — not persisted as columns.
  gf: number;
  ga: number;
  // Scheme-specific counts surfaced to the UI (e.g. { gold: 2 }, { semi_finalist: 1 }).
  detail: Record<string, number>;
  // Assigned by rankBy once a scope is fully accumulated.
  rank?: number;
}

function emptyTally(organization_id: string): OrgTally {
  return { organization_id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, gf: 0, ga: 0, detail: {} };
}

// Core W/D/L counter shared by every scheme — counts played/won/drawn/lost and
// goals for/against, and awards `win`/`draw`/`loss` points. Returns a keyed map so
// callers can layer scheme-specific points on top.
function leagueTally(fixtures: SchemeFixture[], win: number, draw: number, loss: number): Map<string, OrgTally> {
  const table = new Map<string, OrgTally>();
  const ensure = (orgId: string) => {
    let row = table.get(orgId);
    if (!row) { row = emptyTally(orgId); table.set(orgId, row); }
    return row;
  };

  for (const f of fixtures) {
    if (f.status !== 'completed') continue;
    const home = f.home_org_id ? ensure(f.home_org_id) : null;
    const away = f.away_org_id ? ensure(f.away_org_id) : null;
    if (!home && !away) continue;
    if (home) home.played++;
    if (away) away.played++;
    if (home && f.home_score != null) { home.gf += f.home_score; home.ga += f.away_score ?? 0; }
    if (away && f.away_score != null) { away.gf += f.away_score; away.ga += f.home_score ?? 0; }

    const isDraw = f.winner_team_id == null && f.home_score != null && f.away_score != null && f.home_score === f.away_score;
    if (isDraw) {
      if (home) { home.drawn++; home.points += draw; }
      if (away) { away.drawn++; away.points += draw; }
    } else if (f.winner_team_id) {
      const homeWon = f.winner_team_id === f.home_team_id;
      if (home) { if (homeWon) { home.won++; home.points += win; } else { home.lost++; home.points += loss; } }
      if (away) { if (!homeWon) { away.won++; away.points += win; } else { away.lost++; away.points += loss; } }
    }
  }
  return table;
}

// Map each team to its organization across all fixtures in the draw (either side).
function teamOrgMap(fixtures: SchemeFixture[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fixtures) {
    if (f.home_team_id && f.home_org_id) m.set(f.home_team_id, f.home_org_id);
    if (f.away_team_id && f.away_org_id) m.set(f.away_team_id, f.away_org_id);
  }
  return m;
}

// Knockout placement candidates a completed fixture implies. A team's final
// placement is the best-scoring of its candidates (so a 3rd-place win beats the
// implicit "semi-finalist" from losing the semi), which sidesteps any ordering
// concerns between rounds.
function placementCandidates(f: SchemeFixture): Array<[string, StandingsPlacement]> {
  if (!f.winner_team_id) return [];
  const winner = f.winner_team_id;
  const loser = f.home_team_id === winner ? f.away_team_id : f.home_team_id;
  const out: Array<[string, StandingsPlacement]> = [];
  switch (f.round) {
    case 'Final':
      out.push([winner, 'winner']);
      if (loser) out.push([loser, 'runner_up']);
      break;
    case '3rd Place':
      out.push([winner, 'third_place']);
      if (loser) out.push([loser, 'fourth_place']);
      break;
    case 'SF':
      if (loser) out.push([loser, 'semi_finalist']);
      break;
    case 'QF':
      if (loser) out.push([loser, 'quarter_finalist']);
      break;
    default:
      break; // earlier rounds (R16, R32, …) don't map to a canonical placement
  }
  return out;
}

// --- the three schemes ---

function leaguePointsScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'league_points' }>): OrgTally[] {
  return [...leagueTally(fixtures, rule.win, rule.draw, rule.loss).values()];
}

// Placement specificity, best (most decisive) first. A team's final placement is the
// most specific one it earned that the rule actually scores — so a 3rd-place playoff
// loss (fourth_place) beats the generic semi_finalist, yet a config that omits
// third/fourth gracefully falls back to semi_finalist.
const PLACEMENT_SPECIFICITY: StandingsPlacement[] = [
  'winner', 'runner_up', 'third_place', 'fourth_place', 'semi_finalist', 'quarter_finalist',
];

function placementScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'placement' }>, decided: boolean): OrgTally[] {
  // Base P/W/L from the knockout results (no league points), then layer placement
  // points — but only once the discipline is decided (the final has been played).
  const table = leagueTally(fixtures, 0, 0, 0);
  if (!decided) return [...table.values()];
  const teamOrg = teamOrgMap(fixtures);

  // All placements each team earned across the bracket.
  const candidates = new Map<string, Set<StandingsPlacement>>();
  for (const f of fixtures) {
    if (f.status !== 'completed') continue;
    for (const [teamId, placement] of placementCandidates(f)) {
      let set = candidates.get(teamId);
      if (!set) { set = new Set(); candidates.set(teamId, set); }
      set.add(placement);
    }
  }

  for (const [teamId, earned] of candidates) {
    const chosen = PLACEMENT_SPECIFICITY.find((p) => earned.has(p) && rule.points[p] !== undefined);
    if (!chosen) continue;
    const orgId = teamOrg.get(teamId);
    if (!orgId) continue;
    let row = table.get(orgId);
    if (!row) { row = emptyTally(orgId); table.set(orgId, row); }
    row.points += rule.points[chosen]!;
    row.detail[chosen] = (row.detail[chosen] ?? 0) + 1;
  }
  return [...table.values()];
}

function medalScheme(fixtures: SchemeFixture[], rule: Extract<StandingsRule, { scheme: 'medal' }>, decided: boolean): OrgTally[] {
  // Rank organizations within the discipline by a standard 3/1/0 win record, then
  // award gold/silver/bronze points to the top three — but only once the discipline
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

// Run the scheme matching `rule`, then layer participation points (awarded once to
// every organization that took part). `decided` gates placement/medal position
// points until the discipline is concluded; league points always accrue live.
export function runScheme(fixtures: SchemeFixture[], rule: StandingsRule, decided = true): OrgTally[] {
  let tallies: OrgTally[];
  switch (rule.scheme) {
    case 'league_points': tallies = leaguePointsScheme(fixtures, rule); break;
    case 'placement': tallies = placementScheme(fixtures, rule, decided); break;
    case 'medal': tallies = medalScheme(fixtures, rule, decided); break;
  }
  if (rule.participation > 0) {
    for (const t of tallies) {
      t.points += rule.participation;
      t.detail.participation = (t.detail.participation ?? 0) + 1;
    }
  }
  return tallies;
}

// Merge a draw's tallies into a running per-scope accumulator (by organization).
export function accumulate(acc: Map<string, OrgTally>, tallies: OrgTally[]): void {
  for (const t of tallies) {
    let row = acc.get(t.organization_id);
    if (!row) { row = emptyTally(t.organization_id); acc.set(t.organization_id, row); }
    row.played += t.played;
    row.won += t.won;
    row.drawn += t.drawn;
    row.lost += t.lost;
    row.points += t.points;
    row.gf += t.gf;
    row.ga += t.ga;
    for (const [k, v] of Object.entries(t.detail)) row.detail[k] = (row.detail[k] ?? 0) + v;
  }
}

// Sort rows in place by the ordered tiebreakers (descending "better first") and
// assign sequential ranks. `head_to_head` is not yet implemented and is skipped.
export function rankBy(rows: OrgTally[], tiebreakers: StandingsTiebreaker[]): OrgTally[] {
  const metric = (r: OrgTally, t: StandingsTiebreaker): number => {
    switch (t) {
      case 'points': return r.points;
      case 'wins': return r.won;
      case 'lost': return -r.lost; // fewer losses ranks higher
      case 'score_diff': return r.gf - r.ga;
      case 'head_to_head': return 0; // not implemented — neutral
    }
  };
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
