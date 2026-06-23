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
  const byPosition = new Map<number, GeneratedFixture>();

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

      const fixture: GeneratedFixture = {
        round: roundLabel(teamsInRound),
        poolNumber: null,
        bracketPosition: position,
        homeTeamId: home?.teamId ?? null,
        awayTeamId: away?.teamId ?? null,
        status: isBye ? 'bye' : 'scheduled',
        feedsInto,
      };
      fixtures.push(fixture);
      byPosition.set(position, fixture);
    }
  }

  // A bye is auto-complete: its lone team advances with no match played, so seed that
  // team straight into its next-round slot. The two children of a parent match feed it
  // in slot order - the upper child (even local index) fills home, the lower fills away
  // - matching the bracket layout. The bye fixture's winner is the advancing team.
  for (let j = 0; j < size / 2; j++) {
    const child = byPosition.get(offsets[0] + j);
    if (!child || child.status !== 'bye' || child.feedsInto == null) continue;
    const advancing = child.homeTeamId ?? child.awayTeamId;
    if (!advancing) continue;
    child.winnerTeamId = advancing;
    const parent = byPosition.get(child.feedsInto);
    if (!parent) continue;
    if (j % 2 === 0) parent.homeTeamId = advancing;
    else parent.awayTeamId = advancing;
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
