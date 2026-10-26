import type { GroupRanking } from '@semp/shared';
import { rankGroup, type EntityTally, type SchemeFixture, type TieResolver } from '../../../standings/domain/schemes.js';

export type PoolFixture = SchemeFixture;

export interface PoolStanding {
  teamId: string;
  /**
   * The CONTINGENT this team plays for - its campus or department in an intra
   * championship, its organisation in an inter one. Named `entityId` because a
   * pool inside an intra event has several teams sharing one organisation, and a
   * field called organizationId would have made every pool position collapse onto
   * the same value when the qualifier labels were resolved.
   */
  entityId: string;
  rank: number; // 1-based. Must be a strict total order for qualifier-label resolution
  // to work (a label like "A1" has to resolve to exactly one team) - see the tie
  // note in stage-resolver.ts, which skips resolving a rank it can't disambiguate
  // rather than guessing.
  tally: EntityTally;
}

// Builds the contingent -> team map from the SAME fixtures being ranked, rather than
// reaching into standings/domain/schemes.ts's private per-draw teamEntityMap helper -
// every fixture here already carries both id pairs, so no cross-module export is
// needed for this.
function buildTeamEntityMap(fixtures: PoolFixture[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fixtures) {
    if (f.home_team_id && f.home_entity_id) map.set(f.home_entity_id, f.home_team_id);
    if (f.away_team_id && f.away_entity_id) map.set(f.away_entity_id, f.away_team_id);
  }
  return map;
}

// Ranks a single pool by the group ranking (this stage's match points and tie-breaker
// order), then any order the organiser hand-picked for a tie the tie-breakers left.
export function computePoolStandings(fixtures: PoolFixture[], ranking: GroupRanking, resolve?: TieResolver): PoolStandings {
  const { rows, ties } = rankGroup(fixtures, ranking, resolve);
  const entityToTeam = buildTeamEntityMap(fixtures);
  const standings = rows.map((tally, i) => ({
    // Fallback never actually triggers: every tally's entity_id came from a row in
    // `fixtures`, so buildTeamEntityMap always has an entry for it.
    teamId: entityToTeam.get(tally.entity_id) ?? tally.entity_id,
    entityId: tally.entity_id,
    rank: tally.rank ?? i + 1,
    tally,
  }));
  // A rank feeding a branch must resolve to exactly one team, so every rank inside a
  // still-level block is ambiguous and must not be guessed.
  const tied = new Set(standings.filter((s) => ties.some((t) => t.includes(s.entityId))).map((s) => s.rank));
  return { standings, ties, tied };
}

export interface PoolStandings {
  standings: PoolStanding[];
  /** Contingent keys still level after tie-breakers and saved resolutions. */
  ties: string[][];
  /** Ranks inside those ties. */
  tied: Set<number>;
}

export function isPoolComplete(fixtures: PoolFixture[]): boolean {
  if (fixtures.length === 0) return false;
  return fixtures.every((f) => f.status === 'completed' || f.status === 'walkover' || f.status === 'bye');
}
