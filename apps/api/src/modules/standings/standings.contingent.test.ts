import { describe, it, expect } from 'vitest';
import { recomputeStandings } from './standings.service.js';

// The regression this whole change exists to fix, asserted end-to-end through the
// real service rather than through the pure scheme layer.
//
// The scheme layer was never the problem - it has always grouped by an opaque key.
// The bug lived in the SERVICE, which derived that key as `teams.organization_id`.
// In an intra-organisation championship every team carries the same organisation, so
// the map collapsed and the standings table came out with exactly one row: the
// institution, playing itself.
//
// So this fakes the database rather than the maths. Everything the service reads is
// stubbed; what is being checked is which column it turns into a row key, and which
// two columns it writes back.

interface Team { organization_id: string; org_unit_id: string | null }

const ORG = 'org-iimb';

/**
 * A championship of one round-robin draw, with the given completed fixtures.
 *
 * `written` receives whatever createMany is handed, which is the assertion surface:
 * the standings table as the service would actually persist it.
 */
function fakeDb(fixtures: Array<{ home: Team; away: Team; homeScore: number; awayScore: number }>) {
  const written: any[] = [];
  const rows = fixtures.map((f, i) => ({
    status: 'completed',
    round: null,
    home_team_id: `t-h${i}`,
    away_team_id: `t-a${i}`,
    home_score: f.homeScore,
    away_score: f.awayScore,
    winner_team_id: f.homeScore > f.awayScore ? `t-h${i}` : f.awayScore > f.homeScore ? `t-a${i}` : null,
    live_state: null,
    teams_fixtures_home_team_idToteams: f.home,
    teams_fixtures_away_team_idToteams: f.away,
  }));

  const db = {
    standings_rules: { findMany: async () => [] },
    tournament_disciplines: {
      findMany: async () => [{
        id: 'draw-1',
        discipline_id: null,
        format_id: null,
        tournament_sports: { sport_id: 'sport-1', tournament_id: 'tour-1', format_id: null },
        fixtures: rows,
      }],
    },
    fixtures: {
      // No pending fixtures, and no ranking-event contributions.
      groupBy: async () => [],
      findMany: async () => [],
    },
    standings: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: any) => { written.push(...data); return { count: data.length }; },
    },
  } as any;

  return { db, written };
}

/** Just the championship-wide table, which is the one a medal tally shows. */
const overall = (written: any[]) => written.filter((r) => r.scope_type === 'championship');

describe('standings key on the contingent, not the organisation', () => {
  it('gives two campuses of ONE organisation two rows', async () => {
    const blr: Team = { organization_id: ORG, org_unit_id: 'blr' };
    const mum: Team = { organization_id: ORG, org_unit_id: 'mum' };

    const { db, written } = fakeDb([{ home: blr, away: mum, homeScore: 3, awayScore: 1 }]);
    await recomputeStandings(db, 'evt-1');

    const table = overall(written);
    expect(table).toHaveLength(2);
    // Before the contingent existed this was ONE row, with played: 2 - the
    // institution having beaten itself.
    expect(table.map((r) => r.org_unit_id).sort()).toEqual(['blr', 'mum']);
    expect(table.every((r) => r.played === 1)).toBe(true);
  });

  it('credits the win to the winning campus and the loss to the other', async () => {
    const blr: Team = { organization_id: ORG, org_unit_id: 'blr' };
    const mum: Team = { organization_id: ORG, org_unit_id: 'mum' };

    const { db, written } = fakeDb([{ home: blr, away: mum, homeScore: 3, awayScore: 1 }]);
    await recomputeStandings(db, 'evt-1');

    const byUnit = Object.fromEntries(overall(written).map((r) => [r.org_unit_id, r]));
    expect(byUnit.blr.won).toBe(1);
    expect(byUnit.blr.lost).toBe(0);
    expect(byUnit.mum.won).toBe(0);
    expect(byUnit.mum.lost).toBe(1);
    expect(byUnit.blr.rank).toBe(1);
    expect(byUnit.mum.rank).toBe(2);
  });

  it('still writes the owning organisation on every intra row', async () => {
    // organization_id is NOT NULL and every foreign key, cascade and existing index
    // is built on it. A campus row that dropped it would break referential integrity
    // and make "which institution is this?" unanswerable.
    const { db, written } = fakeDb([{
      home: { organization_id: ORG, org_unit_id: 'blr' },
      away: { organization_id: ORG, org_unit_id: 'mum' },
      homeScore: 2, awayScore: 0,
    }]);
    await recomputeStandings(db, 'evt-1');
    expect(overall(written).every((r) => r.organization_id === ORG)).toBe(true);
  });

  it('is unchanged for an inter-organisation championship', async () => {
    // The no-regression case. Units are null, so the key IS the organisation id and
    // this must behave exactly as it did before intra events existed.
    const { db, written } = fakeDb([{
      home: { organization_id: 'org-a', org_unit_id: null },
      away: { organization_id: 'org-b', org_unit_id: null },
      homeScore: 1, awayScore: 4,
    }]);
    await recomputeStandings(db, 'evt-1');

    const table = overall(written);
    expect(table).toHaveLength(2);
    expect(table.every((r) => r.org_unit_id === null)).toBe(true);
    expect(table.find((r) => r.organization_id === 'org-b')!.rank).toBe(1);
  });

  it('writes a row per scope, so tournament and sport tables get the unit too', async () => {
    // The scopes are what the sport-by-sport tabs read. A unit that survived only
    // into the championship-wide table would vanish the moment somebody filtered.
    const { db, written } = fakeDb([{
      home: { organization_id: ORG, org_unit_id: 'blr' },
      away: { organization_id: ORG, org_unit_id: 'mum' },
      homeScore: 2, awayScore: 2,
    }]);
    await recomputeStandings(db, 'evt-1');

    for (const scope of ['championship', 'tournament', 'sport']) {
      const rows = written.filter((r) => r.scope_type === scope);
      expect(rows, scope).toHaveLength(2);
      expect(rows.map((r) => r.org_unit_id).sort(), scope).toEqual(['blr', 'mum']);
    }
  });

  it('separates two departments of the SAME campus', async () => {
    // The deepest case: one organisation, one campus, two competing departments.
    // Both the organisation AND the campus are shared, so nothing but the unit id
    // tells these two apart.
    const { db, written } = fakeDb([{
      home: { organization_id: ORG, org_unit_id: 'sales' },
      away: { organization_id: ORG, org_unit_id: 'eng' },
      homeScore: 0, awayScore: 1,
    }]);
    await recomputeStandings(db, 'evt-1');

    const table = overall(written);
    expect(table.map((r) => r.org_unit_id).sort()).toEqual(['eng', 'sales']);
    expect(table.find((r) => r.org_unit_id === 'eng')!.won).toBe(1);
  });
});
