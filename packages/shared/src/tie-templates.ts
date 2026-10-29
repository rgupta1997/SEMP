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
// A pool rubber: best of `n` frames, recorded frame by frame (pool.ts).
const framesOf = (n: number): ContestSpec => ({ archetype: 'sets', segLabel: 'Frame', segMax: n, pointButtons: [1] });
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
  // Without a standard of its own, "Sport standard" saved nothing and a pickleball
  // team fixture was scored as one match.
  pickleball: fiveRubber,
  squash: tie('detailed', [
    { key: 'ms1', label: "Men's Singles", contest: rallyGame(3) },
    { key: 'ws', label: "Women's Singles", contest: rallyGame(3) },
    { key: 'ms2', label: "Men's Singles", contest: rallyGame(3) },
  ]),
  // Each rubber is scored board by board under the draw's carrom format (CarromResult);
  // this contest is only the legacy fallback, so it is at least an odd best-of.
  carrom: tie('detailed', [
    { key: 'ms', label: 'Men Singles', contest: setsOf(3, 'Game') },
    { key: 'ws', label: 'Women Singles', contest: setsOf(3, 'Game') },
    { key: 'xd', label: 'Mixed Doubles', contest: setsOf(3, 'Game') },
  ]),
  tennis: tie('detailed', [
    { key: 'ms', label: "Men's Singles", contest: setsOf(9, 'Game') },
    { key: 'ws', label: "Women's Singles", contest: setsOf(7, 'Game') },
    { key: 'mwd', label: "Men/Women's Doubles", contest: setsOf(9, 'Game') },
  ]),
  // Each rubber best of 5 frames, scored frame by frame so a tie's frames can rank it.
  'pool/snooker': tie('detailed', [
    { key: 'ms1', label: 'Men Singles', contest: framesOf(5) },
    { key: 'ms2', label: 'Men Singles', contest: framesOf(5) },
    { key: 'ws', label: 'Women Singles', contest: framesOf(5) },
    { key: 'xd', label: 'Mixed Doubles', contest: framesOf(5) },
    { key: 'md', label: 'Men Doubles', contest: framesOf(5) },
  ]),
  // Olympiad style: a board may be drawn (½ each), the match is won on board points
  // (2½-1½), and every board is played - board points also order the standings.
  chess: tie('manual', [
    { key: 'b1', label: 'Board 1', contest: decide('Board') },
    { key: 'b2', label: 'Board 2', contest: decide('Board') },
    { key: 'b3', label: 'Board 3', contest: decide('Board') },
    { key: 'b4', label: 'Board 4', contest: decide('Board') },
  ], { boardPoints: true, skipDeadRubbers: false }),
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

/** A rubber scored frame by frame (pool), whose segMax is its best-of. */
export const isFrameContest = (c?: ContestSpec | null): c is ContestSpec => !!c && c.archetype === 'sets' && c.segLabel === 'Frame';

