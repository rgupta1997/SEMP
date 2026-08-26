import { capabilitiesFor, CAPABILITIES, type CapabilityKey } from './registry.js';
import type { LimitSet } from './limits.js';
import { RANK, TIERS, TIER_LABEL, type Ladder, type Tier } from './tiers.js';

// The plan catalogue - what each plan COSTS and how much of the product it
// includes. The capability registry next door says what each tier grants; this
// says what it is sold as.
//
// The two are kept apart on purpose. `registry.ts` is read by the API guard on
// every gated request and by every locked surface, and it must never learn a
// price: the product rule is that a wall names the missing capability, never the
// tier or the figure. This module is the ONE place a price may appear, and it is
// imported only by the plan page, the billing panel and checkout.
//
// Because of that split, a plan's capability list is DERIVED here rather than
// listed - `capabilitiesOn()` reads the registry. A hand-written list would be a
// second grid to keep in step with the first, and the way that fails is the
// expensive way round: the plan page advertises something the guard refuses.

/** Money is held in paise, integer. Nothing in billing may be a float. */
export type Paise = number;

export interface PlanPrice {
  /** Per month, billed monthly. `null` means not sold self-serve. */
  monthly: Paise | null;
  /** Per year, billed once. `null` means not sold self-serve. */
  annual: Paise | null;
}

export const BILLING_PERIODS = ['monthly', 'annual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export interface PlanDef {
  ladder: Ladder;
  tier: Tier;
  /** Free / Pro / Enterprise, or Free / Pro / Elite. From TIER_LABEL. */
  name: string;
  /** Who the plan is for, in one line. */
  tagline: string;
  /** List price, exclusive of GST. GST is added at invoice time. */
  price: PlanPrice;
  /**
   * Whether it can be bought without talking to anybody. Enterprise is not: it
   * involves SSO, an MSA and a purchase order, none of which fit a card form.
   */
  selfServe: boolean;
  /** What this plan adds over the one below it, in a person's words. */
  adds: readonly string[];
  /** Ceilings on this plan. An absent key is unlimited. */
  limits: LimitSet;
}

// ---------------------------------------------------------------------------
// Prices. Exclusive of GST, in paise.
//
// The annual price is ten months of the monthly one - two months free - which is
// why `annualSavingPct` is computed rather than written down: a price change that
// forgot to update a hard-coded "save 17%" would be a lie printed on the page.
// ---------------------------------------------------------------------------

const RUPEE = 100;

export const PLANS: Record<Ladder, Record<Tier, PlanDef>> = {
  org: {
    free: {
      ladder: 'org', tier: 'free', name: TIER_LABEL.org.free,
      tagline: 'Run your first event and see the whole thing work.',
      price: { monthly: 0, annual: 0 },
      selfServe: true,
      adds: [
        'Create and run an event end to end',
        'Fixtures, live scoring, standings and results',
        'Certificates on the Sportagon template',
        'The institution workspace, teams and roll',
      ],
      limits: { active_events: 1, people: 100, staff_seats: 3 },
    },
    pro: {
      ladder: 'org', tier: 'pro', name: TIER_LABEL.org.pro,
      tagline: 'For an institution running a season, not a one-off.',
      price: { monthly: 4_999 * RUPEE, annual: 49_990 * RUPEE },
      selfServe: true,
      adds: [
        'Bulk roster upload from a spreadsheet',
        'Your own certificate template, logo and signatories - no Sportagon stamp',
        'QR verification on every certificate you issue',
        'The Reports page: participation, performance, engagement',
        'Five events running at once, and a roll of 1,000',
      ],
      limits: { active_events: 5, people: 1_000, staff_seats: 15 },
    },
    max: {
      ladder: 'org', tier: 'max', name: TIER_LABEL.org.max,
      tagline: 'For a university group, a board, or anyone with more than one campus.',
      price: { monthly: null, annual: null },
      selfServe: false,
      adds: [
        'Campuses and nested units, with a breakdown per campus',
        'Custom roles beyond the system set',
        'Benchmarking against peer institutions',
        'Single sign-on - SAML, OIDC, JIT provisioning, SCIM',
        'API keys, webhooks and a sandbox',
        'Audit logs - the timestamped record of who did what',
        'No ceilings on events, people or staff',
      ],
      limits: { active_events: null, people: null, staff_seats: null },
    },
  },
  personal: {
    free: {
      ladder: 'personal', tier: 'free', name: TIER_LABEL.personal.free,
      tagline: 'Play, and keep the record of it. Always free.',
      price: { monthly: 0, annual: 0 },
      selfServe: true,
      adds: [
        'Enter events and see every fixture you are in',
        'Live results and your match history',
        'Your sports profile and Sportagon ID',
        'Every certificate you have earned',
      ],
      limits: {},
    },
    pro: {
      ladder: 'personal', tier: 'pro', name: TIER_LABEL.personal.pro,
      tagline: 'For a player who wants the numbers behind the record.',
      price: { monthly: 149 * RUPEE, annual: 1_299 * RUPEE },
      selfServe: true,
      adds: [
        'Career statistics and form, sport by sport',
        'Your record exported as a sports CV',
        'Insight panels on your profile',
      ],
      limits: {},
    },
    max: {
      ladder: 'personal', tier: 'max', name: TIER_LABEL.personal.max,
      tagline: 'For a player being scouted, or trying to be.',
      price: { monthly: 399 * RUPEE, annual: 3_499 * RUPEE },
      selfServe: true,
      adds: [
        'Percentiles and performance trends against your cohort',
        'AI insights on your profile',
        'The AI coach',
      ],
      limits: {},
    },
  },
};

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

