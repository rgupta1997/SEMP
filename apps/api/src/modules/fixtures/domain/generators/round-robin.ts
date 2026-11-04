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
  // Every fixture needs its own label: a round can hold several matches at once. A pool
  // ("Pool A - Match") numbers them straight through; a league names the round and the
  // match within it ("Round 4 - Match 2", "Round 4 - Bye") - a bare running number read
  // as 15 rounds for a 5-team league that plays 5.
  const byRound = labelPrefix === 'Round';
  let matchNo = 0;
  let roundNo = 0;

  const emitRound = (slots: (TeamRef | null)[], swap: boolean) => {
    roundNo += 1;
    let inRound = 0;
    for (let i = 0; i < half; i++) {
      let home = slots[i];
      let away = slots[n - 1 - i];
      if (swap) [home, away] = [away, home];
      if (home && away) {
        matchNo += 1; inRound += 1;
        fixtures.push({
          round: byRound ? `${labelPrefix} ${roundNo} - Match ${inRound}` : `${labelPrefix} ${matchNo}`, poolNumber: null, bracketPosition: null,
          homeTeamId: home.teamId, awayTeamId: away.teamId, status: 'scheduled',
        });
      } else {
        const real = home ?? away;
        if (real) {
          matchNo += 1;
          fixtures.push({
            round: byRound ? `${labelPrefix} ${roundNo} - Bye` : `${labelPrefix} ${matchNo}`, poolNumber: null, bracketPosition: null,
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
