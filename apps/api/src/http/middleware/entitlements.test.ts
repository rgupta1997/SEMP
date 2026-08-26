import { describe, it, expect } from 'vitest';
import type { RequestHandler } from 'express';
import { makeEntitlementGuards } from './entitlements.js';

// The subscription gate.
//
// This file exists because of a specific failure: requireCapability was written,
// unit-tested at the resolver level, and then mounted on nothing. The padlock on
// the Reports nav item was the entire enforcement, and the route underneath served
// the full report to anyone who typed the URL.
//
// So there are two kinds of test here. The first checks the guard decides
// correctly. The second checks it is actually MOUNTED on the surfaces that need
// it - a gate nobody installed is indistinguishable from no gate at all, and only
// the second kind of test can tell the difference.

interface User { id: string; isSuperAdmin: boolean; organizationId: string | null }

const MEMBER: User = { id: 'u1', isSuperAdmin: false, organizationId: 'org-free' };
const SUPER: User = { id: 'admin', isSuperAdmin: true, organizationId: 'org-free' };

const PLANS: Record<string, string> = { 'org-free': 'free', 'org-pro': 'pro', 'org-max': 'max' };

const fakePrisma: any = {
  organizations: {
    findUnique: async ({ where }: any) => ({ plan: PLANS[where.id] ?? 'free' }),
  },
  users: { findUnique: async () => ({ personal_plan: 'free' }) },
};

function run(handler: RequestHandler, user: User | null, params: any = {}) {
  return new Promise<{ ok: boolean; status?: number; capability?: string }>((resolve) => {
    const req: any = { user, params };
    const next = (err?: any) => resolve(err
      ? { ok: false, status: err?.status, capability: err?.details?.capability }
      : { ok: true });
    (handler as any)(req, {}, next);
  });
}

describe('requireCapability', () => {
  const { requireCapability } = makeEntitlementGuards(fakePrisma);
  const orgParam = { organizationIdFrom: (req: any) => req.params.id };

  it('refuses when the org tier is below the capability', async () => {
    const r = await run(requireCapability('advanced_reports', orgParam), MEMBER, { id: 'org-free' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    // The client renders the locked surface from this, so it has to survive.
    expect(r.capability).toBe('advanced_reports');
  });

  it('allows once the tier reaches it', async () => {
    const r = await run(requireCapability('advanced_reports', orgParam), MEMBER, { id: 'org-pro' });
    expect(r.ok).toBe(true);
  });

  it('is ordinal: a higher tier grants a lower tier’s capability', async () => {
    const r = await run(requireCapability('advanced_reports', orgParam), MEMBER, { id: 'org-max' });
    expect(r.ok).toBe(true);
  });

  it('still refuses a max-tier capability on pro', async () => {
    const r = await run(requireCapability('multi_campus', orgParam), MEMBER, { id: 'org-pro' });
    expect(r.ok).toBe(false);
    expect(r.capability).toBe('multi_campus');
  });

  it('gates the org in the PATH, not the caller’s own org', async () => {
    // The caller belongs to a free org; the request is about a max one. Reading
    // the caller's own organisation here would refuse a legitimate request - and,
    // worse, would allow one the other way round.
    const r = await run(requireCapability('multi_campus', orgParam), MEMBER, { id: 'org-max' });
    expect(r.ok).toBe(true);
  });

  it('lets super admins through by default', async () => {
    const r = await run(requireCapability('multi_campus', orgParam), SUPER, { id: 'org-free' });
    expect(r.ok).toBe(true);
  });

  it('but not when the route asks for the gate to be exercised', async () => {
    // Anything used to demo or test tier behaviour must pass allowSuperAdmin:false,
    // or a super admin silently bypassing makes a broken gate look like a working one.
    const guard = requireCapability('multi_campus', { ...orgParam, allowSuperAdmin: false });
    const r = await run(guard, SUPER, { id: 'org-free' });
    expect(r.ok).toBe(false);
  });

  it('rejects an unauthenticated caller before asking about plans', async () => {
    const r = await run(requireCapability('advanced_reports', orgParam), null, { id: 'org-max' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
});
