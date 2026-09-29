import { Router } from 'express';
import { z } from 'zod';
import { PLANS_ENFORCED_SETTING } from '@semp/entitlements';
import { clearPlanEnforcementCache, plansEnforced } from '@semp/entitlements/server';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';

// Platform-wide switches, super-admin only. Today there is one: whether plans are
// enforced. Off, every tenant resolves to the top tier and the Billing tab is hidden;
// on, the saved plans apply again untouched - see resolve.ts in @semp/entitlements.
export function makePlatformSettingsRouter(prisma: Prisma): Router {
  const router = Router();

  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const row = await prisma.platform_settings.findUnique({
      where: { key: PLANS_ENFORCED_SETTING },
      select: { updated_at: true, users: { select: { name: true } } },
    });
    res.json({
      plans_enforced: await plansEnforced(prisma),
      updated_at: row?.updated_at ?? null,
      updated_by: row?.users?.name ?? null,
    });
  }));

  router.put('/plans-enforced', requireSuperAdmin, validateBody(z.object({ enforced: z.boolean() })), asyncHandler(async (req, res) => {
    const enforced = req.body.enforced as boolean;
    const before = await plansEnforced(prisma);
    await prisma.platform_settings.upsert({
      where: { key: PLANS_ENFORCED_SETTING },
      update: { value: enforced, updated_at: new Date(), updated_by: req.user!.id },
      create: { key: PLANS_ENFORCED_SETTING, value: enforced, updated_by: req.user!.id },
    });
    // This instance sees it at once; others within the resolver's cache window.
    clearPlanEnforcementCache();

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.platformSettingChanged,
      target: { type: 'platform_settings', id: PLANS_ENFORCED_SETTING, label: 'Plan enforcement' },
      summary: enforced
        ? 'Turned plans on - saved plans apply again'
        : 'Turned plans off - everyone is treated as Enterprise',
      diff: { plans_enforced: { from: before, to: enforced } },
    });
    res.json({ plans_enforced: enforced });
  }));

  return router;
}
