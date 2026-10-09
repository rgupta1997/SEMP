import { Router } from 'express';
import { z } from 'zod';
import { PLANS_ENFORCED_SETTING } from '@semp/entitlements';
import { INSIGHTS_ENABLED_SETTING } from '@semp/shared';
import { insightsEnabled } from '../records/insights.service.js';
import { clearPlanEnforcementCache, plansEnforced } from '@semp/entitlements/server';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';

// Platform-wide switches, super-admin only.
//   - Plans: off, every tenant resolves to the top tier (see resolve.ts in @semp/entitlements).
//   - Player insights (default on): off, the API sends no insights card on career stats.
export function makePlatformSettingsRouter(prisma: Prisma): Router {
  const router = Router();

  const changed = (key: string) => prisma.platform_settings.findUnique({
    where: { key },
    select: { updated_at: true, users: { select: { name: true } } },
  });

  router.get('/', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const [plans, insights] = await Promise.all([changed(PLANS_ENFORCED_SETTING), changed(INSIGHTS_ENABLED_SETTING)]);
    res.json({
      plans_enforced: await plansEnforced(prisma),
      updated_at: plans?.updated_at ?? null,
      updated_by: plans?.users?.name ?? null,
      insights_enabled: await insightsEnabled(prisma),
      insights_updated_at: insights?.updated_at ?? null,
      insights_updated_by: insights?.users?.name ?? null,
    });
  }));

  router.put('/player-insights', requireSuperAdmin, validateBody(z.object({ enabled: z.boolean() })), asyncHandler(async (req, res) => {
    const enabled = req.body.enabled as boolean;
    const before = await insightsEnabled(prisma);
    await prisma.platform_settings.upsert({
      where: { key: INSIGHTS_ENABLED_SETTING },
      update: { value: enabled, updated_at: new Date(), updated_by: req.user!.id },
      create: { key: INSIGHTS_ENABLED_SETTING, value: enabled, updated_by: req.user!.id },
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.platformSettingChanged,
      target: { type: 'platform_settings', id: INSIGHTS_ENABLED_SETTING, label: 'Player insights' },
      summary: enabled
        ? 'Turned player insights on - the insights card shows on career stats'
        : 'Turned player insights off - career stats show the tiles and filters only',
      diff: { insights_enabled: { from: before, to: enabled } },
    });
    res.json({ insights_enabled: enabled });
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
