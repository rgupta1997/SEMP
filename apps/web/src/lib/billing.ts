import type { CapabilityKey, LimitKey, Tier } from '@semp/entitlements';

// The client's view of the plan catalogue.
//
// Fetched from /billing/plans rather than imported from @semp/entitlements, even
// though the package is right there and would type-check. Two reasons, and the
// second is the one that matters:
//
//  1. A price change becomes a deploy of the API alone rather than of both.
//  2. The figure shown at checkout is then, by construction, the same figure the
//     invoice is written from. A client that computes its own total will one day
//     compute a different one, and the person who notices is the customer
//     reading a receipt that disagrees with the screen they just paid on.
//
// The TYPES still come from the package - they cost nothing at runtime and mean
// a renamed field breaks the build instead of rendering "undefined".

export type BillingPeriod = 'monthly' | 'annual';

export interface PlanCapability {
  key: CapabilityKey;
  label: string;
  surface: string;
}

export interface PlanView {
  tier: Tier;
  name: string;
  tagline: string;
  selfServe: boolean;
  price: { monthly: number | null; annual: number | null };
  adds: string[];
  limits: Partial<Record<LimitKey, number | null>>;
  capabilities: PlanCapability[];
}

export interface LimitDefView {
  ladder: 'org' | 'personal';
  label: string;
  unit: string;
  counts: string;
}

export interface PlansResponse {
  org: PlanView[];
  personal: PlanView[];
  limits: Record<LimitKey, LimitDefView>;
  taxRateBp: number;
}

export interface UsageMeter {
  key: LimitKey;
  label: string;
  unit: string;
  current: number;
  cap: number | null;
  capLabel: string;
  ok: boolean;
  fraction: number | null;
}

export interface SubscriptionView {
  id: string;
  ladder: string;
  plan: Tier;
  period: BillingPeriod;
  status: 'active' | 'pending_downgrade' | 'cancelled' | 'expired';
  current_period_start: string;
  current_period_end: string;
  pending_plan: Tier | null;
  pending_effective_at: string | null;
  provider: string;
}

export interface InvoiceView {
  id: string;
  number: string;
  plan: Tier;
  period: BillingPeriod;
  subtotal_paise: number;
  tax_rate_bp: number;
  tax_paise: number;
  total_paise: number;
  buyer_name: string | null;
  buyer_gstin: string | null;
  status: string;
  provider: string;
  issued_at: string;
}

export interface SubscriptionEventView {
  id: string;
  kind: string;
  from_plan: Tier | null;
  to_plan: Tier | null;
  actor_id: string | null;
  note: string | null;
  effective_at: string | null;
  created_at: string;
}

export interface BillingState {
  ladder: 'org' | 'personal';
  tier: Tier;
  subscription: SubscriptionView | null;
  usage: UsageMeter[];
  invoices: InvoiceView[];
  history?: SubscriptionEventView[];
  contact?: BillingContact;
  /** Whether THIS person may buy. False for anyone without billing.manage. */
  mayBuy: boolean;
}

export interface BillingContact {
  billing_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  billing_gstin: string | null;
  billing_state_code: string | null;
}

export interface Quote {
  subtotal: number;
  taxRateBp: number;
  tax: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Rupees with Indian grouping. Mirrors the server's formatter exactly. */
export function formatPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function priceLabel(plan: PlanView, period: BillingPeriod): string {
  const p = period === 'annual' ? plan.price.annual : plan.price.monthly;
  if (p === null) return 'Talk to us';
  if (p === 0) return 'Free';
  return formatPaise(p);
}

/** The per-period suffix, split out so a card can typeset it smaller. */
export function priceSuffix(plan: PlanView, period: BillingPeriod): string | null {
  const p = period === 'annual' ? plan.price.annual : plan.price.monthly;
  if (p === null || p === 0) return null;
  return period === 'annual' ? '/year' : '/month';
}

/** Computed, never quoted - a hard-coded saving outlives the price it described. */
export function annualSavingPct(plan: PlanView): number | null {
  const { monthly, annual } = plan.price;
  if (monthly === null || annual === null || monthly === 0) return null;
  const twelve = monthly * 12;
  if (annual >= twelve) return null;
  return Math.round(((twelve - annual) / twelve) * 100);
}

const RANK: Record<Tier, number> = { free: 0, pro: 1, max: 2 };

export function isUpgrade(from: Tier, to: Tier): boolean {
  return RANK[to] > RANK[from];
}

export function isDowngrade(from: Tier, to: Tier): boolean {
  return RANK[to] < RANK[from];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What the button on a plan column should say.
 *
 * Kept here rather than inline so the plan page, the billing panel and the
 * upsell modal cannot describe the same transition three different ways - which
 * they did in the prototype, where one of them said "Downgrade" for a move the
 * server would have refused.
 */
export function actionFor(current: Tier, target: PlanView): {
  label: string;
  kind: 'current' | 'buy' | 'upgrade' | 'downgrade' | 'contact';
  disabled: boolean;
} {
  if (!target.selfServe) return { label: 'Talk to us', kind: 'contact', disabled: false };
  if (target.tier === current) return { label: 'Your plan', kind: 'current', disabled: true };
  if (isUpgrade(current, target.tier)) {
    return { label: current === 'free' ? `Get ${target.name}` : `Move to ${target.name}`, kind: current === 'free' ? 'buy' : 'upgrade', disabled: false };
  }
  return { label: `Move down to ${target.name}`, kind: 'downgrade', disabled: false };
}

/** The kind of event, as a person reads it in the history list. */
export const EVENT_LABEL: Record<string, string> = {
  subscribed: 'Subscribed',
  upgraded: 'Moved up',
  downgrade_scheduled: 'Move down scheduled',
  downgrade_cancelled: 'Scheduled move called off',
  downgrade_applied: 'Moved down',
  renewed: 'Renewed',
  cancelled: 'Cancelled',
};
