// A championship's host cities. The list is `championships.host_cities`; the old
// `venue` text column is kept filled with the same cities joined, so every screen
// that already shows "Mumbai · 15 Oct" keeps working unchanged.

/** Most cities one championship can list. */
export const HOST_CITIES_MAX = 20;

/** Trimmed, blanks dropped, duplicates ("mumbai" / "Mumbai") removed - first spelling kept. */
export function normaliseCities(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const city = raw.replace(/\s+/g, ' ').trim();
    const key = city.toLowerCase();
    if (!city || seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

/** The cities as one line, for the legacy `venue` column and for display: "Mumbai, Pune". */
export const citiesLabel = (list: readonly string[]): string => list.join(', ');

/** A championship's cities: the list, or a pre-list championship's single `venue`. */
export const hostCitiesFor = (c: { host_cities?: readonly string[] | null; venue?: string | null }): string[] =>
  c.host_cities?.length ? [...c.host_cities] : c.venue ? [c.venue] : [];

/** For a tight row: "Mumbai, Pune +5". The full list belongs in a tooltip. */
export function citiesShort(list: readonly string[], max = 2): string {
  return list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ');
}
