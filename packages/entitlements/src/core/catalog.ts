import type { CapabilityKey } from './registry.js';
import type { LimitKey } from './limits.js';
import type { Ladder, Tier } from './tiers.js';

// The editable layer over the catalogue.
//
// Everything a plan IS - its name, price, ceilings and which capabilities it
// includes - has a default written in code (plans.ts, registry.ts, limits.ts).
// The super-admin console edits an OVERLAY stored in `plan_catalog` /
// `plan_catalog_settings`, and every reader in this package resolves
// "overlay value, else code default". Two consequences worth keeping:
//
//   1. A missing or unreadable table degrades to the code defaults - the product
//      behaves exactly as it did before the console existed, never to "nothing
//      is allowed".
//   2. The four plan SLOTS (free/starter/pro/max) stay fixed, because the guard
//      compares them by rank and Postgres compares the enum by declaration
//      order. What a slot is called and what it costs is data; how many slots
//      there are is a migration.
//
// The overlay is process state. The API installs it from the database (with a
// short cache, see server/catalog.ts) and the web client installs the copy the
// API serves, so the guard and the lock icon read one definition.

/** Money in paise, integer. */
export type CatalogPaise = number;

export interface PlanOverride {
  name?: string;
  tagline?: string;
  price?: { monthly: CatalogPaise | null; annual: CatalogPaise | null };
  /** One-off price to lift a single event to this plan. null = not sold per event. */
  eventPass?: CatalogPaise | null;
  selfServe?: boolean;
  /** Shown on the plan page. The personal ladder does not offer `starter`. */
  offered?: boolean;
  /** Marked "Most chosen" on the plan page. */
  featured?: boolean;
  adds?: string[];
  limits?: Partial<Record<LimitKey, number | null>>;
}

export interface CatalogSettings {
  /** Plan every newly created organisation starts on. */
  defaultOrgPlan: Tier;
  /**
   * Tournament formats available WITHOUT the advanced_formats capability,
   * matched case-insensitively against tournament_formats.name. Rankings stays
   * in by default so a free swimming or athletics event can still run.
   */
  defaultFormats: string[];
  /** Days a running event keeps working after its organisation's plan drops below it. */
  graceDays: number;
}

export const DEFAULT_SETTINGS: CatalogSettings = {
  defaultOrgPlan: 'pro',
  defaultFormats: ['Knockout', 'Rankings'],
  graceDays: 3,
};

export interface CatalogOverlay {
  /** Changes whenever the console saves - lets a cache tell stale from fresh. */
  version: string;
  plans: Partial<Record<Ladder, Partial<Record<Tier, PlanOverride>>>>;
  /** Lowest plan that includes each capability, where the console moved it. */
  minTiers: Partial<Record<CapabilityKey, Tier>>;
  settings: Partial<CatalogSettings>;
}

export const EMPTY_OVERLAY: CatalogOverlay = { version: 'code', plans: {}, minTiers: {}, settings: {} };

let current: CatalogOverlay = EMPTY_OVERLAY;

/** Replace the active overlay. Atomic swap - a reader never sees half of one. */
export function installCatalog(overlay: CatalogOverlay | null | undefined): void {
  current = overlay ?? EMPTY_OVERLAY;
}

export function activeCatalog(): CatalogOverlay {
  return current;
}

export function catalogSettings(): CatalogSettings {
  return { ...DEFAULT_SETTINGS, ...current.settings };
}

/** Is this format name usable without advanced_formats? */
export function isDefaultFormat(formatName: string | null | undefined): boolean {
  if (!formatName) return true;
  const n = formatName.trim().toLowerCase();
  return catalogSettings().defaultFormats.some((f) => f.trim().toLowerCase() === n);
}
