import { Router } from 'express';
import { z } from 'zod';
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  catalogSettings,
  isTier,
  LIMITS,
  LIMIT_KEYS,
  minTierOf,
  PLAN_SOURCES,
  planSlots,
  PLANS,
  TIERS,
  TIER_LABEL,
  type CapabilityKey,
  type Ladder,
  type Tier,
} from '@semp/entitlements';
import {
  invalidateCatalog,
  readCatalog,
  sanitiseMinTiers,
  sanitisePlan,
  sanitiseSettings,
} from '@semp/entitlements/server';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { adminSetPlan, liveSubscription, type Holder } from './subscription.service.js';
import { eventPlanView } from './event-plan.js';
import { normaliseCode } from './coupons.js';
import { orgUsage } from './usage.js';

// The super-admin console for everything commercial:
//
//   catalogue   - each plan slot's name, prices, event-pass price, limits, copy;
//                 which plan includes each capability; platform plan settings
//   holders     - put any organisation, person or single event on any plan
//   add-ons     - the catalogue, and grants to organisations
//   coupons     - create, edit, deactivate
//
// Writes to the catalogue bump plan_catalog_settings.version and drop this
// instance's cache; other instances pick the change up within the cache TTL
// (one minute). Nothing here is reachable by anyone but a super admin.

const tierEnum = z.enum(TIERS as unknown as [Tier, ...Tier[]]);
const ladderEnum = z.enum(['org', 'personal']);

const holderPlanSchema = z.object({
  plan: tierEnum,
  /** ISO date; omitted/null = until changed. */
  until: z.coerce.date().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const eventPlanSchema = z.object({
  /** null puts the event back on its host organisation's plan. */
  plan: tierEnum.nullable(),
  note: z.string().max(500).nullable().optional(),
});

const addonSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  unit: z.enum(['month', 'event', 'pack']).optional(),
  price_paise: z.number().int().min(0).nullable().optional(),
  status: z.enum(['available', 'coming_soon', 'hidden']).optional(),
  included_from: tierEnum.nullable().optional(),
  sort: z.number().int().optional(),
});
const newAddonSchema = addonSchema.extend({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, 'lowercase letters, digits and _'),
  name: z.string().min(1).max(80),
});

const grantAddonSchema = z.object({
  addon_key: z.string().min(1),
  quantity: z.number().int().min(1).max(10_000).default(1),
  ends_at: z.coerce.date().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const couponFields = {
  description: z.string().max(300).optional(),
  kind: z.enum(['percent', 'flat']),
  /** percent: basis points (1500 = 15%); flat: paise. */
  value: z.number().int().min(1),
  ladder: ladderEnum.default('org'),
  tiers: z.array(tierEnum).nullable().optional(),
  periods: z.array(z.enum(['monthly', 'annual'])).nullable().optional(),
  valid_from: z.coerce.date().nullable().optional(),
  valid_until: z.coerce.date().nullable().optional(),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  active: z.boolean().optional(),
};
const couponSchema = z.object({ code: z.string().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/), ...couponFields })
  .refine((c) => c.kind !== 'percent' || c.value <= 10_000, { message: 'A percentage cannot exceed 100%', path: ['value'] });
const couponUpdateSchema = z.object(couponFields).partial()
  .refine((c) => c.kind !== 'percent' || c.value === undefined || c.value <= 10_000, { message: 'A percentage cannot exceed 100%', path: ['value'] });

const bigToNum = <T extends Record<string, unknown>>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])) as T;

