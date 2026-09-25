import { describe, it, expect } from 'vitest';
import { resolveFixtureParticipants } from './participants.js';

// A fixtures/team_members/users stand-in. The raw phone query is answered the way
// Postgres would: match on the last 10 digits, ignoring formatting.
//
// `soloTeams` stands in for the individual-discipline team record an entrant is
// registered through behind the scenes - the join that the `where.user_id.in`
// shaped query resolves, as opposed to the `where.team_id.in` shaped one used
// for an ordinary team match.
function fakeDb({ fixture, members = [], soloTeams = [], users = [], teamEntries = [] }: {
  fixture: any;
  members?: Array<{ user_id: string; team_id: string; name: string; org?: string }>;
  soloTeams?: Array<{ user_id: string; team_id: string; org?: string }>;
  users?: Array<{ id: string; name: string; phone: string }>;
  teamEntries?: Array<{ organization_id: string; tournament_discipline_id: string; team_id: string }>;
}) {
  const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);
  return {
    fixtures: { findUnique: async () => fixture },
    team_entries: {
      findMany: async ({ where }: any) => teamEntries
        .filter((e) => where.organization_id.in.includes(e.organization_id)
          && e.tournament_discipline_id === where.tournament_discipline_id)
        .map((e) => ({ team_id: e.team_id })),
    },
    team_members: {
      findMany: async ({ where }: any) => {
        if (where.team_id?.in) {
          return members
            .filter((m) => where.team_id.in.includes(m.team_id))
            .map((m) => ({
              user_id: m.user_id, team_id: m.team_id,
              users: { name: m.name },
              teams: { organization_id: m.org ?? null },
            }));
        }
        return soloTeams
          .filter((m) => where.user_id.in.includes(m.user_id))
          .map((m) => ({ user_id: m.user_id, team_id: m.team_id, teams: { organization_id: m.org ?? null } }));
      },
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
          { id: 'c1', name: 'Ananya', phone: '+91 98765 43210', orgId: 'stale-json-org' },
          { id: 'c2', name: 'Rahul', phone: '9876500011' },
        ] } },
      },
      // Ananya's individual-discipline team record is on file; Rahul's isn't
      // (e.g. not yet entered for this discipline), so he falls back to
      // whatever live_state itself says - nothing, here.
      soloTeams: [{ user_id: 'u9', team_id: 'solo-u9', org: 'o1' }],
      users: [
        { id: 'u9', name: 'Ananya R', phone: '9876543210' },
        { id: 'u8', name: 'Rahul S', phone: '+919876500011' },
      ],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    expect(out.resolved.map((p) => p.user_id).sort()).toEqual(['u8', 'u9']);
    // The competitor row id comes back with them - it is the only handle those
    // JSON rows have, and per-competitor medals are ranked by it (J4-E4-S1).
    //
    // Her real team record wins over the stale org id embedded in live_state -
    // an individual entrant is registered through a team behind the scenes too.
    expect(out.resolved.find((p) => p.user_id === 'u9'))
      .toMatchObject({ competitor_id: 'c1', team_id: 'solo-u9', organization_id: 'o1' });
    // No team record found for him at all: falls back to null, not to a side.
    expect(out.resolved.find((p) => p.user_id === 'u8'))
      .toMatchObject({ competitor_id: 'c2', team_id: null, organization_id: null });
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

  // The default "Team ranking" console ranks orgs (live_state.eventRanking.rows),
  // not teams - this is the org -> team_entries -> roster expansion that lets a
  // placed org's one athlete (individual disciplines cap squad_max at 1) get
  // resolved the same way a match's home/away team is.
  it('resolves the default Team ranking console\'s placed orgs to their one entrant', async () => {
    const db = fakeDb({
      fixture: {
        home_team_id: null, away_team_id: null, tournament_discipline_id: 'td1',
        live_state: { eventRanking: { rows: [
          { orgId: 'o1', place: 1 }, { orgId: 'o2', place: 2 }, { orgId: 'o3', place: null },
        ] } },
      },
      teamEntries: [
        { organization_id: 'o1', tournament_discipline_id: 'td1', team_id: 'tA' },
        { organization_id: 'o2', tournament_discipline_id: 'td1', team_id: 'tB' },
        { organization_id: 'o3', tournament_discipline_id: 'td1', team_id: 'tC' },
      ],
      members: [
        { user_id: 'u1', team_id: 'tA', name: 'Arjun', org: 'o1' },
        { user_id: 'u2', team_id: 'tB', name: 'Bela', org: 'o2' },
        { user_id: 'u3', team_id: 'tC', name: 'Chetan', org: 'o3' },
      ],
    });
    const out = await resolveFixtureParticipants(db, 'fx1');
    expect(out.resolved.map((p) => p.user_id).sort()).toEqual(['u1', 'u2', 'u3']);
    expect(out.resolved.find((p) => p.user_id === 'u1')).toMatchObject({ team_id: 'tA', organization_id: 'o1' });
    expect(out.unmatched).toEqual([]);
  });

  it('returns nothing for a fixture that no longer exists', async () => {
    const db = fakeDb({ fixture: null });
    await expect(resolveFixtureParticipants(db, 'gone')).resolves.toEqual({ resolved: [], unmatched: [] });
  });
});
