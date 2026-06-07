import { BusinessRuleError } from '../../../../shared/errors.js';
import type { GeneratedFixture, TeamRef } from './types.js';
import { nextPowerOfTwo, roundLabel, seedOrder } from './util.js';

export interface KnockoutParams {
  thirdPlaceMatch?: boolean;
}

// Single-elimination bracket. Teams are seeded by input order; the bracket is
// padded to the next power of two with byes assigned to the top seeds.
export function generateKnockout(teams: TeamRef[], params: KnockoutParams = {}): GeneratedFixture[] {
  if (teams.length < 2) throw new BusinessRuleError('Knockout needs at least 2 teams');

  const size = nextPowerOfTwo(teams.length);
  const order = seedOrder(size); // seed numbers in bracket slot order
  const slot = (seed: number): TeamRef | null => (seed <= teams.length ? teams[seed - 1] : null);

  const roundsCount = Math.log2(size);

  // Offset (starting bracketPosition) of each round; matches numbered round-by-round.
  const offsets: number[] = [];
  let acc = 0;
  for (let r = 0; r < roundsCount; r++) {
    offsets.push(acc);
    acc += size / 2 ** (r + 1);
  }

  const fixtures: GeneratedFixture[] = [];

  for (let r = 0; r < roundsCount; r++) {
    const matchesInRound = size / 2 ** (r + 1);
    const teamsInRound = matchesInRound * 2;
    for (let j = 0; j < matchesInRound; j++) {
      const position = offsets[r] + j;
      const feedsInto = r < roundsCount - 1 ? offsets[r + 1] + Math.floor(j / 2) : undefined;

      let home: TeamRef | null = null;
      let away: TeamRef | null = null;
      if (r === 0) {
        home = slot(order[j * 2]);
        away = slot(order[j * 2 + 1]);
      }
      const isBye = r === 0 && (home === null || away === null);

      fixtures.push({
        round: roundLabel(teamsInRound),
        poolNumber: null,
        bracketPosition: position,
        homeTeamId: home?.teamId ?? null,
        awayTeamId: away?.teamId ?? null,
        status: isBye ? 'bye' : 'scheduled',
        feedsInto,
      });
    }
  }

  if (params.thirdPlaceMatch) {
    fixtures.push({
      round: '3rd Place',
      poolNumber: null,
      bracketPosition: null,
      homeTeamId: null,
      awayTeamId: null,
      status: 'scheduled',
    });
  }

  return fixtures;
}
