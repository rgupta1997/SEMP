import {
  catalogSettings,
  isUpgrade,
  planFor,
  priceOf,
  type BillingPeriod,
  type Ladder,
  type Tier,
} from '@semp/entitlements';
import type { subscription_status } from '@prisma/client';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { issueInvoice } from './invoice.js';
import { redeemCoupon } from './coupons.js';

// The subscription lifecycle. Four things happen to a plan and this module owns
// all four: it is bought, it is moved up, it is scheduled to move down, and the
// scheduled move eventually lands.
//
// The rule that shapes the whole file: `organizations.plan` / `users.personal_plan`
// are the RESOLVED tier - the value the entitlement guard reads on every gated
// request - and they are only ever written here, inside the same transaction that
// writes the subscription. Two writers would eventually disagree, and the way
// that failure presents is a customer who paid and cannot use what they bought.

export type Holder =
  | { ladder: 'org'; organizationId: string }
  | { ladder: 'personal'; userId: string };

export interface SubscriptionRow {
  id: string;
  ladder: string;
  organization_id: string | null;
  user_id: string | null;
  plan: Tier;
  period: BillingPeriod;
  status: subscription_status;
  current_period_start: Date;
  current_period_end: Date;
  pending_plan: Tier | null;
  pending_effective_at: Date | null;
  provider: string;
  created_at: Date;
}

/** The two columns the guard reads, addressed by ladder. */
function resolvedWhere(holder: Holder) {
  return holder.ladder === 'org'
    ? { organization_id: holder.organizationId }
    : { user_id: holder.userId };
}

/** A subscription is LIVE if it is running - whether or not a downgrade is queued. */
const LIVE: subscription_status[] = ['active', 'pending_downgrade'];

export async function liveSubscription(
  prisma: Prisma,
  holder: Holder,
): Promise<SubscriptionRow | null> {
  const row = await prisma.subscriptions.findFirst({
    where: { ...resolvedWhere(holder), status: { in: LIVE } },
    orderBy: { created_at: 'desc' },
  });
  return (row as unknown as SubscriptionRow) ?? null;
}

/** The tier as the guard sees it, read from the column it actually reads. */
export async function resolvedTier(prisma: Prisma, holder: Holder): Promise<Tier> {
  if (holder.ladder === 'org') {
    const o = await prisma.organizations.findUnique({
      where: { id: holder.organizationId },
      select: { plan: true },
    });
    if (!o) throw new NotFoundError('Organisation');
    return o.plan as Tier;
  }
  const u = await prisma.users.findUnique({
    where: { id: holder.userId },
    select: { personal_plan: true },
  });
  if (!u) throw new NotFoundError('User');
  return u.personal_plan as Tier;
}

