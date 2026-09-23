import { describe, expect, it } from 'vitest';
import { buildPlayerStatRows } from './player-stats.service.js';
import type { Db } from '../../infra/prisma.js';
import type { FixtureParticipants } from '../fixtures/participants.js';

// A ranking event (athletics, swimming, powerlifting...) has no home_team_id and
// no away_team_id at all - there is no side to sort a competitor into. Before the
// fix this meant `sideOf` stayed empty for everyone and the function silently
// returned zero rows, whatever the resolved participants looked like.
function fakeDb(fixture: Record<string, unknown>) {
  return { fixtures: { findUnique: async () => fixture } } as unknown as Db;
}

describe('buildPlayerStatRows · ranking events', () => {
  it('writes a bare appearance row for every resolved competitor, with no side to sort into', async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      live_state: {}, lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-athletics', sports: { name: 'Athletics' } },
      },
    });
    const participants: FixtureParticipants = {
      resolved: [
        { user_id: 'arjun', team_id: 'solo-arjun', organization_id: 'org1', competitor_id: 'c1', name: 'Arjun' },
      ],
      unmatched: [],
    };

    const rows = await buildPlayerStatRows(db, 'fx1', participants);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fixture_id: 'fx1', user_id: 'arjun', team_id: 'solo-arjun', organization_id: 'org1',
      sport_id: 'sport-athletics', partner_user_id: null, position: null,
      played: true, outcome: null, stats: {},
    });
  });

  it('writes nothing when nobody could be resolved to an account', async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      live_state: {}, lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: null,
    });
    const rows = await buildPlayerStatRows(db, 'fx1', { resolved: [], unmatched: [] });
    expect(rows).toEqual([]);
  });
});
