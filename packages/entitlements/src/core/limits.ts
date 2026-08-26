import type { Ladder } from './tiers.js';

// Numeric plan limits, alongside the yes/no capability registry next door.
//
// The two answer different questions and both are needed. A capability says
// whether a feature EXISTS on this plan; a limit says how much of it you get.
// "Reports" is a capability - you either have the page or you do not. "Active
// events" is a limit - every plan can create an event, they differ in how many
// may run at once. Modelling the second as a capability would have meant a
// `five_events` capability and a `fifty_events` capability, which is how a
// registry turns into a price list.
//
// Limits are SOFT: enforced at the obvious create points (create event, add a
// person, invite a member) and shown everywhere else. Nothing existing is ever
// destroyed or hidden because a limit was crossed - crossing one only stops the
// next creation, which is a wall a person can see coming rather than one that
// removes work already done.
//
// `null` means unlimited. It is deliberately not a very large number: a sentinel
// that reads as "no ceiling" cannot be accidentally compared against.

export interface LimitDef {
  /** Which ladder the limit belongs to. Personal plans currently carry none. */
  ladder: Ladder;
  /** Human name, for the plan table and the wall. */
  label: string;
  /** What is being counted, singular - "event", "person", "staff member". */
  unit: string;
  /** Where the count comes from, so the enforcing route is findable from here. */
  counts: string;
}

export const LIMITS = {
  active_events: {
    ladder: 'org',
    label: 'Active events',
    unit: 'event',
    counts: 'Championships hosted by this institution that are not completed or cancelled',
  },
  people: {
    ladder: 'org',
    label: 'People on the roll',
    unit: 'person',
    counts: 'Students and players in this institution’s directory',
  },
  staff_seats: {
    ladder: 'org',
    label: 'Staff seats',
    unit: 'staff member',
    counts: 'Active members holding a staff role - owner, admin or captain',
  },
} as const satisfies Record<string, LimitDef>;

export type LimitKey = keyof typeof LIMITS;

export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];

export function limitsFor(ladder: Ladder): LimitKey[] {
  return LIMIT_KEYS.filter((k) => LIMITS[k].ladder === ladder);
}

/** A plan's ceilings. `null` on a key means unlimited. */
export type LimitSet = Readonly<Partial<Record<LimitKey, number | null>>>;

/**
 * Is one more allowed?
 *
 * `current` is the count BEFORE the thing being created, so this reads as
 * "there is room for another". An unset key is unlimited, which keeps the
 * personal ladder - which sets none - from being accidentally capped at zero.
 */
export function withinLimit(limits: LimitSet, key: LimitKey, current: number): boolean {
  const cap = key in limits ? limits[key] : null;
  return cap === null || cap === undefined || current < cap;
}

/** How the ceiling reads on a plan table. */
export function formatLimit(limits: LimitSet, key: LimitKey): string {
  const cap = key in limits ? limits[key] : null;
  if (cap === null || cap === undefined) return 'Unlimited';
  return cap.toLocaleString('en-IN');
}

/** Present only so a caller need not repeat the `key in limits` dance. */
export function limitValue(limits: LimitSet, key: LimitKey): number | null {
  const cap = key in limits ? limits[key] : null;
  return cap === undefined ? null : cap;
}
