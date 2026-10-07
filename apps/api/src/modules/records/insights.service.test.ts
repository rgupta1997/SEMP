import { describe, expect, it } from 'vitest';
import { insightsEnabled } from './insights.service.js';

const dbWith = (row: { value: unknown } | null) =>
  ({ platform_settings: { findUnique: async () => row } }) as any;

describe('the player insights switch', () => {
  it('is on when nobody has set it - the feature ships enabled', async () => {
    expect(await insightsEnabled(dbWith(null))).toBe(true);
  });

  it('is off only when a super admin turned it off', async () => {
    expect(await insightsEnabled(dbWith({ value: false }))).toBe(false);
    expect(await insightsEnabled(dbWith({ value: true }))).toBe(true);
  });
});
