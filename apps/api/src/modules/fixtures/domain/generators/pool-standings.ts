import type { StandingsRule, StandingsTiebreaker } from '@semp/shared';
import { rankBy, runScheme, type OrgTally, type SchemeFixture } from '../../../standings/domain/schemes.js';

export type PoolFixture = SchemeFixture;

export interface PoolStanding {
  teamId: string;
  organizationId: string;
  rank: number; // 1-based. Must be a strict total order for qualifier-label resolution
  // to work (a label like "A1" has to resolve to exactly one team) - see the tie
  // note in stage-resolver.ts, which skips resolving a rank it can't disambiguate
  // rather than guessing.
  tally: OrgTally;
}

// Builds the org -> team map from the SAME fixtures being ranked, rather than
// reaching into standings/domain/schemes.ts's private per-draw teamOrgMap helper -
// every fixture here already carries both id pairs, so no cross-module export is
// needed for this.
function buildTeamOrgMap(fixtures: PoolFixture[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fixtures) {
    if (f.home_team_id && f.home_org_id) map.set(f.home_org_id, f.home_team_id);
    if (f.away_team_id && f.away_org_id) map.set(f.away_org_id, f.away_team_id);
  }
  return map;
}

// Ranks a single pool's fixtures by the championship's points formula (win/draw/loss
// values, scheme) but this STAGE's own configured tiebreaker order - the two are
// independent (see GroupStage.tiebreakers in packages/shared/src/stage-config.ts).
export function computePoolStandings(
  fixtures: PoolFixture[],
  rule: StandingsRule,
  tiebreakers: StandingsTiebreaker[],
): PoolStanding[] {
  const ranked = rankBy(runScheme(fixtures, rule, true), tiebreakers);
  const orgToTeam = buildTeamOrgMap(fixtures);
  return ranked.map((tally, i) => ({
    // Fallback never actually triggers: every tally's organization_id came from a
    // row in `fixtures`, so buildTeamOrgMap always has an entry for it.
    teamId: orgToTeam.get(tally.organization_id) ?? tally.organization_id,
    organizationId: tally.organization_id,
    rank: tally.rank ?? i + 1,
    tally,
  }));
}

export function isPoolComplete(fixtures: PoolFixture[]): boolean {
  if (fixtures.length === 0) return false;
  return fixtures.every((f) => f.status === 'completed' || f.status === 'walkover' || f.status === 'bye');
}

function metric(t: OrgTally, tb: StandingsTiebreaker): number {
  switch (tb) {
    case 'points': return t.points;
    case 'wins': return t.won;
    case 'lost': return -t.lost;
    case 'score_diff': return t.gf - t.ga;
    case 'head_to_head': return 0; // not implemented in schemes.ts - never distinguishes a tie
  }
}

// A rank feeding a branch must resolve to exactly one team. rankBy's stable sort
// always produces SOME order even when two teams are fully tied on every configured
// tiebreaker, but that order is an accident of fixture-processing order, not a real
// tiebreak - so callers should NOT trust a rank inside a tied block. Returns every
// rank involved in such a tie (both members of a 2-way tie, etc.) so
// stage-resolver.ts can skip resolving those specific labels rather than silently
// picking an arbitrary team.
export function tiedRanks(standings: PoolStanding[], tiebreakers: StandingsTiebreaker[]): Set<number> {
  const tied = new Set<number>();
  for (let i = 1; i < standings.length; i++) {
    const a = standings[i - 1].tally;
    const b = standings[i].tally;
    const identical = tiebreakers.every((tb) => metric(a, tb) === metric(b, tb));
    if (identical) { tied.add(standings[i - 1].rank); tied.add(standings[i].rank); }
  }
  return tied;
}
