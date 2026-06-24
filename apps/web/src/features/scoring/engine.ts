// Archetype-driven scoring engine. A sport maps to an archetype that decides how
// the console scores it and how the headline (home_score/away_score) is derived.

import type { EventTypeSpec } from '@semp/shared';

export type Archetype = 'points' | 'sets' | 'rally' | 'cricket' | 'time';

export interface SportDef {
  archetype: Archetype;
  segLabel: string;     // Quarter / Half / Set / Game / Innings / Heat
  segMax: number;
  pointButtons: number[]; // increments offered per scoring tap
  manualHint?: string;  // 'time' archetype only - guidance shown in the manual result form
  events?: EventTypeSpec[];   // detailed-mode event buttons (raid/tackle/card…)
  attributePlayers?: boolean; // capture the acting player for events
}

// Keyed by sport name (lowercased). Anything unknown falls back to a running points
// tally - but every seeded sport is listed below so its console is purpose-built
// rather than guessed. Grouped by archetype so the scoring model is self-evident.
const DEFS: Record<string, Partial<SportDef> & { archetype: Archetype }> = {
  // ── Invasion / goal sports: running points tallied per period ────────────────
  basketball:     { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1, 2, 3] },
  netball:        { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1, 2, 3] },
  football:       { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1], attributePlayers: true,
    events: [{ key: 'yellow', label: 'Yellow card', perPlayer: true }, { key: 'red', label: 'Red card', perPlayer: true }] },
  soccer:         { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1], attributePlayers: true,
    events: [{ key: 'yellow', label: 'Yellow card', perPlayer: true }, { key: 'red', label: 'Red card', perPlayer: true }] },
  futsal:         { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1], attributePlayers: true,
    events: [{ key: 'yellow', label: 'Yellow card', perPlayer: true }, { key: 'red', label: 'Red card', perPlayer: true }] },
  hockey:         { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  'field hockey': { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  handball:       { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1] },
  'water polo':   { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  kabaddi:        { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1, 2, 3],
    attributePlayers: true,
    events: [
      { key: 'raid',   label: 'Raid +1',   points: 1, perPlayer: true },
      { key: 'tackle', label: 'Tackle +1', points: 1, perPlayer: true },
      { key: 'bonus',  label: 'Bonus +1',  points: 1, perPlayer: true },
      { key: 'allout', label: 'All Out +2', points: 2 },
    ] },
  'kho-kho':      { archetype: 'points', segLabel: 'Innings', segMax: 2, pointButtons: [1, 2] },
  frisbee:        { archetype: 'points', segLabel: 'Half',    segMax: 2, pointButtons: [1] },

  // ── Set / game sports: win a segment, the most segments wins ─────────────────
  volleyball:     { archetype: 'sets',  segLabel: 'Set',   segMax: 5, pointButtons: [1] },
  throwball:      { archetype: 'sets',  segLabel: 'Set',   segMax: 3, pointButtons: [1] },
  tennis:         { archetype: 'sets',  segLabel: 'Set',   segMax: 3, pointButtons: [1] },
  'pool/snooker': { archetype: 'sets',  segLabel: 'Frame', segMax: 5, pointButtons: [1] },
  carrom:         { archetype: 'sets',  segLabel: 'Board', segMax: 3, pointButtons: [1] },
  badminton:      { archetype: 'rally', segLabel: 'Game',  segMax: 3, pointButtons: [1] },
  'table tennis': { archetype: 'rally', segLabel: 'Game',  segMax: 5, pointButtons: [1] },
  'table-tennis': { archetype: 'rally', segLabel: 'Game',  segMax: 5, pointButtons: [1] },
  squash:         { archetype: 'rally', segLabel: 'Game',  segMax: 5, pointButtons: [1] },

  // ── Cricket: ball-by-ball runs & wickets across innings ──────────────────────
  cricket:        { archetype: 'cricket', segLabel: 'Innings', segMax: 2, pointButtons: [0, 1, 2, 3, 4, 6] },
  'box cricket':  { archetype: 'cricket', segLabel: 'Innings', segMax: 2, pointButtons: [0, 1, 2, 3, 4, 6] },

  // ── Measured / judged / combat: record the final result, confirm the winner ──
  // These have no live tally - the official enters the outcome once. For time
  // events the fastest (lowest) wins, so the winner is picked explicitly rather
  // than derived from "higher score".
  athletics:       { archetype: 'time', segLabel: 'Heat',    segMax: 1, pointButtons: [], manualHint: 'Enter each side’s time or mark, then pick the winner (fastest time, or best distance/height).' },
  swimming:        { archetype: 'time', segLabel: 'Heat',    segMax: 1, pointButtons: [], manualHint: 'Enter each side’s time - fastest (lowest) wins, so confirm the winner below.' },
  cycling:         { archetype: 'time', segLabel: 'Race',    segMax: 1, pointButtons: [], manualHint: 'Enter finish time or position, then pick the winner.' },
  rowing:          { archetype: 'time', segLabel: 'Race',    segMax: 1, pointButtons: [], manualHint: 'Enter each crew’s time - fastest wins, confirm below.' },
  weightlifting:   { archetype: 'time', segLabel: 'Lift',    segMax: 1, pointButtons: [], manualHint: 'Enter best total lifted in kg - highest wins.' },
  powerlifting:    { archetype: 'time', segLabel: 'Lift',    segMax: 1, pointButtons: [], manualHint: 'Enter best total lifted in kg - highest wins.' },
  shooting:        { archetype: 'time', segLabel: 'Round',   segMax: 1, pointButtons: [], manualHint: 'Enter total points scored - highest wins.' },
  archery:         { archetype: 'time', segLabel: 'Round',   segMax: 1, pointButtons: [], manualHint: 'Enter total points scored - highest wins.' },
  gymnastics:      { archetype: 'time', segLabel: 'Routine', segMax: 1, pointButtons: [], manualHint: 'Enter the judged score - highest wins.' },
  yoga:            { archetype: 'time', segLabel: 'Round',   segMax: 1, pointButtons: [], manualHint: 'Enter the judged score - highest wins.' },
  chess:           { archetype: 'time', segLabel: 'Game',    segMax: 1, pointButtons: [], manualHint: 'Enter points (win = 1, draw = ½ each), then pick the winner.' },
  fencing:         { archetype: 'time', segLabel: 'Bout',    segMax: 1, pointButtons: [], manualHint: 'Enter touches scored - highest wins.' },
  boxing:          { archetype: 'time', segLabel: 'Bout',    segMax: 1, pointButtons: [], manualHint: 'Enter judges’ points (or note a stoppage), then pick the winner.' },
  wrestling:       { archetype: 'time', segLabel: 'Bout',    segMax: 1, pointButtons: [], manualHint: 'Enter points scored, then pick the winner.' },
  judo:            { archetype: 'time', segLabel: 'Bout',    segMax: 1, pointButtons: [], manualHint: 'Enter points scored, then pick the winner.' },
  taekwondo:       { archetype: 'time', segLabel: 'Bout',    segMax: 1, pointButtons: [], manualHint: 'Enter points scored, then pick the winner.' },
  'arm wrestling': { archetype: 'time', segLabel: 'Best of 3', segMax: 1, pointButtons: [], manualHint: 'Enter rounds won (best of 3), then pick the winner.' },
  'tug of war':    { archetype: 'time', segLabel: 'Best of 3', segMax: 1, pointButtons: [], manualHint: 'Enter pulls won (best of 3), then pick the winner.' },
};

