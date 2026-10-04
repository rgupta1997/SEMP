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

/**
 * A league or group round, as the fixture generators name them ("Round 3",
 * "Pool A - Match 2"). Knockout rounds ("Final", "SF", "QF", "R16", "3rd Place")
 * and anything unrecognised are not.
 */
export function isGroupRound(round?: string | null): boolean {
  return !!round && /^(round \d+|pool .+)$/i.test(round.trim());
}

/**
 * The tie as it applies to one fixture: dead rubbers are played out in league and
 * group rounds when the layout says so (rubbers won can decide a table), and skipped
 * in a knockout, where only the winner matters.
 */
export function tieForRound(spec: TieSpec, round?: string | null): TieSpec {
  if (spec.skipDeadInGroups === undefined || !isGroupRound(round)) return spec;
  return { ...spec, skipDeadRubbers: spec.skipDeadInGroups };
}

// ---- organiser layouts --------------------------------------------------------
//
// Events play their own team formats - a corporate 3-rubber tie, a Swaythling-style
// five singles - so the rubbers are the organiser's to choose. A layout is just a
// list of rubbers; how each rubber is SCORED still comes from the sport (racquet
// rubbers use the draw's scoring format).

/** One rubber as an organiser describes it. */
export interface TieRubberDraft {
  label: string;
  /** Players per side: 1 singles, 2 doubles. */
  size: number;
}

export interface TieLayout {
  key: string;
  name: string;
  rubbers: TieRubberDraft[];
}

const S = (label: string): TieRubberDraft => ({ label, size: 1 });
const D = (label: string): TieRubberDraft => ({ label, size: 2 });

const RACQUET_LAYOUTS: TieLayout[] = [
  { key: 'five', name: 'Five rubbers — MS, WS, MD, WD, XD',
    rubbers: [S("Men's Singles"), S("Women's Singles"), D("Men's Doubles"), D("Women's Doubles"), D('Mixed Doubles')] },
  { key: 'three_mixed', name: 'Three rubbers — MS, MD, XD',
    rubbers: [S("Men's Singles"), D("Men's Doubles"), D('Mixed Doubles')] },
  { key: 'singles_doubles_singles', name: 'Singles, Doubles, Singles',
    rubbers: [S('Singles 1'), D('Doubles'), S('Singles 2')] },
  { key: 'swaythling', name: 'Swaythling — five singles (A-X, B-Y, C-Z, A-Y, B-X)',
    rubbers: [S('Singles A v X'), S('Singles B v Y'), S('Singles C v Z'), S('Singles A v Y'), S('Singles B v X')] },
  { key: 'corbillon', name: 'Corbillon — four singles and a doubles',
    rubbers: [S('Singles A v X'), S('Singles B v Y'), D('Doubles'), S('Singles A v Y'), S('Singles B v X')] },
  { key: 'thomas_uber', name: 'Three singles, two doubles',
    rubbers: [S('Singles 1'), D('Doubles 1'), S('Singles 2'), D('Doubles 2'), S('Singles 3')] },
];

const RACQUET_TIE_SPORTS = new Set(['table tennis', 'table-tennis', 'badminton', 'tennis', 'squash', 'pickleball']);

/** The ready-made layouts offered for a sport, its own default first. */
export function tieLayoutsFor(sport?: string | null): TieLayout[] {
  const name = sport?.trim().toLowerCase() ?? '';
  const own = tieTemplateFor(name)?.tie;
  const sportDefault: TieLayout[] = own
    ? [{ key: 'default', name: `Standard (${own.rubbers.length} rubbers)`,
      rubbers: own.rubbers.map((r) => ({ label: r.label, size: r.size ?? (/doubles/i.test(r.label) ? 2 : 1) })) }]
    : [];
  if (!RACQUET_TIE_SPORTS.has(name)) return sportDefault;
  // The racquet library, minus any that just repeat the sport's own default.
  const same = (l: TieLayout) => own && l.rubbers.length === own.rubbers.length
    && l.rubbers.every((r, i) => r.label === own.rubbers[i].label);
  return [...sportDefault, ...RACQUET_LAYOUTS.filter((l) => !same(l))];
}

/**
 * Build a tie from an organiser's rubbers. Each rubber is scored the way the sport
 * scores a rubber; keys are stable by position ('r1', 'r2' ...) so a rename keeps a
 * rubber's history attached.
 */
export function buildTieSpec(
  sport: string | null | undefined,
  rubbers: TieRubberDraft[],
  opts: { target?: number | null; skipDeadRubbers?: boolean; skipDeadInGroups?: boolean } = {},
): TieSpec {
  const own = tieTemplateFor(sport)?.tie;
  const contest: ContestSpec = own?.rubbers[0]?.contest ?? rallyGame(3);
  const target = opts.target && opts.target > 0 ? Math.min(opts.target, rubbers.length) : undefined;
  return {
    winBy: target ? 'count' : 'majority',
    ...(target ? { target } : {}),
    skipDeadRubbers: opts.skipDeadRubbers ?? true,
    ...(opts.skipDeadInGroups !== undefined ? { skipDeadInGroups: opts.skipDeadInGroups } : {}),
    rubbers: rubbers.map((r, i) => ({
      key: `r${i + 1}`,
      label: r.label.trim() || `Rubber ${i + 1}`,
      size: Math.max(1, Math.min(2, r.size)),
      contest,
    })),
  };
}