/** One period forward from `from`. Calendar months, not 30 days. */
export function periodEnd(from: Date, period: BillingPeriod): Date {
  const d = new Date(from);
  // setMonth clamps: the 31st of a 30-day month lands on the 30th rather than
  // rolling into the next one, which is what a person expects a renewal date
  // to do.
  if (period === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

export interface SubscribeResult {
  subscription: SubscriptionRow;
  invoiceId: string | null;
  from: Tier;
  to: Tier;
}

/**
 * Buy a plan, or move up to a dearer one. Takes effect at once.
 *
 * Immediate is right for an UPGRADE and only for an upgrade: somebody who has
 * just paid to unlock Reports should not be told to come back in three weeks.
 * Moving DOWN goes through `scheduleDowngrade`, which honours the period already
 * paid for. Anything that is not a step up is refused here rather than silently
 * routed, because a downgrade billed as a purchase is a charge nobody authorised.
 *
 * There is no payment. `issueInvoice` records what WOULD have been charged and
 * marks it paid by provider 'none'; the tier is granted regardless. When a
 * gateway is wired, this function stops being called by the route and starts
 * being called by the webhook - the writes it performs do not change.
 */
export async function subscribe(
  prisma: Prisma,
  holder: Holder,
  input: { plan: Tier; period: BillingPeriod; coupon?: string | null },
  actorId: string,
): Promise<SubscribeResult> {
  const plan = planFor(holder.ladder, input.plan);

  if (!plan.selfServe) {
    throw new BusinessRuleError(
      `${plan.name} is arranged with us directly rather than bought here. Get in touch at play@sportagon.in and we will set it up.`,
    );
  }

  const from = await resolvedTier(prisma, holder);

  if (input.plan === from) {
    const live = await liveSubscription(prisma, holder);
    // Same tier, different cycle, is a real request - monthly to annual is how
    // most people take the discount. Same tier and same cycle is a no-op, and
    // charging for one would be indefensible.
    if (live && live.period === input.period) {
      throw new BusinessRuleError(`You are already on ${plan.name}, billed ${input.period}.`);
    }
  } else if (!isUpgrade(from, input.plan)) {
    throw new BusinessRuleError(
      `${plan.name} is a step down from your current plan. Schedule it instead - it will start when the period you have paid for ends.`,
    );
  }

  const now = new Date();
  const price = priceOf(plan, input.period) ?? 0;

  return prisma.$transaction(async (tx) => {
    // Whatever was running is superseded, not edited. Keeping the old row means
    // "what were they on last March?" stays answerable, which is the question an
    // invoice dispute always turns into.
    const previous = await tx.subscriptions.findFirst({
      where: { ...resolvedWhere(holder), status: { in: LIVE } },
      orderBy: { created_at: 'desc' },
    });
    if (previous) {
      await tx.subscriptions.update({
        where: { id: previous.id },
        data: { status: 'cancelled', cancelled_at: now, updated_at: now },
      });
    }

    const created = await tx.subscriptions.create({
      data: {
        ladder: holder.ladder,
        organization_id: holder.ladder === 'org' ? holder.organizationId : null,
        user_id: holder.ladder === 'personal' ? holder.userId : null,
        plan: input.plan,
        period: input.period,
        status: 'active',
        current_period_start: now,
        current_period_end: periodEnd(now, input.period),
        provider: 'none',
        created_by: actorId,
      },
    });

    await tx.subscription_events.create({
      data: {
        subscription_id: created.id,
        kind: previous ? 'upgraded' : 'subscribed',
        from_plan: from,
        to_plan: input.plan,
        actor_id: actorId,
        effective_at: now,
      },
    });

    await writeResolvedTier(tx, holder, input.plan);

    // A coupon is claimed INSIDE this transaction: if anything below fails the
    // redemption rolls back with it, so a failed purchase never burns a use.
    const discount = price > 0 && input.coupon
      ? await redeemCoupon(tx, { code: input.coupon, ladder: holder.ladder, plan: input.plan, period: input.period, price })
      : null;

    // The free plan is a real choice, not a purchase - it produces no document.
    const invoiceId = price > 0
      ? (await issueInvoice(tx, { subscriptionId: created.id, holder, plan: input.plan, period: input.period, amount: price, discount })).id
      : null;

    return {
      subscription: created as unknown as SubscriptionRow,
      invoiceId,
      from,
      to: input.plan,
    };
  });
}

// ---------------------------------------------------------------------------
// Moving down
// ---------------------------------------------------------------------------

/**
 * Queue a move down for the end of the period already paid for.
 *
 * Nothing changes today: status becomes `pending_downgrade`, the resolved tier
 * is left alone, and the guard keeps granting what was bought until the date
 * arrives. That is the whole point - a customer who cancels in week one of an
 * annual term keeps the year they paid for.
 *
 * Data created above the new line is never destroyed. When the change lands, the
 * capability goes and the surface renders its locked state over work that is
 * still there; re-subscribing brings the surface back with the data intact.
 */
export async function scheduleDowngrade(
  prisma: Prisma,
  holder: Holder,
  input: { plan: Tier; note?: string },
  actorId: string,
) {
  const live = await liveSubscription(prisma, holder);
  if (!live) {
    throw new BusinessRuleError('There is nothing to move down from - this account is already on the free plan.');
  }
  if (!isUpgrade(input.plan, live.plan)) {
    throw new BusinessRuleError('That is not a step down. To move up, subscribe to the plan instead.');
  }

  const now = new Date();
  const effective = live.current_period_end;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subscriptions.update({
      where: { id: live.id },
      data: {
        status: 'pending_downgrade',
        pending_plan: input.plan,
        pending_effective_at: effective,
        updated_at: now,
      },
    });
    await tx.subscription_events.create({
      data: {
        subscription_id: live.id,
        kind: 'downgrade_scheduled',
        from_plan: live.plan,
        to_plan: input.plan,
        actor_id: actorId,
        note: input.note ?? null,
        effective_at: effective,
      },
    });
    return updated as unknown as SubscriptionRow;
  });
}

