import { canonicalTeamSport } from './team-presets.js';

// ============================================================================
// The team sheet: who of a squad PLAYS a match, who is on the BENCH, and who sits it
// out (the rest of the squad). The scorer's pickers - goal, assist, card, shoot-out
// kicker - offer only the first two, so a 20-strong football squad is not twenty
// names to scroll past for every goal.
//
// Kept in `fixtures.live_state.teamSheet`. It does not change who gets an appearance
// at lock - that is still the whole squad (a decision, not an oversight).
// ============================================================================

export interface SideSheet {
  playing: string[];
  bench: string[];
  /** Shirt numbers worn THIS match, by player id. Starts from each profile; the profile is never changed. */
  jerseys?: Record<string, number>;
}
export interface TeamSheet { A: SideSheet; B: SideSheet }

/**
 * The usual shape of a side: players on the field, and a usual bench. A starting point,
 * never a rule. Cricket is not here: its XI is the format's own `playersPerSide`.
 */
const USUAL: Record<string, { onField: number; bench: number }> = {
  football: { onField: 11, bench: 7 },
  futsal: { onField: 5, bench: 7 },
  hockey: { onField: 11, bench: 5 },
  basketball: { onField: 5, bench: 7 },
  handball: { onField: 7, bench: 7 },
  volleyball: { onField: 6, bench: 6 },
  throwball: { onField: 7, bench: 5 },
  kabaddi: { onField: 7, bench: 5 },
  // 9 on the field; squads run to 15 (KKFI competition guidelines 5.1), so up to 6 subs.
  'kho-kho': { onField: 9, bench: 6 },
  frisbee: { onField: 7, bench: 7 },
  'tug of war': { onField: 8, bench: 2 },
};

/** The usual side for a team sport, or null when the sport has no team sheet (combat, board…). */
export function usualSide(sport?: string | null, rulesSheet?: Record<string, unknown> | null): { onField: number; bench: number } | null {
  // Netball scores like basketball but fields seven.
  if (sport?.trim().toLowerCase() === 'netball') return { onField: 7, bench: 5 };
  const key = canonicalTeamSport(sport);
  const usual = key ? USUAL[key] ?? null : null;
  // A format can field a different side (five-a-side hockey): its rules sheet wins.
  const onField = Number(rulesSheet?.playersOnField);
  if (!usual || !Number.isInteger(onField) || onField < 1) return usual;
  const bench = Number(rulesSheet?.bench);
  return { onField, bench: Number.isInteger(bench) && bench >= 0 ? bench : usual.bench };
}

export interface SheetPerson { id: string; name: string; role?: string | null; jersey?: number | null }

/** A shirt number: 0-999, the same range the profile and the team sheet accept. */
export const JERSEY_NUMBER_MIN = 0;
export const JERSEY_NUMBER_MAX = 999;
export const isJerseyNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= JERSEY_NUMBER_MIN && v <= JERSEY_NUMBER_MAX;

/** Each player's profile number, as the starting point for one match. */
export function defaultJerseys(squad: SheetPerson[]): Record<string, number> {
  return Object.fromEntries(squad.filter((p) => isJerseyNumber(p.jersey)).map((p) => [p.id, p.jersey as number]));
}

/** Numbers worn by more than one player on this side - a warning, never a block. */
export function duplicateJerseys(side: SideSheet): number[] {
  const named = new Set([...side.playing, ...side.bench]);
  const seen = new Map<number, number>();
  for (const [id, n] of Object.entries(side.jerseys ?? {})) if (named.has(id)) seen.set(n, (seen.get(n) ?? 0) + 1);
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
}

// Captain and vice first, then by shirt number, then by name - the order a team sheet is read in.
const ROLE_RANK: Record<string, number> = { captain: 0, vice_captain: 1 };
export function sheetOrder<P extends SheetPerson>(squad: P[]): P[] {
  return [...squad].sort((a, b) =>
    (ROLE_RANK[a.role ?? ''] ?? 2) - (ROLE_RANK[b.role ?? ''] ?? 2)
    || (a.jersey ?? Number.MAX_SAFE_INTEGER) - (b.jersey ?? Number.MAX_SAFE_INTEGER)
    || a.name.localeCompare(b.name));
}

/** The pre-filled sheet: the usual number playing, the usual bench after them, the rest out. */
export function defaultSideSheet(squad: SheetPerson[], usual: { onField: number; bench: number }): SideSheet {
  const ids = sheetOrder(squad).map((p) => p.id);
  return {
    playing: ids.slice(0, usual.onField),
    bench: ids.slice(usual.onField, usual.onField + usual.bench),
    jerseys: defaultJerseys(squad),
  };
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The stored sheet, or null when none has been confirmed for this match. */
export function readTeamSheet(liveState: unknown): TeamSheet | null {
  const raw = (liveState as { teamSheet?: any } | null)?.teamSheet;
  if (!raw || typeof raw !== 'object') return null;
  const side = (s: any): SideSheet => {
    const out: SideSheet = { playing: ids(s?.playing), bench: ids(s?.bench) };
    // Absent on sheets confirmed before shirt numbers existed - left absent, not emptied.
    if (s?.jerseys && typeof s.jerseys === 'object') {
      out.jerseys = Object.fromEntries(Object.entries(s.jerseys).filter((e): e is [string, number] => isJerseyNumber(e[1])));
    }
    return out;
  };
  return { A: side(raw.A), B: side(raw.B) };
}

/** The number each player wore in this match, from its team sheet. Empty with no sheet. */
export function matchJerseys(liveState: unknown): Map<string, number> {
  const sheet = readTeamSheet(liveState);
  return new Map(sheet ? [...Object.entries(sheet.A.jerseys ?? {}), ...Object.entries(sheet.B.jerseys ?? {})] : []);
}

/**
 * A substitution: `onId` comes off the bench and takes `offId`'s place on the field;
 * `offId` goes to the bench. Inferred when a substitute is credited with something,
 * so no separate substitution log is kept.
 */
export function substitute(sheet: SideSheet, onId: string, offId: string): SideSheet {
  const playing = sheet.playing.includes(offId)
    ? sheet.playing.map((id) => (id === offId ? onId : id))
    : [...sheet.playing.filter((id) => id !== onId), onId];
  const bench = [...sheet.bench.filter((id) => id !== onId && id !== offId), offId];
  return { ...sheet, playing: playing.filter((id, i) => playing.indexOf(id) === i), bench };
}

/**
 * Who the scorer may pick for one side: playing, then bench. With no sheet, the whole
 * squad, as before. Someone named on the sheet but since dropped from the squad is left out.
 */
export function matchdaySquad<P extends { id: string }>(squad: P[], sheet: SideSheet | null | undefined): P[] {
  if (!sheet) return squad;
  const byId = new Map(squad.map((p) => [p.id, p]));
  return [...sheet.playing, ...sheet.bench].map((id) => byId.get(id)).filter((p): p is P => !!p);
}
