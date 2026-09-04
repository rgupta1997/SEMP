// The institution's internal shape, and what competes in a championship.
//
// Two ideas that are easy to conflate and must not be:
//
//   UNIT TYPE   - what an organisation is made of.      campus -> department
//   ENTRY LEVEL - what competes in one championship.    organization | campus | department
//
// They meet at the CONTINGENT: the thing that appears in a standings table. In an
// inter-organisation event a contingent is an organisation; in an intra-organisation
// event it is one of that organisation's units. Everything downstream - fixtures,
// standings, medal tallies, certificates - reads the contingent and never asks which
// of the two it came from.
//
// This lives in @semp/shared because the API enforces it and the web renders it, and
// two copies of a competition rule is how one of them silently goes stale.

// ---------------------------------------------------------------------------
// Unit types
// ---------------------------------------------------------------------------

/**
 * The two structural levels an organisation is divided into.
 *
 * Structural, not editorial: a college's "Batch" and a company's "Department" are
 * the same level and must stay one type, or every query that walks the tree needs
 * to know which vocabulary this tenant chose. The NOUN is a label - see
 * `unitLabels()` - and the label is the only part an institution gets to change.
 */
export const UNIT_TYPES = ['campus', 'department'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** A department hangs off a campus. A campus hangs off the organisation itself. */
export const UNIT_PARENT: Record<UnitType, UnitType | null> = {
  campus: null,
  department: 'campus',
};

export interface UnitLabels {
  campus: string;
  department: string;
}

export const DEFAULT_UNIT_LABELS: UnitLabels = { campus: 'Campus', department: 'Department' };

/**
 * Ready-made vocabularies. Offered as presets in the admin screen rather than
 * enforced - an institution that calls its campuses "Chapters" should be able to,
 * and the structure does not care.
 */
export const UNIT_LABEL_PRESETS: Array<{ key: string; label: string; labels: UnitLabels }> = [
  { key: 'college', label: 'College or university', labels: { campus: 'Campus', department: 'Batch' } },
  { key: 'company', label: 'Company', labels: { campus: 'Office', department: 'Department' } },
  { key: 'school', label: 'School', labels: { campus: 'Campus', department: 'Class' } },
  { key: 'club', label: 'Club or association', labels: { campus: 'Chapter', department: 'Squad' } },
];

/**
 * The nouns one organisation uses, read out of `organizations.settings`.
 *
 * Tolerant by design: settings is a free-form jsonb blob written by several
 * features, so a missing key, a wrong type or a whole missing object all fall back
 * to the default rather than throwing. A label is a display string - it is never
 * worth a 500.
 */
export function unitLabels(settings: unknown): UnitLabels {
  const raw = (settings as { unit_labels?: unknown } | null)?.unit_labels;
  if (!raw || typeof raw !== 'object') return DEFAULT_UNIT_LABELS;
  const l = raw as Partial<Record<UnitType, unknown>>;
  return {
    campus: typeof l.campus === 'string' && l.campus.trim() ? l.campus.trim() : DEFAULT_UNIT_LABELS.campus,
    department: typeof l.department === 'string' && l.department.trim() ? l.department.trim() : DEFAULT_UNIT_LABELS.department,
  };
}

// ---------------------------------------------------------------------------
// Entry level
// ---------------------------------------------------------------------------

/**
 * What competes in a championship.
 *
 * On the CHAMPIONSHIP, not the tournament. Standings aggregate into a
 * championship-wide scope, so an event that mixed levels would rank a campus
 * against a department in one table and the overall standing would mean nothing.
 * One event, one kind of competitor.
 */
export const ENTRY_LEVELS = ['organization', 'campus', 'department'] as const;
export type EntryLevel = (typeof ENTRY_LEVELS)[number];

export const ENTRY_LEVEL_META: Record<EntryLevel, {
  label: string;
  /** What the entrant list is called on screen. */
  entrantLabel: string;
  description: string;
  /** Does this level compete inside one organisation? */
  intra: boolean;
  /** The unit type that enters, or null when organisations enter directly. */
  unitType: UnitType | null;
}> = {
  organization: {
    label: 'Between organisations',
    entrantLabel: 'Organisations',
    description: 'Other institutions apply to take part. This is the open, inter-organisation event.',
    intra: false,
    unitType: null,
  },
  campus: {
    label: 'Between campuses',
    entrantLabel: 'Campuses',
    description: 'Your own campuses compete against each other. Nobody outside the organisation takes part.',
    intra: true,
    unitType: 'campus',
  },
  department: {
    label: 'Between departments',
    entrantLabel: 'Departments',
    description: 'Departments compete against each other, either within one campus or across the whole organisation.',
    intra: true,
    unitType: 'department',
  },
};

export const isIntraLevel = (level: EntryLevel): boolean => ENTRY_LEVEL_META[level].intra;

/** The unit type that enters at this level, or null for inter-organisation events. */
export const entrantUnitType = (level: EntryLevel): UnitType | null => ENTRY_LEVEL_META[level].unitType;

/**
 * English plural of a label an institution typed in.
 *
 * Needed because the labels are stored SINGULAR ("Campus", "Office", "Batch") and
 * almost every place they appear is a list of them. Naive `+ 's'` produced
 * "Campuss"; a naive singular-by-stripping-s produced "the campu they belong to".
 * Both shipped, and both are the kind of thing a customer reads as sloppiness.
 *
 * Deliberately small: -s/-x/-ch/-sh take -es, consonant+y takes -ies, everything
 * else takes -s. It handles Campus, Office, Batch, Class, Faculty and Chapter,
 * which covers the presets and almost anything an institution will type.
 */
export function pluralise(word: string): string {
  const w = word.trim();
  if (!w) return w;
  if (/(?:s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/**
 * The entrant noun this organisation would use for this level, SINGULAR -
 * "Campus", "Office", "Batch". Falls back to the structural label when the level
 * does not name units at all.
 *
 * Use `entrantLabelPlural` for headings and lists; the two are separate functions
 * because getting it wrong is invisible to the person who wrote the code and
 * obvious to everybody reading the screen.
 */
export function entrantLabel(level: EntryLevel, labels: UnitLabels = DEFAULT_UNIT_LABELS): string {
  const type = entrantUnitType(level);
  return type ? labels[type] : 'Organisation';
}

/** The same noun, plural - "Campuses", "Offices", "Organisations". */
export function entrantLabelPlural(level: EntryLevel, labels: UnitLabels = DEFAULT_UNIT_LABELS): string {
  return pluralise(entrantLabel(level, labels));
}

// ---------------------------------------------------------------------------
// Contingent
// ---------------------------------------------------------------------------

/**
 * The thing that competes.
 *
 * Both ids are carried, always. `unitId` is what distinguishes two entrants in an
 * intra event; `orgId` is what every existing foreign key, cascade and index is
 * built on, and it stays populated even when the unit is the meaningful half. A
 * shape that dropped one of them would either break referential integrity or make
 * "which institution does this row belong to" unanswerable.
 */
export interface ContingentRef {
  orgId: string;
  unitId: string | null;
}

/**
 * The single value a standings table, a fixture side or a medal tally groups by.
 *
 * This is THE rule the whole feature turns on, which is why it is three lines in
 * one place rather than an `?? ` scattered across the engine: the unit wins when
 * there is one, and the organisation is the fallback. Every caller that groups,
 * sorts, dedupes or compares contingents must go through here.
 */
export const contingentKey = (c: ContingentRef): string => c.unitId ?? c.orgId;

export const sameContingent = (a: ContingentRef | null, b: ContingentRef | null): boolean =>
  !!a && !!b && contingentKey(a) === contingentKey(b);

/** Build a ref from any row carrying the two columns. Null org id means "no side". */
export function contingentOf(row: { organization_id?: string | null; org_unit_id?: string | null } | null | undefined): ContingentRef | null {
  const orgId = row?.organization_id;
  if (!orgId) return null;
  return { orgId, unitId: row?.org_unit_id ?? null };
}

// ============================================================================
// COMPETITION TIER - the level a result was won at.
//
// A career record that adds every result together is a career record that lies. A
// hundred against another institution and a hundred in an inter-department game are
// not the same hundred, and cricket has said so for a century by keeping first-class,
// List A and T20 apart. The same distinction here is INTER (institution against
// institution) and INTRA (units of one institution against each other).
//
// Derived from `entry_level`, which already decides who competes - so the tier cannot
// drift away from the shape of the event that produced it, and no organiser has to
// remember to tag anything.
// ============================================================================

export const COMPETITION_TIERS = ['inter', 'intra'] as const;
export type CompetitionTier = (typeof COMPETITION_TIERS)[number];

/** Tier plus the rollup, which is the row a profile leads with. */
export const TIER_SCOPES = ['all', ...COMPETITION_TIERS] as const;
export type TierScope = (typeof TIER_SCOPES)[number];

export const TIER_META: Record<CompetitionTier, { label: string; short: string; hint: string }> = {
  inter: {
    label: 'Inter-institution',
    short: 'Inter',
    hint: 'Against other institutions - the record that travels with you.',
  },
  intra: {
    label: 'Intra-institution',
    short: 'Intra',
    hint: 'Between campuses, departments or houses of one institution.',
  },
};

/** Which tier a result belongs to, from the shape of the event that produced it. */
export function competitionTier(level: EntryLevel | string | null | undefined): CompetitionTier {
  // Unknown or absent reads as INTER, because that is what an ordinary championship
  // is and what every row written before this existed actually was. Guessing intra
  // would quietly demote real results.
  if (!level) return 'inter';
  return (ENTRY_LEVELS as readonly string[]).includes(level)
    && isIntraLevel(level as EntryLevel) ? 'intra' : 'inter';
}

export const tierLabel = (t: CompetitionTier): string => TIER_META[t].label;