/** Change of mind, before the scheduled change lands. */
export async function cancelScheduledDowngrade(prisma: Prisma, holder: Holder, actorId: string) {
  const live = await liveSubscription(prisma, holder);
  if (!live || live.status !== 'pending_downgrade') {
    throw new BusinessRuleError('There is no scheduled plan change to call off.');
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.subscriptions.update({
      where: { id: live.id },
      data: { status: 'active', pending_plan: null, pending_effective_at: null, updated_at: now },
    });
    await tx.subscription_events.create({
      data: {
        subscription_id: live.id,
        kind: 'downgrade_cancelled',
        from_plan: live.pending_plan,
        to_plan: live.plan,
        actor_id: actorId,
        effective_at: now,
      },
    });
    return updated as unknown as SubscriptionRow;
  });
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface AppliedChange {
  subscriptionId: string;
  ladder: Ladder;
  organizationId: string | null;
  userId: string | null;
  from: Tier;
  to: Tier;
}

/**
 * Land every plan change that has come due, and roll every renewal forward.
 *
 * This runs LAZILY rather than on a timer, because the API has no long-lived
 * process to hang a timer on - it is a Lambda behind an API Gateway, and a cron
 * would be a second deployable to keep alive. Instead it is called on the read
 * paths that would otherwise show a stale plan: the entitlement snapshot the
 * client fetches once per session, and the billing panel itself.
 *
 * `where` narrows it to one holder on those paths so a person's own request pays
 * only for their own row. Called with no scope - by the platform sweep endpoint -
 * it walks everything due, which is the safety net for an account nobody has
 * opened since its renewal date.
 *
 * Safe to call concurrently: each row is claimed by a conditional update, so a
 * second caller arriving at the same instant updates nothing and reports nothing.
 */
export async function applyDuePlanChanges(
  prisma: Prisma,
  scope?: { organizationId?: string; userId?: string },
): Promise<AppliedChange[]> {
  const now = new Date();

  const due = await prisma.subscriptions.findMany({
    where: {
      status: { in: LIVE },
      current_period_end: { lte: now },
      ...(scope?.organizationId ? { organization_id: scope.organizationId } : {}),
      ...(scope?.userId ? { user_id: scope.userId } : {}),
    },
    take: 500,
  });
  if (due.length === 0) return [];

  const applied: AppliedChange[] = [];

  for (const row of due as unknown as SubscriptionRow[]) {
    const holder: Holder = row.ladder === 'org'
      ? { ladder: 'org', organizationId: row.organization_id! }
      : { ladder: 'personal', userId: row.user_id! };

    // A pending downgrade lands. Anything else simply renews on the same plan -
    // there is no payment to fail, so a term that ends with nothing queued rolls
    // forward rather than dropping the customer to free.
    //
    // Everything the update needs to know is read into locals FIRST. What the row
    // held before the write decides the event kind and whether a tier actually
    // moved, and reading those back off `row` afterwards would make this correct
    // only for as long as the client hands back a detached copy.
    const fromPlan = row.plan;
    // Nullish rather than a `!== null` check: a column that has never been set
    // reads as undefined through some clients and null through others, and the
    // difference here decides whether a renewal is logged as a downgrade.
    const pendingPlan = row.pending_plan ?? null;
    const hadPendingDowngrade = pendingPlan !== null;
    const target = pendingPlan ?? fromPlan;
    const claimOn = { end: row.current_period_end, status: row.status };
    const nextStart = row.current_period_end;
    const nextEnd = periodEnd(nextStart, row.period);

    const claimed = await prisma.subscriptions.updateMany({
      // The claim: only a row still sitting on the period end we read gets
      // moved, so two concurrent sweeps cannot both advance it.
      where: { id: row.id, current_period_end: claimOn.end, status: claimOn.status },
      data: {
        plan: target,
        status: 'active',
        pending_plan: null,
        pending_effective_at: null,
        current_period_start: nextStart,
        current_period_end: nextEnd,
        updated_at: now,
      },
    });
    if (claimed.count === 0) continue;

    await prisma.subscription_events.create({
      data: {
        subscription_id: row.id,
        kind: hadPendingDowngrade ? 'downgrade_applied' : 'renewed',
        from_plan: fromPlan,
        to_plan: target,
        actor_id: null, // the sweep, not a person - see the column's comment
        effective_at: nextStart,
      },
    });

    if (target !== fromPlan) {
      await writeResolvedTier(prisma, holder, target);
      applied.push({
        subscriptionId: row.id,
        ladder: row.ladder as Ladder,
        organizationId: row.organization_id,
        userId: row.user_id,
        from: fromPlan,
        to: target,
      });
    }
  }

  return applied;
}

