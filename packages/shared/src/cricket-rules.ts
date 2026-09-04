import { z } from 'zod';

// ============================================================================
// Cricket's own configuration model.
//
// WHY NOT THE RALLY KERNEL. The kernel's unit is "a point to a side", and every
// level of it counts units below. Cricket does not work that way:
//
//   * the scoring unit is a DELIVERY with a rich outcome - runs off the bat, an
//     extra, a wicket, or several at once
//   * the two sides do not score at the same time; they bat in turn
//   * one ball credits up to THREE people in three directions (the batter is
//     dismissed, the bowler takes the wicket, the fielder takes the catch)
//   * an over is six LEGAL balls, so a wide does not advance the count
//   * the innings ends on overs, or all out, or the target being passed
//
// Forcing that into `unitWinner(target, winBy, cap)` would be a lie. So cricket
// gets its own engine - and reuses every architectural decision that mattered:
// an append-only event log, state as a pure fold, undo as a truncate, the format
// as data, and the same resolution ladder.
// ============================================================================

/** Every way a batter can be out. Recorded, never inferred. */
export const DISMISSALS = [
  'bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket',
  'caught_and_bowled', 'obstructing', 'timed_out', 'retired',
] as const;
export type Dismissal = (typeof DISMISSALS)[number];

/** Which dismissals are credited to the BOWLER. A run-out is not a bowler's wicket. */
export const BOWLER_WICKETS: readonly Dismissal[] = [
  'bowled', 'caught', 'lbw', 'stumped', 'hit_wicket', 'caught_and_bowled',
];

/** Extras. Wides and no-balls are the bowler's fault; byes are not. */
export const EXTRAS = ['wide', 'noball', 'bye', 'legbye'] as const;
export type Extra = (typeof EXTRAS)[number];

/** An extra that does NOT consume a legal ball of the over. */
export const ILLEGAL_EXTRAS: readonly Extra[] = ['wide', 'noball'];

/** How an innings stopped. `target` means the chase succeeded. */
export const INNINGS_ENDS = ['overs', 'all_out', 'target', 'declared', 'rain', 'conceded'] as const;
export type InningsEnd = (typeof INNINGS_ENDS)[number];

export interface CricketFormat {
  /** Discriminator, so a stored format can be told from a rally one. */
  kind: 'cricket';
  sport: string;
  presetKey?: string;
  name: string;

  /** null = unlimited (a Test / timeless match). */
  oversPerInnings: number | null;
  /** 1 for limited-overs, 2 for a Test. */
  inningsPerSide: number;
  /** 6 normally. Box cricket often plays 5 or 4. */
  ballsPerOver: number;
  /** null = no limit. T20 is 4, ODI is 10. */
  maxOversPerBowler: number | null;
  playersPerSide: number;
  /**
   * Wickets that end the innings. Normally playersPerSide - 1, because the last
   * batter has no partner - unless `lastManStands`, where they bat on alone.
   */
  wicketsToEndInnings: number;

  // ---- the deliveries
  /** Runs awarded for a wide. 1 normally; some box formats give 2. */
  wideRuns: number;
  noBallRuns: number;
  /** A no-ball is followed by a free hit. */
  freeHitAfterNoBall: boolean;
  /** Box cricket: the last batter continues alone rather than the innings ending. */
  lastManStands: boolean;

  // ---- the match
  powerplayOvers: number | null;
  /** A tie is broken by a super over rather than standing. */
  superOverOnTie: boolean;
  drawsAllowed: boolean;
  /**
   * Rain rules are NOT modelled. Stated as a field so a format can say whether the
   * organiser intends to apply one by hand, rather than the product implying it
   * computes a par score. DLS is a licensed table and inferring it would be wrong.
   */
  rainRule: 'none' | 'organiser_decides';

  officiatingMode: 'officiated' | 'selfScored';
  /** ballByBall builds the scorecard from deliveries; summary takes the totals. */
  entryMode: 'ballByBall' | 'summary';
  rulesSheet?: Record<string, unknown>;
}

