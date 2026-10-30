import { RAID_ENDS, type KernelState, type RallyLog } from './rally-kernel.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import { canonicalTeamSport } from './team-presets.js';

// ============================================================================
// Kabaddi on top of the period kernel: whose raid it is, and the do-or-die.
//
// Raids alternate (AKFI / IIMK "each side shall continue to send their raider").
// The toss decides who raids first; in the second half the other team does. A raid
// ends with one of RAID_ENDS, whichever side the tap was made on. Two empty raids in a
// row by a team make its next raid a do-or-die: an empty one then puts the raider out.
//
// Everything is read from the log, so undo and a second device agree.
// ============================================================================

// RAID_ENDS (taps that end a raid) lives in the kernel, which decides golden raids on them.
export { RAID_ENDS };

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

export function isKabaddiFormat(format?: Pick<ScoringFormat, 'sport'> | null): boolean {
  return !!format && canonicalTeamSport(format.sport) === 'kabaddi';
}

export interface KabaddiStatus {
  /** Who raids first in the match (the toss). null until recorded. */
  firstRaider: Side | null;
  /** Whose raid is next. null before the toss or once the match is over. */
  raider: Side | null;
  /** The raiding team has two empty raids in a row: this raid must score. */
  doOrDie: boolean;
  /** Empty raids in a row by the raiding team. */
  emptyStreak: number;
  /** True until the first raid has ended - the toss can still be changed. */
  beforeFirstRaid: boolean;
  /** Golden raid toss made: the raids since are golden raids. */
  goldenStarted: boolean;
  /** Golden raids completed (each team gets one). */
  goldenRaids: number;
  /** Both golden raids empty and still level: a toss decides. */
  goldenTossDue: boolean;
}

/** Each team's golden raid; level after both, a toss decides. */
export const GOLDEN_RAIDS = 2;

export function kabaddiStatus(log: RallyLog, state: KernelState): KabaddiStatus {
  let first: Side | null = null;
  let raider: Side | null = null;
  let half = 0;
  let raidsEnded = 0;
  let empty: Record<Side, number> = { A: 0, B: 0 };
  let goldenStarted = false;
  let goldenRaids = 0;
  for (const ev of log) {
    if (ev.t === 'raidFirst' && raidsEnded === 0 && half === 0) {
      first = ev.side;
      raider = ev.side;
    } else if (ev.t === 'endPeriod') {
      half += 1;
      // The team that did not raid first opens the second half; halves alternate after.
      if (first) raider = half % 2 === 1 ? other(first) : first;
      empty = { A: 0, B: 0 };
    } else if (ev.t === 'raidTurn') {
      raider = ev.side;
    } else if (ev.t === 'goldenRaid') {
      goldenStarted = true;
      raider = ev.side;
    } else if (ev.t === 'point' && ev.kind && RAID_ENDS.has(ev.kind) && raider) {
      empty[raider] = ev.kind === 'empty_raid' ? empty[raider] + 1 : 0;
      raidsEnded += 1;
      if (goldenStarted) goldenRaids += 1;
      raider = other(raider);
    }
  }
  const live = state.ended ? null : raider;
  const emptyStreak = live ? empty[live] : 0;
  return {
    firstRaider: first, raider: live, doOrDie: !goldenStarted && emptyStreak >= 2, emptyStreak, beforeFirstRaid: raidsEnded === 0,
    goldenStarted, goldenRaids, goldenTossDue: goldenStarted && !state.ended && goldenRaids >= GOLDEN_RAIDS,
  };
}
