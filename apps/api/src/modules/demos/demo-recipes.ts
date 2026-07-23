// The four championship archetypes every demo sandbox contains, each frozen at a
// different lifecycle stage so one sandbox demos the whole product story:
// enrollment (corporate), live scoring (school), finals drama (public) and a
// finished championship with podium + awards (college).

import type { DemoChampKind } from '@semp/shared';
import { tieTemplateFor, eventTemplateFor } from '@semp/shared';

export type StagePattern = 'completed' | 'half' | 'fresh' | 'finals';

export interface ChampRecipe {
  kind: DemoChampKind;
  nameSuffix: string;
  pattern: StagePattern;
  /** Final championship status, set after fixtures + standings are in. */
  status: 'ongoing' | 'completed';
  /** Start/end as day offsets from "now" so every sandbox looks current. */
  dateWindow: { start: number; end: number };
}

export const CHAMP_RECIPES: ChampRecipe[] = [
  { kind: 'college', nameSuffix: 'Inter-College Championship', pattern: 'completed', status: 'completed', dateWindow: { start: -30, end: -23 } },
  { kind: 'school', nameSuffix: 'Inter-School Championship', pattern: 'half', status: 'ongoing', dateWindow: { start: -3, end: 4 } },
  { kind: 'corporate', nameSuffix: 'Corporate Championship', pattern: 'fresh', status: 'ongoing', dateWindow: { start: 0, end: 7 } },
  { kind: 'public', nameSuffix: 'Open Championship', pattern: 'finals', status: 'ongoing', dateWindow: { start: -7, end: 2 } },
];

// How a sport is scored: rubber-based tie (badminton/TT/...), multi-competitor
// event (swimming/powerlifting), else one single match per fixture. Mirrors the
// template resolution the discipline setup uses.
export type DrawStructure = 'single' | 'tie' | 'event';

export function drawStructureFor(sport: string): DrawStructure {
  if (tieTemplateFor(sport)) return 'tie';
  if (eventTemplateFor(sport)) return 'event';
  return 'single';
}

// Realistic completed headline scores per sport; [winner, loser].
const SCORES: Record<string, [number, number]> = {
  basketball: [58, 49], football: [3, 1], futsal: [4, 2], hockey: [3, 2], frisbee: [13, 9],
  'kho-kho': [12, 9], kabaddi: [34, 28], cricket: [142, 131], 'box cricket': [88, 79],
  volleyball: [3, 1], throwball: [3, 1], netball: [21, 17], handball: [27, 24],
};

export function scorePair(sport: string): [number, number] {
  return SCORES[sport.trim().toLowerCase()] ?? [2, 1];
}
