import { z } from 'zod';

// ============================================================================
// Config-driven scoring templates.
//
// A FormatTemplate describes how ONE fixture is structured and scored. It is
// stored on `tournament_disciplines.format_config.scoring` (per draw) and read
// by the scoring console. Today's hardcoded per-sport archetypes become the
// *default* template (see web `templates.ts`) - this type is the editable
// override a client supplies for any format we don't ship out of the box.
//
//   fixtureType 'single' -> one contest between the two teams (football, etc.)
//   fixtureType 'tie'    -> several rubbers (TT/badminton MS/WS/MD/WD/XD, …),
//                           the tie won by taking the majority of rubbers.
//
//   scoringMode 'detailed' -> live, event-by-event console
//   scoringMode 'manual'   -> enter the final score only
// Both modes are available for every sport (mode is per-draw, override per
// fixture); they converge to the same derived headline at sign-off.
// ============================================================================

// Contest scoring model. Mirrors the web engine's archetypes 1:1 so a template's
// `single`/rubber `contest` plugs straight into the existing reducer.
export const CONTEST_ARCHETYPES = ['points', 'sets', 'rally', 'cricket', 'time'] as const;
export type ContestArchetype = (typeof CONTEST_ARCHETYPES)[number];

export const SCORING_MODES = ['detailed', 'manual'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

export const FIXTURE_TYPES = ['single', 'tie', 'event'] as const;
export type FixtureType = (typeof FIXTURE_TYPES)[number];

// Multi-competitor event (swimming heats, powerlifting categories): not two teams,
// but many participants whose marks aggregate into team points.
export const EVENT_RESULT_TYPES = ['time', 'distance', 'weight', 'points', 'placing'] as const;
export type EventResultType = (typeof EVENT_RESULT_TYPES)[number];

export const EVENT_AGGREGATES = ['medals', 'sumBest', 'placePoints'] as const;
export type EventAggregate = (typeof EVENT_AGGREGATES)[number];

export interface SubEventSpec { key: string; label: string }

export interface EventResultSpec {
  resultType: EventResultType;
  winnerIs: 'min' | 'max';   // time -> min (fastest); distance/weight/points -> max
  unit?: string;             // 's' | 'm' | 'kg' | 'pts'
  aggregate: EventAggregate; // medals = gold/silver/bronze pts; sumBest = team total; placePoints
  medalPoints?: number[];    // [gold, silver, bronze, …] for 'medals'/'placePoints'
}

export interface EventSpec {
  subEvents: SubEventSpec[]; // the races / lifts / categories
  result: EventResultSpec;
  // When true each competitor contests exactly ONE sub-event (e.g. a powerlifter is in
  // a single weight class) - the console shows a picker + one mark instead of a grid.
  // Default (false) is the multi-mark grid (a swimmer enters a time per race they swim).
  pickOne?: boolean;
  subEventNoun?: string;     // singular name for a sub-event ("Weight category" / "Race")
}

// A loggable, optionally-scoring event in detailed mode (raid/tackle/bonus/card/…).
// `points` (when set) credits the acting side; `perPlayer` requires picking a player
// so the event is attributed in the timeline (and, once persisted, in fixture_events).
export interface EventTypeSpec {
  key: string;        // 'raid' | 'tackle' | 'bonus' | 'card' | 'goal' …
  label: string;      // button text, e.g. "Raid +1"
  points?: number;    // credited to the acting side (omit/0 = non-scoring)
  perPlayer?: boolean;
}

// How one contest (a single match, or one rubber of a tie) is scored. Structurally
// identical to the web engine's `SportDef`, plus optional knobs for richer formats.
export interface ContestSpec {
  archetype: ContestArchetype;
  segLabel: string;       // Quarter / Half / Set / Game / Innings / Heat …
  segMax: number;
  pointButtons: number[]; // increments offered per scoring tap
  manualHint?: string;    // guidance shown in the manual-result form
  events?: EventTypeSpec[];   // detailed-mode event buttons beyond plain points
  attributePlayers?: boolean; // capture which player for each event (live_log)
}

// One rubber of a tie (e.g. Men's Doubles). `contest` is its own scoring model, so
// rubbers in the same tie may differ (Tennis: MS best-of-9, WS best-of-7).
export interface RubberSpec {
  key: string;            // stable id: 'ms' | 'ws' | 'md' | 'wd' | 'xd' | 'b1' …
  label: string;          // "Men's Singles"
  contest: ContestSpec;
  playerRule?: string;    // free-text constraint, shown to officials (informational)
}

export interface TieSpec {
  winBy: 'majority' | 'count'; // majority = first to ⌈rubbers/2⌉; count = first to `target`
  target?: number;             // explicit clinch count (overrides majority maths)
  skipDeadRubbers: boolean;    // once decided, remaining rubbers are not played
  rubbers: RubberSpec[];       // ordered
}

export interface FormatTemplate {
  fixtureType: FixtureType;
  scoringMode: ScoringMode;
  single?: ContestSpec;        // present when fixtureType === 'single'
  tie?: TieSpec;               // present when fixtureType === 'tie'
  event?: EventSpec;           // present when fixtureType === 'event'
}

// ---- zod (validates `format_config.scoring` on the API) --------------------

export const eventTypeSpecSchema: z.ZodType<EventTypeSpec> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  points: z.number().optional(),
  perPlayer: z.boolean().optional(),
});

export const contestSpecSchema: z.ZodType<ContestSpec> = z.object({
  archetype: z.enum(CONTEST_ARCHETYPES),
  segLabel: z.string().min(1),
  segMax: z.number().int().positive(),
  pointButtons: z.array(z.number()),
  manualHint: z.string().optional(),
  events: z.array(eventTypeSpecSchema).optional(),
  attributePlayers: z.boolean().optional(),
});

export const rubberSpecSchema: z.ZodType<RubberSpec> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  contest: contestSpecSchema,
  playerRule: z.string().optional(),
});

export const tieSpecSchema: z.ZodType<TieSpec> = z.object({
  winBy: z.enum(['majority', 'count']),
  target: z.number().int().positive().optional(),
  skipDeadRubbers: z.boolean(),
  rubbers: z.array(rubberSpecSchema).min(1),
});

export const eventResultSpecSchema: z.ZodType<EventResultSpec> = z.object({
  resultType: z.enum(EVENT_RESULT_TYPES),
  winnerIs: z.enum(['min', 'max']),
  unit: z.string().optional(),
  aggregate: z.enum(EVENT_AGGREGATES),
  medalPoints: z.array(z.number()).optional(),
});

export const eventSpecSchema: z.ZodType<EventSpec> = z.object({
  subEvents: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })).min(1),
  result: eventResultSpecSchema,
  pickOne: z.boolean().optional(),
  subEventNoun: z.string().optional(),
});

export const formatTemplateSchema = z
  .object({
    fixtureType: z.enum(FIXTURE_TYPES),
    scoringMode: z.enum(SCORING_MODES),
    single: contestSpecSchema.optional(),
    tie: tieSpecSchema.optional(),
    event: eventSpecSchema.optional(),
  })
  .refine((t) => (t.fixtureType === 'tie' ? !!t.tie : t.fixtureType === 'event' ? !!t.event : true), {
    message: 'A "tie" template needs a `tie` definition; an "event" template needs an `event` definition.',
  });
// Note: a "single" template may omit `single` (a mode-only override); the console
// backfills the contest spec from the sport's default.

// `format_config` validated when a `scoring` key is present, while still allowing
// any other organiser-set keys to pass through untouched.
export const disciplineFormatConfigSchema = z
  .object({ scoring: formatTemplateSchema.optional() })
  .passthrough();
