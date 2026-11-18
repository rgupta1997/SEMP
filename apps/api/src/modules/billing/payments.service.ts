import { planFor, withGst, type BillingPeriod, type Tier } from '@semp/entitlements';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError } from '../../shared/errors.js';
import { couponProblem, discountFor, normaliseCode, type CouponRow } from './coupons.js';
import { createOrder, paymentsForOrder, publicKeyId } from './razorpay.js';
import {
  grantPurchase,
  preparePurchase,
  resolvedTier,
  subscribe,
  type Holder,
  type SubscribeResult,
} from './subscription.service.js';

// Paying for a plan through Razorpay.
//
//   checkout  -> price it, create the Razorpay order, record payment_orders 'created'
//   settle    -> claim 'created' -> 'paid' and grant, in ONE transaction
//
// Three things can call settle for the same order - the browser's signed
// callback, Razorpay's webhook, and the reconcile sweep - and they race. The
// claim is a conditional update inside the granting transaction, so exactly one
// of them grants; the others find the row already paid and return quietly. If
// granting throws, the claim rolls back with it and the row is then marked
// 'settle_failed' with the reason: money was taken and a human has to look.

export type CheckoutResult =
  | { mode: 'granted'; result: SubscribeResult }
  | {
      mode: 'razorpay';
      keyId: string;
      orderId: string;
      amount: number;
      currency: 'INR';
      description: string;
      prefill: { name: string; email: string; contact: string };
    };

/**
 * What this purchase will charge, priced exactly as the quote prices it: list,
 * minus coupon, plus GST. Runs the purchase rules first. The coupon is CHECKED
 * here and claimed at settlement.
 */
export async function priceCheckout(
  prisma: Prisma,
  holder: Holder,
  input: { plan: Tier; period: BillingPeriod; coupon?: string | null },
): Promise<{ price: number; coupon: { code: string; paise: number } | null; total: number }> {
  const { price } = await preparePurchase(prisma, holder, input);
  let coupon: { code: string; paise: number } | null = null;
  if (price > 0 && input.coupon) {
    const code = normaliseCode(input.coupon);
    const row = (await prisma.coupons.findUnique({ where: { code } })) as CouponRow | null;
    const problem = couponProblem(row, { ladder: holder.ladder, plan: input.plan, period: input.period });
    if (problem) throw new BusinessRuleError(problem);
    coupon = { code, paise: discountFor(row!, price) };
  }
  return { price, coupon, total: withGst(price - (coupon?.paise ?? 0)).total };
}

export async function startCheckout(
  prisma: Prisma,
  holder: Holder,
  input: { plan: Tier; period: BillingPeriod; coupon?: string | null },
  actorId: string,
): Promise<CheckoutResult> {
  const keyId = publicKeyId();
  if (!keyId) throw new BusinessRuleError('Online payment is not configured.');

  const { price, coupon, total } = await priceCheckout(prisma, holder, input);

  // Nothing to collect (free plan, 100% coupon): no gateway round trip.
  if (total <= 0) {
    return { mode: 'granted', result: await subscribe(prisma, holder, input, actorId) };
  }

  const plan = planFor(holder.ladder, input.plan);
  const description = `${plan.name} plan, billed ${input.period === 'annual' ? 'annually' : 'monthly'}`;
  const holderId = holder.ladder === 'org' ? holder.organizationId : holder.userId;

  const order = await createOrder({
    amount: total,
    receipt: `semp_${holderId.slice(0, 8)}_${Date.now().toString(36)}`,
    notes: { app: 'semp', ladder: holder.ladder, holder: holderId, plan: input.plan, period: input.period },
  });

  await prisma.payment_orders.create({
    data: {
      provider: 'razorpay',
      provider_order_id: order.id,
      kind: 'subscription',
      ladder: holder.ladder,
      organization_id: holder.ladder === 'org' ? holder.organizationId : null,
      user_id: holder.ladder === 'personal' ? holder.userId : null,
      plan: input.plan,
      period: input.period,
      list_price_paise: BigInt(price),
      discount_paise: BigInt(coupon?.paise ?? 0),
      coupon_code: coupon?.code ?? null,
      total_paise: BigInt(total),
      created_by: actorId,
    },
  });

  // Prefill from the person paying; for an institution, its billing email when set.
  const [me, org] = await Promise.all([
    prisma.users.findUnique({ where: { id: actorId }, select: { name: true, email: true, phone: true } }),
    holder.ladder === 'org'
      ? prisma.organizations.findUnique({ where: { id: holder.organizationId }, select: { billing_email: true } })
      : Promise.resolve(null),
  ]);

  return {
    mode: 'razorpay',
    keyId,
    orderId: order.id,
    amount: total,
    currency: 'INR',
    description,
    prefill: {
      name: me?.name ?? '',
      email: org?.billing_email ?? me?.email ?? '',
      contact: me?.phone ?? '',
    },
  };
}

export type SettleOutcome =
  | { state: 'settled'; holder: Holder; result: SubscribeResult }
  | { state: 'already_paid' }
  | { state: 'unknown_order' }
  | { state: 'failed'; error: string };

