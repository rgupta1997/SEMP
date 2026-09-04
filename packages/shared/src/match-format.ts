import { z } from 'zod';
import {
  cricketFormatSchema, cricketPresetByKey, cricketPresetsFor, defaultCricketFormat,
  isCricketSport, parseCricketFormat, type CricketFormat,
} from './cricket-rules.js';
import { defaultFormatFor, isKernelSport, presetByKey, presetsFor } from './racquet-presets.js';
import { scoringFormatSchema, type ScoringFormat } from './scoring-rules.js';

// ============================================================================
// One format type for the whole platform.
//
// THE PROBLEM. `ScoringFormat` describes a match built from nested levels of
// units - points into games into sets - with serve rules attached. Cricket has none
// of that: no levels, no serve rotation, and a scoring unit (the delivery) whose
// outcome credits three people at once. Its config is a genuinely different shape,
// so it gets a genuinely different type.
//
// But the RESOLUTION LADDER is not about shape. "This round plays a different
// format" is the same statement whether the sport is badminton or cricket, and an
// organiser setting "QF short, Final full" must get identical behaviour either way.
// Two parallel ladders would be two places for that to drift - and the round-override
// feature has already been broken twice in ways that were invisible until somebody
// tried to score a match.
//
// THE ANSWER. A discriminated union at the boundary, and ONE generic walk beneath
// it. The union is discriminated by `kind`, which only CricketFormat carries: a
// rally format has no `kind` at all, so the absence is the discriminant. That is
// deliberately not symmetrical - adding `kind: 'rally'` to ScoringFormat would
// invalidate every format row already stored, and there is no gain to justify a
// migration over 90 presets and every saved organisation format.
// ============================================================================

export type MatchFormat = ScoringFormat | CricketFormat;

/** True for a cricket config. The narrowing every consumer branches on. */
export function isCricketFormat(f: MatchFormat | null | undefined): f is CricketFormat {
  return !!f && (f as CricketFormat).kind === 'cricket';
}

/** True for a rally-kernel config: levels, units and serve. */
export function isRallyFormat(f: MatchFormat | null | undefined): f is ScoringFormat {
  return !!f && !isCricketFormat(f) && Array.isArray((f as ScoringFormat).levels);
}

/**
 * How to read a format of one family: parse a stored config, look up a preset, and
 * name the sport default.
 *
 * Passed to the ladder rather than branched inside it, so the walk - frozen beats
 * fixture beats round beats draw beats default - exists exactly once no matter how
 * many families are added later.
 */
export interface FormatFamily<F extends MatchFormat> {
  key: 'rally' | 'cricket';
  parse(config: unknown): F | null;
  preset(key: string): F | null;
  sportDefault(sport?: string | null): F | null;
}

export const RALLY_FAMILY: FormatFamily<ScoringFormat> = {
  key: 'rally',
  parse: (config) => {
    const r = scoringFormatSchema.safeParse(config);
    return r.success ? (r.data as ScoringFormat) : null;
  },
  preset: (key) => presetByKey(key) ?? null,
  sportDefault: (sport) => defaultFormatFor(sport) ?? null,
};

export const CRICKET_FAMILY: FormatFamily<CricketFormat> = {
  key: 'cricket',
  parse: (config) => parseCricketFormat(config),
  preset: (key) => cricketPresetByKey(key) ?? null,
  sportDefault: (sport) => defaultCricketFormat(sport ?? 'cricket') ?? null,
};

/**
 * Which family a sport belongs to.
 *
 * Keyed on the SPORT, not on the stored config, because the ladder has to know
 * which family to read before it has anything to read - the sport default is the
 * bottom rung, and reaching it means every stored config was absent.
 */
export function familyForSport(sport?: string | null): FormatFamily<MatchFormat> {
  return (isCricketSport(sport) ? CRICKET_FAMILY : RALLY_FAMILY) as FormatFamily<MatchFormat>;
}

/** The sport a format is for, whichever family it belongs to. */
export function formatSport(f: MatchFormat): string {
  return f.sport;
}

/** The preset key a format came from, if any. Same field, both families. */
export function formatPresetKey(f: MatchFormat): string | undefined {
  return f.presetKey;
}

/** The display name. Same field in both, but read through one accessor so a caller
 *  handling a union never has to narrow just to draw a label. */
export function formatName(f: MatchFormat): string {
  return f.name;
}

/** Officiated or self-scored. Both families carry it; both consoles need it. */
export function formatOfficiating(f: MatchFormat): 'officiated' | 'selfScored' {
  return f.officiatingMode;
}

// ============================================================================
// The shelf, across both families
// ============================================================================

/**
 * Is this sport scored by the platform at all?
 *
 * Distinct from `isKernelSport`, which asks the narrower question "does the rally
 * kernel score it". That distinction matters at every call site that decides whether
 * to offer a Score button or a format picker: cricket is scored, just not by the
 * kernel, and asking the narrower question there hides the feature for cricket.
 */
export function isScoredSport(name?: string | null): boolean {
  return isKernelSport(name) || isCricketSport(name);
}

/** The presets on the shelf for one sport, whichever family it belongs to. */
export function matchPresetsFor(sport?: string | null): MatchFormat[] {
  return isCricketSport(sport) ? cricketPresetsFor(sport) : presetsFor(sport);
}

/** A preset by key, searched across both families. Keys are globally unique. */
export function matchPresetByKey(key: string): MatchFormat | undefined {
  return presetByKey(key) ?? cricketPresetByKey(key);
}

/** The format a draw gets when nobody has chosen one, in either family. */
export function defaultMatchFormat(sport?: string | null): MatchFormat | undefined {
  return matchPresetsFor(sport)[0];
}

/**
 * A rough "how long is this format" number, for ordering a shelf.
 *
 * Comparable ACROSS families only in the loosest sense, which is all the one caller
 * needs: "the Final plays the longest format on the shelf" picks from one sport's
 * shelf, so the two branches are never compared with each other. Exposed here rather
 * than reaching into `levels[0]` at the call site, which is precisely what crashed on
 * a cricket format before the union existed.
 */
export function formatLength(f: MatchFormat): number {
  if (isCricketFormat(f)) {
    // Unlimited overs is the longest thing there is; a Test outranks any ODI.
    const overs = f.oversPerInnings ?? Number.MAX_SAFE_INTEGER / 4;
    return overs * f.inningsPerSide;
  }
  const inner = f.levels[0];
  const top = f.levels[f.levels.length - 1];
  return top.target * inner.target;
}

/**
 * A stored config of EITHER family.
 *
 * The API's save endpoint needs this: it validated with `scoringFormatSchema` alone,
 * which would have rejected every cricket format an organiser tried to save - the
 * shelf would offer cricket presets and then refuse to keep a variation of one.
 *
 * A union rather than a loosened schema, so each family is still validated in full:
 * a cricket config with a bad wicket count is refused as firmly as it ever was.
 */
export const matchFormatSchema: z.ZodType<MatchFormat> =
  z.union([cricketFormatSchema, scoringFormatSchema]) as z.ZodType<MatchFormat>;
