import { RANK, type Tier } from './tiers.js';

// Which plan an EVENT runs on.
//
// An organisation's plan answers "what may this institution do". An event needs
// its own answer, for three reasons the user set out (2026-11-08):
//
//   - a single event can be bought up on its own (an event pass);
//   - a running event must not be taken down the moment its organisation's
//     subscription drops - it gets `graceDays` (3) to renew, then goes
//     read-only;
//   - everything that existed before plans were enforced is grandfathered.
//
// So each championship stores `plan_tier` (the plan it was booked on) and
// `plan_source`:
//
//   org    - follows the host organisation. Stamped with the org's tier at
//            creation. If the org later drops BELOW it, the event keeps its
//            booked tier until `plan_grace_until`, then locks.
//   pass   - bought for this event alone. Never lapses with the org.
//   admin  - set by a super admin. Never lapses with the org.
//   legacy - created before plans were enforced. Unlimited, never locks.
//
// Pure: callers supply the org's tier and the clock.

export const PLAN_SOURCES = ['org', 'pass', 'admin', 'legacy'] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export interface EventPlanInput {
  /** Host organisation's resolved tier; null when the event has no host org (solo host = free). */
  orgTier: Tier | null;
  planTier: Tier | null;
  planSource: string | null;
  graceUntil: Date | string | null;
  /** False when the platform switch has plans off - everything resolves to max. */
  enforced: boolean;
  now?: Date;
}

export interface EventPlanState {
  /** The tier every event-level capability and limit is checked against. */
  tier: Tier;
  source: PlanSource;
  /** The org dropped below the event's booked plan and the grace window is running. */
  inGrace: boolean;
  /** Grace ran out: the event is read-only until the plan is restored. */
  locked: boolean;
  graceUntil: string | null;
}

const higher = (a: Tier, b: Tier): Tier => (RANK[a] >= RANK[b] ? a : b);

function asSource(s: string | null): PlanSource {
  return (PLAN_SOURCES as readonly string[]).includes(s ?? '') ? (s as PlanSource) : 'org';
}

export function resolveEventPlan(input: EventPlanInput): EventPlanState {
  const source = asSource(input.planSource);
  const graceIso = input.graceUntil ? new Date(input.graceUntil).toISOString() : null;
  const base = { source, inGrace: false, locked: false, graceUntil: graceIso };

  if (!input.enforced || source === 'legacy') return { ...base, tier: 'max' };

  const org: Tier = input.orgTier ?? 'free';
  if (source === 'pass' || source === 'admin') {
    return { ...base, tier: higher(input.planTier ?? 'free', org) };
  }

  const booked: Tier = input.planTier ?? org;
  if (RANK[org] >= RANK[booked]) return { ...base, tier: org, graceUntil: null };

  // The org has dropped below what this event was booked on.
  const now = input.now ?? new Date();
  const expired = input.graceUntil !== null && new Date(input.graceUntil).getTime() <= now.getTime();
  if (!expired) return { ...base, tier: booked, inGrace: true };
  return { ...base, tier: org, locked: true };
}
