import { describe, expect, it } from 'vitest';
import { couponProblem, discountFor, normaliseCode, redeemCoupon, type CouponRow } from './coupons.js';

const coupon = (o: Partial<CouponRow> = {}): CouponRow => ({
  code: 'LAUNCH20', description: '', kind: 'percent', value: 2000, ladder: 'org',
  tiers: [], periods: [], valid_from: null, valid_until: null,
  max_redemptions: null, redemptions: 0, active: true, ...o,
});
const ctx = { ladder: 'org' as const, plan: 'pro' as const, period: 'annual' as const, now: new Date('2026-11-10T00:00:00Z') };

describe('coupons', () => {
  it('normalises codes', () => expect(normaliseCode('  launch20 ')).toBe('LAUNCH20'));

  it('takes a percentage or a flat amount, never more than the price', () => {
    expect(discountFor({ kind: 'percent', value: 2000 }, 499_900)).toBe(99_980);
    expect(discountFor({ kind: 'flat', value: 100_000 }, 499_900)).toBe(100_000);
    expect(discountFor({ kind: 'flat', value: 900_000 }, 499_900)).toBe(499_900);
  });

  it('applies when nothing restricts it', () => expect(couponProblem(coupon(), ctx)).toBeNull());

  it('names why it does not apply', () => {
    expect(couponProblem(null, ctx)).toMatch(/not valid/);
    expect(couponProblem(coupon({ active: false }), ctx)).toMatch(/not valid/);
    expect(couponProblem(coupon({ valid_until: new Date('2026-11-01') }), ctx)).toMatch(/expired/);
    expect(couponProblem(coupon({ valid_from: new Date('2026-12-01') }), ctx)).toMatch(/not active yet/);
    expect(couponProblem(coupon({ tiers: ['starter'] }), ctx)).toMatch(/does not apply/);
    expect(couponProblem(coupon({ periods: ['monthly'] }), ctx)).toMatch(/annual/);
    expect(couponProblem(coupon({ ladder: 'personal' }), ctx)).toMatch(/does not apply/);
    expect(couponProblem(coupon({ max_redemptions: 5, redemptions: 5 }), ctx)).toMatch(/fully used/);
  });

  it('refuses when the conditional claim loses the race for the last use', async () => {
    const tx = {
      coupons: { findUnique: async () => coupon({ max_redemptions: 1, redemptions: 0 }) },
      // Another buyer took it between the read and the claim.
      $queryRaw: async () => [],
    };
    await expect(redeemCoupon(tx, { code: 'launch20', ladder: 'org', plan: 'pro', period: 'annual', price: 499_900 }))
      .rejects.toThrow(/fully used/);
  });

  it('returns the discount when the claim succeeds', async () => {
    const tx = { coupons: { findUnique: async () => coupon() }, $queryRaw: async () => [{ code: 'LAUNCH20' }] };
    await expect(redeemCoupon(tx, { code: 'launch20', ladder: 'org', plan: 'pro', period: 'annual', price: 499_900 }))
      .resolves.toEqual({ code: 'LAUNCH20', paise: 99_980 });
  });
});
