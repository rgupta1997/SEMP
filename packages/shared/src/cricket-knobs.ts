import type { CricketFormat } from './cricket-rules.js';

// ============================================================================
// The EDITING model for a cricket format.
//
// Mirrors format-knobs.ts, and for the same reason: what is good to STORE is not
// good to put in front of a person. The difference is that CricketFormat is already
// flat - there are no nested levels to unwind - so this layer is thinner. It exists
// anyway, for three things the storage model cannot express:
//
//   1. UNLIMITED as a toggle. `oversPerInnings: null` means a Test. A form field
//      cannot hold null usefully, so it becomes a checkbox plus a number, and
//      `?? 20` is exactly the bug that made the Test preset a twenty-over game.
//   2. WHICH KNOBS APPLY. A powerplay in a four-over box game is nonsense, and a
//      max-overs-per-bowler in a Test is nonsense. `cricketKnobsFor` returns only
//      what makes sense for the format in hand.
//   3. GUARD RAILS THE DATABASE ALSO ENFORCES. `wicketsToEndInnings` cannot exceed
//      playersPerSide - 1 unless the last batter stands alone, and the schema has a
//      check constraint saying so. Clamping it here means the form cannot produce a
//      row the insert would reject. Clamped rather than DERIVED from the squad size,
//      because a super over ends after two wickets with eleven on the sheet.
// ============================================================================

export interface CricketKnobs {
  // ---- the shape of an innings
  /** Off = unlimited (a Test). The stored form is null, which a form cannot hold. */
  limitedOvers: boolean;
  oversPerInnings: number;
  ballsPerOver: number;
  inningsPerSide: number;
  playersPerSide: number;
  /**
   * How many wickets end the innings.
   *
   * Explicit rather than derived from playersPerSide, because a super over ends
   * after TWO wickets with eleven players on the sheet - a real rule that a
   * "does the last batter need a partner" toggle cannot express. The round-trip
   * test caught exactly that.
   */
  wicketsToEnd: number;
  /** On = the last batter bats alone rather than the innings ending. */
  lastManStands: boolean;

  // ---- the bowling
  bowlerLimitEnabled: boolean;
  maxOversPerBowler: number;
  powerplayEnabled: boolean;
  powerplayOvers: number;

  // ---- the deliveries
  wideRuns: number;
  noBallRuns: number;
  freeHitAfterNoBall: boolean;

  // ---- how the match is decided
  superOverOnTie: boolean;
  drawsAllowed: boolean;

  // ---- how it is run
  officiatingMode: 'officiated' | 'selfScored';
  entryMode: 'ballByBall' | 'summary';
}

export interface CricketKnobSpec {
  key: keyof CricketKnobs;
  label: string;
  hint?: string;
  group: 'innings' | 'bowling' | 'deliveries' | 'result' | 'run';
  type: 'int' | 'bool' | 'enum';
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  applies?: (k: CricketKnobs) => boolean;
}

export const CRICKET_KNOB_GROUPS: Array<{ key: CricketKnobSpec['group']; label: string }> = [
  { key: 'innings', label: 'The innings' },
  { key: 'bowling', label: 'Bowling' },
  { key: 'deliveries', label: 'Deliveries and extras' },
  { key: 'result', label: 'Deciding the match' },
  { key: 'run', label: 'How it is run' },
];

