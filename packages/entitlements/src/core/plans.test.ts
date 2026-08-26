import { describe, it, expect } from 'vitest';
import {
  annualSavingPct,
  CAPABILITIES,
  CAPABILITY_KEYS,
  BILLING_PERIODS,
  capabilitiesAddedAt,
  capabilitiesOn,
  formatLimit,
  formatPaise,
  granted,
  GST_RATE_BP,
  isUpgrade,
  LIMIT_KEYS,
  LIMITS,
  limitsFor,
  planFor,
  planLadder,
  planUnlocking,
  PLANS,
  priceLabel,
  priceOf,
  TIERS,
  withGst,
  withinLimit,
  type Ladder,
} from './index.js';

const LADDERS: Ladder[] = ['org', 'personal'];

describe('the catalogue covers the ladders', () => {
  it('has a plan for every tier on both ladders', () => {
    for (const ladder of LADDERS) {
      expect(planLadder(ladder)).toHaveLength(3);
      for (const tier of TIERS) {
        const p = planFor(ladder, tier);
        expect(p.ladder).toBe(ladder);
        expect(p.tier).toBe(tier);
        expect(p.tagline.length).toBeGreaterThan(0);
        expect(p.adds.length).toBeGreaterThan(0);
      }
    }
  });

  it('names each plan the way its own ladder sells it', () => {
    expect(planFor('org', 'max').name).toBe('Enterprise');
    expect(planFor('personal', 'max').name).toBe('Elite');
    expect(planFor('org', 'free').name).toBe('Free');
  });

  it('starts both ladders at zero', () => {
    for (const ladder of LADDERS) {
      expect(planFor(ladder, 'free').price.monthly).toBe(0);
      expect(planFor(ladder, 'free').price.annual).toBe(0);
      expect(priceLabel(planFor(ladder, 'free'), 'monthly')).toBe('Free');
    }
  });

  it('prices rise with the tier, on both periods', () => {
    for (const ladder of LADDERS) {
      for (const period of BILLING_PERIODS) {
        const prices = TIERS.map((t) => priceOf(planFor(ladder, t), period));
        for (let i = 1; i < prices.length; i++) {
          // A null is "talk to us", which is above every printed price by
          // definition and so is not compared.
          if (prices[i] === null || prices[i - 1] === null) continue;
          expect(prices[i]!).toBeGreaterThan(prices[i - 1]!);
        }
      }
    }
  });

  it('holds every price in whole paise', () => {
    for (const ladder of LADDERS) {
      for (const tier of TIERS) {
        for (const period of BILLING_PERIODS) {
          const p = priceOf(planFor(ladder, tier), period);
          if (p === null) continue;
          expect(Number.isInteger(p), `${ladder}/${tier}/${period} is not an integer`).toBe(true);
        }
      }
    }
  });

  it('sells Enterprise by conversation, not by card', () => {
    const ent = planFor('org', 'max');
    expect(ent.selfServe).toBe(false);
    expect(ent.price.monthly).toBeNull();
    expect(priceLabel(ent, 'annual')).toBe('Talk to us');
    // Everything else must be buyable, or the plan page has a column nobody can act on.
    for (const ladder of LADDERS) {
      for (const tier of TIERS) {
        const p = planFor(ladder, tier);
        if (p === ent) continue;
        expect(p.selfServe, `${ladder}/${tier} is not self-serve`).toBe(true);
        expect(p.price.monthly).not.toBeNull();
      }
    }
  });
});

// The load-bearing test in this file. The plan page is a second surface reading
// the same truth as the guard; if it ever grew its own list of features, the
// failure mode is that it advertises something the API then refuses.
describe('what a plan includes is derived from the registry', () => {
  it('includes exactly what the guard grants at that tier', () => {
    for (const ladder of LADDERS) {
      for (const tier of TIERS) {
        for (const key of capabilitiesOn(ladder, tier)) {
          expect(granted(tier, key), `${ladder}/${tier} advertises ${key}`).toBe(true);
        }
      }
    }
  });

  it('never advertises a capability from the other ladder', () => {
    for (const ladder of LADDERS) {
      for (const tier of TIERS) {
        for (const key of capabilitiesOn(ladder, tier)) {
          expect(planUnlocking(key).ladder).toBe(ladder);
        }
      }
    }
  });

  it('partitions every capability into exactly one "adds" step', () => {
    for (const ladder of LADDERS) {
      const seen = TIERS.flatMap((t) => capabilitiesAddedAt(ladder, t));
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.sort()).toEqual(capabilitiesOn(ladder, 'max').sort());
    }
  });

  it('grows the included set at every step up', () => {
    for (const ladder of LADDERS) {
      const [free, pro, max] = TIERS.map((t) => capabilitiesOn(ladder, t));
      expect(pro.length).toBeGreaterThan(free.length);
      expect(max.length).toBeGreaterThan(pro.length);
      for (const k of free) expect(pro).toContain(k);
      for (const k of pro) expect(max).toContain(k);
    }
  });

  it('points a locked capability at the cheapest plan that has it', () => {
    expect(planUnlocking('multi_campus').tier).toBe('max');
    expect(planUnlocking('multi_campus').name).toBe('Enterprise');
    expect(planUnlocking('advanced_reports').tier).toBe('pro');
    expect(planUnlocking('ai_coach').name).toBe('Elite');
  });
});

