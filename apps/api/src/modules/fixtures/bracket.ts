import type { Db } from '../../infra/prisma.js';

// Single-elimination bracket advancement.
//
// Extracted from the routes so the scorecard lock can call it INSIDE its transaction
// (hence `Db`, not `Prisma` - see the note on that type). The live-scoring path still
// calls the best-effort wrappers below; the lock calls `advanceWinnerStrict`, where a
// failure must roll the whole lock back rather than be logged and shrugged off.

// Put `teamId` into the correct slot of the match that the match at `position` feeds
// into. Bracket positions are contiguous round-by-round, so the parent is derived
// from the bracket size (sibling count = size - 1). No-op for non-bracket formats
// (group/round-robin have null positions), non-power-of-two brackets, the final, or
// a parent that has already been played.
export async function advanceInBracket(prisma: Db, drawId: string, position: number, teamId: string): Promise<void> {
  const sibs = await prisma.fixtures.findMany({
    where: { tournament_discipline_id: drawId, bracket_position: { not: null } },
    select: { id: true, bracket_position: true, status: true },
  });
  const size = sibs.length + 1;
  if (size < 2 || (size & (size - 1)) !== 0) return; // not a clean single-elim bracket
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
  if (round < 0 || round >= rounds - 1) return; // not found, or it's the final - nowhere to advance
  const parentPos = offsets[round + 1] + Math.floor(j / 2);
  const parent = sibs.find((s) => s.bracket_position === parentPos);
  if (!parent || parent.status === 'completed') return; // don't overwrite a played match
  // Even child → parent's home slot, odd child → away (mirrors the generator's pairing).
  await prisma.fixtures.update({ where: { id: parent.id }, data: j % 2 === 0 ? { home_team_id: teamId } : { away_team_id: teamId } });
}

// Push a completed bracket result's winner into the next round. Throws on failure -
// used by the lock, where partial propagation is worse than no lock at all.
export async function advanceWinnerStrict(prisma: Db, fixtureId: string): Promise<void> {
  const fx = await prisma.fixtures.findUnique({
    where: { id: fixtureId },
    select: { tournament_discipline_id: true, bracket_position: true, winner_team_id: true, status: true },
  });
  const advancing = fx?.status === 'completed' || fx?.status === 'walkover';
  if (!fx || !advancing || fx.winner_team_id == null || fx.bracket_position == null) return;
  await advanceInBracket(prisma, fx.tournament_discipline_id, fx.bracket_position, fx.winner_team_id);
}

// The live-scoring variant: the result is already saved, so an advancement hiccup
// must not fail the scorer's request.
export async function advanceWinner(prisma: Db, fixtureId: string): Promise<void> {
  try {
    await advanceWinnerStrict(prisma, fixtureId);
  } catch (err) {
    console.error(`[bracket] winner advancement failed for fixture ${fixtureId}:`, err);
  }
}

// Round-0 byes: the lone present team auto-advances to the next round. Run right
// after generation so byes don't leave a permanent TBD in the next round.
export async function propagateByes(prisma: Db, drawId: string): Promise<void> {
  try {
    const byes = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: drawId, status: 'bye', bracket_position: { not: null } },
      select: { bracket_position: true, home_team_id: true, away_team_id: true },
    });
    for (const b of byes) {
      const team = b.home_team_id ?? b.away_team_id;
      if (team && b.bracket_position != null) await advanceInBracket(prisma, drawId, b.bracket_position, team);
    }
  } catch (err) {
    console.error(`[bracket] bye propagation failed for draw ${drawId}:`, err);
  }
}
