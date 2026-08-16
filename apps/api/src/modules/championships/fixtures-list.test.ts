import { describe, it, expect, vi } from 'vitest';
import { listChampionshipFixtures } from './fixtures-list.js';

// A corrected result must carry a dated amendment notice everywhere it appears -
// including the unauthenticated share page, which reads this same list (J6-E4-S4).
// These tests pin down where that date comes from, because the three sources are
// easy to confuse and the wrong one would date the correction to the wrong day.

const LOCKED_AT = new Date('2026-08-15T10:00:00Z');
const UNLOCKED_AT = new Date('2026-08-14T09:00:00Z');
const UPDATED_AT = new Date('2026-08-16T11:00:00Z');

const fixture = (over: Record<string, unknown> = {}) => ({
  id: 'fx1',
  status: 'completed',
  scorecard_status: 'locked',
  submitted_at: null,
  locked_at: LOCKED_AT,
  lock_version: 0,
  updated_at: UPDATED_AT,
  round: 'Final',
  scheduled_at: null,
  duration_minutes: null,
  tournament_discipline_id: 'd1',
  home_score: 3,
  away_score: 1,
  winner_team_id: 'tA',
  home_team_id: 'tA',
  away_team_id: 'tB',
  venue_ground_id: null,
  official_id: null,
  pool_number: null,
  bracket_position: null,
  live_state: {},
  teams_fixtures_home_team_idToteams: null,
  teams_fixtures_away_team_idToteams: null,
  venue_grounds: null,
  tournament_disciplines: null,
  ...over,
});

function fakePrisma(rows: any[], auditRows: any[] = []) {
  const auditFindMany = vi.fn(async () => auditRows);
  const prisma: any = {
    fixtures: { findMany: async () => rows },
    audit_log: { findMany: auditFindMany },
  };
  return { prisma, auditFindMany };
}

describe('listChampionshipFixtures · amendment notice', () => {
  it('says nothing about an amendment for a result that was never corrected', async () => {
    const { prisma, auditFindMany } = fakePrisma([fixture()]);
    const [row] = await listChampionshipFixtures(prisma, 'champ1');
    expect(row.amended_at).toBeNull();
    // The overwhelmingly common case must not cost an extra query.
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it('dates the amendment from the re-lock once the corrected result is official again', async () => {
    const { prisma, auditFindMany } = fakePrisma([fixture({ lock_version: 1 })]);
    const [row] = await listChampionshipFixtures(prisma, 'champ1');
    expect(row.lock_version).toBe(1);
    expect(row.amended_at).toEqual(LOCKED_AT);
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it('uses the unlock entry while the correction is still open', async () => {
    const { prisma, auditFindMany } = fakePrisma(
      [fixture({ lock_version: 1, locked_at: null, scorecard_status: 'submitted' })],
      // Newest first, as the query orders them - an older unlock must not win.
      [{ target_id: 'fx1', at: UNLOCKED_AT }, { target_id: 'fx1', at: new Date('2026-07-01T00:00:00Z') }],
    );
    const [row] = await listChampionshipFixtures(prisma, 'champ1');
    expect(row.amended_at).toEqual(UNLOCKED_AT);
    expect(auditFindMany).toHaveBeenCalledOnce();
  });

  it('still shows the correction when its audit entry is missing', async () => {
    // Audit writes are best-effort by design, so a missing row must degrade the
    // date - never the disclosure.
    const { prisma } = fakePrisma([fixture({ lock_version: 2, locked_at: null, scorecard_status: 'submitted' })], []);
    const [row] = await listChampionshipFixtures(prisma, 'champ1');
    expect(row.amended_at).toEqual(UPDATED_AT);
  });
});
