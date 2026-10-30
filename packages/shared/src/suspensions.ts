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
  /** Cards whose suspension also ends when the other side scores (futsal's red). */
  endsOnGoal: string[];
  /** Suspensions are timed on the console; off leaves only the escalation question. */
  timed: boolean;
  /** What a repeat card becomes: hockey green -> yellow -> red; football's second yellow -> red2y. */
  steps: Record<string, string>;
}

const HOCKEY_MINUTES = { green: 2, yellow: 5 };
// Futsal: a red card leaves the side short for 2 minutes, or until the other side scores.
const FUTSAL_MINUTES = { red: 2, red2y: 2 };
const HOCKEY_STEPS = { green: 'yellow', yellow: 'red' };
const FOOTBALL_STEPS = { yellow: 'red2y' };
/** Cards that send a player off (unless the format times them, as futsal does). */
export const DISMISSAL_CARDS: readonly string[] = ['red', 'red2y'];

type CardFormat = Pick<ScoringFormat, 'sport' | 'rulesSheet'>;

export type CardSport = 'hockey' | 'futsal' | 'football';

/** The sports with card rules (timers and/or escalation), and so a Cards section in the editor. */
export function cardSportOf(sport?: string | null): CardSport | null {
  const s = canonicalTeamSport(sport);
  return s === 'hockey' || s === 'futsal' || s === 'football' ? s : null;
}

/** Whether a repeat card escalates: the rules sheet's choice, else the Laws of the Game (football, futsal) yes, hockey no. */
export function escalationOn(format: CardFormat | null | undefined): boolean {
  const own = format?.rulesSheet?.cardEscalation;
  if (typeof own === 'boolean') return own;
  const s = cardSportOf(format?.sport);
  return s === 'football' || s === 'futsal';
}

/** Minutes off per card: the rules sheet's, else the sport's; null when it has none. Ignores the on/off switch. */
export function cardMinutesFor(format: CardFormat | null | undefined): Record<string, number> | null {
  if (!format) return null;
  const raw = format.rulesSheet?.cardSuspensionMinutes;
  const own = raw && typeof raw === 'object'
    ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>
    : null;
  if (own && Object.keys(own).length) return own;
  const sport = cardSportOf(format.sport);
  return sport === 'hockey' ? HOCKEY_MINUTES : sport === 'futsal' ? FUTSAL_MINUTES : null;
}

/** A format's card rules: its rules sheet, else the sport's defaults; null when it has none or they are off. */
export function cardRulesFor(format: CardFormat | null | undefined): CardRules | null {
  if (!format) return null;
  const sheet = format.rulesSheet ?? {};
  const escalate = escalationOn(format);
  const minutes = cardMinutesFor(format);
  // Switched off in the format editor: cards are only logged (escalation, if on, still asks).
  const timed = !!minutes && sheet.cardSuspensions !== false;
  if (!timed && !escalate) return null;
  const sport = cardSportOf(format.sport);
  const ends = Array.isArray(sheet.cardEndsOnGoal) ? sheet.cardEndsOnGoal.filter((k): k is string => typeof k === 'string')
    : sport === 'futsal' ? ['red', 'red2y'] : [];
  return { minutes: minutes ?? {}, escalate, endsOnGoal: ends, timed, steps: sport === 'hockey' ? HOCKEY_STEPS : FOOTBALL_STEPS };
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
  /** Match time left to serve, ms. Infinity for a red card off for the match. */
  remainingMs: number;
}

/** Who is off right now: timed suspensions still running, and players sent off. */
export function activeSuspensions(log: RallyLog, rules: CardRules, now: number): Suspension[] {
  if (!rules.timed) return [];
  const played = matchTimeAt(log, log.length, now);
  const out = new Map<string, Suspension>();
  log.forEach((ev, i) => {
    if (ev.t !== 'point' || !ev.kind || !ev.playerId) return;
    const mins = rules.minutes[ev.kind];
    // A red with no minutes set is off for the match.
    const red = DISMISSAL_CARDS.includes(ev.kind) && !mins;
    if (!red && !mins) return;
    // Futsal's red: over as soon as the other side scores.
    const side = ev.side;
    const conceded = rules.endsOnGoal.includes(ev.kind)
      && log.slice(i + 1).some((x) => x.t === 'point' && (x.pts ?? 1) > 0 && x.side !== side);
    const remainingMs = red ? Infinity : conceded ? 0 : matchTimeAt(log, i, now) + mins * 60_000 - played;
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
  if (!rules.escalate || !rules.steps[card]) return card;
  const held = (k: string) => log.filter((ev) => ev.t === 'point' && ev.kind === k && ev.playerId === playerId).length;
  let next = card;
  // A repeat moves up one step, and keeps moving while that card is also a repeat.
  while (rules.steps[next] && held(next) > 0) next = rules.steps[next];
  return next;
}

/** Sent off for the rest of the match: a red the format does not time (football, hockey). */
export function sentOffPlayers(log: RallyLog, rules: CardRules | null): Set<string> {
  const out = new Set<string>();
  for (const ev of log) {
    if (ev.t !== 'point' || !ev.kind || !ev.playerId || !DISMISSAL_CARDS.includes(ev.kind)) continue;
    if (rules?.timed && rules.minutes[ev.kind]) continue;
    out.add(ev.playerId);
  }
  return out;
}
