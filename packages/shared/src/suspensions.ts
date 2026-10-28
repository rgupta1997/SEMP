import type { RallyLog } from './rally-kernel.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import { canonicalTeamSport } from './team-presets.js';

// Card suspensions served in match time (hockey: green 2 minutes, yellow 5), and the
// rule that a second green becomes a yellow and a second yellow a red. Read off the
// log, so nothing is stored; the console only shows it and asks before escalating.

export interface CardRules {
  /** Minutes off per card key, e.g. { green: 2, yellow: 5 }. */
  minutes: Record<string, number>;
  /** Second green becomes a yellow, second yellow a red (IIMK). */
  escalate: boolean;
}

/** Card keys in escalation order: a repeat moves one step up. */
const LADDER = ['green', 'yellow', 'red'] as const;
const HOCKEY_MINUTES = { green: 2, yellow: 5 };

/** A format's card rules: its rules sheet, else hockey's defaults; null when it has none. */
export function cardRulesFor(format: Pick<ScoringFormat, 'sport' | 'rulesSheet'> | null | undefined): CardRules | null {
  if (!format) return null;
  const sheet = format.rulesSheet ?? {};
  const raw = sheet.cardSuspensionMinutes;
  const own = raw && typeof raw === 'object'
    ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>
    : null;
  const minutes = own && Object.keys(own).length ? own : canonicalTeamSport(format.sport) === 'hockey' ? HOCKEY_MINUTES : null;
  if (!minutes) return null;
  return { minutes, escalate: sheet.cardEscalation === true };
}

const ms = (at?: string): number | null => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
};

/** Match time played over all periods, in ms, before event `upTo` (or now, at the end of the log). */
export function matchTimeAt(log: RallyLog, upTo: number, now: number): number {
  let total = 0;
  let period = 0;
  let since: number | null = null;
  const stop = (t: number) => { if (since !== null) { period += Math.max(0, t - since); since = null; } };
  for (const ev of log.slice(0, upTo)) {
    const t = ms(ev.at) ?? now;
    if (ev.t === 'clockStart') { if (since === null) since = t; }
    else if (ev.t === 'clockPause') stop(t);
    else if (ev.t === 'clockAdjust') { period = Math.max(0, ev.toMs); if (since !== null) since = t; }
    else if (ev.t === 'endPeriod') { stop(t); total += period; period = 0; }
  }
  const ref = upTo < log.length ? ms(log[upTo].at) ?? now : now;
  return total + period + (since === null ? 0 : Math.max(0, ref - since));
}

export interface Suspension {
  playerId: string;
  playerName?: string;
  side: Side;
  card: string;
  /** Match time left to serve, ms. Infinity for a red card (off for the match). */
  remainingMs: number;
}

/** Who is off right now: timed suspensions still running, and players sent off. */
export function activeSuspensions(log: RallyLog, rules: CardRules, now: number): Suspension[] {
  const played = matchTimeAt(log, log.length, now);
  const out = new Map<string, Suspension>();
  log.forEach((ev, i) => {
    if (ev.t !== 'point' || !ev.kind || !ev.playerId) return;
    const red = ev.kind === 'red';
    const mins = rules.minutes[ev.kind];
    if (!red && !mins) return;
    const remainingMs = red ? Infinity : matchTimeAt(log, i, now) + mins * 60_000 - played;
    const prev = out.get(ev.playerId);
    // A later card replaces the earlier one; a red stays for the match.
    if (prev?.remainingMs === Infinity) return;
    if (remainingMs > 0) out.set(ev.playerId, { playerId: ev.playerId, playerName: ev.playerName, side: ev.side, card: ev.kind, remainingMs });
    else out.delete(ev.playerId);
  });
  return [...out.values()].sort((a, b) => a.remainingMs - b.remainingMs);
}

/** The card a player should get under escalation: a second green is a yellow, a second yellow a red. */
export function escalatedCard(log: RallyLog, rules: CardRules, playerId: string, card: string): string {
  if (!rules.escalate || !(LADDER as readonly string[]).includes(card)) return card;
  const held = (k: string) => log.filter((ev) => ev.t === 'point' && ev.kind === k && ev.playerId === playerId).length;
  let next = card;
  // A repeat moves up one step, and keeps moving while that card is also a repeat.
  while (next !== 'red' && held(next) > 0) next = LADDER[LADDER.indexOf(next as (typeof LADDER)[number]) + 1];
  return next;
}
