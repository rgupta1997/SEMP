import type { EntityTally } from './schemes.js';

// Event sports (swimming, powerlifting) earn event points race by race. When the rule
// converts them, each group's totals (e.g. Swimming Men) are ranked and the sport placing
// points awarded instead, as rulebooks like IIMK's do.

export interface EventTotal {
  entity_id: string;
  points: number;
  gold: number;
  silver: number;
}

/**
 * Ranks totals by points, then more golds, then more silvers. Contingents still level
 * share the better place. Anyone without place points gets participation.
 */
export function convertEventTotals(totals: EventTotal[], places: number[], participation: number): EntityTally[] {
  const sorted = [...totals].sort((a, b) => b.points - a.points || b.gold - a.gold || b.silver - a.silver);
  const out: EntityTally[] = [];
  for (let i = 0; i < sorted.length;) {
    const head = sorted[i];
    let j = i + 1;
    while (j < sorted.length && sorted[j].points === head.points && sorted[j].gold === head.gold && sorted[j].silver === head.silver) j++;
    const value = places[i] ?? 0;
    for (const t of sorted.slice(i, j)) {
      const detail: Record<string, number> = {};
      let points = value;
      if (value > 0) detail[`event_place_${i + 1}`] = 1;
      else if (participation > 0) { points = participation; detail.participation = 1; }
      out.push({ entity_id: t.entity_id, played: 0, won: 0, drawn: 0, lost: 0, points, gf: 0, ga: 0, wo: 0, detail });
    }
    i = j;
  }
  return out;
}