export const cricketFormatSchema: z.ZodType<CricketFormat> = z.object({
  kind: z.literal('cricket'),
  sport: z.string().min(1),
  presetKey: z.string().optional(),
  name: z.string().min(1),
  oversPerInnings: z.number().int().positive().max(500).nullable(),
  inningsPerSide: z.number().int().min(1).max(2),
  ballsPerOver: z.number().int().min(1).max(12),
  maxOversPerBowler: z.number().int().positive().nullable(),
  playersPerSide: z.number().int().min(2).max(15),
  wicketsToEndInnings: z.number().int().min(1).max(10),
  wideRuns: z.number().int().min(0).max(5),
  noBallRuns: z.number().int().min(0).max(5),
  freeHitAfterNoBall: z.boolean(),
  lastManStands: z.boolean(),
  powerplayOvers: z.number().int().positive().nullable(),
  superOverOnTie: z.boolean(),
  drawsAllowed: z.boolean(),
  rainRule: z.enum(['none', 'organiser_decides']),
  officiatingMode: z.enum(['officiated', 'selfScored']),
  entryMode: z.enum(['ballByBall', 'summary']),
  rulesSheet: z.record(z.unknown()).optional(),
}).refine((f) => f.wicketsToEndInnings <= f.playersPerSide - 1 || f.lastManStands, {
  message: 'Wickets to end the innings cannot exceed playersPerSide - 1 unless the last batter stands alone',
});

// ============================================================================
// The shelf
// ============================================================================

const base = (o: Partial<CricketFormat> & { sport: string; key: string; name: string }): CricketFormat => ({
  kind: 'cricket',
  sport: o.sport,
  presetKey: o.key,
  name: o.name,
  // `??` would fold an explicit null (unlimited overs, i.e. a Test) into 20, so the
  // absence of the key is what has to be tested here.
  oversPerInnings: o.oversPerInnings !== undefined ? o.oversPerInnings : 20,
  inningsPerSide: o.inningsPerSide ?? 1,
  ballsPerOver: o.ballsPerOver ?? 6,
  maxOversPerBowler: o.maxOversPerBowler ?? null,
  playersPerSide: o.playersPerSide ?? 11,
  wicketsToEndInnings: o.wicketsToEndInnings ?? ((o.playersPerSide ?? 11) - 1),
  wideRuns: o.wideRuns ?? 1,
  noBallRuns: o.noBallRuns ?? 1,
  freeHitAfterNoBall: o.freeHitAfterNoBall ?? false,
  lastManStands: o.lastManStands ?? false,
  powerplayOvers: o.powerplayOvers ?? null,
  superOverOnTie: o.superOverOnTie ?? false,
  drawsAllowed: o.drawsAllowed ?? false,
  rainRule: o.rainRule ?? 'none',
  officiatingMode: o.officiatingMode ?? 'officiated',
  entryMode: o.entryMode ?? 'ballByBall',
  ...(o.rulesSheet ? { rulesSheet: o.rulesSheet } : {}),
});

export const CRICKET_PRESETS: CricketFormat[] = [
  base({
    sport: 'cricket', key: 'cricket_t20', name: 'T20 — 20 overs',
    oversPerInnings: 20, maxOversPerBowler: 4, powerplayOvers: 6,
    freeHitAfterNoBall: true, superOverOnTie: true,
    rulesSheet: { fieldingRestrictions: 'not enforced by the console', dls: 'not computed' },
  }),
  base({
    sport: 'cricket', key: 'cricket_t10', name: 'T10 — 10 overs',
    oversPerInnings: 10, maxOversPerBowler: 2, powerplayOvers: 3,
    freeHitAfterNoBall: true, superOverOnTie: true,
  }),
  base({
    sport: 'cricket', key: 'cricket_odi', name: 'ODI — 50 overs',
    oversPerInnings: 50, maxOversPerBowler: 10, powerplayOvers: 10,
    freeHitAfterNoBall: true,
  }),
  base({
    sport: 'cricket', key: 'cricket_corp_15', name: 'Corporate — 15 overs',
    oversPerInnings: 15, maxOversPerBowler: 3,
    officiatingMode: 'selfScored', entryMode: 'summary',
  }),
  base({
    sport: 'cricket', key: 'cricket_corp_8', name: 'Corporate — 8 overs a side',
    oversPerInnings: 8, maxOversPerBowler: 2, playersPerSide: 8, wicketsToEndInnings: 7,
    officiatingMode: 'selfScored', entryMode: 'summary',
  }),
  base({
    sport: 'cricket', key: 'cricket_test', name: 'Test / multi-day — unlimited overs, two innings',
    oversPerInnings: null, inningsPerSide: 2, maxOversPerBowler: null,
    drawsAllowed: true, rainRule: 'organiser_decides',
    rulesSheet: { declarations: 'recorded as an innings end', followOn: 'not automated' },
  }),
  base({
    sport: 'cricket', key: 'cricket_super_over', name: 'Super over — 1 over a side',
    oversPerInnings: 1, maxOversPerBowler: 1, wicketsToEndInnings: 2,
  }),

  // Box cricket: the format Indian corporate events actually run, and it differs in
  // ways that matter - a smaller side, fewer balls an over, and the last batter
  // often carrying on alone because there is nobody left to bat with.
  base({
    sport: 'box cricket', key: 'box_6ov_8', name: 'Box cricket — 6 overs, 8 a side',
    oversPerInnings: 6, ballsPerOver: 6, maxOversPerBowler: 2,
    playersPerSide: 8, wicketsToEndInnings: 7,
    officiatingMode: 'selfScored', entryMode: 'summary',
    rulesSheet: { wallRuns: 'house rule - record as runs off the bat', oneHandOneBounce: 'house rule' },
  }),
  base({
    sport: 'box cricket', key: 'box_5ov_6_lms', name: 'Box cricket — 5 overs, 6 a side, last man stands',
    oversPerInnings: 5, ballsPerOver: 6, maxOversPerBowler: 1,
    playersPerSide: 6, wicketsToEndInnings: 6, lastManStands: true,
    officiatingMode: 'selfScored', entryMode: 'summary',
  }),
  base({
    sport: 'box cricket', key: 'box_4ov_4ball', name: 'Box cricket — 4 overs of 4 balls, 6 a side',
    oversPerInnings: 4, ballsPerOver: 4, maxOversPerBowler: 1,
    playersPerSide: 6, wicketsToEndInnings: 5, wideRuns: 2,
    officiatingMode: 'selfScored', entryMode: 'summary',
  }),
];