// ---------------------------------------------------------------------------

/**
 * The only write to the resolved tier in the product.
 *
 * Typed loosely because it is handed either the client or a transaction client,
 * and the two differ structurally in Prisma's types while offering the identical
 * update. Every caller here is already inside the transaction that wrote the
 * subscription, which is what keeps the two in step.
 */
async function writeResolvedTier(
  tx: { organizations: { update: Function }; users: { update: Function }; $executeRaw: Function },
  holder: Holder,
  plan: Tier,
): Promise<void> {
  if (holder.ladder === 'org') {
    await tx.organizations.update({ where: { id: holder.organizationId }, data: { plan } });
    await syncEventPlans(tx, holder.organizationId, plan);
  } else {
    await tx.users.update({ where: { id: holder.userId }, data: { personal_plan: plan } });
  }
}

/**
 * Keep the host's running events in step with its new tier (see
 * entitlements core/eventPlan.ts). Three bounded UPDATEs over one org's
 * events, each driven by idx_championships_host_org, inside the transaction
 * that changed the tier:
 *
 *   1. moving UP ratchets every running event up with it - so an event that
 *      used Pro features is protected by the grace window if the org later
 *      drops back;
 *   2. moving DOWN starts the grace clock (once) on every running event now
 *      booked above the org;
 *   3. events at or below the new tier lose any grace clock they had.
 *
 * Only `plan_source = 'org'` rows move: passes, admin-set and legacy events
 * are independent of the org by definition.
 */
async function syncEventPlans(tx: { $executeRaw: Function }, organizationId: string, plan: Tier): Promise<void> {
  const graceDays = catalogSettings().graceDays;
  await tx.$executeRaw`
    update championships
       set plan_tier = ${plan}::tier, plan_grace_until = null
     where host_organization_id = ${organizationId}::uuid
       and plan_source = 'org' and archived_at is null and status <> 'completed'
       and (plan_tier is null or plan_tier < ${plan}::tier)`;
  await tx.$executeRaw`
    update championships
       set plan_grace_until = now() + make_interval(days => ${graceDays}::int)
     where host_organization_id = ${organizationId}::uuid
       and plan_source = 'org' and archived_at is null and status <> 'completed'
       and plan_tier > ${plan}::tier and plan_grace_until is null`;
  await tx.$executeRaw`
    update championships
       set plan_grace_until = null
     where host_organization_id = ${organizationId}::uuid
       and plan_grace_until is not null and plan_tier <= ${plan}::tier`;
}

// ---------------------------------------------------------------------------
// Super-admin and default grants - no invoice, provider 'admin'
// ---------------------------------------------------------------------------

/** A date far enough out that a complimentary plan simply keeps renewing. */
function complimentaryEnd(from: Date): Date {
  return periodEnd(from, 'annual');
}

