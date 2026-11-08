import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  capabilitiesFor,
  granted,
  grantedCapabilities,
  lockState,
  requiredTier,
  requiredTierLabel,
  atLeast,
  isTier,
  RANK,
  TIERS,
  type CapabilityKey,
  type Tier,
} from './index.js';

// The grant grid, transcribed rather than derived. It began as the 63 cells of
// Product Breakdown v1.0 sheet 06 (3 tiers x 21 capabilities); the SaaS plans of
// 2026-11-08 added the `starter` column and the event-level capabilities. The
// ordinal model is only a valid simplification if it reproduces this exactly, so
// if a capability's placement changes, this table changes first and the
// registry follows.
const GRID: Record<string, [boolean, boolean, boolean, boolean]> = {
  // org ladder            free   starter pro    enterprise
  create_event:          [true,  true,  true,  true],
  stamped_certificates:  [true,  true,  true,  true],
  advanced_formats:      [false, true,  true,  true],
  manual_schedule:       [false, true,  true,  true],
  standard_points:       [false, true,  true,  true],
  intra_department:      [false, true,  true,  true],
  event_communications:  [false, true,  true,  true],
  event_awards:          [false, true,  true,  true],
  share_links:           [false, true,  true,  true],
  bulk_player_upload:    [false, false, true,  true],
  custom_certificates:   [false, false, true,  true],
  advanced_reports:      [false, false, true,  true],
  custom_points:         [false, false, true,  true],
  intra_campus:          [false, false, true,  true],
  multi_campus:          [false, false, true,  true],
  advanced_permissions:  [false, false, false, true],
  benchmarking:          [false, false, false, true],
  sso:                   [false, false, false, true],
  api:                   [false, false, false, true],
  audit_logs:            [false, false, false, true],
  white_label:           [false, false, false, true],
  // personal ladder       free   (unsold) pro   elite
  play_events:           [true,  true,  true,  true],
  view_results:          [true,  true,  true,  true],
  basic_profile:         [true,  true,  true,  true],
  certificates:          [true,  true,  true,  true],
  advanced_stats:        [false, false, true,  true],
  sports_cv:             [false, false, true,  true],
  premium_insights:      [false, false, true,  true],
  performance_analytics: [false, false, false, true],
  ai_insights:           [false, false, false, true],
  ai_coach:              [false, false, false, true],
};

describe('tier ordering', () => {
  it('ranks by declaration order, matching the Postgres enum', () => {
    expect(TIERS).toEqual(['free', 'starter', 'pro', 'max']);
    expect(RANK.free).toBeLessThan(RANK.starter);
    expect(RANK.starter).toBeLessThan(RANK.pro);
    expect(RANK.pro).toBeLessThan(RANK.max);
  });

  it('atLeast is reflexive and ordered', () => {
    for (const t of TIERS) expect(atLeast(t, t)).toBe(true);
    expect(atLeast('pro', 'free')).toBe(true);
    expect(atLeast('free', 'pro')).toBe(false);
    expect(atLeast('max', 'pro')).toBe(true);
    expect(atLeast('pro', 'max')).toBe(false);
  });

  it('rejects values that are not tiers', () => {
    expect(isTier('free')).toBe(true);
    expect(isTier('enterprise')).toBe(false); // the label, not the value
    expect(isTier(undefined)).toBe(false);
  });
});

describe('the registry reproduces the grant grid', () => {
  it('covers exactly the capabilities the grid names', () => {
    expect([...CAPABILITY_KEYS].sort()).toEqual(Object.keys(GRID).sort());
    expect(capabilitiesFor('org')).toHaveLength(21);
    expect(capabilitiesFor('personal')).toHaveLength(10);
  });

  // The load-bearing test. 63 grid cells against 21 minimum tiers: if the
  // collapse lost anything, a cell disagrees here.
  it('grants exactly what the grid grants, in every cell', () => {
    for (const [key, cells] of Object.entries(GRID)) {
      TIERS.forEach((tier, i) => {
        expect(
          granted(tier, key as CapabilityKey),
          `${key} at ${tier} should be ${cells[i]}`,
        ).toBe(cells[i]);
      });
    }
  });

  it('is monotonic - nothing granted low is withdrawn higher', () => {
    for (const key of CAPABILITY_KEYS) {
      let seenGranted = false;
      for (const tier of TIERS) {
        const g = granted(tier, key);
        if (seenGranted) expect(g, `${key} withdrawn at ${tier}`).toBe(true);
        if (g) seenGranted = true;
      }
    }
  });
});

describe('grantedCapabilities', () => {
  it('never returns a capability from the other ladder', () => {
    for (const tier of TIERS) {
      for (const k of grantedCapabilities('org', tier)) {
        expect(CAPABILITIES[k].ladder).toBe('org');
      }
      for (const k of grantedCapabilities('personal', tier)) {
        expect(CAPABILITIES[k].ladder).toBe('personal');
      }
    }
  });

  it('widens as the tier rises and never narrows', () => {
    for (const ladder of ['org', 'personal'] as const) {
      const free = new Set(grantedCapabilities(ladder, 'free'));
      const pro = new Set(grantedCapabilities(ladder, 'pro'));
      const max = new Set(grantedCapabilities(ladder, 'max'));
      for (const k of free) expect(pro.has(k)).toBe(true);
      for (const k of pro) expect(max.has(k)).toBe(true);
      expect(max.size).toBeGreaterThan(free.size);
    }
  });

  it('gives a free org exactly the two capabilities the sheet grants', () => {
    expect(grantedCapabilities('org', 'free').sort()).toEqual([
      'create_event',
      'stamped_certificates',
    ]);
  });
});

describe('lockState', () => {
  it('names the capability and what it unlocks', () => {
    const s = lockState('starter', 'multi_campus');
    expect(s.granted).toBe(false);
    expect(s.label).toBe('Campuses and units');
    expect(s.surface).toMatch(/nested units/);
  });

  // The product rule: a locked surface names the capability, never the price
  // tier. Asserted structurally so it cannot regress by accident once someone
  // reaches for the Tier that is right there.
  it('never leaks a tier into what the locked surface renders', () => {
    // Whole words only - "profile" legitimately contains "pro", and a substring
    // check would forbid half the copy in the product for no reason.
    const forbidden = ['free', 'pro', 'max', 'enterprise', 'elite', 'tier', 'tiers', 'upgrade', 'plan', 'plans'];
    const pattern = new RegExp(`\\b(${forbidden.join('|')})\\b`, 'i');

    for (const key of CAPABILITY_KEYS) {
      const s = lockState('free', key);
      const rendered = `${s.label} ${s.surface}`;
      const hit = pattern.exec(rendered);
      expect(hit?.[0], `${key} names the tier: "${rendered}"`).toBeUndefined();
      expect(s).not.toHaveProperty('minTier');
      expect(s).not.toHaveProperty('requiredTier');
    }
  });

  it('reports granted for anything at or above the minimum', () => {
    expect(lockState('max', 'multi_campus').granted).toBe(true);
    expect(lockState('free', 'create_event').granted).toBe(true);
  });
});

describe('the plan page helpers', () => {
  it('are the one place a tier may be named', () => {
    expect(requiredTier('multi_campus')).toBe('pro');
    expect(requiredTier('sso')).toBe('max');
    expect(requiredTier('create_event')).toBe('free');
  });

  it('labels the top tier per its own ladder', () => {
    expect(requiredTierLabel('sso')).toBe('Enterprise');
    expect(requiredTierLabel('ai_coach')).toBe('Elite');
  });
});
