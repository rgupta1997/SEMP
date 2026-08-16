import { describe, it, expect } from 'vitest';
import { resolveFixtureParticipants } from './participants.js';

// A fixtures/team_members/users stand-in. The raw phone query is answered the way
// Postgres would: match on the last 10 digits, ignoring formatting.
function fakeDb({ fixture, members = [], users = [] }: {
  fixture: any;
  members?: Array<{ user_id: string; team_id: string; name: string; org?: string }>;
  users?: Array<{ id: string; name: string; phone: string }>;
}) {
  const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);
  return {
    fixtures: { findUnique: async () => fixture },
    team_members: {
      findMany: async ({ where }: any) => members
        .filter((m) => where.team_id.in.includes(m.team_id))
        .map((m) => ({
          user_id: m.user_id, team_id: m.team_id,
          users: { name: m.name },
          teams: { organization_id: m.org ?? null },
        })),
    },
    $queryRawUnsafe: async (_sql: string, keys: string[]) =>
      users.filter((u) => keys.includes(last10(u.phone))),
  } as any;
}

describe('resolveFixtureParticipants', () => {
  it('resolves a team match to the active members of both sides', async () => {
    const db = fakeDb({
      fixture: { home_team_id: 'tA', away_team_id: 'tB', live_state: {} },
      members: [
        { user_id: 'u1', team_id: 'tA', name: 'Asha', org: 'o1' },
        { user_id: 'u2', team_id: 'tB', name: 'Bharat', org: 'o2' },
      ],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    // The organisation each side represented is captured HERE, at lock time, and
    // denormalised onto their permanent record - a transfer next season must not
    // rewrite who they played for today (J4-E2-S3).
    expect(out.resolved).toEqual([
      { user_id: 'u1', team_id: 'tA', organization_id: 'o1', competitor_id: null, name: 'Asha' },
      { user_id: 'u2', team_id: 'tB', organization_id: 'o2', competitor_id: null, name: 'Bharat' },
    ]);
    expect(out.unmatched).toEqual([]);
  });

  // The point of the story: a swimmer exists only as JSON until this runs.
  it('matches ranking-event competitors to accounts by phone, ignoring formatting', async () => {
    const db = fakeDb({
      fixture: {
        home_team_id: null, away_team_id: null,
        live_state: { event: { participants: [
          { id: 'c1', name: 'Ananya', phone: '+91 98765 43210', orgId: 'o1' },
          { id: 'c2', name: 'Rahul', phone: '9876500011' },
        ] } },
      },
      users: [
        { id: 'u9', name: 'Ananya R', phone: '9876543210' },
        { id: 'u8', name: 'Rahul S', phone: '+919876500011' },
      ],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    expect(out.resolved.map((p) => p.user_id).sort()).toEqual(['u8', 'u9']);
    // No team: an individual competitor's result is theirs, not a side's.
    expect(out.resolved.every((p) => p.team_id === null)).toBe(true);
    // The competitor row id comes back with them - it is the only handle those
    // JSON rows have, and per-competitor medals are ranked by it (J4-E4-S1).
    expect(out.resolved.find((p) => p.user_id === 'u9')).toMatchObject({ competitor_id: 'c1', organization_id: 'o1' });
    expect(out.resolved.find((p) => p.user_id === 'u8')).toMatchObject({ competitor_id: 'c2', organization_id: null });
    expect(out.unmatched).toEqual([]);
  });

  it('records competitors it cannot match rather than dropping them', async () => {
    const db = fakeDb({
      fixture: {
        home_team_id: null, away_team_id: null,
        live_state: { participants: [
          { name: 'Known', phone: '9876543210' },
          { name: 'Unknown', phone: '9000000000' },
          { name: 'No phone at all' },
        ] },
      },
      users: [{ id: 'u9', name: 'Known', phone: '9876543210' }],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    expect(out.resolved).toHaveLength(1);
    expect(out.unmatched).toEqual([
      { name: 'Unknown', phone_hint: '••••0000' },
      { name: 'No phone at all', phone_hint: null },
    ]);
  });

  it('never repeats a person who is both a team member and a listed competitor', async () => {
    const db = fakeDb({
      fixture: {
        home_team_id: 'tA', away_team_id: null,
        live_state: { participants: [{ id: 'c1', name: 'Asha', phone: '9876543210' }] },
      },
      members: [{ user_id: 'u1', team_id: 'tA', name: 'Asha', org: 'o1' }],
      users: [{ id: 'u1', name: 'Asha', phone: '9876543210' }],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    expect(out.resolved).toHaveLength(1);
    // The team membership is the more specific fact, so it wins - but the
    // competitor row is still recorded on them, or they would lose the medal
    // their swim earned.
    expect(out.resolved[0]).toMatchObject({ team_id: 'tA', organization_id: 'o1', competitor_id: 'c1' });
  });

  it('returns nothing for a fixture that no longer exists', async () => {
    const db = fakeDb({ fixture: null });
    await expect(resolveFixtureParticipants(db, 'gone')).resolves.toEqual({ resolved: [], unmatched: [] });
  });
});
