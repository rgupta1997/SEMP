import {
  CRICKET_KNOB_GROUPS, CRICKET_KNOB_SPECS, applyCricketKnobs, cricketKnobsFor,
  describeCricketKnobs, isCricketEditable, readCricketKnobs,
  type CricketKnobSpec, type CricketKnobs,
} from './cricket-knobs.js';
import {
  KNOB_GROUPS, KNOB_SPECS, applyKnobs, describeKnobs, isEditable, knobsFor, readKnobs,
  type FormatKnobs, type KnobSpec,
} from './format-knobs.js';
import { isCricketFormat, type MatchFormat } from './match-format.js';

// ============================================================================
// One editing interface over both knob models.
//
// WHY A FACADE RATHER THAN A UNION IN THE UI. The rule editor is a generic renderer:
// it walks groups, asks which knobs apply, draws a checkbox / number / select from
// each spec, and shows a summary line. None of that cares whether the format is
// badminton or a Test. But it was written against `FormatKnobs`, so adding cricket
// by widening every annotation would spread a discriminated union through several
// hundred lines of JSX for no gain - and every `if (family === 'cricket')` in a
// component is a place the two editors can drift apart.
//
// Both knob models already have the SAME FIVE-FUNCTION SHAPE - read, apply, which
// apply, describe, is it editable - and structurally identical specs. So the shape
// becomes the interface, and the branch happens exactly once, here.
//
// The payoff is concrete: a knob added to either registry appears in the editor with
// no UI change at all, which is already true of the rally side and is now true of
// cricket too.
// ============================================================================

export type AnyKnobs = FormatKnobs | CricketKnobs;

/**
 * A spec the editor can render. The two spec types differ only in their `group`
 * union, so the facade widens that to a string and keeps everything else.
 */
export interface AnyKnobSpec {
  key: string;
  label: string;
  hint?: string;
  group: string;
  type: 'int' | 'bool' | 'enum';
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface KnobModel {
  family: 'rally' | 'cricket';
  groups: Array<{ key: string; label: string }>;
  /** Every spec, whether or not it currently applies. For a coverage check. */
  allSpecs: AnyKnobSpec[];
  /** Only the specs that apply to the knobs in hand. */
  specsFor(knobs: AnyKnobs): AnyKnobSpec[];
  read(format: MatchFormat): AnyKnobs;
  apply(format: MatchFormat, knobs: AnyKnobs, name?: string): MatchFormat;
  describe(knobs: AnyKnobs): string;
  /**
   * Whether this format can be edited through knobs at all.
   *
   * Tennis is refused on the rally side: a game sits inside a set with its own
   * scoring, and flattening that loses the structure. Every cricket format is
   * editable, because nothing in it nests that way.
   */
  editable(format: MatchFormat): boolean;
}

const widen = (s: KnobSpec | CricketKnobSpec): AnyKnobSpec => ({
  key: s.key as string,
  label: s.label,
  hint: s.hint,
  group: s.group as string,
  type: s.type,
  min: s.min,
  max: s.max,
  options: s.options,
});

const RALLY_MODEL: KnobModel = {
  family: 'rally',
  groups: KNOB_GROUPS.map((g) => ({ key: g.key as string, label: g.label })),
  allSpecs: KNOB_SPECS.map(widen),
  specsFor: (knobs) => knobsFor(knobs as FormatKnobs).map(widen),
  read: (format) => readKnobs(format as never),
  apply: (format, knobs, name) => applyKnobs(format as never, knobs as FormatKnobs, name),
  describe: (knobs) => describeKnobs(knobs as FormatKnobs),
  editable: (format) => isEditable(format as never),
};

const CRICKET_MODEL: KnobModel = {
  family: 'cricket',
  groups: CRICKET_KNOB_GROUPS.map((g) => ({ key: g.key as string, label: g.label })),
  allSpecs: CRICKET_KNOB_SPECS.map(widen),
  specsFor: (knobs) => cricketKnobsFor(knobs as CricketKnobs).map(widen),
  read: (format) => readCricketKnobs(format as never),
  apply: (format, knobs, name) => applyCricketKnobs(format as never, knobs as CricketKnobs, name),
  describe: (knobs) => describeCricketKnobs(knobs as CricketKnobs),
  editable: (format) => isCricketEditable(format as never),
};

/** The editing model for whichever family this format belongs to. */
export function knobModelFor(format: MatchFormat): KnobModel {
  return isCricketFormat(format) ? CRICKET_MODEL : RALLY_MODEL;
}

/**
 * Why a format cannot be edited, phrased for the person who tried.
 *
 * Returns null when it can be. Kept here rather than in the UI so the two families
 * cannot end up explaining themselves differently.
 */
export function whyNotEditable(format: MatchFormat): string | null {
  if (knobModelFor(format).editable(format)) return null;
  return 'This format has a game-inside-set structure (tennis), which the rule editor cannot describe. Pick a preset instead.';
}