/**
 * Put a holder on a plan by decree, from the platform console.
 *
 * - No invoice and no price check: this is Sportagon staff granting, comping or
 *   correcting, not a purchase. `provider = 'admin'` marks it in history.
 * - Any direction, immediately - including down. (A CUSTOMER moving down waits
 *   for the period end; a super admin is the override.)
 * - `until` makes it temporary: the row is created as a pending downgrade to
 *   free landing on that date, so the existing lazy sweep ends it - no timer.
 * - Moving the org down starts the grace clock on its running events via
 *   writeResolvedTier, exactly like any other downgrade.
 */
export async function adminSetPlan(
  prisma: Prisma,
  holder: Holder,
  input: { plan: Tier; until?: Date | null; note?: string | null },
  actorId: string,
): Promise<{ from: Tier; to: Tier; subscription: SubscriptionRow | null }> {
  const from = await resolvedTier(prisma, holder);
  const now = new Date();
  if (input.until && input.until.getTime() <= now.getTime()) {
    throw new BusinessRuleError('The end date must be in the future.');
  }

  return prisma.$transaction(async (tx) => {
    const previous = await tx.subscriptions.findFirst({
      where: { ...resolvedWhere(holder), status: { in: LIVE } },
      orderBy: { created_at: 'desc' },
    });
    if (previous) {
      await tx.subscriptions.update({
        where: { id: previous.id },
        data: { status: 'cancelled', cancelled_at: now, updated_at: now },
      });
    }

    let created: SubscriptionRow | null = null;
    if (input.plan !== 'free') {
      const temporary = !!input.until;
      created = (await tx.subscriptions.create({
        data: {
          ladder: holder.ladder,
          organization_id: holder.ladder === 'org' ? holder.organizationId : null,
          user_id: holder.ladder === 'personal' ? holder.userId : null,
          plan: input.plan,
          period: 'annual',
          status: temporary ? 'pending_downgrade' : 'active',
          current_period_start: now,
          current_period_end: input.until ?? complimentaryEnd(now),
          pending_plan: temporary ? 'free' : null,
          pending_effective_at: input.until ?? null,
          provider: 'admin',
          created_by: actorId,
        },
      })) as unknown as SubscriptionRow;
    }

    // History hangs off a subscription; when moving to free with nothing
    // running before or after, there is nowhere to hang it - the org's own
    // `plan` column is then the whole record.
    const logOn = created?.id ?? previous?.id;
    if (logOn) {
      await tx.subscription_events.create({
        data: {
          subscription_id: logOn,
          kind: 'admin_set',
          from_plan: from,
          to_plan: input.plan,
          actor_id: actorId,
          note: input.note ?? null,
          effective_at: now,
        },
      });
    }

    await writeResolvedTier(tx, holder, input.plan);
    return { from, to: input.plan, subscription: created };
  });
}

/**
 * Every new organisation starts on the configured default plan (Pro unless the
 * console says otherwise). Called inside the transaction that creates the org,
 * so an org never exists without its plan.
 */
export async function grantDefaultOrgPlan(
  tx: {
    subscriptions: { create: Function };
    subscription_events: { create: Function };
    organizations: { update: Function };
    users: { update: Function };
    $executeRaw: Function;
  },
  organizationId: string,
  actorId: string | null,
): Promise<Tier> {
  const plan = catalogSettings().defaultOrgPlan;
  if (plan === 'free') return plan;
  const now = new Date();
  const sub = await tx.subscriptions.create({
    data: {
      ladder: 'org',
      organization_id: organizationId,
      plan,
      period: 'annual',
      status: 'active',
      current_period_start: now,
      current_period_end: complimentaryEnd(now),
      provider: 'admin',
      created_by: actorId,
    },
  });
  await tx.subscription_events.create({
    data: {
      subscription_id: sub.id,
      kind: 'default_grant',
      from_plan: 'free',
      to_plan: plan,
      actor_id: actorId,
      note: 'Default plan for a new organisation',
      effective_at: now,
    },
  });
  await tx.organizations.update({ where: { id: organizationId }, data: { plan } });
  return plan;
}
