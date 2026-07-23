// Seeded tie templates (selectable per draw in the discipline setup). These are
// *defaults* a client can pick, mirroring the Ice Breakers rulebook. They are data,
// not logic - a format we don't ship is configured, not coded. Each rubber is one
// contest; the tie is won by majority and dead rubbers are skipped. They live here
// so the web console/setup AND the API (demo seeder, matrix import) share one source.

import type { ContestSpec, FormatTemplate, RubberSpec, ScoringMode, TieSpec } from './scoring.js';

// A rubber scored as best-of-`segMax` sets (badminton/TT/squash: best of 3 sets). The
// rubbers themselves are the "games" of the match; these are the sets inside one.
const rallyGame = (segMax = 3): ContestSpec => ({ archetype: 'rally', segLabel: 'Set', segMax, pointButtons: [1] });
const setsOf = (segMax: number, segLabel: string): ContestSpec => ({ archetype: 'sets', segLabel, segMax, pointButtons: [1] });
const decide = (segLabel: string): ContestSpec => ({ archetype: 'time', segLabel, segMax: 1, pointButtons: [], manualHint: `Pick the winner of this ${segLabel.toLowerCase()}.` });

const tie = (scoringMode: ScoringMode, rubbers: RubberSpec[], opts?: Partial<TieSpec>): FormatTemplate => ({
  fixtureType: 'tie',
  scoringMode,
  tie: { winBy: 'majority', skipDeadRubbers: true, rubbers, ...opts },
});

// The 5-rubber MS/WS/MD/WD/XD set shared by table tennis & badminton.
const fiveRubbers = (contest: ContestSpec): RubberSpec[] => [
  { key: 'ms', label: "Men's Singles", contest },
  { key: 'ws', label: "Women's Singles", contest },
  { key: 'md', label: "Men's Doubles", contest },
  { key: 'wd', label: "Women's Doubles", contest },
  { key: 'xd', label: 'Mixed Doubles', contest },
];

const fiveRubber = tie('detailed', fiveRubbers(rallyGame(3)));

const TIE_TEMPLATES: Record<string, FormatTemplate> = {
  'table tennis': fiveRubber,
  'table-tennis': fiveRubber,
  badminton: fiveRubber,
  squash: tie('detailed', [
    { key: 'ms1', label: "Men's Singles", contest: rallyGame(3) },
    { key: 'ws', label: "Women's Singles", contest: rallyGame(3) },
    { key: 'ms2', label: "Men's Singles", contest: rallyGame(3) },
  ]),
  carrom: tie('detailed', [
    { key: 'ms', label: 'Men Singles', contest: setsOf(4, 'Board') },
    { key: 'ws', label: 'Women Singles', contest: setsOf(4, 'Board') },
    { key: 'xd', label: 'Mixed Doubles', contest: setsOf(4, 'Board') },
  ]),
  tennis: tie('detailed', [
    { key: 'ms', label: "Men's Singles", contest: setsOf(9, 'Game') },
    { key: 'ws', label: "Women's Singles", contest: setsOf(7, 'Game') },
    { key: 'mwd', label: "Men/Women's Doubles", contest: setsOf(9, 'Game') },
  ]),
  'pool/snooker': tie('manual', [
    { key: 'ms1', label: 'Men Singles', contest: decide('Frame') },
    { key: 'ms2', label: 'Men Singles', contest: decide('Frame') },
    { key: 'ws', label: 'Women Singles', contest: decide('Frame') },
    { key: 'xd', label: 'Mixed Doubles', contest: decide('Frame') },
    { key: 'md', label: 'Men Doubles', contest: decide('Frame') },
  ]),
  chess: tie('manual', [
    { key: 'b1', label: 'Board 1', contest: decide('Board') },
    { key: 'b2', label: 'Board 2', contest: decide('Board') },
    { key: 'b3', label: 'Board 3', contest: decide('Board') },
    { key: 'b4', label: 'Board 4', contest: decide('Board') },
  ]),
};

// The seeded tie template for a sport, if one exists (drives the "Team tie" option in
// the discipline editor). Returns a deep copy so callers can persist it freely.
export function tieTemplateFor(name?: string | null): FormatTemplate | undefined {
  const t = name ? TIE_TEMPLATES[name.trim().toLowerCase()] : undefined;
  return t ? (JSON.parse(JSON.stringify(t)) as FormatTemplate) : undefined;
}
