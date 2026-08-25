import { BusinessRuleError } from '../../../../shared/errors.js';
import { roundLabel } from './util.js';

export interface ManualKnockoutParams {
  thirdPlaceMatch?: boolean;
}

// Structurally like GeneratedFixture (round / poolNumber / bracketPosition / status /
// feedsInto), but the two sides are generic entrant TOKENS, not typed team ids. This
// file only knows bracket SHAPE - it never interprets what a token means. The caller
// (stage-orchestrator.ts) decides: for stage 1 a token is a real team id, mapped onto
// home_team_id/away_team_id; for stage 2+ it's a slot-label placeholder, mapped onto
// home_slot_label/away_slot_label instead.
export interface ManualKnockoutFixture {
  round: string;
  poolNumber: null;
  bracketPosition: number | null;
  entrantHome: string | null;
  entrantAway: string | null;
  status: 'scheduled' | 'bye';
  winnerToken?: string | null; // set for byes - mirrors GeneratedFixture.winnerTeamId
  feedsInto?: number;
}

// Same bracket shape as generateKnockout (global bracketPosition, feedsInto wiring,
// bye auto-advance), but round 0 is GIVEN as explicit organiser pairs instead of
// DERIVED via seedOrder. Requires a power-of-two pair count - unlike generateKnockout,
// there's no seed order to fall back on for padding an uneven count, so a bye must be
// expressed explicitly by leaving one side of a pair null.
export function generateManualKnockout(
  pairs: Array<{ home: string | null; away: string | null }>,
  params: ManualKnockoutParams = {},
): ManualKnockoutFixture[] {
  const m = pairs.length;
  if (m < 1) throw new BusinessRuleError('Manual knockout needs at least 1 pair');
  if ((m & (m - 1)) !== 0) {
    throw new BusinessRuleError(
      'Manual knockout pairing needs a power-of-two number of pairs (1, 2, 4, 8, …) - express a bye by leaving one side of a pair empty',
    );
  }
  for (const p of pairs) {
    if (p.home === null && p.away === null) throw new BusinessRuleError('Each manual pair must have at least one side filled in');
  }

  const size = m * 2;
  const roundsCount = Math.log2(size);
  const offsets: number[] = [];
  let acc = 0;
  for (let r = 0; r < roundsCount; r++) { offsets.push(acc); acc += size / 2 ** (r + 1); }

  const fixtures: ManualKnockoutFixture[] = [];
  const byPosition = new Map<number, ManualKnockoutFixture>();

  for (let r = 0; r < roundsCount; r++) {
    const matchesInRound = size / 2 ** (r + 1);
    const teamsInRound = matchesInRound * 2;
    for (let j = 0; j < matchesInRound; j++) {
      const position = offsets[r] + j;
      const feedsInto = r < roundsCount - 1 ? offsets[r + 1] + Math.floor(j / 2) : undefined;

      let home: string | null = null;
      let away: string | null = null;
      if (r === 0) { home = pairs[j].home; away = pairs[j].away; }
      const isBye = r === 0 && (home === null || away === null);

      const fixture: ManualKnockoutFixture = {
        round: roundLabel(teamsInRound),
        poolNumber: null,
        bracketPosition: position,
        entrantHome: home,
        entrantAway: away,
        status: isBye ? 'bye' : 'scheduled',
        feedsInto,
      };
      fixtures.push(fixture);
      byPosition.set(position, fixture);
    }
  }

  // Bye auto-advance - identical shape to generateKnockout's, operating on tokens.
  for (let j = 0; j < size / 2; j++) {
    const child = byPosition.get(offsets[0] + j);
    if (!child || child.status !== 'bye' || child.feedsInto == null) continue;
    const advancing = child.entrantHome ?? child.entrantAway;
    if (!advancing) continue;
    child.winnerToken = advancing;
    const parent = byPosition.get(child.feedsInto);
    if (!parent) continue;
    if (j % 2 === 0) parent.entrantHome = advancing;
    else parent.entrantAway = advancing;
  }

  if (params.thirdPlaceMatch) {
    fixtures.push({
      round: '3rd Place', poolNumber: null, bracketPosition: null,
      entrantHome: null, entrantAway: null, status: 'scheduled',
    });
  }

  return fixtures;
}
