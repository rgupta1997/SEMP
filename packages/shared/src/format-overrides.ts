import { z } from 'zod';
import type { ScoringFormat } from './scoring-rules.js';

/**
 * PER-MATCH RULES, WITHOUT A FORMAT OF THEIR OWN.
 *
 * A fixture could already be pinned to a saved format, but that pins an ID - so
 * "make this one match 12-minute halves" meant creating and naming a whole format,
 * and every tweak left another row on the organiser's shelf. Pinning also severs
 * inheritance: re-point the draw's format afterwards and the tweaked match no longer
 * follows it.
 *
 * These hold ONLY what was changed. The ladder resolves a format exactly as it always
 * did, and this patches the result - so a match with a 12-minute half still inherits
 * everything else, and still moves when the draw moves.
 *
 * Every field is optional and absent means INHERIT. That distinction is the whole
 * design: `undefined` is "whatever the format says", `false` is a real answer.
 */
export interface FormatOverrides {
  /**
   * Minutes in ONE period, not the match total.
   *
   * The format stores a single whole-match number and divides it down, which is
   * arithmetic no organiser should be asked to do in their head - so this is
   * multiplied back out by the period count on the way in.
   */
  periodMinutes?: number;
  /** Minutes in EACH period of extra time. */
  extraTimeMinutes?: number;
  /** Whether a level match may be recorded as a draw. */
  drawsAllowed?: boolean;
}

export const formatOverridesSchema: z.ZodType<FormatOverrides> = z.object({
  periodMinutes: z.number().int().min(1).max(240).optional(),
  extraTimeMinutes: z.number().int().min(1).max(60).optional(),
  drawsAllowed: z.boolean().optional(),
});

/** Nothing set - so callers can avoid storing `{}` and meaning it. */
export function isEmptyOverrides(o: FormatOverrides | null | undefined): boolean {
  if (!o) return true;
  return o.periodMinutes === undefined
    && o.extraTimeMinutes === undefined
    && o.drawsAllowed === undefined;
}

/**
 * Read overrides off a stored value, dropping anything that does not parse.
 *
 * A column can hold whatever a previous version of the app put there, so this is
 * deliberately forgiving: an unparseable blob resolves to "no overrides" and the
 * match plays under its inherited format, rather than throwing an organiser out of
 * a scoring console.
 */
export function parseOverrides(raw: unknown): FormatOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = formatOverridesSchema.safeParse(raw);
  if (!parsed.success) return null;
  return isEmptyOverrides(parsed.data) ? null : parsed.data;
}

/** How many periods a format's match level declares. */
function periodCount(format: ScoringFormat): number {
  return Math.max(1, format.levels[format.levels.length - 1]?.target ?? 1);
}

/**
 * Patch a resolved format with a match's overrides.
 *
 * Returns the SAME object when there is nothing to apply, so callers can use it
 * unconditionally without churning React identities on every render.
 */
export function applyOverrides(
  format: ScoringFormat,
  overrides: FormatOverrides | null | undefined,
): ScoringFormat {
  if (!overrides || isEmptyOverrides(overrides)) return format;
  const next: ScoringFormat = { ...format };

  if (overrides.periodMinutes !== undefined) {
    // A format with no clock at all gets one, because asking for a 12-minute half
    // and getting an untimed match is not a defensible reading of the request.
    const periods = periodCount(format);
    const minutes = Math.max(1, overrides.periodMinutes) * periods;
    next.clock = format.clock
      ? { ...format.clock, minutes }
      : {
        scope: 'match',
        minutes,
        action: 'leaderWins',
        tieRule: 'organiserDecides',
        warningSeconds: 120,
        pauseOnStoppage: false,
      };
  }

  if (overrides.extraTimeMinutes !== undefined) {
    const periods = format.tieBreak?.extraTime?.periods ?? 2;
    next.tieBreak = {
      ...(format.tieBreak ?? {}),
      extraTime: { periods, minutes: Math.max(1, overrides.extraTimeMinutes) },
    };
  }

  if (overrides.drawsAllowed !== undefined) {
    next.endStates = { ...format.endStates, drawsAllowed: overrides.drawsAllowed };
  }

  return next;
}

/**
 * What the override fields should SHOW when they are left blank - the values the
 * match would play under if nobody touched them.
 *
 * The dialog prints these under each control. An override set without knowing the
 * inherited answer is a guess, and the commonest way one gets set to the value it
 * already had.
 */
export function inheritedOverrides(format: ScoringFormat | null): Required<FormatOverrides> | null {
  if (!format) return null;
  return {
    periodMinutes: Math.max(1, Math.round((format.clock?.minutes ?? 0) / periodCount(format))),
    extraTimeMinutes: format.tieBreak?.extraTime?.minutes ?? 0,
    drawsAllowed: format.endStates.drawsAllowed,
  };
}