export const CRICKET_KNOB_SPECS: CricketKnobSpec[] = [
  // ---- innings
  { key: 'limitedOvers', label: 'Limited overs', group: 'innings', type: 'bool',
    hint: 'Off means unlimited overs — a Test or a timeless match, which ends on wickets or on time.' },
  { key: 'oversPerInnings', label: 'Overs an innings', group: 'innings', type: 'int', min: 1, max: 100,
    applies: (k) => k.limitedOvers },
  { key: 'ballsPerOver', label: 'Balls an over', group: 'innings', type: 'int', min: 1, max: 12,
    hint: 'Six almost everywhere. Box cricket is often four or five.' },
  { key: 'inningsPerSide', label: 'Innings a side', group: 'innings', type: 'int', min: 1, max: 2,
    hint: 'One for limited overs, two for a Test.' },
  { key: 'playersPerSide', label: 'Players a side', group: 'innings', type: 'int', min: 2, max: 15,
    hint: 'Eleven normally. Corporate and box formats are often six or eight.' },
  { key: 'wicketsToEnd', label: 'Wickets that end the innings', group: 'innings', type: 'int', min: 1, max: 10,
    hint: 'Normally one fewer than the side, because the last batter has nobody to bat with. A super over ends after two.' },
  { key: 'lastManStands', label: 'Last batter bats alone', group: 'innings', type: 'bool',
    hint: 'Lets the innings continue with one batter left, which box cricket often plays. Off, being one down ends it.' },

  // ---- bowling
  { key: 'bowlerLimitEnabled', label: 'Limit overs per bowler', group: 'bowling', type: 'bool',
    hint: 'Stops one bowler bowling the whole innings. A Test has no limit.' },
  { key: 'maxOversPerBowler', label: 'Maximum overs a bowler', group: 'bowling', type: 'int', min: 1, max: 50,
    hint: 'T20 is 4, an ODI is 10 — a fifth of the innings.',
    applies: (k) => k.bowlerLimitEnabled },
  { key: 'powerplayEnabled', label: 'Powerplay', group: 'bowling', type: 'bool',
    hint: 'Recorded on the scorecard. Fielding restrictions are not enforced by the console.',
    applies: (k) => k.limitedOvers && k.oversPerInnings >= 6 },
  { key: 'powerplayOvers', label: 'Powerplay overs', group: 'bowling', type: 'int', min: 1, max: 25,
    applies: (k) => k.limitedOvers && k.oversPerInnings >= 6 && k.powerplayEnabled },

  // ---- deliveries
  { key: 'wideRuns', label: 'Runs for a wide', group: 'deliveries', type: 'int', min: 0, max: 5,
    hint: 'One normally. Some box formats give two to keep the over moving.' },
  { key: 'noBallRuns', label: 'Runs for a no-ball', group: 'deliveries', type: 'int', min: 0, max: 5 },
  { key: 'freeHitAfterNoBall', label: 'Free hit after a no-ball', group: 'deliveries', type: 'bool',
    hint: 'The batter cannot be bowled or caught off the next delivery.' },

  // ---- result
  { key: 'superOverOnTie', label: 'Super over on a tie', group: 'result', type: 'bool',
    hint: 'A tie is broken by a one-over eliminator rather than standing as a tie.' },
  { key: 'drawsAllowed', label: 'Allow a draw', group: 'result', type: 'bool',
    hint: 'A draw is time running out, which is not the same as a tie. Multi-day cricket only.' },

  // ---- run
  { key: 'officiatingMode', label: 'Who scores', group: 'run', type: 'enum',
    options: [
      { value: 'officiated', label: 'An appointed official' },
      { value: 'selfScored', label: 'The teams themselves' },
    ] },
  { key: 'entryMode', label: 'How it is entered', group: 'run', type: 'enum',
    hint: 'Ball by ball builds the full scorecard. Summary takes the totals, for a match nobody could staff.',
    options: [
      { value: 'ballByBall', label: 'Ball by ball' },
      { value: 'summary', label: 'Final totals only' },
    ] },
];

/** Only the knobs that make sense for the format in hand. */
export function cricketKnobsFor(k: CricketKnobs): CricketKnobSpec[] {
  return CRICKET_KNOB_SPECS.filter((s) => !s.applies || s.applies(k));
}

export function readCricketKnobs(f: CricketFormat): CricketKnobs {
  return {
    limitedOvers: f.oversPerInnings !== null,
    // A sensible number to show if they switch limited overs back on, rather than 0.
    oversPerInnings: f.oversPerInnings ?? 20,
    ballsPerOver: f.ballsPerOver,
    inningsPerSide: f.inningsPerSide,
    playersPerSide: f.playersPerSide,
    wicketsToEnd: f.wicketsToEndInnings,
    lastManStands: f.lastManStands,
    bowlerLimitEnabled: f.maxOversPerBowler !== null,
    maxOversPerBowler: f.maxOversPerBowler ?? Math.max(1, Math.ceil((f.oversPerInnings ?? 20) / 5)),
    powerplayEnabled: f.powerplayOvers !== null,
    powerplayOvers: f.powerplayOvers ?? Math.max(1, Math.round((f.oversPerInnings ?? 20) * 0.3)),
    wideRuns: f.wideRuns,
    noBallRuns: f.noBallRuns,
    freeHitAfterNoBall: f.freeHitAfterNoBall,
    superOverOnTie: f.superOverOnTie,
    drawsAllowed: f.drawsAllowed,
    officiatingMode: f.officiatingMode,
    entryMode: f.entryMode,
  };
}

