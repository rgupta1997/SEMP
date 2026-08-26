import {
  formatLimit,
  limitValue,
  LIMITS,
  planFor,
  withinLimit,
  type LimitKey,
  type Tier,
} from '../core/index.js';
import { orgTier, personalTier, type EntitlementsPrisma } from './resolve.js';

// The limit gate, beside the capability gate in `resolve.ts`. Same shape, one
// difference that matters:
//
//   capability - is the feature on this plan at all?      -> 403
//   limit      - is there room for one more of them?      -> 402
//
// 402 rather than 403 because the caller is not forbidden - they may do this
// thing, they have simply used up how many of it their plan includes. The client
// renders the two differently: a capability wall replaces the surface, a limit
// wall disables one button and says what the ceiling is.
//
// The COUNT is supplied by the caller. This module deliberately does not know
// how to count an institution's active events - that is a query about
// championships, and teaching a package about tiers to also read the
// championship table is how a small pure module becomes a second copy of the
// domain. `apps/api/src/modules/billing/usage.ts` owns the counting.

export class PlanLimitError extends Error {
  readonly limit: LimitKey;
  readonly cap: number;
  readonly current: number;
  readonly status = 402;

  constructor(limit: LimitKey, cap: number, current: number) {
    // Names the ceiling and where you are against it. Like the capability
    // message, it does NOT name the plan that would raise it: the wall says what
    // is in the way, the plan page says what it costs to move it.
    super(
      `${LIMITS[limit].label}: this plan includes ${cap.toLocaleString('en-IN')}, and ${current.toLocaleString('en-IN')} are in use.`,
    );
    this.name = 'PlanLimitError';
    this.limit = limit;
    this.cap = cap;
    this.current = current;
  }
}

/** What a plan allows for one limit. `null` is unlimited. */
export function capFor(ladder: 'org' | 'personal', tier: Tier, key: LimitKey): number | null {
  return limitValue(planFor(ladder, tier).limits, key);
}

export interface LimitState {
  key: LimitKey;
  label: string;
  unit: string;
  /** How many exist now. */
  current: number;
  /** The ceiling, or null for unlimited. */
  cap: number | null;
  /** "5" or "Unlimited" - what the meter prints. */
  capLabel: string;
  /** Is there room for one more? */
  ok: boolean;
  /** 0..1 against the cap; null when unlimited, so no bar is drawn. */
  fraction: number | null;
}

/** One limit, resolved against a tier and a count. Pure - what the meter renders. */
export function limitState(
  ladder: 'org' | 'personal',
  tier: Tier,
  key: LimitKey,
  current: number,
): LimitState {
  const limits = planFor(ladder, tier).limits;
  const cap = limitValue(limits, key);
  return {
    key,
    label: LIMITS[key].label,
    unit: LIMITS[key].unit,
    current,
    cap,
    capLabel: formatLimit(limits, key),
    ok: withinLimit(limits, key, current),
    fraction: cap === null || cap === 0 ? null : Math.min(1, current / cap),
  };
}

/**
 * Throws `PlanLimitError` when the organisation has no room for one more.
 *
 * Reads the tier through the client it is handed, exactly as `assertCapability`
 * does, so a caller inside a transaction sees that transaction's picture.
 */
export async function assertWithinOrgLimit(
  prisma: EntitlementsPrisma,
  key: LimitKey,
  organizationId: string,
  current: number,
): Promise<void> {
  const tier = await orgTier(prisma, organizationId);
  const cap = capFor('org', tier, key);
  if (cap !== null && current >= cap) throw new PlanLimitError(key, cap, current);
}

/** The personal ladder sets no ceilings today; kept so callers need not care. */
export async function assertWithinPersonalLimit(
  prisma: EntitlementsPrisma,
  key: LimitKey,
  userId: string,
  current: number,
): Promise<void> {
  const tier = await personalTier(prisma, userId);
  const cap = capFor('personal', tier, key);
  if (cap !== null && current >= cap) throw new PlanLimitError(key, cap, current);
}
