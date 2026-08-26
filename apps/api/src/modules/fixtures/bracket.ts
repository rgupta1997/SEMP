import type { Db } from '../../infra/prisma.js';

// Single-elimination bracket advancement - the one home for this arithmetic.
//
// Two histories meet here. The wave branch extracted advancement out of the routes so
// the scorecard lock could call it INSIDE its transaction (hence `Db`, not `Prisma`:
// a helper typed `Prisma` cannot accept a tx client, and passing the global one
// instead compiles, runs, and writes outside the transaction). Independently, the
// groups-and-knockouts work taught the same arithmetic about `stage_sequence`, so a
// two-stage tournament does not fold its group and knockout fixtures into one bracket.
//
// Both are required. The stage-aware implementation is the one kept; the strict
// variant the lock depends on is layered on top of it.

/**
 * Pure bracket arithmetic: given how many bracket-position siblings exist in the same
 * stage and which position was just decided, return the parent match's
 * bracket_position and the slot the winner fills - or null when there is no parent
 * (not a clean single-elim bracket, position not found, or it is the final).
 *
 * Pure on purpose. It is what lets a regression test prove the stage_sequence filter
 * never changed the arithmetic for existing single-stage brackets.
 */
export function computeParentPosition(siblingCount: number, position: number): { parentPos: number; slot: 'home' | 'away' } | null {
  const size = siblingCount + 1;
  if (size < 2 || (size & (size - 1)) !== 0) return null; // not a clean single-elim bracket
  const rounds = Math.log2(size);
  const offsets: number[] = [];
  let acc = 0;
  for (let r = 0; r < rounds; r++) { offsets.push(acc); acc += size / 2 ** (r + 1); }
  let round = -1;
  let j = -1;
  for (let ri = 0; ri < rounds; ri++) {
    const matchesInRound = size / 2 ** (ri + 1);
    if (position >= offsets[ri] && position < offsets[ri] + matchesInRound) { round = ri; j = position - offsets[ri]; break; }
  }
  if (round < 0 || round >= rounds - 1) return null; // not found, or it's the final - nowhere to advance
  const parentPos = offsets[round + 1] + Math.floor(j / 2);
  // Even child → parent's home slot, odd child → away (mirrors the generator's pairing).
  return { parentPos, slot: j % 2 === 0 ? 'home' : 'away' };
}

/**
 * Put `teamId` into the correct slot of the match that `position` feeds into.
 *
 * Scoped to one `stageSequence`: sibling counting is what derives the bracket size, so
 * counting two stages together would corrupt the round-offset arithmetic. Defaults to
 * 1 - every pre-existing single-stage tournament - so this is a no-op for them.
 *
 * No-op for non-bracket formats (group and round-robin have null positions),
 * non-power-of-two brackets, the final, or a parent that has already been played.
 */
export async function advanceInBracket(
  prisma: Db,
  drawId: string,
  position: number,
  teamId: string,
  stageSequence = 1,
): Promise<void> {
  const sibs = await prisma.fixtures.findMany({
    where: { tournament_discipline_id: drawId, bracket_position: { not: null }, stage_sequence: stageSequence },
    select: { id: true, bracket_position: true, status: true },
  });
  const result = computeParentPosition(sibs.length, position);
  if (!result) return;
  const parent = sibs.find((s) => s.bracket_position === result.parentPos);
  if (!parent || parent.status === 'completed') return; // don't overwrite a played match
  await prisma.fixtures.update({
    where: { id: parent.id },
    data: result.slot === 'home' ? { home_team_id: teamId } : { away_team_id: teamId },
  });
}

/**
 * Push a completed bracket result's winner into the next round. Throws on failure -
 * used by the lock, where partial propagation is worse than no lock at all.
 */
export async function advanceWinnerStrict(prisma: Db, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: {
      tournament_discipline_id: true, bracket_position: true,
      winner_team_id: true, status: true, stage_sequence: true,
    },
  });
  const advancing = fx?.status === 'completed' || fx?.status === 'walkover';
  if (!fx || !advancing || fx.winner_team_id == null || fx.bracket_position == null) return;
  await advanceInBracket(prisma, fx.tournament_discipline_id, fx.bracket_position, fx.winner_team_id, fx.stage_sequence ?? 1);
}

/**
 * The live-scoring variant: the result is already saved, so an advancement hiccup
 * must not fail the scorer's request.
 */
export async function advanceWinner(prisma: Db, fixtureId: string): Promise<void> {
  try {
    await advanceWinnerStrict(prisma, fixtureId);
  } catch (err) {
    console.error(`[bracket] winner advancement failed for fixture ${fixtureId}:`, err);
  }
}

/**
 * Round-0 byes: the lone present team auto-advances. Run right after generation so a
 * bye does not leave a permanent TBD in the next round.
 */
export async function propagateByes(prisma: Db, drawId: string): Promise<void> {
  try {
    const byes = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawId, status: 'bye', bracket_position: { not: null } },
      select: { bracket_position: true, home_team_id: true, away_team_id: true, stage_sequence: true },
    });
    for (const b of byes) {
      const team = b.home_team_id ?? b.away_team_id;
      if (team && b.bracket_position != null) {
        await advanceInBracket(prisma, drawId, b.bracket_position, team, b.stage_sequence ?? 1);
      }
    }
  } catch (err) {
    console.error(`[bracket] bye propagation failed for draw ${drawId}:`, err);
  }
}
