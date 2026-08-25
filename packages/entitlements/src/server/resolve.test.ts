import { describe, it, expect } from 'vitest';
import {
  assertCapability,
  CapabilityRequiredError,
  entitlementSnapshot,
  hasCapability,
  orgTier,
  personalTier,
  tierFor,
  type EntitlementsPrisma,
} from './resolve.js';
import type { Tier } from '../core/index.js';

// A structural double, the way the API's own middleware tests do it. Records
// calls so the transaction-client contract can be checked: this module must read
// through whatever client it is handed, never a captured global.
function fakePrisma(over: {
  orgs?: Record<string, Tier>;
  users?: Record<string, Tier>;
} = {}) {
  const calls: string[] = [];
  const prisma: EntitlementsPrisma & { calls: string[] } = {
    calls,
    organizations: {
      async findUnique({ where }) {
        calls.push(`org:${where.id}`);
        const plan = over.orgs?.[where.id];
        return plan ? { plan } : null;
      },
    },
    users: {
      async findUnique({ where }) {
        calls.push(`user:${where.id}`);
        const personal_plan = over.users?.[where.id];
        return personal_plan ? { personal_plan } : null;
      },
    },
  };
  return prisma;
}

describe('reading a tier', () => {
  it('reads the organisation plan', async () => {
    const p = fakePrisma({ orgs: { iimb: 'max' } });
    expect(await orgTier(p, 'iimb')).toBe('max');
  });

  it('reads the personal plan independently of any org', async () => {
    const p = fakePrisma({ orgs: { iimb: 'max' }, users: { akash: 'free' } });
    expect(await personalTier(p, 'akash')).toBe('free');
  });

  it('treats a missing row as free rather than throwing', async () => {
    const p = fakePrisma();
    expect(await orgTier(p, 'nope')).toBe('free');
    expect(await personalTier(p, 'nope')).toBe('free');
  });
});

describe('tierFor picks the ladder from the capability', () => {
  it('uses the org plan for an org capability', async () => {
    const p = fakePrisma({ orgs: { iimb: 'max' }, users: { akash: 'free' } });
    expect(await tierFor(p, 'multi_campus', { userId: 'akash', organizationId: 'iimb' })).toBe('max');
    expect(p.calls).toEqual(['org:iimb']);
  });

  it('uses the personal plan for a personal capability, ignoring the org', async () => {
    const p = fakePrisma({ orgs: { iimb: 'max' }, users: { akash: 'pro' } });
    expect(await tierFor(p, 'advanced_stats', { userId: 'akash', organizationId: 'iimb' })).toBe('pro');
    expect(p.calls).toEqual(['user:akash']);
  });

  it('falls back to free for an org capability with no org in context', async () => {
    const p = fakePrisma({ users: { akash: 'max' } });
    expect(await tierFor(p, 'multi_campus', { userId: 'akash', organizationId: null })).toBe('free');
  });
});

describe('the two ladders do not cross', () => {
  // The mistake the shared `tier` type invites: an Enterprise org quietly
  // granting its players Elite. Sheet 06 says it must not.
  it('an org on max does not grant its player a personal capability', async () => {
    const p = fakePrisma({ orgs: { iimb: 'max' }, users: { akash: 'free' } });
    const holder = { userId: 'akash', organizationId: 'iimb' };
    expect(await hasCapability(p, 'ai_coach', holder)).toBe(false);
    expect(await hasCapability(p, 'advanced_stats', holder)).toBe(false);
    expect(await hasCapability(p, 'multi_campus', holder)).toBe(true);
  });

  it('a player on max does not grant their org an org capability', async () => {
    const p = fakePrisma({ orgs: { iimb: 'free' }, users: { akash: 'max' } });
    const holder = { userId: 'akash', organizationId: 'iimb' };
    expect(await hasCapability(p, 'ai_coach', holder)).toBe(true);
    expect(await hasCapability(p, 'multi_campus', holder)).toBe(false);
    expect(await hasCapability(p, 'audit_logs', holder)).toBe(false);
  });
});

describe('assertCapability', () => {
  it('passes silently when granted', async () => {
    const p = fakePrisma({ orgs: { iimb: 'pro' } });
    await expect(
      assertCapability(p, 'advanced_reports', { userId: 'u', organizationId: 'iimb' }),
    ).resolves.toBeUndefined();
  });

  it('throws a 403 naming the capability', async () => {
    const p = fakePrisma({ orgs: { iimb: 'pro' } });
    await expect(
      assertCapability(p, 'multi_campus', { userId: 'u', organizationId: 'iimb' }),
    ).rejects.toThrow(CapabilityRequiredError);

    const err = await assertCapability(p, 'sso', { userId: 'u', organizationId: 'iimb' })
      .catch((e) => e as CapabilityRequiredError);
    expect(err.status).toBe(403);
    expect(err.capability).toBe('sso');
    expect(err.ladder).toBe('org');
  });

  // The message crosses the wire and renders on the locked surface, so it is
  // held to the same rule: name the capability, never the price.
  it('produces a message that names no tier', async () => {
    const p = fakePrisma({ orgs: { iimb: 'free' } });
    const err = await assertCapability(p, 'benchmarking', { userId: 'u', organizationId: 'iimb' })
      .catch((e) => e as CapabilityRequiredError);
    const msg = err.message.toLowerCase();
    for (const forbidden of ['enterprise', 'elite', 'tier', 'upgrade', ' plan']) {
      expect(msg, `message mentions "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

describe('entitlementSnapshot', () => {
  it('returns both ladders with the capabilities each grants', async () => {
    const p = fakePrisma({ orgs: { iimb: 'pro' }, users: { akash: 'max' } });
    const snap = await entitlementSnapshot(p, { userId: 'akash', organizationId: 'iimb' });

    expect(snap.org.tier).toBe('pro');
    expect(snap.org.capabilities).toContain('advanced_reports');
    expect(snap.org.capabilities).not.toContain('sso');

    expect(snap.personal.tier).toBe('max');
    expect(snap.personal.capabilities).toContain('ai_coach');

    // never mixes the ladders
    expect(snap.org.capabilities).not.toContain('ai_coach');
    expect(snap.personal.capabilities).not.toContain('multi_campus');
  });

  it('handles a caller with no organisation', async () => {
    const p = fakePrisma({ users: { akash: 'free' } });
    const snap = await entitlementSnapshot(p, { userId: 'akash', organizationId: null });
    expect(snap.org.tier).toBe('free');
    expect(snap.org.capabilities).toEqual(['create_event', 'stamped_certificates']);
  });

  it('reads through the client it is given, not a captured one', async () => {
    const p = fakePrisma({ orgs: { iimb: 'pro' }, users: { akash: 'pro' } });
    await entitlementSnapshot(p, { userId: 'akash', organizationId: 'iimb' });
    expect(p.calls.sort()).toEqual(['org:iimb', 'user:akash']);
  });
});