/**
 * Every cricket format is editable, unlike the rally side where tennis is refused.
 *
 * The reason tennis cannot be flattened is that a game sits inside a set with its own
 * scoring; cricket has no equivalent nesting, so there is nothing this model loses.
 */
export function isCricketEditable(_f: CricketFormat): boolean {
  return true;
}

export function applyCricketKnobs(f: CricketFormat, k: CricketKnobs, name?: string): CricketFormat {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  const players = clamp(k.playersPerSide, 2, 15);
  const overs = k.limitedOvers ? clamp(k.oversPerInnings, 1, 100) : null;

  // Taken as given, then CLAMPED to what the schema will accept: its check
  // constraint says the count cannot exceed players - 1 unless the last batter
  // stands alone, so the form must not be able to produce a row the insert would
  // reject. Clamping rather than deriving keeps a real rule like the super over's
  // two-wicket innings expressible.
  const ceiling = Math.min(10, k.lastManStands ? players : Math.max(1, players - 1));
  const wicketsToEndInnings = clamp(k.wicketsToEnd, 1, ceiling);

  return {
    ...f,
    name: name ?? f.name,
    // A varied format is no longer the preset it came from: keeping the key would let
    // a later lookup silently resolve back to the original rules.
    presetKey: undefined,
    oversPerInnings: overs,
    ballsPerOver: clamp(k.ballsPerOver, 1, 12),
    inningsPerSide: clamp(k.inningsPerSide, 1, 2),
    playersPerSide: players,
    wicketsToEndInnings,
    lastManStands: k.lastManStands,
    maxOversPerBowler: k.bowlerLimitEnabled
      // Nobody may be asked to bowl more overs than the innings has.
      ? clamp(k.maxOversPerBowler, 1, overs ?? 50)
      : null,
    powerplayOvers: k.powerplayEnabled && overs !== null
      ? clamp(k.powerplayOvers, 1, overs)
      : null,
    wideRuns: clamp(k.wideRuns, 0, 5),
    noBallRuns: clamp(k.noBallRuns, 0, 5),
    freeHitAfterNoBall: k.freeHitAfterNoBall,
    superOverOnTie: k.superOverOnTie,
    drawsAllowed: k.drawsAllowed,
    officiatingMode: k.officiatingMode,
    entryMode: k.entryMode,
  };
}

/** The live summary line under the editor, so a change is legible before it is saved. */
export function describeCricketKnobs(k: CricketKnobs): string {
  const bits: string[] = [];
  bits.push(k.limitedOvers ? `${k.oversPerInnings} over${k.oversPerInnings === 1 ? '' : 's'}` : 'unlimited overs');
  if (k.inningsPerSide > 1) bits.push(`${k.inningsPerSide} innings a side`);
  if (k.playersPerSide !== 11) bits.push(`${k.playersPerSide} a side`);
  if (k.ballsPerOver !== 6) bits.push(`${k.ballsPerOver}-ball overs`);
  if (k.bowlerLimitEnabled) bits.push(`max ${k.maxOversPerBowler} per bowler`);
  if (k.lastManStands) bits.push('last man stands');
  if (k.wicketsToEnd !== Math.max(1, k.playersPerSide - 1)) bits.push(`${k.wicketsToEnd} wickets`);
  if (k.wideRuns !== 1) bits.push(`wide = ${k.wideRuns}`);
  if (k.freeHitAfterNoBall) bits.push('free hit');
  if (k.superOverOnTie) bits.push('super over on a tie');
  if (k.drawsAllowed) bits.push('draws allowed');
  return bits.join(' · ');
}