/**
 * Grant what an order paid for. Idempotent and race-safe (see the header).
 * `amountPaid` (paise), when the caller knows it, must match the order total.
 */
export async function settleOrder(
  prisma: Prisma,
  input: { orderId: string; paymentId: string; amountPaid?: number; source: 'checkout' | 'webhook' | 'reconcile' },
): Promise<SettleOutcome> {
  const order = await prisma.payment_orders.findUnique({
    where: { provider_provider_order_id: { provider: 'razorpay', provider_order_id: input.orderId } },
  });
  if (!order) return { state: 'unknown_order' };
  if (order.status === 'paid') return { state: 'already_paid' };
  if (order.status === 'settle_failed') return { state: 'failed', error: order.error ?? 'Settlement failed earlier.' };

  const holder: Holder = order.ladder === 'org'
    ? { ladder: 'org', organizationId: order.organization_id! }
    : { ladder: 'personal', userId: order.user_id! };

  const fail = async (error: string): Promise<SettleOutcome> => {
    console.error(`[payments] settle ${input.orderId} (${input.source}) failed: ${error}`);
    await prisma.payment_orders.updateMany({
      where: { id: order.id, status: { in: ['created', 'expired'] } },
      data: { status: 'settle_failed', provider_payment_id: input.paymentId, error, updated_at: new Date() },
    });
    return { state: 'failed', error };
  };

  if (input.amountPaid !== undefined && input.amountPaid !== Number(order.total_paise)) {
    return fail(`Paid ${input.amountPaid} paise against an order of ${order.total_paise} paise.`);
  }

  try {
    const result = await prisma.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma;
      const now = new Date();
      // The claim. An order paid after it was swept to 'expired' is still honoured.
      const claimed = await tx.payment_orders.updateMany({
        where: { id: order.id, status: { in: ['created', 'expired'] } },
        data: { status: 'paid', provider_payment_id: input.paymentId, paid_at: now, updated_at: now },
      });
      if (claimed.count === 0) return null;

      // No upgrade-rule re-check: the buyer was checked at checkout and has paid.
      // Whatever happened since (say a second tab bought the same plan), they get
      // what they paid for - a fresh period from today.
      const from = await resolvedTier(tx, holder);
      const listPrice = Number(order.list_price_paise);
      const granted = await grantPurchase(
        tx,
        holder,
        { plan: order.plan as Tier, period: order.period as BillingPeriod },
        order.created_by,
        {
          from,
          price: listPrice,
          payment: {
            provider: 'razorpay',
            ref: input.paymentId,
            listPrice,
            discount: order.coupon_code ? { code: order.coupon_code, paise: Number(order.discount_paise) } : null,
          },
        },
      );
      await tx.payment_orders.update({
        where: { id: order.id },
        data: { subscription_id: granted.subscription.id, invoice_id: granted.invoiceId },
      });
      return granted;
    });
    if (!result) return { state: 'already_paid' };
    return { state: 'settled', holder, result };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** An order is left alone this long, so the browser callback gets to settle it first. */
const RECONCILE_AFTER_MS = 60_000;
/** Never paid after this long: swept to 'expired' (still honoured if a payment turns up). */
const EXPIRE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Ask Razorpay about orders nobody confirmed - the webhook that never came, the
 * tab closed mid-redirect. Runs lazily on the billing reads for the holder in
 * question (cheap: only when that holder has an open order) and platform-wide
 * from the super-admin sweep. There is no timer on Lambda.
 */
export async function reconcileOpenOrders(
  prisma: Prisma,
  scope: { organizationId?: string; userId?: string } = {},
): Promise<SettleOutcome[]> {
  const now = Date.now();
  const open = await prisma.payment_orders.findMany({
    where: {
      status: 'created',
      created_at: { lt: new Date(now - RECONCILE_AFTER_MS) },
      ...(scope.organizationId ? { organization_id: scope.organizationId } : {}),
      ...(scope.userId ? { user_id: scope.userId } : {}),
    },
    orderBy: { created_at: 'asc' },
    take: 25,
  });
  if (open.length === 0 || !publicKeyId()) return [];

  const outcomes: SettleOutcome[] = [];
  for (const o of open) {
    try {
      const payments = await paymentsForOrder(o.provider_order_id);
      const captured = payments.find((p) => p.status === 'captured');
      if (captured) {
        outcomes.push(await settleOrder(prisma, {
          orderId: o.provider_order_id, paymentId: captured.id, amountPaid: captured.amount, source: 'reconcile',
        }));
      } else if (now - o.created_at.getTime() > EXPIRE_AFTER_MS) {
        await prisma.payment_orders.updateMany({
          where: { id: o.id, status: 'created' },
          data: { status: 'expired', updated_at: new Date() },
        });
      }
    } catch (e) {
      // One bad order must not stop the rest, nor fail the read that triggered this.
      console.error(`[payments] reconcile ${o.provider_order_id} failed:`, e);
    }
  }
  return outcomes;
}
