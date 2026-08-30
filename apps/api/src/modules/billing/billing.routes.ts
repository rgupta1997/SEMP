import { Router, type RequestHandler } from 'express';
import {
  billingContactSchema,
  PLAN_PERIODS,
  PLAN_TIERS,
  requestUpgradeSchema,
  scheduleDowngradeSchema,
  subscribeSchema,
} from '@semp/shared';
import { notify } from '@semp/notifications/server/notify.js';
import type { NotificationTypeKey } from '@semp/notifications/core/registry.js';
import {
  CAPABILITIES,
  capabilitiesOn,
  GST_RATE_BP,
  LIMITS,
  planFor,
  planLadder,
  priceOf,
  withGst,
  type BillingPeriod,
  type CapabilityKey,
  type Tier,
} from '@semp/entitlements';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { serialiseInvoice } from './invoice.js';
import { orgUsage } from './usage.js';
import {
  applyDuePlanChanges,
  cancelScheduledDowngrade,
  liveSubscription,
  resolvedTier,
  scheduleDowngrade,
  subscribe,
  type Holder,
} from './subscription.service.js';

// Buying a plan, and everything that reads back what was bought.
//
// Two ladders, two sets of routes, one service underneath. `/billing/org/:orgId`
// is the institution's subscription and is gated on `billing.manage`;
// `/billing/me` is a person's own and is gated on being them, which needs no
// permission at all. The pairing is deliberate rather than one generic route
// with a holder in the body - the two have genuinely different authorisation,
// and a single route would have had to decide which rule applied from a field
// the caller controls.
//
// There is no payment step. Subscribing writes the subscription, issues the
// invoice and grants the tier in one transaction. Wiring a gateway later moves
// only WHO calls `subscribe()` - the route becomes an intent, and the webhook
// calls the service - so nothing downstream of it has to change.

// The wire vocabulary in @semp/shared is a restatement of the entitlement one.
// These two assignments are the check that it stays a restatement: if either
// list drifts, this file stops compiling, which is the earliest and cheapest
// place for that to be noticed.
const _tiersAgree: readonly Tier[] = PLAN_TIERS;
const _periodsAgree: readonly BillingPeriod[] = PLAN_PERIODS;
void _tiersAgree;
void _periodsAgree;

