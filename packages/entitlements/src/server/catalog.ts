import {
  CAPABILITIES,
  DEFAULT_SETTINGS,
  EMPTY_OVERLAY,
  installCatalog,
  isTier,
  LIMITS,
  type CatalogOverlay,
  type CatalogSettings,
  type CapabilityKey,
  type Ladder,
  type LimitKey,
  type PlanOverride,
  type Tier,
} from '../core/index.js';

// Loads the super-admin catalogue overlay from the database into the process.
//
// Cost model: one read of two tiny tables, at most once per CATALOG_TTL_MS per
// API instance, shared by every request in that window (concurrent callers await
// one in-flight load rather than each issuing it). On Lambda each warm container
// holds its own copy, so a console save reaches every instance within the TTL;
// the instance that served the save is refreshed at once via invalidateCatalog().
//
// Failure model: a failed or malformed read keeps whatever was installed last
// (the code defaults on a cold start) and retries soon. The catalogue can make
// the product MORE or LESS generous, so "fall back to code defaults" is the only
// answer that is never a surprise.

export const CATALOG_TTL_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 10_000;

export interface CatalogPrisma {
  plan_catalog: {
    findMany(args?: object): Promise<Array<{ ladder: string; tier: Tier; overrides: unknown }>>;
  };
  plan_catalog_settings: {
    findUnique(args: { where: { id: number } }): Promise<{ min_tiers: unknown; settings: unknown; version: bigint | number } | null>;
  };
}

let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** Forget the cache - the next ensureCatalog() reads the database. */
export function invalidateCatalog(): void {
  loadedAt = 0;
}

export async function ensureCatalog(prisma: CatalogPrisma): Promise<void> {
  if (Date.now() - loadedAt < CATALOG_TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      installCatalog(await readCatalog(prisma));
      loadedAt = Date.now();
    } catch {
      // Keep the previous overlay; try again shortly rather than on every request.
      loadedAt = Date.now() - CATALOG_TTL_MS + RETRY_AFTER_FAILURE_MS;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Read and sanitise. Exported for the console, which shows exactly what is stored. */
export async function readCatalog(prisma: CatalogPrisma): Promise<CatalogOverlay> {
  const [rows, settingsRow] = await Promise.all([
    prisma.plan_catalog.findMany(),
    prisma.plan_catalog_settings.findUnique({ where: { id: 1 } }),
  ]);
  const plans: CatalogOverlay['plans'] = {};
  for (const r of rows) {
    if ((r.ladder !== 'org' && r.ladder !== 'personal') || !isTier(r.tier)) continue;
    const ladder = r.ladder as Ladder;
    (plans[ladder] ??= {})[r.tier] = sanitisePlan(r.overrides);
  }
  return {
    version: String(settingsRow?.version ?? 'code'),
    plans,
    minTiers: sanitiseMinTiers(settingsRow?.min_tiers),
    settings: sanitiseSettings(settingsRow?.settings),
  };
}

// ---------------------------------------------------------------------------
// Sanitisers. The console validates on write too; these exist so a hand-edited
// row can never install a value the readers do not expect.
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const money = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;

export function sanitisePlan(raw: unknown): PlanOverride {
  if (!isObj(raw)) return {};
  const out: PlanOverride = {};
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, 40);
  if (typeof raw.tagline === 'string') out.tagline = raw.tagline.slice(0, 200);
  if (isObj(raw.price)) {
    const m = money(raw.price.monthly);
    const a = money(raw.price.annual);
    if (m !== undefined && a !== undefined) out.price = { monthly: m, annual: a };
  }
  const pass = money(raw.eventPass);
  if (pass !== undefined && 'eventPass' in raw) out.eventPass = pass;
  for (const k of ['selfServe', 'offered', 'featured'] as const) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean;
  }
  if (Array.isArray(raw.adds)) out.adds = raw.adds.filter((x): x is string => typeof x === 'string').slice(0, 20);
  if (isObj(raw.limits)) {
    const limits: Partial<Record<LimitKey, number | null>> = {};
    for (const [k, v] of Object.entries(raw.limits)) {
      if (!(k in LIMITS)) continue;
      if (v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)) limits[k as LimitKey] = v as number | null;
    }
    out.limits = limits;
  }
  return out;
}

export function sanitiseMinTiers(raw: unknown): Partial<Record<CapabilityKey, Tier>> {
  if (!isObj(raw)) return {};
  const out: Partial<Record<CapabilityKey, Tier>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k in CAPABILITIES && isTier(v)) out[k as CapabilityKey] = v;
  }
  return out;
}

export function sanitiseSettings(raw: unknown): Partial<CatalogSettings> {
  if (!isObj(raw)) return {};
  const out: Partial<CatalogSettings> = {};
  if (isTier(raw.defaultOrgPlan)) out.defaultOrgPlan = raw.defaultOrgPlan;
  if (Array.isArray(raw.defaultFormats)) {
    const f = raw.defaultFormats.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (f.length > 0) out.defaultFormats = f;
  }
  if (typeof raw.graceDays === 'number' && Number.isInteger(raw.graceDays) && raw.graceDays >= 0 && raw.graceDays <= 60) {
    out.graceDays = raw.graceDays;
  }
  return out;
}

/** For tests: return to the code defaults and forget the cache. */
export function resetCatalogForTests(): void {
  installCatalog(EMPTY_OVERLAY);
  loadedAt = 0;
  inflight = null;
}

export { DEFAULT_SETTINGS };
