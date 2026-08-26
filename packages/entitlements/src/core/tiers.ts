// The ordered tier. Mirrors the Postgres `tier` enum declared in
// 20260825000040_tier_enum.sql, and the order here must match the order there -
// both sides rank by position, so a disagreement would silently grant or deny.

export const TIERS = ['free', 'pro', 'max'] as const;

export type Tier = (typeof TIERS)[number];

/**
 * Rank of each tier. Postgres compares its native enum by declaration order for
 * free; this is the same comparison in TypeScript, where enums have no ordering.
 */
export const RANK: Record<Tier, number> = {
  free: 0,
  pro: 1,
  max: 2,
};

/** Is `held` at or above `required`? The whole entitlement check, in one line. */
export function atLeast(held: Tier, required: Tier): boolean {
  return RANK[held] >= RANK[required];
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/**
 * Tier as a person sees it. The two ladders share one type but not one
 * vocabulary: the top of the organisation ladder is sold as Enterprise, the top
 * of the personal ladder as Elite. Display only - never branch on this.
 */
export const TIER_LABEL: Record<Ladder, Record<Tier, string>> = {
  org: { free: 'Free', pro: 'Pro', max: 'Enterprise' },
  personal: { free: 'Free', pro: 'Pro', max: 'Elite' },
};

/**
 * The two ladders are independent. An organisation on `max` does not grant its
 * players `max`, and a player on `max` gets nothing extra inside an org - stated
 * explicitly in Breakdown v1.0 sheet 06 and easy to conflate once both are
 * spelled with the same three words.
 */
export type Ladder = 'org' | 'personal';