export function sportDef(name?: string | null): SportDef {
  const d = name ? DEFS[name.trim().toLowerCase()] : undefined;
  return { archetype: 'points', segLabel: 'Period', segMax: 2, pointButtons: [1], ...(d ?? {}) } as SportDef;
}

export interface MatchState {
  a: number; b: number;              // current-period points (or running points)
  seg: number;                       // current period (1-based)
  segScores: [number, number][];     // finished period scores
  segsA: number; segsB: number;      // periods/sets/games won (sets/rally)
  inn: number; batting: 'A' | 'B';   // cricket
  runsA: number; wktA: number; runsB: number; wktB: number;
  ballsA: number; ballsB: number;    // cricket: legal balls bowled per innings (overs = balls/6)
  ended?: boolean;                   // final period frozen (points archetype) - locks scoring until reopened
}

// Balls → cricket overs notation, e.g. 92 → "15.2" (15 overs, 2 balls).
export function oversStr(balls: number): string {
  const b = Math.max(0, Math.floor(balls || 0));
  return `${Math.floor(b / 6)}.${b % 6}`;
}
// Parse "15.2" overs notation back to a ball count (balls capped at 5 per over).
export function oversToBalls(overs: string): number {
  const [ov, ball] = String(overs ?? '').split('.');
  return (Math.max(0, Math.floor(Number(ov) || 0)) * 6) + Math.min(5, Math.max(0, Math.floor(Number(ball) || 0)));
}
// Cricket "runs/wkts (overs)" for one side.
export function cricketScore(s: MatchState, side: 'A' | 'B'): string {
  const runs = side === 'A' ? s.runsA : s.runsB;
  const wkt = side === 'A' ? s.wktA : s.wktB;
  const balls = side === 'A' ? s.ballsA : s.ballsB;
  return `${runs}/${wkt} (${oversStr(balls)})`;
}

