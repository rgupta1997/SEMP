import { FORMAT_VISIBILITY_SETTING, isPresetShown, readFormatVisibility, type FormatVisibility } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

/** The super admin's shown/hidden choices for built-in formats. */
export async function formatVisibility(db: Db): Promise<FormatVisibility> {
  const row = await db.platform_settings.findUnique({ where: { key: FORMAT_VISIBILITY_SETTING }, select: { value: true } });
  return readFormatVisibility(row?.value);
}

/**
 * The presets a picker offers. Hidden ones drop out, except any `keep` key - the
 * format a draw already uses and the sport default - so nothing in use disappears.
 */
export function visiblePresets<T extends { presetKey?: string }>(presets: T[], choices: FormatVisibility, keep: Array<string | null | undefined>): T[] {
  const kept = new Set(keep.filter((k): k is string => !!k));
  return presets.filter((p) => !p.presetKey || kept.has(p.presetKey) || isPresetShown(p.presetKey, choices));
}
