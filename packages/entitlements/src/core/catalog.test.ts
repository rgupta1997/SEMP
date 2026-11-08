import { afterEach, describe, expect, it } from 'vitest';
import {
  catalogSettings,
  granted,
  installCatalog,
  isDefaultFormat,
  planFor,
  planLadder,
  resolveEventPlan,
  EMPTY_OVERLAY,
} from './index.js';
import { sanitiseMinTiers, sanitisePlan, sanitiseSettings } from '../server/catalog.js';

afterEach(() => installCatalog(EMPTY_OVERLAY));

describe('the console overlay', () => {
  it('reads the code defaults when nothing is stored', () => {
    expect(planFor('org', 'starter').name).toBe('Starter');
    expect(planFor('org', 'free').limits.disciplines_per_sport).toBe(1);
    expect(catalogSettings().defaultOrgPlan).toBe('pro');
    expect(catalogSettings().graceDays).toBe(3);
  });

  it('renames, reprices and moves ONE limit without restating the rest', () => {
    installCatalog({
      version: '2',
      plans: { org: { starter: { name: 'Club', price: { monthly: 99_900, annual: 999_000 }, limits: { teams_per_event: 40 } } } },
      minTiers: {},
      settings: {},
    });
    const p = planFor('org', 'starter');
    expect(p.name).toBe('Club');
    expect(p.price.monthly).toBe(99_900);
    expect(p.limits.teams_per_event).toBe(40);
    // untouched ceilings keep their defaults
    expect(p.limits.active_events).toBe(3);
  });

  it('moves a capability to another plan, for the guard and the plan page alike', () => {
    expect(granted('starter', 'custom_points')).toBe(false);
    installCatalog({ version: '3', plans: {}, minTiers: { custom_points: 'starter' }, settings: {} });
    expect(granted('starter', 'custom_points')).toBe(true);
    expect(granted('free', 'custom_points')).toBe(false);
  });

  it('can hide a plan from the plan page without removing the slot', () => {
    installCatalog({ version: '4', plans: { org: { starter: { offered: false } } }, minTiers: {}, settings: {} });
    expect(planLadder('org').map((p) => p.tier)).toEqual(['free', 'pro', 'max']);
  });

  it('matches default formats case-insensitively, and Rankings stays free', () => {
    expect(isDefaultFormat('knockout')).toBe(true);
    expect(isDefaultFormat('Rankings')).toBe(true);
    expect(isDefaultFormat('League')).toBe(false);
    installCatalog({ version: '5', plans: {}, minTiers: {}, settings: { defaultFormats: ['League'] } });
    expect(isDefaultFormat('league')).toBe(true);
    expect(isDefaultFormat('Knockout')).toBe(false);
  });
});

describe('sanitising what is stored', () => {
  it('drops unknown keys, bad money and negative limits', () => {
    const p = sanitisePlan({
      name: '  Club  ', price: { monthly: 10.5, annual: 100 }, limits: { teams_per_event: -1, people: null, nonsense: 4 }, junk: true,
    });
    expect(p.name).toBe('Club');
    expect(p.price).toBeUndefined(); // 10.5 paise is not money
    expect(p.limits).toEqual({ people: null });
    expect(p).not.toHaveProperty('junk');
  });

  it('keeps only real capabilities and real tiers', () => {
    expect(sanitiseMinTiers({ custom_points: 'starter', made_up: 'pro', sso: 'gold' })).toEqual({ custom_points: 'starter' });
  });

  it('bounds the grace window and refuses an empty format list', () => {
    expect(sanitiseSettings({ graceDays: 999, defaultFormats: [], defaultOrgPlan: 'pro' })).toEqual({ defaultOrgPlan: 'pro' });
  });
});

describe('which plan an event runs on', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const base = { enforced: true, now, graceUntil: null, planTier: null, planSource: 'org' } as const;

  it('runs everything as max while plans are switched off', () => {
    expect(resolveEventPlan({ ...base, enforced: false, orgTier: 'free' }).tier).toBe('max');
  });

  it('never limits or locks a grandfathered event', () => {
    const s = resolveEventPlan({ ...base, planSource: 'legacy', orgTier: 'free', planTier: 'pro', graceUntil: '2026-01-01' });
    expect(s).toMatchObject({ tier: 'max', locked: false });
  });

  it('follows the org when the org is at or above the booked plan', () => {
    expect(resolveEventPlan({ ...base, orgTier: 'pro', planTier: 'starter' }).tier).toBe('pro');
  });

  it('keeps the booked plan during the grace window after the org drops', () => {
    const s = resolveEventPlan({ ...base, orgTier: 'free', planTier: 'pro', graceUntil: '2026-11-12T00:00:00Z' });
    expect(s).toMatchObject({ tier: 'pro', inGrace: true, locked: false });
  });

  it('locks once grace has run out', () => {
    const s = resolveEventPlan({ ...base, orgTier: 'free', planTier: 'pro', graceUntil: '2026-11-09T00:00:00Z' });
    expect(s).toMatchObject({ tier: 'free', locked: true });
  });

  it('treats a solo host as free, and a pass as independent of the org', () => {
    expect(resolveEventPlan({ ...base, orgTier: null }).tier).toBe('free');
    expect(resolveEventPlan({ ...base, orgTier: 'free', planTier: 'pro', planSource: 'pass' })).toMatchObject({ tier: 'pro', locked: false });
  });
});
