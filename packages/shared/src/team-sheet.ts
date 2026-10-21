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

export interface SideSheet { playing: string[]; bench: string[] }
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
  'kho-kho': { onField: 9, bench: 3 },
  frisbee: { onField: 7, bench: 7 },
  'tug of war': { onField: 8, bench: 2 },
};

/** The usual side for a team sport, or null when the sport has no team sheet (combat, board…). */
export function usualSide(sport?: string | null): { onField: number; bench: number } | null {
  // Netball scores like basketball but fields seven.
  if (sport?.trim().toLowerCase() === 'netball') return { onField: 7, bench: 5 };
  const key = canonicalTeamSport(sport);
  return key ? USUAL[key] ?? null : null;
}

export interface SheetPerson { id: string; name: string; role?: string | null; jersey?: number | null }

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
  return { playing: ids.slice(0, usual.onField), bench: ids.slice(usual.onField, usual.onField + usual.bench) };
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The stored sheet, or null when none has been confirmed for this match. */
export function readTeamSheet(liveState: unknown): TeamSheet | null {
  const raw = (liveState as { teamSheet?: any } | null)?.teamSheet;
  if (!raw || typeof raw !== 'object') return null;
  const side = (s: any): SideSheet => ({ playing: ids(s?.playing), bench: ids(s?.bench) });
  return { A: side(raw.A), B: side(raw.B) };
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
  return { playing: playing.filter((id, i) => playing.indexOf(id) === i), bench };
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
