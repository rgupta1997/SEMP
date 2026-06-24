import { BusinessRuleError } from '../../../../shared/errors.js';
import { generateGroups } from './groups.js';
import { generateKnockout } from './knockout.js';
import { generateRoundRobin } from './round-robin.js';
import { generateRanking } from './ranking.js';
import type { GeneratedFixture, TeamRef } from './types.js';

export type { GeneratedFixture, TeamRef } from './types.js';
export { generateGroups, generateKnockout, generateRoundRobin, generateRanking };

// Dispatch by tournament_formats.name. `params` are the format's instance config.
export function generateFixtures(
  formatName: string,
  teams: TeamRef[],
  params: Record<string, unknown>,
): GeneratedFixture[] {
  const name = formatName.trim().toLowerCase();

  if (name.includes('pool')) {
    // Pool + Knockout: pool stage now; knockout stage generated after standings.
    return generateGroups(teams, {
      numGroups: Number(params.num_groups ?? params.numGroups ?? 2),
      advancePerGroup: Number(params.advance_per_group ?? params.advancePerGroup ?? 2),
    });
  }
  if (name.includes('group')) {
    return generateGroups(teams, {
      numGroups: Number(params.num_groups ?? params.numGroups ?? 2),
      advancePerGroup: Number(params.advance_per_group ?? params.advancePerGroup ?? 2),
    });
  }
  if (name.includes('knockout')) {
    return generateKnockout(teams, {
      thirdPlaceMatch: Boolean(params.third_place_match ?? params.thirdPlaceMatch ?? false),
    });
  }
  if (name.includes('league') || name.includes('round robin') || name.includes('round-robin')) {
    return generateRoundRobin(teams, {
      doubleRound: Boolean(params.double_round ?? params.doubleRound ?? false),
    });
  }
  if (name.includes('rank')) {
    // Ranking event (powerlifting/swimming/athletics): one team-less event fixture.
    return generateRanking(teams, params);
  }

  throw new BusinessRuleError(`No fixture generator for format '${formatName}'`);
}