/** Whether a level league or group tie may be won on a tie-break: the layout's choice, else not for chess. */
export function groupTiebreakAllowed(spec: Pick<TieSpec, 'groupTiebreak' | 'boardPoints'>): boolean {
  return spec.groupTiebreak ?? !spec.boardPoints;
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
// The organiser chooses the rubbers; how each rubber is SCORED still comes from the
// sport (racquet rubbers use the draw's scoring format).

/** One rubber as an organiser describes it. */
export interface TieRubberDraft {
  label: string;
  /** Players per side: 1 singles, 2 doubles. */
  size: number;
  /** Pool: best of this many frames (3, 5, 7); omitted = the sport's own. */
  frames?: number;
}

export interface TieLayout {
  key: string;
  name: string;
  rubbers: TieRubberDraft[];
}

const S = (label: string, frames?: number): TieRubberDraft => ({ label, size: 1, ...(frames ? { frames } : {}) });
const D = (label: string, frames?: number): TieRubberDraft => ({ label, size: 2, ...(frames ? { frames } : {}) });

const RACQUET_LAYOUTS: TieLayout[] = [
  { key: 'five', name: 'Five rubbers - MS, WS, MD, WD, XD',
    rubbers: [S("Men's Singles"), S("Women's Singles"), D("Men's Doubles"), D("Women's Doubles"), D('Mixed Doubles')] },
  { key: 'three_mixed', name: 'Three rubbers - MS, MD, XD',
    rubbers: [S("Men's Singles"), D("Men's Doubles"), D('Mixed Doubles')] },
  { key: 'singles_doubles_singles', name: 'Singles, Doubles, Singles',
    rubbers: [S('Singles 1'), D('Doubles'), S('Singles 2')] },
  { key: 'swaythling', name: 'Swaythling - five singles (A-X, B-Y, C-Z, A-Y, B-X)',
    rubbers: [S('Singles A v X'), S('Singles B v Y'), S('Singles C v Z'), S('Singles A v Y'), S('Singles B v X')] },
  { key: 'corbillon', name: 'Corbillon - four singles and a doubles',
    rubbers: [S('Singles A v X'), S('Singles B v Y'), D('Doubles'), S('Singles A v Y'), S('Singles B v X')] },
  { key: 'thomas_uber', name: 'Three singles, two doubles',
    rubbers: [S('Singles 1'), D('Doubles 1'), S('Singles 2'), D('Doubles 2'), S('Singles 3')] },
];

// Inter-IIM badminton and table tennis share one order: every rubber played in the group
// stage, dead ones skipped in knockouts (the split a picked layout comes with).
const IIM_FIVE_THREE: TieLayout[] = [
  { key: 'iim_men', name: 'Inter-IIM men - MS, MS, MD, MS, MD',
    rubbers: [S("Men's Singles 1"), S("Men's Singles 2"), D("Men's Doubles 1"), S("Men's Singles 3"), D("Men's Doubles 2")] },
  { key: 'iim_women', name: 'Inter-IIM women - WS, WD, WS',
    rubbers: [S("Women's Singles 1"), D("Women's Doubles"), S("Women's Singles 2")] },
];

// Layouts for one sport only, offered after the racquet library.
const SPORT_LAYOUTS: Record<string, TieLayout[]> = {
  badminton: IIM_FIVE_THREE,
  'table tennis': IIM_FIVE_THREE,
  'table-tennis': IIM_FIVE_THREE,
  // Inter-IIM 8-ball: men 3 singles and 2 doubles, each best of 5; women 2 singles and a
  // doubles, best of 3. Doubles first - the rulebook's order when teams don't agree one.
  'pool/snooker': [
    { key: 'iim_men', name: 'Inter-IIM men - 2 doubles, 3 singles, best of 5 frames',
      rubbers: [D("Men's Doubles 1", 5), D("Men's Doubles 2", 5), S("Men's Singles 1", 5), S("Men's Singles 2", 5), S("Men's Singles 3", 5)] },
    { key: 'iim_women', name: 'Inter-IIM women - doubles, 2 singles, best of 3 frames',
      rubbers: [D("Women's Doubles", 3), S("Women's Singles 1", 3), S("Women's Singles 2", 3)] },
  ],
  tennis: [
    { key: 'iim_men', name: 'Inter-IIM men - MS, MD, MS',
      rubbers: [S("Men's Singles 1"), D("Men's Doubles"), S("Men's Singles 2")] },
    { key: 'iim_women', name: 'Inter-IIM women - WS, WD, WS',
      rubbers: [S("Women's Singles 1"), D("Women's Doubles"), S("Women's Singles 2")] },
  ],
};

const RACQUET_TIE_SPORTS = new Set(['table tennis', 'table-tennis', 'badminton', 'tennis', 'squash', 'pickleball']);

/** The ready-made layouts offered for a sport, its own default first. */
export function tieLayoutsFor(sport?: string | null): TieLayout[] {
  const name = sport?.trim().toLowerCase() ?? '';
  const own = tieTemplateFor(name)?.tie;
  const sportDefault: TieLayout[] = own
    ? [{ key: 'default', name: `Standard (${own.rubbers.length} rubbers)`,
      rubbers: own.rubbers.map((r) => ({
        label: r.label, size: r.size ?? (/doubles/i.test(r.label) ? 2 : 1),
        ...(isFrameContest(r.contest) ? { frames: r.contest.segMax } : {}),
      })) }]
    : [];
  if (!RACQUET_TIE_SPORTS.has(name)) return [...sportDefault, ...(SPORT_LAYOUTS[name] ?? [])];
  // The racquet library, minus any that just repeat the sport's own default.
  const same = (l: TieLayout) => own && l.rubbers.length === own.rubbers.length
    && l.rubbers.every((r, i) => r.label === own.rubbers[i].label);
  return [...sportDefault, ...RACQUET_LAYOUTS.filter((l) => !same(l)), ...(SPORT_LAYOUTS[name] ?? [])];
}

/**
 * Build a tie from an organiser's rubbers. Each rubber is scored the way the sport
 * scores a rubber; keys are stable by position ('r1', 'r2' ...) so a rename keeps a
 * rubber's history attached.
 */
export function buildTieSpec(
  sport: string | null | undefined,
  rubbers: TieRubberDraft[],
  opts: { target?: number | null; skipDeadRubbers?: boolean; skipDeadInGroups?: boolean; groupTiebreak?: boolean } = {},
): TieSpec {
  const own = tieTemplateFor(sport)?.tie;
  const contest: ContestSpec = own?.rubbers[0]?.contest ?? rallyGame(3);
  // A rubber's own best-of frames (pool), else the sport's contest.
  const target = opts.target && opts.target > 0 ? Math.min(opts.target, rubbers.length) : undefined;
  return {
    winBy: target ? 'count' : 'majority',
    ...(target ? { target } : {}),
    skipDeadRubbers: opts.skipDeadRubbers ?? true,
    ...(opts.skipDeadInGroups !== undefined ? { skipDeadInGroups: opts.skipDeadInGroups } : {}),
    ...(opts.groupTiebreak !== undefined ? { groupTiebreak: opts.groupTiebreak } : {}),
    rubbers: rubbers.map((r, i) => ({
      key: `r${i + 1}`,
      label: r.label.trim() || `Rubber ${i + 1}`,
      size: Math.max(1, Math.min(2, r.size)),
      contest: r.frames ? framesOf(Math.max(1, Math.round(r.frames))) : contest,
    })),
  };
}