export interface LogEntry { t: string; team?: 'A' | 'B'; txt: string; player?: string; kind?: string }

export function initState(): MatchState {
  return { a: 0, b: 0, seg: 1, segScores: [], segsA: 0, segsB: 0, inn: 1, batting: 'A', runsA: 0, wktA: 0, runsB: 0, wktB: 0, ballsA: 0, ballsB: 0 };
}

// Tolerant rehydrate from a persisted (possibly partial) snapshot.
export function hydrate(raw: any): MatchState {
  const s = initState();
  if (raw && typeof raw === 'object') Object.assign(s, raw);
  if (!Array.isArray(s.segScores)) s.segScores = [];
  return s;
}

export type Action =
  | { type: 'POINT'; team?: 'A' | 'B'; pts?: number; label?: string }
  | { type: 'EVENT'; team?: 'A' | 'B'; key: string; label: string; pts?: number; playerId?: string; playerName?: string }
  | { type: 'NEXT_SEG' }
  | { type: 'END_FINAL' }
  | { type: 'REOPEN' }
  | { type: 'WICKET' }
  | { type: 'SWITCH_INNINGS' };

export function reduce(def: SportDef, s: MatchState, action: Action): { state: MatchState; entry?: LogEntry } {
  const ns: MatchState = { ...s, segScores: [...s.segScores] };
  switch (action.type) {
    case 'POINT': {
      const pts = action.pts ?? 1;
      if (def.archetype === 'cricket') {
        if (ns.batting === 'A') { ns.runsA += pts; ns.ballsA += 1; } else { ns.runsB += pts; ns.ballsB += 1; }
        const balls = ns.batting === 'A' ? ns.ballsA : ns.ballsB;
        return { state: ns, entry: { t: `${oversStr(balls)} ov`, team: ns.batting, txt: `${pts} run${pts === 1 ? '' : 's'}` } };
      }
      if (action.team === 'A') ns.a += pts; else ns.b += pts;
      return { state: ns, entry: { t: `${def.segLabel} ${ns.seg}`, team: action.team, txt: `+${pts}${action.label ? ` ${action.label}` : ''}` } };
    }
    case 'EVENT': {
      // A configured event (raid/tackle/card/…): credit points to the acting side when
      // the event scores, and log it with the acting player for the timeline / stats.
      const pts = action.pts ?? 0;
      if (def.archetype !== 'cricket' && pts) {
        if (action.team === 'A') ns.a += pts; else if (action.team === 'B') ns.b += pts;
      }
      const txt = `${action.label}${action.playerName ? ` · ${action.playerName}` : ''}`;
      return { state: ns, entry: { t: `${def.segLabel} ${ns.seg}`, team: action.team, txt, player: action.playerName, kind: action.key } };
    }
    case 'WICKET': {
      if (ns.batting === 'A') { ns.wktA += 1; ns.ballsA += 1; } else { ns.wktB += 1; ns.ballsB += 1; }
      const balls = ns.batting === 'A' ? ns.ballsA : ns.ballsB;
      return { state: ns, entry: { t: `${oversStr(balls)} ov`, team: ns.batting, txt: 'Wicket' } };
    }
    case 'SWITCH_INNINGS': {
      ns.inn = Math.min(ns.inn + 1, def.segMax);
      ns.batting = ns.batting === 'A' ? 'B' : 'A';
      return { state: ns, entry: { t: `Inn ${ns.inn}`, txt: 'Innings change' } };
    }
    case 'END_FINAL': {
      // Points archetype: snapshot the final period and freeze scoring. The running
      // a/b totals stay (they ARE the headline), so this only records the breakdown
      // and locks the deck until REOPEN.
      ns.segScores.push([ns.a, ns.b]);
      ns.ended = true;
      return { state: ns, entry: { t: '', txt: `End ${def.segLabel} ${ns.seg}` } };
    }
    case 'REOPEN': {
      // Undo END_FINAL: drop the snapshot we pushed and unlock scoring.
      if (ns.ended) { ns.segScores.pop(); ns.ended = false; }
      return { state: ns, entry: { t: '', txt: `Resume ${def.segLabel} ${ns.seg}` } };
    }
    case 'NEXT_SEG': {
      if (def.archetype === 'sets' || def.archetype === 'rally') {
        if (ns.ended) return { state: ns }; // already clinched - ignore
        const aWon = ns.a >= ns.b;
        if (aWon) ns.segsA += 1; else ns.segsB += 1;
        ns.segScores.push([ns.a, ns.b]);
        const finished = ns.seg;
        ns.a = 0; ns.b = 0;
        // Best-of-segMax: first to a majority wins the contest. Freeze there instead
        // of advancing past it (no "set 4 of 3"), and never exceed segMax.
        const need = Math.floor(def.segMax / 2) + 1;
        if (ns.segsA >= need || ns.segsB >= need) ns.ended = true;
        else ns.seg = Math.min(ns.seg + 1, def.segMax);
        return { state: ns, entry: { t: '', txt: `${aWon ? 'Home' : 'Away'} take ${def.segLabel.toLowerCase()} ${finished}` } };
      }
      ns.segScores.push([ns.a, ns.b]);
      ns.seg = Math.min(ns.seg + 1, def.segMax);
      return { state: ns, entry: { t: '', txt: `Start ${def.segLabel} ${ns.seg}` } };
    }
    default:
      return { state: s };
  }
}

// Headline numbers persisted as home_score / away_score (drive standings).
export function headline(def: SportDef, s: MatchState): { a: number; b: number } {
  if (def.archetype === 'sets' || def.archetype === 'rally') return { a: s.segsA, b: s.segsB };
  if (def.archetype === 'cricket') return { a: s.runsA, b: s.runsB };
  return { a: s.a, b: s.b };
}

export function subLine(def: SportDef, s: MatchState): string {
  if (def.archetype === 'sets' || def.archetype === 'rally') {
    const parts = s.segScores.map((x) => `${x[0]}–${x[1]}`);
    if (!s.ended) parts.push(`${s.a}–${s.b}`); // hide the empty current set once clinched
    return parts.join('  ·  ');
  }
  if (def.archetype === 'cricket') {
    const bt = s.batting === 'A' ? 'Home' : 'Away';
    return `Innings ${s.inn} · ${bt} batting · Home ${cricketScore(s, 'A')} · Away ${cricketScore(s, 'B')}`;
  }
  const parts = s.segScores.map((x, i) => `${def.segLabel[0]}${i + 1} ${x[0]}–${x[1]}`);
  return parts.join('  ·  ');
}
