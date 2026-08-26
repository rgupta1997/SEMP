// Where a competition is, for the Discover region filter (FR-DIS-3, J3-E4-S2).
//
// The map is deliberately partial. It covers the countries this product plausibly
// runs in and resolves everything else to null - which the UI groups as
// "Unspecified" rather than hiding, because a filter that silently drops rows teaches
// people not to trust the filter. Adding a country here is a one-line change; getting
// a wrong region because we guessed from a string is not recoverable by the user.

export const REGIONS = ['asia', 'europe', 'americas', 'africa', 'oceania'] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  asia: 'Asia',
  europe: 'Europe',
  americas: 'Americas',
  africa: 'Africa',
  oceania: 'Oceania',
};

// Country name -> region. Keys are compared case-insensitively and trimmed.
const COUNTRY_REGION: Record<string, Region> = {
  // Asia - where the product actually operates today
  india: 'asia', 'sri lanka': 'asia', nepal: 'asia', bangladesh: 'asia', pakistan: 'asia',
  bhutan: 'asia', maldives: 'asia', singapore: 'asia', malaysia: 'asia', indonesia: 'asia',
  thailand: 'asia', vietnam: 'asia', philippines: 'asia', japan: 'asia', china: 'asia',
  'south korea': 'asia', 'hong kong': 'asia', taiwan: 'asia',
  'united arab emirates': 'asia', uae: 'asia', qatar: 'asia', 'saudi arabia': 'asia',
  oman: 'asia', kuwait: 'asia', bahrain: 'asia', israel: 'asia', turkey: 'asia',

  // Europe
  'united kingdom': 'europe', uk: 'europe', england: 'europe', scotland: 'europe',
  wales: 'europe', ireland: 'europe', france: 'europe', germany: 'europe', spain: 'europe',
  portugal: 'europe', italy: 'europe', netherlands: 'europe', belgium: 'europe',
  switzerland: 'europe', austria: 'europe', sweden: 'europe', norway: 'europe',
  denmark: 'europe', finland: 'europe', poland: 'europe', greece: 'europe',

  // Americas
  'united states': 'americas', usa: 'americas', us: 'americas', canada: 'americas',
  mexico: 'americas', brazil: 'americas', argentina: 'americas', chile: 'americas',
  colombia: 'americas', peru: 'americas',

  // Africa
  'south africa': 'africa', kenya: 'africa', nigeria: 'africa', egypt: 'africa',
  ghana: 'africa', tanzania: 'africa', uganda: 'africa', morocco: 'africa',

  // Oceania
  australia: 'oceania', 'new zealand': 'oceania', fiji: 'oceania', 'papua new guinea': 'oceania',
};

// null = we don't know, which is a real answer and is shown as "Unspecified".
export function regionForCountry(country?: string | null): Region | null {
  if (!country) return null;
  return COUNTRY_REGION[country.trim().toLowerCase()] ?? null;
}

// The countries offered in a picker: the ones we can place, alphabetically, with
// their canonical capitalisation. Anything else can still be typed.
export const KNOWN_COUNTRIES: string[] = Object.keys(COUNTRY_REGION)
  .filter((c) => c.length > 3)
  .map((c) => c.replace(/\b[a-z]/g, (m) => m.toUpperCase()))
  .sort((a, b) => a.localeCompare(b));