export function planFor(ladder: Ladder, tier: Tier): PlanDef {
  return PLANS[ladder][tier];
}

/** The ladder in order, cheapest first. What the plan page renders as columns. */
export function planLadder(ladder: Ladder): PlanDef[] {
  return TIERS.map((t) => PLANS[ladder][t]);
}

/** Every capability this plan includes. Derived - never a second list. */
export function capabilitiesOn(ladder: Ladder, tier: Tier): CapabilityKey[] {
  return capabilitiesFor(ladder).filter((k) => RANK[tier] >= RANK[CAPABILITIES[k].minTier]);
}

/** Only what this plan adds over the one below it. Empty on the lowest tier. */
export function capabilitiesAddedAt(ladder: Ladder, tier: Tier): CapabilityKey[] {
  return capabilitiesFor(ladder).filter((k) => CAPABILITIES[k].minTier === tier);
}

/** The cheapest plan on this ladder that includes the capability. */
export function planUnlocking(capability: CapabilityKey): PlanDef {
  const def = CAPABILITIES[capability];
  return PLANS[def.ladder][def.minTier];
}

export function priceOf(plan: PlanDef, period: BillingPeriod): Paise | null {
  return period === 'annual' ? plan.price.annual : plan.price.monthly;
}

/**
 * What annual saves against twelve months of monthly, as a whole percent.
 * `null` when either price is absent or the plan is free - a "save 0%" badge on
 * the free column is noise.
 */
export function annualSavingPct(plan: PlanDef): number | null {
  const { monthly, annual } = plan.price;
  if (monthly === null || annual === null || monthly === 0) return null;
  const twelve = monthly * 12;
  if (annual >= twelve) return null;
  return Math.round(((twelve - annual) / twelve) * 100);
}

/** Is `to` a step up from `from` on the ladder? Decides upgrade vs downgrade. */
export function isUpgrade(from: Tier, to: Tier): boolean {
  return RANK[to] > RANK[from];
}

// ---------------------------------------------------------------------------
// Money, formatted the way an Indian invoice reads
// ---------------------------------------------------------------------------

/** Rupees with Indian digit grouping; paise shown only when there are any. */
export function formatPaise(paise: Paise): string {
  const rupees = paise / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** How a price reads on the plan card, including the "not sold here" case. */
export function priceLabel(plan: PlanDef, period: BillingPeriod): string {
  const p = priceOf(plan, period);
  if (p === null) return 'Talk to us';
  if (p === 0) return 'Free';
  return `${formatPaise(p)}${period === 'annual' ? '/year' : '/month'}`;
}

/** The GST rate applied to a SaaS subscription in India, in basis points. */
export const GST_RATE_BP = 1800;

export interface TaxedTotal {
  subtotal: Paise;
  taxRateBp: number;
  tax: Paise;
  total: Paise;
}

/**
 * List price plus GST. The tax is rounded once, to the paise, and the total is
 * then derived by ADDITION rather than by rounding a second time - so
 * subtotal + tax always equals total on the printed invoice, which is the
 * property anyone reconciling it will check first.
 */
export function withGst(subtotal: Paise, rateBp: number = GST_RATE_BP): TaxedTotal {
  const tax = Math.round((subtotal * rateBp) / 10_000);
  return { subtotal, taxRateBp: rateBp, tax, total: subtotal + tax };
}
