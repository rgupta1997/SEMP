import { describe, it, expect } from 'vitest';
import { provisionalEntriesFor } from './provisional.service.js';

// The provisional half of the timeline. Two properties matter more than the
// rest, and both are here because getting either wrong is invisible in the UI:
//
//   1. It returns only fixtures THIS player was in. The first draft spread two
//      sibling `OR` keys into one Prisma where, which silently overwrote the
//      team clause and would have shown every player every result on the
//      platform.
//   2. It carries no achievements. A gold medal from a scorecard an official can
//      still edit must never reach a profile or a countable total.

const FX = (over: Record<string, unknown> = {}) => ({
  id: 'fx1', round: 'Final', status: 'completed',
  scheduled_at: new Date('2026-03-14T10:00:00Z'), updated_at: new Date('2026-03-15T10:00:00Z'),
  home_team_id: 'tA', away_team_id: 'tB', home_score: 3, away_score: 1, winner_team_id: 'tA',
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
  ...over,
});

function fakeDb({ teams = ['tA'], fixtures = [FX()], awards = [] }: {
  teams?: string[]; fixtures?: any[]; awards?: any[];
} = {}) {
  const seen: any[] = [];
  return {
    seen,
    db: {
      team_members: {
        findMany: async () => teams.map((t) => ({
          team_id: t, teams: { organization_id: 'o1' }, users: { name: 'A Player' },
        })),
      },
      fixtures: {
        findMany: async ({ where }: any) => { seen.push(where); return fixtures; },
      },
      fixture_awards: { findMany: async () => awards },
      award_types: { findMany: async () => [{ id: 'at1', code: 'player_of_the_match', label: 'Player of the Match' }] },
    } as any,
  };
}

describe('provisionalEntriesFor', () => {
  it('returns one entry per unlocked fixture the player was in', async () => {
    const { db } = fakeDb();
    const out = await provisionalEntriesFor(db, 'u1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ verified: false, fixture_id: 'fx1', kind: 'result' });
  });

  // The query bug the compiler caught. Both conditions must survive into the
  // where clause: mine AND played. If the team clause is lost, every player
  // sees every result on the platform.
  it('scopes the query to this player\'s teams AND to played fixtures', async () => {
    const { db, seen } = fakeDb();
    await provisionalEntriesFor(db, 'u1');
    const where = seen[0];
    expect(where.scorecard_status).toEqual({ not: 'locked' });
    const serialised = JSON.stringify(where);
    expect(serialised).toContain('home_team_id');   // mine
    expect(serialised).toContain('walkover');       // played
    // Exactly one top-level OR would mean one of the two clauses was overwritten.
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
  });

  it('words a provisional row exactly as the verified one will read', async () => {
    const { db } = fakeDb();
    const out = await provisionalEntriesFor(db, 'u1');
    // Same derivation as the lock uses, so locking flips the badge and nothing
    // else - the sentence describing the match never changes under the player.
    expect(out[0].title).toBe('IIMB vs IIMA — Won 3-1');
    expect(out[0].detail).toMatchObject({ outcome: 'won', championship_name: 'Inter-College 2026' });
  });

  it('dates the entry by the fixture, not by when it was read', async () => {
    const { db } = fakeDb();
    const out = await provisionalEntriesFor(db, 'u1');
    expect(out[0].date.toISOString().slice(0, 10)).toBe('2026-03-14');
  });

  it('carries no medal chips, however decisive the unlocked result', async () => {
    const { db } = fakeDb();
    const out = await provisionalEntriesFor(db, 'u1');
    // The fixture is a won final. Locked, it would be gold; unlocked it is a
    // result and nothing more - the chips array stays empty because no
    // achievement was derived onto it.
    expect((out[0].detail as any).chips).toEqual([]);
  });

  it('shows the match from the away side when that is the player\'s team', async () => {
    const { db } = fakeDb({ teams: ['tB'] });
    const out = await provisionalEntriesFor(db, 'u1');
    expect(out[0].title).toBe('IIMA vs IIMB — Lost 1-3');
  });

  it('is empty for someone on no team at all', async () => {
    const { db } = fakeDb({ teams: [] });
    await expect(provisionalEntriesFor(db, 'u1')).resolves.toEqual([]);
  });

  it('skips a fixture involving neither of the player\'s teams', async () => {
    const { db } = fakeDb({ fixtures: [FX({ home_team_id: 'tX', away_team_id: 'tY' })] });
    await expect(provisionalEntriesFor(db, 'u1')).resolves.toEqual([]);
  });
});
