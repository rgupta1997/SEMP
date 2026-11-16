import { describe, expect, it } from 'vitest';
import { readDrawTables } from './tables.service.js';

// The point tally's group tables. A hand-added match with no pool and a custom round
// ("Eliminator") used to form an empty, unnamed "Table" beside the real pools.
const side = (org: string) => ({ organization_id: org, org_unit_id: null, organizations: { name: org.toUpperCase(), short_name: org.toUpperCase() }, org_units: null });
const fx = (home: string, away: string, pool: number | null, round: string, done = true) => ({
  status: done ? 'completed' : 'scheduled', round, pool_number: pool, stage_sequence: 1,
  home_team_id: `t-${home}`, away_team_id: `t-${away}`,
  home_score: done ? 3 : null, away_score: done ? 1 : null, winner_team_id: done ? `t-${home}` : null, live_state: null,
  teams_fixtures_home_team_idToteams: side(home), teams_fixtures_away_team_idToteams: side(away),
});

function fakeDb(fixtures: any[]) {
  return {
    standings_rules: { findMany: async () => [] },
    tournament_formats: { findMany: async () => [] },
    tournament_disciplines: {
      findUnique: async () => ({
        id: 'draw-1', discipline_id: null, format_id: null, format_config: {}, entry_type: 'team',
        disciplines: { name: "Men's", entry_type: 'team' },
        tournament_sports: { format_id: null, sports: { name: 'Kabaddi' }, tournaments: { championship_id: 'evt-1' } },
        fixtures,
      }),
    },
  } as any;
}

const labels = async (fixtures: any[]) => (await readDrawTables(fakeDb(fixtures), 'draw-1')).stages.flatMap((s) => s.pools.map((p) => p.label));

describe('point tally tables', () => {
  it('a pool stage does not grow an empty "Table" from a pool-less, hand-added match', async () => {
    expect(await labels([
      fx('a', 'b', 1, 'Pool A - Match 1'), fx('c', 'd', 2, 'Pool B - Match 1'),
      fx('a', 'c', null, 'Eliminator', false),
    ])).toEqual(['Pool A', 'Pool B']);
  });

  it('a plain league with no pools still gets its one table', async () => {
    expect(await labels([fx('a', 'b', null, 'Round 1'), fx('b', 'c', null, 'Round 2')])).toEqual(['Table']);
  });
});