export function makePlansAdminRouter(prisma: Prisma): Router {
  const router = Router();
  router.use(requireSuperAdmin);

  const bumpVersion = async (actorId: string, data: Record<string, unknown> = {}) => {
    await prisma.plan_catalog_settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data, updated_by: actorId },
      update: { ...data, version: { increment: 1 }, updated_at: new Date(), updated_by: actorId },
    });
    invalidateCatalog();
  };

  // ---- catalogue ---------------------------------------------------------

  /** Everything the console renders: each slot as configured AND its code default, so "reset" is visible. */
  router.get('/catalog', asyncHandler(async (_req, res) => {
    const stored = await readCatalog(prisma);
    const ladder = (l: Ladder) => planSlots(l).map((p) => ({
      ...p,
      overridden: !!stored.plans[l]?.[p.tier],
      defaults: PLANS[l][p.tier],
    }));
    res.json({
      version: stored.version,
      tiers: TIERS,
      tierLabels: TIER_LABEL,
      org: ladder('org'),
      personal: ladder('personal'),
      limits: LIMIT_KEYS.map((k) => ({ key: k, ...LIMITS[k] })),
      capabilities: CAPABILITY_KEYS.map((k) => ({
        key: k, ...CAPABILITIES[k], defaultMinTier: CAPABILITIES[k].minTier, minTier: minTierOf(k),
      })),
      settings: catalogSettings(),
      planSources: PLAN_SOURCES,
    });
  }));

  /** Save one slot. The body is a PlanOverride; only what is sent is stored. */
  router.put('/catalog/plans/:ladder/:tier', asyncHandler(async (req, res) => {
    const ladder = req.params.ladder as Ladder;
    const tier = req.params.tier;
    if ((ladder !== 'org' && ladder !== 'personal') || !isTier(tier)) throw new NotFoundError('Plan');
    const overrides = sanitisePlan(req.body);
    if (overrides.price && overrides.price.monthly !== null && overrides.price.annual !== null
        && overrides.price.annual > overrides.price.monthly * 12) {
      throw new BusinessRuleError('The annual price is more than twelve monthly payments.');
    }
    await prisma.plan_catalog.upsert({
      where: { ladder_tier: { ladder, tier } },
      create: { ladder, tier, overrides: overrides as object, updated_by: req.user!.id },
      update: { overrides: overrides as object, updated_at: new Date(), updated_by: req.user!.id },
    });
    await bumpVersion(req.user!.id);
    res.json({ ok: true, overrides });
  }));

  /** Drop a slot's overrides - back to the code default. */
  router.delete('/catalog/plans/:ladder/:tier', asyncHandler(async (req, res) => {
    const tier = req.params.tier;
    if (!isTier(tier)) throw new NotFoundError('Plan');
    await prisma.plan_catalog.deleteMany({ where: { ladder: req.params.ladder, tier } });
    await bumpVersion(req.user!.id);
    res.json({ ok: true });
  }));

  /**
   * Which plan includes each capability. Sent as the full map of overrides;
   * a capability set back to its code default is simply omitted. Monotonic by
   * construction - one minimum tier per capability can never grant low and
   * withdraw high.
   */
  router.put('/catalog/capabilities', asyncHandler(async (req, res) => {
    const minTiers = sanitiseMinTiers(req.body?.minTiers);
    for (const [k, t] of Object.entries(minTiers)) {
      if (CAPABILITIES[k as CapabilityKey].minTier === t) delete minTiers[k as CapabilityKey];
    }
    await bumpVersion(req.user!.id, { min_tiers: minTiers });
    res.json({ ok: true, minTiers });
  }));

  router.put('/catalog/settings', asyncHandler(async (req, res) => {
    const settings = sanitiseSettings(req.body);
    await bumpVersion(req.user!.id, { settings });
    res.json({ ok: true, settings: { ...catalogSettings(), ...settings } });
  }));

  // ---- holders -------------------------------------------------------------

  router.get('/orgs/:id/plan', asyncHandler(async (req, res) => {
    const org = await prisma.organizations.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, plan: true } });
    if (!org) throw new NotFoundError('Organisation');
    const holder: Holder = { ladder: 'org', organizationId: org.id };
    const subscription = await liveSubscription(prisma, holder);
    const [history, usage, addons] = await Promise.all([
      prisma.subscription_events.findMany({
        where: { subscriptions: { organization_id: org.id } },
        orderBy: { created_at: 'desc' }, take: 20,
      }),
      orgUsage(prisma, org.id, org.plan as Tier),
      prisma.org_addons.findMany({ where: { organization_id: org.id }, orderBy: { created_at: 'desc' }, include: { addons: { select: { name: true } } } }),
    ]);
    res.json({ organization: org, tier: org.plan, subscription, history, usage, addons });
  }));

  router.put('/orgs/:id/plan', validateBody(holderPlanSchema), asyncHandler(async (req, res) => {
    const org = await prisma.organizations.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!org) throw new NotFoundError('Organisation');
    res.json(await adminSetPlan(prisma, { ladder: 'org', organizationId: org.id }, req.body, req.user!.id));
  }));

  router.put('/users/:id/plan', validateBody(holderPlanSchema), asyncHandler(async (req, res) => {
    const user = await prisma.users.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw new NotFoundError('User');
    if (req.body.plan === 'starter') throw new BusinessRuleError('The personal ladder has no Starter plan.');
    res.json(await adminSetPlan(prisma, { ladder: 'personal', userId: user.id }, req.body, req.user!.id));
  }));

  router.get('/championships/:id/plan', asyncHandler(async (req, res) => {
    const c = await prisma.championships.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, host_organization_id: true } });
    if (!c) throw new NotFoundError('Championship');
    res.json({ championship: c, plan: await eventPlanView(prisma, c.id) });
  }));

  /**
   * Put ONE event on a plan, independent of its host (source 'admin'), or hand
   * it back to the host's plan (plan: null -> source 'org', stamped with the
   * host's current tier). Clears any grace clock either way.
   */
  router.put('/championships/:id/plan', validateBody(eventPlanSchema), asyncHandler(async (req, res) => {
    const c = await prisma.championships.findUnique({
      where: { id: req.params.id },
      select: { id: true, organizations: { select: { plan: true } } },
    });
    if (!c) throw new NotFoundError('Championship');
    const plan = req.body.plan as Tier | null;
    await prisma.championships.update({
      where: { id: c.id },
      data: plan
        ? { plan_tier: plan, plan_source: 'admin', plan_grace_until: null }
        : { plan_tier: (c.organizations?.plan as Tier | undefined) ?? 'free', plan_source: 'org', plan_grace_until: null },
    });
    res.json(await eventPlanView(prisma, c.id));
  }));

  // ---- add-ons -------------------------------------------------------------

  router.get('/addons', asyncHandler(async (_req, res) => {
    const rows = await prisma.addons.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }] });
    res.json(rows.map(bigToNum));
  }));

  router.post('/addons', validateBody(newAddonSchema), asyncHandler(async (req, res) => {
    const { price_paise, ...rest } = req.body;
    const row = await prisma.addons.create({ data: { ...rest, price_paise: price_paise == null ? null : BigInt(price_paise) } });
    res.status(201).json(bigToNum(row));
  }));

  router.patch('/addons/:key', validateBody(addonSchema), asyncHandler(async (req, res) => {
    const { price_paise, ...rest } = req.body;
    const row = await prisma.addons.update({
      where: { key: req.params.key },
      data: { ...rest, ...(price_paise !== undefined ? { price_paise: price_paise == null ? null : BigInt(price_paise) } : {}), updated_at: new Date() },
    });
    res.json(bigToNum(row));
  }));

  router.post('/orgs/:id/addons', validateBody(grantAddonSchema), asyncHandler(async (req, res) => {
    const addon = await prisma.addons.findUnique({ where: { key: req.body.addon_key }, select: { key: true, status: true } });
    if (!addon) throw new NotFoundError('Add-on');
    const row = await prisma.org_addons.create({
      data: {
        organization_id: req.params.id, addon_key: addon.key, quantity: req.body.quantity,
        ends_at: req.body.ends_at ?? null, note: req.body.note ?? null, granted_by: req.user!.id,
      },
    });
    res.status(201).json(row);
  }));

  router.delete('/orgs/:id/addons/:grantId', asyncHandler(async (req, res) => {
    const r = await prisma.org_addons.updateMany({
      where: { id: req.params.grantId, organization_id: req.params.id, status: 'active' },
      data: { status: 'cancelled', ends_at: new Date() },
    });
    if (r.count === 0) throw new NotFoundError('Add-on grant');
    res.json({ ok: true });
  }));

  // ---- coupons -------------------------------------------------------------

  router.get('/coupons', asyncHandler(async (_req, res) => {
    res.json(await prisma.coupons.findMany({ orderBy: { created_at: 'desc' }, take: 200 }));
  }));

  router.post('/coupons', validateBody(couponSchema), asyncHandler(async (req, res) => {
    const code = normaliseCode(req.body.code);
    const exists = await prisma.coupons.findUnique({ where: { code }, select: { code: true } });
    if (exists) throw new BusinessRuleError('A coupon with that code already exists.');
    const row = await prisma.coupons.create({
      data: { ...req.body, code, tiers: req.body.tiers ?? [], periods: req.body.periods ?? [], created_by: req.user!.id },
    });
    res.status(201).json(row);
  }));

  router.patch('/coupons/:code', validateBody(couponUpdateSchema), asyncHandler(async (req, res) => {
    const data = { ...req.body } as Record<string, unknown>;
    if ('tiers' in data) data.tiers = data.tiers ?? [];
    if ('periods' in data) data.periods = data.periods ?? [];
    const row = await prisma.coupons.update({ where: { code: normaliseCode(req.params.code) }, data });
    res.json(row);
  }));

  return router;
}
