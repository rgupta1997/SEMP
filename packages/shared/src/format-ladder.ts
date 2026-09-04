import { z } from 'zod';
import {
  RALLY_FAMILY, familyForSport, type FormatFamily, type MatchFormat,
} from './match-format.js';
import { scoringFormatSchema, type ScoringFormat } from './scoring-rules.js';

// ============================================================================
// Which format does THIS fixture play under?
//
// Seven layers, most-specific wins. Pure, so it is testable without a database and
// usable identically on the API and in the console - the official and the organiser
// must never disagree about which rules are in force.
//
//   1  sport default          code (racquet-presets.ts)
//   2  platform preset        scoring_formats, organization_id null
//   3  organisation format    scoring_formats, organization_id = host org
//   4  discipline draw        tournament_disciplines.scoring_format_id
//   5  round / stage          tournament_disciplines.round_formats   <- QF/SF/Final
//   6  individual fixture     fixtures.scoring_format_id
//   7  in-match override      typed correction events in fixtures.live_log
//
// Layers 2 and 3 are the SHELF - where a chosen format lives - rather than steps in
// the walk. The walk itself is 6 -> 5 -> 4 -> 1, and layer 7 is not a format at all
// but an event appended to the log with an author and a reason.
// ============================================================================

/**
 * One per-round override. `round` matches fixtures.round verbatim ('Final', 'SF',
 * 'QF', 'R16', '3rd Place' - exactly what generators/util.ts stamps). Omit `round`
 * to cover a whole stage.
 */
export interface RoundFormatRule {
  stageSequence?: number;
  round?: string;
  /** A saved format row. */
  formatId?: string;
  /**
   * A BUILT-IN preset, by key.
   *
   * Rules originally required a saved format row, which forced the UI to make
   * somebody save a format before a round could point at it - a prerequisite that
   * made the whole feature read as broken. A preset needs no row: it lives in code,
   * so a rule can name it directly.
   */
  presetKey?: string;
}

export const roundFormatRuleSchema: z.ZodType<RoundFormatRule> = z.object({
  stageSequence: z.number().int().positive().optional(),
  round: z.string().min(1).optional(),
  formatId: z.string().min(1).optional(),
  presetKey: z.string().min(1).optional(),
})
  .refine((r) => r.stageSequence !== undefined || r.round !== undefined, {
    message: 'A round override needs a stageSequence, a round, or both',
  })
  .refine((r) => !!r.formatId || !!r.presetKey, {
    message: 'A round override needs a saved format or a preset to point at',
  });

export const roundFormatsSchema = z.array(roundFormatRuleSchema).max(32);

/** Everything the ladder needs about one fixture. Hand-written rather than derived
 *  from Prisma, mirroring records/derive.ts - it keeps this pure and testable. */
export interface LadderFixture {
  scoring_format_id?: string | null;
  round?: string | null;
  stage_sequence?: number | null;
  /**
   * The format snapshotted into live_state when scoring began. Wins over everything:
   * a played match must stay reproducible under the rules it was played under.
   *
   * Typed as the UNION because cricket freezes here too, and parsed on the way past
   * either way - so a config that no longer validates falls through to the next rung
   * rather than resolving to something malformed.
   */
  frozen_format?: MatchFormat | null;
}

export interface LadderDraw {
  scoring_format_id?: string | null;
  round_formats?: unknown;
  /** Sport name, for the built-in default at the bottom of the ladder. */
  sport?: string | null;
}

/** A row from scoring_formats, keyed by id. */
export interface LadderFormatRow {
  id: string;
  config: unknown;
  name?: string | null;
  organization_id?: string | null;
  archived_at?: Date | string | null;
}

export type LadderLayer =
  | 'frozen' | 'fixture' | 'round' | 'stage' | 'draw' | 'sportDefault' | 'none';

export interface ResolvedFormat {
  format: ScoringFormat | null;
  /** Which rung supplied it. Surfaced on the console so the commonest courtside
   *  dispute - "who changed the rules?" - has an answer on screen. */
  layer: LadderLayer;
  formatId: string | null;
  /** Human-readable provenance: "this round's override", "the draw default". */
  source: string;
}

