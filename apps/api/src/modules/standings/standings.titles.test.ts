import { describe, expect, it } from 'vitest';
import { SPORT_TITLES_SCOPE } from '@semp/shared';
import { recomputeStandings } from './standings.service.js';

// Swimming with sport titles on: Men + a women's relay, each feeding its own title. Every
// table, the swimming-only one included, must score the title placings, not raw event points.
const MEN = '11111111-1111-4111-8111-111111111111';
const W_RELAY = '22222222-2222-4222-8222-222222222222';
const SPORT = 'sport-swim';

const event = (disciplineId: string, name: string, standings: Array<{ orgId: string; points: number; gold?: number; silver?: number }>) => ({
  live_state: { eventStandings: standings },
  tournament_discipline_id: `draw-${disciplineId}`,
  tournament_disciplines: {
    discipline_id: disciplineId, format_id: null,
    disciplines: { name, entry_type: 'team' },
    tournament_sports: { sport_id: SPORT, tournament_id: 'tour-1', format_id: null, sports: { name: 'Swimming' } },
  },
});

function fakeDb() {
  const written: any[] = [];
  const db = {
    standings_rules: {
      findMany: async () => [{
        scope_type: SPORT_TITLES_SCOPE, scope_id: SPORT,
        config: {
          enabled: true,
          events: { [MEN]: 'men', [W_RELAY]: 'women' },
          titles: { Men: { places: [10, 7, 4], participation: 1 }, Women: { places: [10, 7, 4], participation: 1 } },
        },
      }],
    },
    tournament_formats: { findMany: async () => [] },
    standings_adjustments: { findMany: async () => [] },
    tournament_disciplines: { findMany: async () => [] },
    fixtures: {
      groupBy: async () => [],
      findMany: async () => [
        event(MEN, 'Men', [{ orgId: 'iimk', points: 5, gold: 1 }, { orgId: 'iimi', points: 3, silver: 1 }]),
        event(W_RELAY, "Women's 4x25m Medley Relay", [{ orgId: 'iimk', points: 10, gold: 1 }]),
      ],
    },
    standings: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: any) => { written.push(...data); return { count: data.length }; },
    },
  } as any;
  return { db, written };
}

const pointsIn = (written: any[], scope: string) =>
  Object.fromEntries(written.filter((r) => r.scope_type === scope).map((r) => [r.organization_id, r.points]));

describe('a sport with titles on scores its title placings in every table', () => {
  it('the swimming table shows title points (10 + 10), not raw event points (5 + 10)', async () => {
    const { db, written } = fakeDb();
    await recomputeStandings(db, 'evt-1');
    // Men's title: IIMK 1st -> 10, Indore 2nd -> 7. Women's title: IIMK 1st -> 10.
    expect(pointsIn(written, 'sport')).toEqual({ iimk: 20, iimi: 7 });
  });

  it('the overall table is unchanged: the same title points', async () => {
    const { db, written } = fakeDb();
    await recomputeStandings(db, 'evt-1');
    expect(pointsIn(written, 'championship')).toEqual({ iimk: 20, iimi: 7 });
    expect(pointsIn(written, 'tournament')).toEqual({ iimk: 20, iimi: 7 });
  });
});