const CRICKET_ALIASES: Record<string, string> = {
  cricket: 'cricket',
  'box cricket': 'box cricket',
  'box-cricket': 'box cricket',
  boxcricket: 'box cricket',
};

export function canonicalCricketSport(name?: string | null): string | null {
  if (!name) return null;
  return CRICKET_ALIASES[name.trim().toLowerCase()] ?? null;
}

export function isCricketSport(name?: string | null): boolean {
  return canonicalCricketSport(name) !== null;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function cricketPresetsFor(sport?: string | null): CricketFormat[] {
  const key = canonicalCricketSport(sport);
  if (!key) return [];
  return CRICKET_PRESETS.filter((p) => p.sport === key).map(copy);
}

export function cricketPresetByKey(key: string): CricketFormat | undefined {
  const p = CRICKET_PRESETS.find((x) => x.presetKey === key);
  return p ? copy(p) : undefined;
}

export function defaultCricketFormat(sport?: string | null): CricketFormat | undefined {
  return cricketPresetsFor(sport)[0];
}

/** Parse a stored config, rejecting anything that is not a valid cricket format. */
export function parseCricketFormat(config: unknown): CricketFormat | null {
  const r = cricketFormatSchema.safeParse(config);
  if (r.success) return r.data as CricketFormat;
  // A stored REFERENCE, not a snapshot. Resolving it matters because the
  // alternative is silent: returning null sends the caller to the sport default,
  // so a super over stored as { presetKey: 'cricket_super_over' } would be scored
  // as a twenty-over match with nothing anywhere saying so.
  const key = (config as { presetKey?: unknown } | null)?.presetKey;
  if (typeof key === 'string') {
    const preset = cricketPresetByKey(key);
    if (preset) return preset;
  }
  return null;
}

/** Balls → overs notation. "15.2" is 15 overs and 2 balls, NOT 15.2 of anything. */
export function oversOf(balls: number, ballsPerOver = 6): string {
  const b = Math.max(0, Math.floor(balls));
  return `${Math.floor(b / ballsPerOver)}.${b % ballsPerOver}`;
}

/** Overs notation → balls. The inverse, so a summary entry can be typed naturally. */
export function ballsOf(overs: string, ballsPerOver = 6): number {
  const [o, b] = String(overs ?? '').split('.');
  const whole = Math.max(0, Math.floor(Number(o) || 0));
  const part = Math.min(ballsPerOver - 1, Math.max(0, Math.floor(Number(b) || 0)));
  return whole * ballsPerOver + part;
}

/** One line describing a format, for a shelf row. */
export function describeCricketFormat(f: CricketFormat): string {
  const bits: string[] = [];
  bits.push(f.oversPerInnings === null ? 'unlimited overs'
    : `${f.oversPerInnings} over${f.oversPerInnings === 1 ? '' : 's'}`);
  if (f.inningsPerSide > 1) bits.push(`${f.inningsPerSide} innings a side`);
  if (f.playersPerSide !== 11) bits.push(`${f.playersPerSide} a side`);
  if (f.ballsPerOver !== 6) bits.push(`${f.ballsPerOver}-ball overs`);
  if (f.maxOversPerBowler) bits.push(`max ${f.maxOversPerBowler} per bowler`);
  if (f.lastManStands) bits.push('last man stands');
  if (f.superOverOnTie) bits.push('super over on a tie');
  return bits.join(' · ');
}
