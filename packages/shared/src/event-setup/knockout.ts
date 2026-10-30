import type { SetupMatchRowSpec, SetupMatchSide } from './blueprint.js';

export interface KnockoutLayout {
  /** First-round pairs in bracket order; a null side is a bye. */
  pairs: Array<{ home: string | null; away: string | null }>;
  /** sheet match id -> global 0-based bracket position (the product's convention). */
  positionOf: Map<string, number>;
  rounds: number;
  /** Every squad key the bracket draws, in bracket order. */
  squads: string[];
}

export class KnockoutSheetError extends Error {
  constructor(message: string, readonly matchId?: string) { super(message); }
}

/**
 * Rebuild the bracket a schedule sheet describes. The final is the one match no
 * other match feeds; walking it left to right gives every round's matches in bracket
 * order. A squad that appears one round above the first is a bye - it becomes a
 * first-round pair with an empty side, exactly how the product's manual knockout
 * (generateManualKnockout) expresses one. Throws KnockoutSheetError on any sheet that
 * is not a clean single-elimination tree.
 */
export function knockoutFromRows(rows: SetupMatchRowSpec[]): KnockoutLayout {
  const byId = new Map(rows.map((r) => [r.matchId, r]));
  if (byId.size !== rows.length) {
    const seen = new Set<string>();
    const dup = rows.find((r) => (seen.has(r.matchId) ? true : (seen.add(r.matchId), false)));
    throw new KnockoutSheetError(`Match id ${dup?.matchId} is used twice`, dup?.matchId);
  }
  const fed = new Set(rows.flatMap((r) => [r.home, r.away]).flatMap((s) => ('winnerOf' in s ? [s.winnerOf] : [])));
  for (const r of rows) {
    for (const s of [r.home, r.away]) {
      if ('winnerOf' in s && !byId.has(s.winnerOf)) throw new KnockoutSheetError(`${r.matchId} takes the winner of ${s.winnerOf}, which is not a match on the sheet`, r.matchId);
    }
  }
  const roots = rows.filter((r) => !fed.has(r.matchId));
  if (roots.length !== 1) {
    throw new KnockoutSheetError(roots.length
      ? `Expected one final, but ${roots.map((r) => r.matchId).join(', ')} all feed nothing`
      : 'No final: every match feeds another (a loop)');
  }

  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (s: SetupMatchSide): number => {
    if (!('winnerOf' in s)) return 0;
    const id = s.winnerOf;
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (visiting.has(id)) throw new KnockoutSheetError(`${id} feeds itself through a loop`, id);
    visiting.add(id);
    const r = byId.get(id)!;
    const d = 1 + Math.max(depth(r.home), depth(r.away));
    visiting.delete(id);
    depthMemo.set(id, d);
    return d;
  };
  const rounds = depth({ winnerOf: roots[0].matchId });
  const size = 2 ** rounds;
  const offsets: number[] = [];
  for (let r = 0, acc = 0; r < rounds; r++) { offsets.push(acc); acc += size / 2 ** (r + 1); }

  const counters = new Array<number>(rounds).fill(0);
  const pairs: KnockoutLayout['pairs'] = [];
  const positionOf = new Map<string, number>();
  const squads: string[] = [];

  const visit = (matchId: string, r: number) => {
    const row = byId.get(matchId)!;
    if (r === 0) {
      for (const s of [row.home, row.away]) {
        if ('winnerOf' in s) throw new KnockoutSheetError(`${matchId} is a first-round match but takes the winner of ${s.winnerOf}`, matchId);
        squads.push(s.squadKey);
      }
      positionOf.set(matchId, offsets[0] + counters[0]++);
      pairs.push({ home: (row.home as { squadKey: string }).squadKey, away: (row.away as { squadKey: string }).squadKey });
      return;
    }
    positionOf.set(matchId, offsets[r] + counters[r]++);
    for (const s of [row.home, row.away]) {
      if ('winnerOf' in s) {
        // A feeder comes from the round right before. The one exception: a match
        // between two squads that BOTH had a first-round bye sits in round two but
        // looks like a first-round match (depth 1) - e.g. 5 squads, "D v E" in round two.
        const d = depth(s);
        if (d !== r && !(r === 2 && d === 1)) throw new KnockoutSheetError(`${matchId} takes the winner of ${s.winnerOf}, which is not in the round before it`, matchId);
        visit(s.winnerOf, r - 1);
      } else if (r === 1) {
        // A bye: the squad's first-round "match" is against nobody.
        squads.push(s.squadKey);
        counters[0]++;
        pairs.push({ home: s.squadKey, away: null });
      } else {
        throw new KnockoutSheetError(`${matchId}: a squad enters more than one round in - only one-round byes are supported`, matchId);
      }
    }
  };
  visit(roots[0].matchId, rounds - 1);

  const seen = new Set<string>();
  for (const s of squads) {
    if (seen.has(s)) throw new KnockoutSheetError(`A squad is drawn twice in the bracket (${s})`);
    seen.add(s);
  }
  return { pairs, positionOf, rounds, squads };
}
