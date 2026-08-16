import { describe, it, expect, beforeEach } from 'vitest';
import {
  supersedeAchievements, supersedeLifetimeEntries, writeAchievementsFor, writeLifetimeEntriesFor,
} from './records.service.js';
import type { FixtureParticipants } from '../fixtures/participants.js';

// The correction cycle, which is the reliability property this subsystem lives or
// dies on:
//
//   lock v0 → unlock → relock v1
//
// After it, a player must hold exactly ONE live gold - not two, and not zero -
// and the withdrawn one must still be on the record as superseded rather than
// deleted. Everything below exercises that with an in-memory stand-in, because
// the failure it guards against (a medal silently doubling after a protest) is
// invisible in any single-lock test.

interface Row { id: string; fixture_id: string | null; lock_version: number | null; superseded_at: Date | null; [k: string]: unknown }

function fakeDb(fixture: Record<string, unknown>) {
  let seq = 0;
  const tables: Record<'lifetime_entries' | 'achievements', Row[]> = { lifetime_entries: [], achievements: [] };

  const table = (name: 'lifetime_entries' | 'achievements') => ({
    createMany: async ({ data }: any) => {
      for (const d of data) tables[name].push({ id: `${name}-${++seq}`, superseded_at: null, ...d });
      return { count: data.length };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of tables[name]) {
        if (r.fixture_id !== where.fixture_id) continue;
        if (where.superseded_at === null && r.superseded_at !== null) continue;
        if (where.lock_version != null && r.lock_version !== where.lock_version) continue;
        Object.assign(r, data);
        count += 1;
      }
      return { count };
    },
  });

  return {
    tables,
    live: (name: 'lifetime_entries' | 'achievements') => tables[name].filter((r) => r.superseded_at === null),
    db: {
      fixtures: { findUnique: async () => fixture },
      fixture_awards: { findMany: async () => [] },
      award_types: { findMany: async () => [] },
      lifetime_entries: table('lifetime_entries'),
      achievements: table('achievements'),
    } as any,
  };
}

const FIXTURE = {
  id: 'fx1', round: 'Final', status: 'completed',
  scheduled_at: new Date('2026-03-14T10:30:00Z'), updated_at: new Date('2026-08-16T09:00:00Z'),
  home_team_id: 'tA', away_team_id: 'tB', home_score: 2, away_score: 0, winner_team_id: 'tA',
  live_state: null, lock_version: 0,
  teams_fixtures_home_team_idToteams: { name: 'IIMB' },
  teams_fixtures_away_team_idToteams: { name: 'IIMA' },
  tournament_disciplines: {
    format_config: null,
    disciplines: { name: 'Mens' },
    tournament_sports: {
      sports: { id: 'sp1', name: 'Football' },
      tournaments: { championship_id: 'champ1', championships: { name: 'Inter-College 2026' } },
    },
  },
};

const PARTICIPANTS: FixtureParticipants = {
  resolved: [
    { user_id: 'u1', team_id: 'tA', organization_id: 'o1', competitor_id: null, name: 'Winner' },
    { user_id: 'u2', team_id: 'tB', organization_id: 'o2', competitor_id: null, name: 'Loser' },
  ],
  unmatched: [],
};

let world: ReturnType<typeof fakeDb>;
beforeEach(() => { world = fakeDb({ ...FIXTURE }); });

const lock = async (version = 0) => {
  world.db.fixtures.findUnique = async () => ({ ...FIXTURE, lock_version: version });
  await writeLifetimeEntriesFor(world.db, 'fx1', PARTICIPANTS);
  await writeAchievementsFor(world.db, 'fx1', PARTICIPANTS);
};

const unlock = async (version: number) => {
  await supersedeLifetimeEntries(world.db, 'fx1', version);
  await supersedeAchievements(world.db, 'fx1', version);
};

// ---------------------------------------------------------------------------

