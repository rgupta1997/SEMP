import { Router } from 'express';
import { z } from 'zod';
import { PLANS_ENFORCED_SETTING } from '@semp/entitlements';
import { DEFAULT_HIDDEN_PRESETS, FORMAT_VISIBILITY_SETTING, INSIGHTS_ENABLED_SETTING, RACQUET_PRESETS, isPresetShown } from '@semp/shared';
import { insightsEnabled } from '../records/insights.service.js';
import { formatVisibility } from '../scoring/format-visibility.service.js';
import { BusinessRuleError } from '../../shared/errors.js';
import { clearPlanEnforcementCache, plansEnforced } from '@semp/entitlements/server';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';

// Platform-wide switches, super-admin only.
//   - Plans: off, every tenant resolves to the top tier (see resolve.ts in @semp/entitlements).
//   - Player insights (default on): off, the API sends no insights card on career stats.
//   - Match formats: which built-in racquet formats the pickers offer (rare ones start hidden).
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

  // Built-in racquet formats, per sport, with whether pickers offer them. The first
  // preset of each sport is its default and can't be hidden.
  router.get('/match-formats', requireSuperAdmin, asyncHandler(async (_req, res) => {
    const choices = await formatVisibility(prisma);
    const row = await changed(FORMAT_VISIBILITY_SETTING);
    const firstOf = new Map<string, string>();
    for (const p of RACQUET_PRESETS) if (!firstOf.has(p.sport)) firstOf.set(p.sport, p.presetKey!);
    res.json({
      formats: RACQUET_PRESETS.map((p) => ({
        presetKey: p.presetKey, name: p.name, sport: p.sport,
        shown: isPresetShown(p.presetKey!, choices),
        hiddenByDefault: DEFAULT_HIDDEN_PRESETS.includes(p.presetKey!),
        isDefault: firstOf.get(p.sport) === p.presetKey,
      })),
      updated_at: row?.updated_at ?? null,
      updated_by: row?.users?.name ?? null,
    });
  }));

  router.put('/match-formats', requireSuperAdmin,
    validateBody(z.object({ presetKey: z.string().min(1).max(60), shown: z.boolean() })),
    asyncHandler(async (req, res) => {
      const { presetKey, shown } = req.body as { presetKey: string; shown: boolean };
      const preset = RACQUET_PRESETS.find((p) => p.presetKey === presetKey);
      if (!preset) throw new BusinessRuleError(`"${presetKey}" is not a built-in racquet format`);
      if (!shown && RACQUET_PRESETS.find((p) => p.sport === preset.sport)?.presetKey === presetKey) {
        throw new BusinessRuleError('The sport default format is always offered, so it can\'t be hidden.');
      }
      const choices = await formatVisibility(prisma);
      const before = isPresetShown(presetKey, choices);
      const next = { ...choices, [presetKey]: shown };
      await prisma.platform_settings.upsert({
        where: { key: FORMAT_VISIBILITY_SETTING },
        update: { value: next, updated_at: new Date(), updated_by: req.user!.id },
        create: { key: FORMAT_VISIBILITY_SETTING, value: next, updated_by: req.user!.id },
      });
      await audit(prisma, req, {
        action: AUDIT_ACTIONS.platformSettingChanged,
        target: { type: 'platform_settings', id: FORMAT_VISIBILITY_SETTING, label: 'Match formats' },
        summary: `${shown ? 'Showed' : 'Hid'} the ${preset.sport} format "${preset.name}" in format pickers`,
        diff: { [presetKey]: { from: before, to: shown } },
      });
      res.json({ presetKey, shown });
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
