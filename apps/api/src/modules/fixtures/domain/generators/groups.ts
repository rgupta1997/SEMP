import { BusinessRuleError } from '../../../../shared/errors.js';
import type { GeneratedFixture, TeamRef } from './types.js';
import { generateRoundRobin } from './round-robin.js';

export interface GroupsParams {
  numGroups: number;
  advancePerGroup?: number; // used later to seed the knockout stage, not at generation
  teamsPerGroup?: number;
  doubleRound?: boolean;
}

// Group / pool stage: snake-distribute teams into N groups, then round-robin
// within each group. Knockout stage (if any) is generated in a later pass once
// standings exist (qualifiers = top `advancePerGroup` per group).
export function generateGroups(teams: TeamRef[], params: GroupsParams): GeneratedFixture[] {
  const G = params.numGroups;
  if (!G || G < 1) throw new BusinessRuleError('numGroups must be >= 1');
  if (teams.length < G * 2) throw new BusinessRuleError('Need at least 2 teams per group');

  const groups: TeamRef[][] = Array.from({ length: G }, () => []);
  teams.forEach((t, i) => {
    const cycle = i % (2 * G); // snake seeding for balance
    const idx = cycle < G ? cycle : 2 * G - 1 - cycle;
    groups[idx].push(t);
  });

  const fixtures: GeneratedFixture[] = [];
  groups.forEach((groupTeams, gi) => {
    const letter = String.fromCharCode(65 + gi);
    const rr = generateRoundRobin(groupTeams, { doubleRound: params.doubleRound }, `Pool ${letter} - Match`);
    rr.forEach((f) => fixtures.push({ ...f, poolNumber: gi + 1 }));
  });

  return fixtures;
}