export function makeBillingRouter(prisma: Prisma): Router {
  const router = Router();

  // ---- who may act -------------------------------------------------------

  /**
   * Buying is a separate question from administering.
   *
   * A Sports Admin runs the sport and cannot commit the institution to a spend;
   * a Billing Admin can do nothing else. That split is already in the permission
   * catalogue as `billing.manage`, so this reads it rather than inventing a
   * second rule - and falls back to owner/admin membership so an institution
   * that has never configured a role still has somebody who can pay.
   */
  const requireBilling: RequestHandler = asyncHandler(async (req, _res, next) => {
    const organizationId = req.params.orgId;
    const allowed = await can(prisma, 'billing.manage', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: {
          user_id: req.user!.id, organization_id: organizationId,
          status: 'active', role: { in: ['owner', 'admin'] },
        },
        select: { id: true },
      })),
    });
    if (!allowed) {
      throw new ForbiddenError('Only an owner or billing admin can change this institution’s plan.');
    }
    next();
  });

  /** Reading the plan needs only membership - everybody should know what they are on. */
  const requireMember: RequestHandler = asyncHandler(async (req, _res, next) => {
    if (req.user!.isSuperAdmin) return next();
    const member = await prisma.organization_members.findFirst({
      where: { user_id: req.user!.id, organization_id: req.params.orgId, status: 'active' },
      select: { id: true },
    });
    if (!member) throw new ForbiddenError('You are not a member of this institution.');
    next();
  });

  // ---- the catalogue -----------------------------------------------------

  /**
   * Both ladders, priced, with what each plan includes.
   *
   * Served rather than bundled into the client so a price change is a deploy of
   * one thing rather than two, and so the figure the checkout totals is the same
   * figure the invoice is written from - the client never computes a price.
   */
  router.get('/plans', asyncHandler(async (_req, res) => {
    const ladder = (l: 'org' | 'personal') => planLadder(l).map((plan) => ({
      tier: plan.tier,
      name: plan.name,
      tagline: plan.tagline,
      selfServe: plan.selfServe,
      price: plan.price,
      adds: plan.adds,
      limits: plan.limits,
      capabilities: capabilitiesOn(l, plan.tier).map((k) => ({
        key: k, label: CAPABILITIES[k].label, surface: CAPABILITIES[k].surface,
      })),
    }));
    res.json({
      org: ladder('org'),
      personal: ladder('personal'),
      // So the client can label a meter without a second registry.
      limits: LIMITS,
      taxRateBp: GST_RATE_BP,
    });
  }));

  /** What a purchase would cost, tax included. The checkout screen's only sum. */
  router.get('/quote', asyncHandler(async (req, res) => {
    const ladder = req.query.ladder === 'personal' ? 'personal' : 'org';
    const tier = String(req.query.plan ?? '') as Tier;
    const period = (req.query.period === 'annual' ? 'annual' : 'monthly') as BillingPeriod;
    if (!(PLAN_TIERS as readonly string[]).includes(tier)) throw new NotFoundError('Plan');

    const plan = planFor(ladder, tier);
    const amount = priceOf(plan, period);
    if (amount === null) {
      // Enterprise. Answered rather than refused, so the client can render the
      // "talk to us" state from the same call it would have priced.
      res.json({ ladder, plan: tier, period, selfServe: false, quote: null });
      return;
    }
    res.json({ ladder, plan: tier, period, selfServe: plan.selfServe, quote: withGst(amount) });
  }));

  // ---- the organisation ladder ------------------------------------------

  router.get('/org/:orgId', requireMember, asyncHandler(async (req, res) => {
    const organizationId = req.params.orgId;
    const holder: Holder = { ladder: 'org', organizationId };

    // A scheduled change that came due while nobody was looking lands here, on
    // the read - see the note on applyDuePlanChanges for why there is no timer.
    await applyDuePlanChanges(prisma, { organizationId });

    const org = await prisma.organizations.findUnique({
      where: { id: organizationId },
      select: {
        id: true, name: true, plan: true,
        billing_name: true, billing_email: true, billing_phone: true,
        billing_address: true, billing_gstin: true, billing_state_code: true,
      },
    });
    if (!org) throw new NotFoundError('Organisation');

    // The subscription first, because the history hangs off its id. Everything
    // that does not depend on it then goes out together.
    const subscription = await liveSubscription(prisma, holder);

    const [usage, invoices, history, mayBuy] = await Promise.all([
      orgUsage(prisma, organizationId, org.plan as Tier),
      prisma.invoices.findMany({
        where: { organization_id: organizationId },
        orderBy: { issued_at: 'desc' },
        take: 24,
      }),
      subscription
        ? prisma.subscription_events.findMany({
            where: { subscription_id: subscription.id },
            orderBy: { created_at: 'desc' },
            take: 12,
          })
        : Promise.resolve([]),
      can(prisma, 'billing.manage', {
        user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
        scope: { organizationId },
        fallback: async () => !!(await prisma.organization_members.findFirst({
          where: {
            user_id: req.user!.id, organization_id: organizationId,
            status: 'active', role: { in: ['owner', 'admin'] },
          },
          select: { id: true },
        })),
      }),
    ]);

    res.json({
      ladder: 'org',
      tier: org.plan,
      subscription,
      usage,
      invoices: invoices.map(serialiseInvoice),
      history,
      contact: {
        billing_name: org.billing_name, billing_email: org.billing_email,
        billing_phone: org.billing_phone, billing_address: org.billing_address,
        billing_gstin: org.billing_gstin, billing_state_code: org.billing_state_code,
      },
      // The client renders Subscribe against this, and the server enforces it
      // again on the write. Both, because a hidden button is a courtesy and the
      // guard is the boundary.
      mayBuy,
    });
  }));

  router.post('/org/:orgId/subscribe', requireBilling, validateBody(subscribeSchema), asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'org', organizationId: req.params.orgId };
    const result = await subscribe(prisma, holder, req.body, req.user!.id);
    await announcePlanChange(prisma, holder, {
      type: 'plan_changed',
      from: result.from, to: result.to, actorId: req.user!.id,
    });
    res.status(201).json(result);
  }));

  router.post('/org/:orgId/schedule-downgrade', requireBilling, validateBody(scheduleDowngradeSchema), asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'org', organizationId: req.params.orgId };
    const before = await resolvedTier(prisma, holder);
    const row = await scheduleDowngrade(prisma, holder, req.body, req.user!.id);
    await announcePlanChange(prisma, holder, {
      type: 'plan_downgrade_scheduled',
      from: before, to: req.body.plan, actorId: req.user!.id,
      effectiveAt: row.pending_effective_at,
    });
    res.json(row);
  }));

  router.post('/org/:orgId/cancel-scheduled', requireBilling, asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'org', organizationId: req.params.orgId };
    res.json(await cancelScheduledDowngrade(prisma, holder, req.user!.id));
  }));

  router.patch('/org/:orgId/contact', requireBilling, validateBody(billingContactSchema), asyncHandler(async (req, res) => {
    const updated = await prisma.organizations.update({
      where: { id: req.params.orgId },
      data: req.body,
      select: {
        billing_name: true, billing_email: true, billing_phone: true,
        billing_address: true, billing_gstin: true, billing_state_code: true,
      },
    });
    res.json(updated);
  }));

  /**
   * Asking somebody who can buy to buy.
   *
   * The wall a Sports Admin hits is otherwise a dead end: they can see the
   * capability, they cannot purchase it, and there is nothing in the product
   * connecting them to the person who can. Any active member may send one, and
   * it carries the capability they were blocked on.
   */
  router.post('/org/:orgId/request-upgrade', requireMember, validateBody(requestUpgradeSchema), asyncHandler(async (req, res) => {
    const organizationId = req.params.orgId;
    const [org, me] = await Promise.all([
      prisma.organizations.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.users.findUnique({ where: { id: req.user!.id }, select: { name: true } }),
    ]);
    if (!org) throw new NotFoundError('Organisation');

    const key = req.body.capability as CapabilityKey | undefined;
    await notify(prisma as never, {
      type: 'plan_upgrade_requested',
      organizationId,
      senderId: req.user!.id,
      data: {
        who: me?.name ?? 'Somebody',
        organizationName: org.name,
        // The capability's LABEL, not its key: this is a message to a person.
        capability: key && CAPABILITIES[key] ? CAPABILITIES[key].label : null,
        note: req.body.note ?? null,
      },
    });
    res.status(201).json({ ok: true });
  }));

  // ---- the personal ladder ----------------------------------------------

  router.get('/me', asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'personal', userId: req.user!.id };
    await applyDuePlanChanges(prisma, { userId: req.user!.id });

    const [tier, subscription, invoices] = await Promise.all([
      resolvedTier(prisma, holder),
      liveSubscription(prisma, holder),
      prisma.invoices.findMany({
        where: { user_id: req.user!.id },
        orderBy: { issued_at: 'desc' },
        take: 24,
      }),
    ]);

    res.json({
      ladder: 'personal',
      tier,
      subscription,
      // The personal plans set no ceilings, so there is nothing to meter. Sent
      // as an empty list rather than omitted, so the client renders one shape.
      usage: [],
      invoices: invoices.map(serialiseInvoice),
      mayBuy: true,
    });
  }));

  router.post('/me/subscribe', validateBody(subscribeSchema), asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'personal', userId: req.user!.id };
    const result = await subscribe(prisma, holder, req.body, req.user!.id);
    res.status(201).json(result);
  }));

  router.post('/me/schedule-downgrade', validateBody(scheduleDowngradeSchema), asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'personal', userId: req.user!.id };
    res.json(await scheduleDowngrade(prisma, holder, req.body, req.user!.id));
  }));

  router.post('/me/cancel-scheduled', asyncHandler(async (req, res) => {
    const holder: Holder = { ladder: 'personal', userId: req.user!.id };
    res.json(await cancelScheduledDowngrade(prisma, holder, req.user!.id));
  }));

  // ---- one invoice -------------------------------------------------------

  /**
   * The buyer may read their own. For an institution's invoice that means
   * `billing.manage`, not membership: what the institution spends is not
   * everybody's business, and the reading rule has to match the buying one.
   */
  router.get('/invoices/:id', asyncHandler(async (req, res) => {
    const inv = await prisma.invoices.findUnique({ where: { id: req.params.id } });
    if (!inv) throw new NotFoundError('Invoice');

    if (inv.user_id) {
      if (inv.user_id !== req.user!.id && !req.user!.isSuperAdmin) throw new NotFoundError('Invoice');
    } else if (inv.organization_id) {
      const allowed = req.user!.isSuperAdmin || await can(prisma, 'billing.manage', {
        user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
        scope: { organizationId: inv.organization_id },
        fallback: async () => !!(await prisma.organization_members.findFirst({
          where: {
            user_id: req.user!.id, organization_id: inv.organization_id!,
            status: 'active', role: { in: ['owner', 'admin'] },
          },
          select: { id: true },
        })),
      });
      // Not-found rather than forbidden: whether a given invoice exists is
      // itself information about somebody else's account.
      if (!allowed) throw new NotFoundError('Invoice');
    }

    res.json(serialiseInvoice(inv));
  }));

  // ---- the safety net ----------------------------------------------------

  /**
   * Land every due change across the platform.
   *
   * The lazy sweep on the read paths covers anybody who opens the product. This
   * covers the account that does not - a lapsed institution whose scheduled
   * downgrade would otherwise sit unapplied because nobody signed in. Super-admin
   * only, and safe to call as often as you like: it claims each row conditionally
   * and reports only what it actually moved.
   */
  router.post('/sweep', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const applied = await applyDuePlanChanges(prisma);
    for (const change of applied) {
      await announcePlanChange(
        prisma,
        change.ladder === 'org'
          ? { ladder: 'org', organizationId: change.organizationId! }
          : { ladder: 'personal', userId: change.userId! },
        { type: 'plan_downgrade_applied', from: change.from, to: change.to, actorId: null },
      );
    }
    res.json({ applied });
  }));

  return router;
}

