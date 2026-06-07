// Archetype-driven scoring engine. A sport maps to an archetype that decides how
// the console scores it and how the headline (home_score/away_score) is derived.

export type Archetype = 'points' | 'sets' | 'rally' | 'cricket' | 'time';

export interface SportDef {
  archetype: Archetype;
  segLabel: string;     // Quarter / Half / Set / Game / Innings / Heat
  segMax: number;
  pointButtons: number[]; // increments offered per scoring tap
}

// Keyed by sport name (lowercased). Anything unknown falls back to running points.
const DEFS: Record<string, Partial<SportDef> & { archetype: Archetype }> = {
  basketball: { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1, 2, 3] },
  netball: { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1, 2, 3] },
  football: { archetype: 'points', segLabel: 'Half', segMax: 2, pointButtons: [1] },
  soccer: { archetype: 'points', segLabel: 'Half', segMax: 2, pointButtons: [1] },
  futsal: { archetype: 'points', segLabel: 'Half', segMax: 2, pointButtons: [1] },
  'field hockey': { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  hockey: { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  handball: { archetype: 'points', segLabel: 'Half', segMax: 2, pointButtons: [1] },
  'water polo': { archetype: 'points', segLabel: 'Quarter', segMax: 4, pointButtons: [1] },
  kabaddi: { archetype: 'points', segLabel: 'Half', segMax: 2, pointButtons: [1, 2, 3] },
  volleyball: { archetype: 'sets', segLabel: 'Set', segMax: 5, pointButtons: [1] },
  tennis: { archetype: 'sets', segLabel: 'Set', segMax: 3, pointButtons: [1] },
  badminton: { archetype: 'rally', segLabel: 'Game', segMax: 3, pointButtons: [1] },
  'table tennis': { archetype: 'rally', segLabel: 'Game', segMax: 5, pointButtons: [1] },
  'table-tennis': { archetype: 'rally', segLabel: 'Game', segMax: 5, pointButtons: [1] },
  squash: { archetype: 'rally', segLabel: 'Game', segMax: 5, pointButtons: [1] },
  cricket: { archetype: 'cricket', segLabel: 'Innings', segMax: 2, pointButtons: [0, 1, 2, 3, 4, 6] },
  athletics: { archetype: 'time', segLabel: 'Heat', segMax: 1, pointButtons: [] },
  swimming: { archetype: 'time', segLabel: 'Heat', segMax: 1, pointButtons: [] },
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
}

export interface LogEntry { t: string; team?: 'A' | 'B'; txt: string }

export function initState(): MatchState {
  return { a: 0, b: 0, seg: 1, segScores: [], segsA: 0, segsB: 0, inn: 1, batting: 'A', runsA: 0, wktA: 0, runsB: 0, wktB: 0 };
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
  | { type: 'NEXT_SEG' }
  | { type: 'WICKET' }
  | { type: 'SWITCH_INNINGS' };

export function reduce(def: SportDef, s: MatchState, action: Action): { state: MatchState; entry?: LogEntry } {
  const ns: MatchState = { ...s, segScores: [...s.segScores] };
  switch (action.type) {
    case 'POINT': {
      const pts = action.pts ?? 1;
      if (def.archetype === 'cricket') {
        if (ns.batting === 'A') ns.runsA += pts; else ns.runsB += pts;
        return { state: ns, entry: { t: `Inn ${ns.inn}`, team: ns.batting, txt: `${pts} run${pts === 1 ? '' : 's'}` } };
      }
      if (action.team === 'A') ns.a += pts; else ns.b += pts;
      return { state: ns, entry: { t: `${def.segLabel} ${ns.seg}`, team: action.team, txt: `+${pts}${action.label ? ` ${action.label}` : ''}` } };
    }
    case 'WICKET': {
      if (ns.batting === 'A') ns.wktA += 1; else ns.wktB += 1;
      return { state: ns, entry: { t: `Inn ${ns.inn}`, team: ns.batting, txt: 'Wicket' } };
    }
    case 'SWITCH_INNINGS': {
      ns.inn = Math.min(ns.inn + 1, def.segMax);
      ns.batting = ns.batting === 'A' ? 'B' : 'A';
      return { state: ns, entry: { t: `Inn ${ns.inn}`, txt: 'Innings change' } };
    }
    case 'NEXT_SEG': {
      if (def.archetype === 'sets' || def.archetype === 'rally') {
        const aWon = ns.a >= ns.b;
        if (aWon) ns.segsA += 1; else ns.segsB += 1;
        ns.segScores.push([ns.a, ns.b]);
        const finished = ns.seg;
        ns.a = 0; ns.b = 0; ns.seg += 1;
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
    parts.push(`${s.a}–${s.b}`);
    return parts.join('  ·  ');
  }
  if (def.archetype === 'cricket') {
    const bt = s.batting === 'A' ? 'Home' : 'Away';
    return `Innings ${s.inn} · ${bt} batting · ${s.batting === 'A' ? `${s.runsA}/${s.wktA}` : `${s.runsB}/${s.wktB}`}`;
  }
  const parts = s.segScores.map((x, i) => `${def.segLabel[0]}${i + 1} ${x[0]}–${x[1]}`);
  return parts.join('  ·  ');
}
