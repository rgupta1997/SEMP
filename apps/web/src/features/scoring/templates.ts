// Resolves the FormatTemplate that drives the scoring console for a fixture.
//
// Order of precedence:
//   1. The draw's explicit config  (tournament_disciplines.format_config.scoring)
//   2. A built-in default derived from the sport's archetype (today's behaviour)
//
// So the hardcoded per-sport `DEFS` in engine.ts is now just the *default library*;
// any client can override per draw without code changes. Single-contest sports keep
// behaving exactly as before when no override is set.

import type { ContestSpec, EventSpec, FormatTemplate, RubberSpec, ScoringMode, TieSpec } from '@semp/shared';
import { sportDef, type SportDef } from './engine';

// Measured / judged sports (athletics, swimming, lifts, chess result) have no
// per-event ticks, so they default to manual entry. Everything else defaults to the
// live, event-by-event console. The organiser can still flip the mode per draw.
function defaultMode(def: SportDef): ScoringMode {
  return def.archetype === 'time' ? 'manual' : 'detailed';
}

function isFormatTemplate(v: any): v is FormatTemplate {
  return !!v && (v.fixtureType === 'single' || v.fixtureType === 'tie' || v.fixtureType === 'event');
}

export function resolveTemplate(fixture: any): FormatTemplate {
  const stored = fixture?.tournament_disciplines?.format_config?.scoring;
  if (isFormatTemplate(stored)) {
    // Persisted templates are validated server-side; trust the shape but backfill a
    // default contest for a single template that predates richer config.
    if (stored.fixtureType === 'single' && !stored.single) {
      stored.single = sportDef(sportName(fixture));
    }
    return stored;
  }
  const def = sportDef(sportName(fixture));
  return { fixtureType: 'single', scoringMode: defaultMode(def), single: def };
}

function sportName(fixture: any): string | null | undefined {
  return fixture?.tournament_disciplines?.tournament_sports?.sports?.name;
}

// ---- Seeded tie templates (selectable per draw in the discipline setup) -----
// These are *defaults* a client can pick, mirroring the Ice Breakers rulebook. They
// are data, not logic - a format we don't ship is configured, not coded. Each rubber
// is one contest; the tie is won by majority and dead rubbers are skipped.

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

// ---- Seeded multi-competitor event templates (swimming, powerlifting) -------

const event = (result: EventSpec['result'], subEvents: EventSpec['subEvents'], opts?: Pick<EventSpec, 'pickOne' | 'subEventNoun'>): FormatTemplate => ({
  fixtureType: 'event', scoringMode: 'manual', event: { subEvents, result, ...opts },
});

const EVENT_TEMPLATES: Record<string, FormatTemplate> = {
  // Swimmers can each swim several races; enter a time per race. Each race is ranked
  // (fastest wins) and the top finishers earn 5/3/1 for their org.
  swimming: event(
    { resultType: 'time', winnerIs: 'min', unit: 's', aggregate: 'medals', medalPoints: [5, 3, 1] },
    [
      { key: 'm25f', label: "Men's 25m Freestyle" }, { key: 'm50f', label: "Men's 50m Freestyle" },
      { key: 'm25bk', label: "Men's 25m Backstroke" }, { key: 'm25fly', label: "Men's 25m Butterfly" }, { key: 'm25br', label: "Men's 25m Breaststroke" },
      { key: 'w50f', label: "Women's 50m Freestyle" }, { key: 'w25f', label: "Women's 25m Freestyle" },
      { key: 'w25bk', label: "Women's 25m Backstroke" }, { key: 'w25fly', label: "Women's 25m Butterfly" }, { key: 'w25br', label: "Women's 25m Breaststroke" },
      { key: 'relay', label: 'Mixed 4x25m Freestyle Relay' },
    ],
    { subEventNoun: 'Race' },
  ),
  // Each lifter is in ONE weight class; enter their best total. Lifters are ranked
  // within their class (heaviest wins) and the top finishers earn 5/3/1 for their org.
  powerlifting: event(
    { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'medals', medalPoints: [5, 3, 1] },
    [
      { key: 'm63', label: 'Men ≤63kg' }, { key: 'm74', label: 'Men ≤74kg' }, { key: 'm85', label: 'Men ≤85kg' }, { key: 'm96', label: 'Men ≤96kg' },
      { key: 'w62', label: 'Women ≤62kg' }, { key: 'w62p', label: 'Women 62kg+' },
    ],
    { pickOne: true, subEventNoun: 'Weight category' },
  ),
};

// The seeded event template for a sport, if any (drives the "Multi-competitor event"
// option in the discipline editor). Deep-copied so callers can persist it freely.
export function eventTemplateFor(name?: string | null): FormatTemplate | undefined {
  const t = name ? EVENT_TEMPLATES[name.trim().toLowerCase()] : undefined;
  return t ? (JSON.parse(JSON.stringify(t)) as FormatTemplate) : undefined;
}