describe('limits', () => {
  it('loosens as the tier rises and never tightens', () => {
    for (const key of limitsFor('org')) {
      let previous = -1;
      for (const tier of TIERS) {
        const cap = planFor('org', tier).limits[key];
        if (cap === null || cap === undefined) { previous = Infinity; continue; }
        expect(cap, `${key} tightened at ${tier}`).toBeGreaterThan(previous);
        previous = cap;
      }
      // The top of the ladder must end unlimited, or Enterprise has a ceiling
      // nobody was told about.
      expect(planFor('org', 'max').limits[key] ?? null).toBeNull();
    }
  });

  it('leaves the personal ladder uncapped, and says so', () => {
    expect(limitsFor('personal')).toEqual([]);
    for (const tier of TIERS) {
      expect(planFor('personal', tier).limits).toEqual({});
      // An absent key must read as unlimited, not as zero - that is the bug this
      // asserts against, and it would have blocked every player on the free plan.
      for (const key of LIMIT_KEYS) {
        expect(withinLimit(planFor('personal', tier).limits, key, 10_000)).toBe(true);
      }
    }
  });

  it('has room up to the cap and not past it', () => {
    const free = planFor('org', 'free').limits;
    expect(withinLimit(free, 'active_events', 0)).toBe(true);
    expect(withinLimit(free, 'active_events', 1)).toBe(false);
    expect(withinLimit(free, 'people', 99)).toBe(true);
    expect(withinLimit(free, 'people', 100)).toBe(false);
    expect(withinLimit(planFor('org', 'max').limits, 'people', 1_000_000)).toBe(true);
  });

  it('prints a ceiling with Indian grouping, and unlimited as a word', () => {
    expect(formatLimit(planFor('org', 'pro').limits, 'people')).toBe('1,000');
    expect(formatLimit(planFor('org', 'max').limits, 'people')).toBe('Unlimited');
  });

  it('describes every limit it defines', () => {
    for (const key of LIMIT_KEYS) {
      expect(LIMITS[key].label.length).toBeGreaterThan(0);
      expect(LIMITS[key].counts.length).toBeGreaterThan(0);
    }
  });
});

describe('annual pricing', () => {
  it('is cheaper than twelve months, on every priced plan', () => {
    for (const ladder of LADDERS) {
      for (const tier of TIERS) {
        const { monthly, annual } = planFor(ladder, tier).price;
        if (monthly === null || annual === null || monthly === 0) continue;
        expect(annual, `${ladder}/${tier} annual is not a discount`).toBeLessThan(monthly * 12);
      }
    }
  });

  it('computes the saving rather than quoting one', () => {
    // Two months free on the org ladder: 49,990 against 59,988.
    expect(annualSavingPct(planFor('org', 'pro'))).toBe(17);
    expect(annualSavingPct(planFor('personal', 'pro'))).toBe(27);
  });

  it('offers no saving badge where there is nothing to save', () => {
    expect(annualSavingPct(planFor('org', 'free'))).toBeNull();
    expect(annualSavingPct(planFor('org', 'max'))).toBeNull();
  });
});

describe('direction of a plan change', () => {
  it('is an upgrade only when the rank rises', () => {
    expect(isUpgrade('free', 'pro')).toBe(true);
    expect(isUpgrade('pro', 'max')).toBe(true);
    expect(isUpgrade('pro', 'free')).toBe(false);
    // Same tier is not an upgrade - a period change must not be billed as one.
    expect(isUpgrade('pro', 'pro')).toBe(false);
  });
});

describe('money', () => {
  it('formats rupees with Indian grouping and no stray paise', () => {
    expect(formatPaise(499_900)).toBe('₹4,999');
    expect(formatPaise(4_999_000)).toBe('₹49,990');
    expect(formatPaise(0)).toBe('₹0');
    expect(formatPaise(14_950)).toBe('₹149.50');
  });

  it('labels the period alongside the figure', () => {
    expect(priceLabel(planFor('org', 'pro'), 'monthly')).toBe('₹4,999/month');
    expect(priceLabel(planFor('org', 'pro'), 'annual')).toBe('₹49,990/year');
  });

  it('adds 18% GST', () => {
    const t = withGst(499_900);
    expect(t.taxRateBp).toBe(GST_RATE_BP);
    expect(t.tax).toBe(89_982);
    expect(t.total).toBe(589_882);
  });

  // The invoice property: the printed lines must add up. Rounding the total
  // separately from the tax is how they stop doing so.
  it('always totals to subtotal plus tax, at every price in the catalogue', () => {
    const amounts = LADDERS.flatMap((l) =>
      TIERS.flatMap((t) => BILLING_PERIODS.map((p) => priceOf(planFor(l, t), p))),
    ).filter((a): a is number => a !== null);

    for (const a of [...amounts, 1, 7, 33, 99, 12_345]) {
      const t = withGst(a);
      expect(t.subtotal + t.tax).toBe(t.total);
      expect(Number.isInteger(t.tax)).toBe(true);
    }
  });

  it('charges no tax on nothing', () => {
    expect(withGst(0)).toEqual({ subtotal: 0, taxRateBp: GST_RATE_BP, tax: 0, total: 0 });
  });
});

describe('the guard path stays free of prices', () => {
  // Structural, because the rule is easy to break by convenience: the moment the
  // deciding path can see a figure, a wall can print one. The catalogue may hold
  // prices; the definition a locked surface renders from may not.
  it('keeps price and ceilings out of the capability registry', () => {
    for (const key of CAPABILITY_KEYS) {
      expect(CAPABILITIES[key]).not.toHaveProperty('price');
      expect(CAPABILITIES[key]).not.toHaveProperty('limits');
      expect(Object.keys(CAPABILITIES[key]).sort()).toEqual(['label', 'ladder', 'minTier', 'surface']);
    }
  });

  it('keeps the catalogue out of the registry module', () => {
    // planUnlocking bridges the two, and is the only thing that may.
    expect(planUnlocking('sso')).toHaveProperty('price');
    expect(CAPABILITIES.sso).not.toHaveProperty('tagline');
  });
});
