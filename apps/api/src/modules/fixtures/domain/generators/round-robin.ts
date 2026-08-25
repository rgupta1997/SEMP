import { BusinessRuleError } from '../../../../shared/errors.js';
import type { GeneratedFixture, TeamRef } from './types.js';

export interface RoundRobinParams {
  doubleRound?: boolean;
}

// Round-robin via the circle method. Odd counts get a phantom slot (-> a bye each
// round). Optionally play a second leg with home/away swapped.
export function generateRoundRobin(
  teams: TeamRef[],
  params: RoundRobinParams = {},
  labelPrefix = 'Round',
): GeneratedFixture[] {
  if (teams.length < 2) throw new BusinessRuleError('Round robin needs at least 2 teams');

  const arr: (TeamRef | null)[] = teams.slice();
  if (arr.length % 2 !== 0) arr.push(null); // phantom -> bye
  const n = arr.length;
  const roundsN = n - 1;
  const half = n / 2;

  const fixtures: GeneratedFixture[] = [];
  let order = arr.slice();
  // Numbers every emitted fixture individually - NOT the round it plays in. A
  // round-robin round can have several matches happening simultaneously (e.g. 4
  // teams -> 2 matches per round), so numbering by round would stamp two different
  // matches with the same "Match N" label, which read as duplicated/confusing.
  let matchNo = 0;

  const emitRound = (slots: (TeamRef | null)[], swap: boolean) => {
    for (let i = 0; i < half; i++) {
      let home = slots[i];
      let away = slots[n - 1 - i];
      if (swap) [home, away] = [away, home];
      if (home && away) {
        matchNo += 1;
        fixtures.push({
          round: `${labelPrefix} ${matchNo}`, poolNumber: null, bracketPosition: null,
          homeTeamId: home.teamId, awayTeamId: away.teamId, status: 'scheduled',
        });
      } else {
        const real = home ?? away;
        if (real) {
          matchNo += 1;
          fixtures.push({
            round: `${labelPrefix} ${matchNo}`, poolNumber: null, bracketPosition: null,
            homeTeamId: real.teamId, awayTeamId: null, status: 'bye',
          });
        }
      }
    }
  };

  const rotate = (slots: (TeamRef | null)[]) => [slots[0], slots[n - 1], ...slots.slice(1, n - 1)];

  for (let r = 0; r < roundsN; r++) {
    emitRound(order, false);
    order = rotate(order);
  }
  if (params.doubleRound) {
    order = arr.slice();
    for (let r = 0; r < roundsN; r++) {
      emitRound(order, true);
      order = rotate(order);
    }
  }

  return fixtures;
}