/**
 * Tell the people who need to know.
 *
 * Only the organisation ladder is announced. A person who changed their own
 * plan already knows - a notification telling them what they just did is noise,
 * and the product has enough of that. An institution is different: the plan is
 * shared, and somebody other than the buyer will notice the capability move.
 *
 * Failures are swallowed. A notification that cannot be delivered must not undo
 * a purchase that has already been granted and invoiced.
 */
async function announcePlanChange(
  prisma: Prisma,
  holder: Holder,
  input: { type: NotificationTypeKey; from: Tier; to: Tier; actorId: string | null; effectiveAt?: Date | null },
): Promise<void> {
  if (holder.ladder !== 'org') return;
  try {
    const org = await prisma.organizations.findUnique({
      where: { id: holder.organizationId },
      select: { name: true },
    });
    await notify(prisma as never, {
      type: input.type,
      organizationId: holder.organizationId,
      senderId: input.actorId,
      data: {
        organizationName: org?.name ?? 'your institution',
        // The plan NAMES, from the ladder that governs this holder - "Enterprise",
        // not "max". The billing surfaces are the one place naming a plan is right.
        from: planFor('org', input.from).name,
        to: planFor('org', input.to).name,
        effectiveAt: input.effectiveAt ? input.effectiveAt.toISOString() : null,
      },
    });
  } catch {
    // deliberately ignored - see above
  }
}
