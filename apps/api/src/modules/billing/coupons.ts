import type { BillingPeriod, Ladder, Tier } from '@semp/entitlements';
import { BusinessRuleError } from '../../shared/errors.js';

// Coupons: a percentage (basis points) or a flat amount (paise) off the list
// price, before GST.
//
// Concurrency: a redemption is ONE conditional UPDATE -
//   redemptions = redemptions + 1 WHERE redemptions < max_redemptions
// - so two buyers racing for the last use cannot both succeed, and nobody waits
// on a lock. It runs inside the purchase transaction, so a purchase that fails
// later rolls the redemption back with it.

export interface CouponRow {
  code: string;
  description: string;
  kind: string;
  value: number;
  ladder: string;
  tiers: string[] | null;
  periods: string[] | null;
  valid_from: Date | null;
  valid_until: Date | null;
  max_redemptions: number | null;
  redemptions: number;
  active: boolean;
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Why this coupon does not apply, or null when it does. Pure - the quote and the purchase share it. */
export function couponProblem(
  c: CouponRow | null,
  ctx: { ladder: Ladder; plan: Tier; period: BillingPeriod; now?: Date },
): string | null {
  if (!c || !c.active) return 'That coupon code is not valid.';
  const now = ctx.now ?? new Date();
  if (c.valid_from && now < c.valid_from) return 'That coupon is not active yet.';
  if (c.valid_until && now > c.valid_until) return 'That coupon has expired.';
  if (c.ladder !== ctx.ladder) return 'That coupon does not apply to this plan.';
  if (c.tiers && c.tiers.length > 0 && !c.tiers.includes(ctx.plan)) return 'That coupon does not apply to this plan.';
  if (c.periods && c.periods.length > 0 && !c.periods.includes(ctx.period)) return `That coupon does not apply to ${ctx.period} billing.`;
  if (c.max_redemptions !== null && c.redemptions >= c.max_redemptions) return 'That coupon has been fully used.';
  return null;
}

/** Paise off `price`. Never more than the price. */
export function discountFor(c: Pick<CouponRow, 'kind' | 'value'>, price: number): number {
  const off = c.kind === 'percent' ? Math.round((price * c.value) / 10_000) : c.value;
  return Math.max(0, Math.min(price, off));
}

type Tx = {
  coupons: { findUnique: Function };
  $queryRaw: Function;
};

/** Validate and claim one use. Throws BusinessRuleError with a readable reason. */
export async function redeemCoupon(
  tx: Tx,
  input: { code: string; ladder: Ladder; plan: Tier; period: BillingPeriod; price: number },
): Promise<{ code: string; paise: number }> {
  const code = normaliseCode(input.code);
  const c = (await tx.coupons.findUnique({ where: { code } })) as CouponRow | null;
  const problem = couponProblem(c, input);
  if (problem) throw new BusinessRuleError(problem);

  const claimed = (await tx.$queryRaw`
    update coupons
       set redemptions = redemptions + 1
     where code = ${code} and active
       and (max_redemptions is null or redemptions < max_redemptions)
    returning code`) as Array<{ code: string }>;
  if (claimed.length === 0) throw new BusinessRuleError('That coupon has been fully used.');

  return { code, paise: discountFor(c!, input.price) };
}
