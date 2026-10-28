import type { RallyLog } from './rally-kernel.js';
import type { Side } from './scoring-rules.js';
import { canonicalTeamSport } from './team-presets.js';

// Hockey's team counts read off the match log: penalty corners won, and how many
// were scored from. A corner is the team's, so it lives here rather than on a player.

export const isHockeySport = (sport?: string | null): boolean => canonicalTeamSport(sport) === 'hockey';

/** Event keys: a penalty corner awarded (team), and a goal scored from one (player). */
export const PC_AWARDED = 'pc';
export const PC_GOAL = 'pc_goal';

export interface CornerCount { won: number; scored: number }

/** Corners per side. A corner goal with no corner tapped still counts as a corner. */
export function penaltyCorners(log: RallyLog): Record<Side, CornerCount> {
  const out: Record<Side, CornerCount> = { A: { won: 0, scored: 0 }, B: { won: 0, scored: 0 } };
  const taps: Record<Side, number> = { A: 0, B: 0 };
  for (const ev of log) {
    if (ev.t !== 'point') continue;
    if (ev.kind === PC_AWARDED) taps[ev.side] += 1;
    if (ev.kind === PC_GOAL) out[ev.side].scored += 1;
  }
  for (const s of ['A', 'B'] as const) out[s].won = Math.max(taps[s], out[s].scored);
  return out;
}

/** "PC 4–2 (2–0 scored)", home first; null when no corner was recorded. */
export function cornersLine(log: RallyLog): string | null {
  const { A, B } = penaltyCorners(log);
  if (!A.won && !B.won) return null;
  return `PC ${A.won}–${B.won}${A.scored || B.scored ? ` (${A.scored}–${B.scored} scored)` : ''}`;
}
