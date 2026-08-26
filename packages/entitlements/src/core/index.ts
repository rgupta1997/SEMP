import {
  CAPABILITIES,
  capabilitiesFor,
  type CapabilityDef,
  type CapabilityKey,
} from './registry.js';
import { atLeast, TIER_LABEL, type Ladder, type Tier } from './tiers.js';

export * from './registry.js';
export * from './tiers.js';
export * from './limits.js';
// The catalogue - prices and ceilings. Kept out of the guard path on purpose:
// nothing that decides an entitlement imports it, so a price cannot reach a
// locked surface by accident.
export * from './plans.js';

/** The entitlement check. One comparison, used by the API guard and the UI alike. */
export function granted(held: Tier, key: CapabilityKey): boolean {
  return atLeast(held, CAPABILITIES[key].minTier);
}

/** Every capability a holder at this tier has, on the ladder that governs them. */
export function grantedCapabilities(ladder: Ladder, held: Tier): CapabilityKey[] {
  return capabilitiesFor(ladder).filter((k) => granted(held, k));
}

/**
 * What a locked surface needs in order to render.
 *
 * Note what it does NOT carry: the tier that would unlock it. That omission is
 * the point. A locked panel names the missing capability and what it unlocks,
 * so the reader learns what the product does rather than what it costs, and the
 * upgrade CTA can route to the right ladder without the wall quoting a price.
 * `requiredTier` is exposed separately, for the plan page - which is the one
 * screen that is legitimately about tiers.
 */
export interface LockState {
  granted: boolean;
  key: CapabilityKey;
  label: string;
  surface: string;
  ladder: Ladder;
}

export function lockState(held: Tier, key: CapabilityKey): LockState {
  const def: CapabilityDef = CAPABILITIES[key];
  return {
    granted: granted(held, key),
    key,
    label: def.label,
    surface: def.surface,
    ladder: def.ladder,
  };
}

/** For the plan page only, where naming the tier is the whole job. */
export function requiredTier(key: CapabilityKey): Tier {
  return CAPABILITIES[key].minTier;
}

/** Tier as it is sold on the ladder that governs this capability. */
export function requiredTierLabel(key: CapabilityKey): string {
  const def = CAPABILITIES[key];
  return TIER_LABEL[def.ladder][def.minTier];
}