describe('writing the record at lock', () => {
  it('writes one timeline entry per participant and stamps the lock version', async () => {
    await lock();
    expect(world.live('lifetime_entries')).toHaveLength(2);
    for (const r of world.live('lifetime_entries')) {
      expect(r).toMatchObject({ fixture_id: 'fx1', championship_id: 'champ1', sport_id: 'sp1', lock_version: 0, source: 'locked_result' });
    }
  });

  it('dates the record when the match was played, not when it was locked', async () => {
    await lock();
    // Locked five months after the fixture. A timeline dated by paperwork would
    // put a March final in August and scatter the player's season.
    for (const r of world.live('lifetime_entries')) {
      expect((r.occurred_on as Date).toISOString().slice(0, 10)).toBe('2026-03-14');
    }
  });

  it('writes the squad achievement and the per-member copies', async () => {
    await lock();
    const live = world.live('achievements');
    expect(live.filter((a) => a.team_id === 'tA' && a.medal === 'gold')).toHaveLength(1);
    expect(live.filter((a) => a.user_id === 'u1' && a.medal === 'gold')).toHaveLength(1);
    expect(live.filter((a) => a.user_id === 'u2' && a.medal === 'silver')).toHaveLength(1);
  });
});

describe('the correction cycle (J4-E4-S3)', () => {
  it('leaves exactly one live gold after lock → unlock → relock', async () => {
    await lock(0);
    await unlock(0);
    await lock(1);

    const goldForU1 = world.live('achievements').filter((a) => a.user_id === 'u1' && a.medal === 'gold');
    expect(goldForU1).toHaveLength(1);
    expect(goldForU1[0].lock_version).toBe(1);

    expect(world.live('lifetime_entries')).toHaveLength(2);
    expect(world.live('lifetime_entries').every((r) => r.lock_version === 1)).toBe(true);
  });

  it('supersedes rather than deletes - the withdrawn medal stays on the record', async () => {
    await lock(0);
    await unlock(0);

    expect(world.live('achievements')).toHaveLength(0);
    // Still there, stamped, and attributable to the version it came from.
    const retired = world.tables.achievements.filter((a) => a.superseded_at !== null);
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.every((a) => a.lock_version === 0)).toBe(true);
  });

  it('supersedes only the version named, never a later one', async () => {
    await lock(0);
    await unlock(0);
    await lock(1);
    // A stale unlock for v0 arriving late must not wipe the corrected record.
    await unlock(0);
    expect(world.live('achievements').every((a) => a.lock_version === 1)).toBe(true);
    expect(world.live('lifetime_entries')).toHaveLength(2);
  });

  it('repairs itself when a relock follows an unlock that never superseded', async () => {
    await lock(0);
    // No unlock ran - the previous generation is still live. A relock must leave
    // one live record, not two.
    await lock(1);
    expect(world.live('lifetime_entries')).toHaveLength(2);
    expect(world.live('achievements').filter((a) => a.user_id === 'u1' && a.medal === 'gold')).toHaveLength(1);
    expect(world.live('lifetime_entries').every((r) => r.lock_version === 1)).toBe(true);
  });
});

describe('nothing to record', () => {
  it('writes no achievement for a league fixture, but still writes the timeline', async () => {
    world.db.fixtures.findUnique = async () => ({ ...FIXTURE, round: 'League' });
    await writeLifetimeEntriesFor(world.db, 'fx1', PARTICIPANTS);
    await writeAchievementsFor(world.db, 'fx1', PARTICIPANTS);
    expect(world.live('achievements')).toHaveLength(0);
    expect(world.live('lifetime_entries')).toHaveLength(2);
  });

  it('is inert for a fixture with nobody resolved', async () => {
    await writeLifetimeEntriesFor(world.db, 'fx1', { resolved: [], unmatched: [] });
    await writeAchievementsFor(world.db, 'fx1', { resolved: [], unmatched: [] });
    expect(world.tables.lifetime_entries).toHaveLength(0);
    // The final still decided a squad medal, which stands on its own.
    expect(world.live('achievements').every((a) => a.team_id != null)).toBe(true);
  });

  it('is inert for a fixture that no longer exists', async () => {
    world.db.fixtures.findUnique = async () => null;
    await expect(writeLifetimeEntriesFor(world.db, 'gone', PARTICIPANTS)).resolves.toBeUndefined();
    expect(world.tables.lifetime_entries).toHaveLength(0);
  });
});