const LAYER_LABEL: Record<LadderLayer, string> = {
  frozen: 'the rules this match was played under',
  fixture: 'an override on this match',
  round: "this round's override",
  stage: "this stage's override",
  draw: 'the draw default',
  sportDefault: 'the sport default',
  none: 'no format configured',
};

/** Parse a stored config, rejecting anything that no longer validates. */
export function parseStoredFormat(config: unknown): ScoringFormat | null {
  const r = scoringFormatSchema.safeParse(config);
  return r.success ? (r.data as ScoringFormat) : null;
}

export function parseRoundFormats(raw: unknown): RoundFormatRule[] {
  const r = roundFormatsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

/**
 * Pick the round override for a fixture. FIRST MATCH WINS on an ordered list, so a
 * specific ('Final') entry placed above a broad (stage-wide) one beats it - which is
 * how "everything in stage 2 short, except the Final" is expressed without a
 * priority field to get wrong.
 */
export function matchRoundRule(
  rules: RoundFormatRule[],
  fixture: Pick<LadderFixture, 'round' | 'stage_sequence'>,
): { rule: RoundFormatRule; layer: 'round' | 'stage' } | null {
  const round = fixture.round ?? null;
  const stage = fixture.stage_sequence ?? 1;
  for (const r of rules) {
    if (r.stageSequence !== undefined && r.stageSequence !== stage) continue;
    if (r.round !== undefined) {
      if (round !== r.round) continue;
      return { rule: r, layer: 'round' };
    }
    return { rule: r, layer: 'stage' };
  }
  return null;
}

/**
 * The walk, once, for any family of formats.
 *
 * Generic over the format type rather than duplicated per family: "this round plays
 * a different format" means the same thing in badminton and in cricket, and an
 * organiser must get identical behaviour from both. Two copies of these six rungs
 * would be two places for that to drift, and per-round overrides have already been
 * broken twice in ways nobody saw until a match was scored.
 */
export function walkLadder<F extends MatchFormat>(
  fixture: LadderFixture,
  draw: LadderDraw,
  formats: Map<string, LadderFormatRow> | LadderFormatRow[],
  family: FormatFamily<F>,
): { format: F | null; layer: LadderLayer; formatId: string | null; source: string } {
  const byId = formats instanceof Map ? formats : new Map(formats.map((f) => [f.id, f]));

  const found = (format: F, layer: LadderLayer, formatId: string | null) =>
    ({ format, layer, formatId, source: LAYER_LABEL[layer] });

  const pick = (id: string | null | undefined, layer: LadderLayer) => {
    if (!id) return null;
    const row = byId.get(id);
    if (!row) return null;
    const parsed = family.parse(row.config);
    return parsed ? found(parsed, layer, id) : null;
  };

  // 7 / frozen. A match that has been scored keeps its rules even if the format is
  // later edited - that is the whole basis of a reproducible result.
  if (fixture.frozen_format) {
    const parsed = family.parse(fixture.frozen_format);
    if (parsed) return found(parsed, 'frozen', null);
  }

  // 6 / this one match.
  const onFixture = pick(fixture.scoring_format_id, 'fixture');
  if (onFixture) return onFixture;

  // 5 / the round or the stage.
  const hit = matchRoundRule(parseRoundFormats(draw.round_formats), fixture);
  if (hit) {
    const fromRound = pick(hit.rule.formatId, hit.layer);
    if (fromRound) return fromRound;
    // A rule naming a built-in preset needs no saved row to resolve.
    if (hit.rule.presetKey) {
      const preset = family.preset(hit.rule.presetKey);
      if (preset) return found(preset, hit.layer, null);
    }
  }

  // 4 / the draw.
  const onDraw = pick(draw.scoring_format_id, 'draw');
  if (onDraw) return onDraw;

  // 1 / the built-in default. It must be a REAL, correct format - which is exactly
  // what the platform lacked before this kernel: an unconfigured sport fell through
  // to a generic "Period, best of 2, +1" counter.
  const def = family.sportDefault(draw.sport);
  if (def) return found(def, 'sportDefault', null);

  return { format: null, layer: 'none', formatId: null, source: LAYER_LABEL.none };
}

/**
 * Resolve a RALLY format. Unchanged in behaviour and signature: every existing
 * caller wants a ScoringFormat and would have to narrow a union for no reason.
 *
 * A cricket fixture resolves to null here, which is correct - there is no rally
 * format for it - and `resolveMatchFormat` is what a caller handling both uses.
 */
export function resolveFormat(
  fixture: LadderFixture,
  draw: LadderDraw,
  formats: Map<string, LadderFormatRow> | LadderFormatRow[] = [],
): ResolvedFormat {
  return walkLadder(fixture, draw, formats, RALLY_FAMILY);
}

export interface ResolvedMatchFormat {
  format: MatchFormat | null;
  layer: LadderLayer;
  formatId: string | null;
  source: string;
  /** Which engine scores this: the rally kernel, or cricket's own. */
  family: 'rally' | 'cricket';
}

/**
 * Resolve whichever format the sport actually uses.
 *
 * The family is chosen by SPORT, not by inspecting a stored config, because the
 * bottom rung is the sport default - and reaching it means every stored config was
 * absent, so there was nothing to inspect.
 */
export function resolveMatchFormat(
  fixture: LadderFixture,
  draw: LadderDraw,
  formats: Map<string, LadderFormatRow> | LadderFormatRow[] = [],
): ResolvedMatchFormat {
  const family = familyForSport(draw.sport);
  return { ...walkLadder(fixture, draw, formats, family), family: family.key };
}

/**
 * Every distinct format a draw could use, so a caller can load them in ONE query
 * rather than per fixture. Ordering is irrelevant; duplicates are dropped.
 */
export function formatIdsForDraw(draw: LadderDraw, fixtures: LadderFixture[]): string[] {
  const ids = new Set<string>();
  if (draw.scoring_format_id) ids.add(draw.scoring_format_id);
  for (const r of parseRoundFormats(draw.round_formats)) if (r.formatId) ids.add(r.formatId);
  for (const f of fixtures) if (f.scoring_format_id) ids.add(f.scoring_format_id);
  return [...ids];
}

/**
 * The rounds a knockout draw WILL have, from how many sides enter it.
 *
 * This exists because the per-round editor could not know the rounds before the
 * draw was generated - and that is exactly when an organiser wants to set them. It
 * fell back to a generic R32/R16/QF/SF/Final ladder, so somebody entering an
 * 8-team draw could set overrides on R32 and R16, save them, and watch nothing
 * happen: the rounds never materialised and the rules sat inert forever.
 *
 * The labels match generators/util.ts exactly - Final, SF, QF, then R{n} - because a
 * rule is matched against `fixtures.round` by string.
 */
export function predictKnockoutRounds(entrants: number): string[] {
  if (entrants < 2) return [];
  let size = 1;
  while (size < entrants) size *= 2;
  const rounds: string[] = [];
  for (let inRound = size; inRound >= 2; inRound /= 2) {
    rounds.push(inRound === 2 ? 'Final' : inRound === 4 ? 'SF' : inRound === 8 ? 'QF' : `R${inRound}`);
  }
  return rounds;
}

/** The format each round will play, so the editor can show the whole picture. */
export interface RoundResolution {
  round: string;
  /** How many matches this round has. 0 when the draw is not generated yet. */
  matches: number;
  format: ScoringFormat | null;
  layer: LadderLayer;
  /** True when this round carries its own rule rather than inheriting. */
  overridden: boolean;
}

/**
 * Resolve every round of a draw at once.
 *
 * The editor renders this rather than a bare form: showing what each round WILL
 * play - inherited or overridden - is what makes the feature legible. A form that
 * only shows the exceptions cannot tell you what the rest are doing.
 */
export function resolveRounds(
  rounds: Array<{ round: string; matches?: number; stageSequence?: number }>,
  draw: LadderDraw,
  formats: LadderFormatRow[] = [],
): RoundResolution[] {
  const rules = parseRoundFormats(draw.round_formats);
  return rounds.map((r) => {
    const resolved = resolveFormat(
      { round: r.round, stage_sequence: r.stageSequence ?? 1 }, draw, formats,
    );
    return {
      round: r.round,
      matches: r.matches ?? 0,
      format: resolved.format,
      layer: resolved.layer,
      overridden: !!matchRoundRule(rules, { round: r.round, stage_sequence: r.stageSequence ?? 1 }),
    };
  });
}
