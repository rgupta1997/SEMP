import { describe, expect, it } from 'vitest';
import { presetByKey } from '@semp/shared';
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

  it("captures the detailed console's own mark, picking the faster time for a time-based sport", async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-swim', sports: { name: 'Swimming' } },
      },
      live_state: { event: { participants: [
        { id: 'c1', name: 'Fast Swimmer', marks: { 'disc-100bk': 60.1 } },
      ] } },
    });
    const participants: FixtureParticipants = {
      resolved: [{ user_id: 'u1', team_id: 'solo-u1', organization_id: 'org1', competitor_id: 'c1', name: 'Fast Swimmer' }],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    // Sole entrant in her own category: best mark, and rank 1 by default (a podium finish).
    expect(rows[0].stats).toEqual({ mark: 60.1, rank: 1, measured: 1, podium: 1 });
  });

  it('picks the heavier lift for a weight-based sport, and the best of several marks when more than one exists', async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-pl', sports: { name: 'Powerlifting' } },
      },
      live_state: { event: { participants: [
        // A whole-sport session where this lifter's marks ended up under two
        // keys - the best of them is what the appearance produced.
        { id: 'c1', name: 'Lifter', marks: { m63: 100, m74: 130 } },
      ] } },
    });
    const participants: FixtureParticipants = {
      resolved: [{ user_id: 'u1', team_id: 'solo-u1', organization_id: 'org1', competitor_id: 'c1', name: 'Lifter' }],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    expect(rows[0].stats).toEqual({ mark: 130, rank: 1, measured: 1, podium: 1 });
  });

  it("ranks each competitor within their own category, not the whole field", async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-pl', sports: { name: 'Powerlifting' } },
      },
      live_state: { event: { participants: [
        { id: 'c1', name: 'A', marks: { m63: 120 } },
        { id: 'c2', name: 'B', marks: { m63: 110 } },
        // A different class entirely - must not affect either m63 lifter's rank.
        { id: 'c3', name: 'C', marks: { m74: 999 } },
      ] } },
    });
    const participants: FixtureParticipants = {
      resolved: [
        { user_id: 'a', team_id: 'ta', organization_id: 'org1', competitor_id: 'c1', name: 'A' },
        { user_id: 'b', team_id: 'tb', organization_id: 'org2', competitor_id: 'c2', name: 'B' },
        { user_id: 'c', team_id: 'tc', organization_id: 'org3', competitor_id: 'c3', name: 'C' },
      ],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    const by = (uid: string) => rows.find((r) => r.user_id === uid)!.stats;
    expect(by('a')).toEqual({ mark: 120, rank: 1, measured: 1, podium: 1 });
    expect(by('b')).toEqual({ mark: 110, rank: 2, measured: 1, podium: 1 });
    expect(by('c')).toEqual({ mark: 999, rank: 1, measured: 1, podium: 1 });
  });

  it("picks the entry with the BETTER RANK to represent a whole-sport appearance, not the bigger/smaller raw number across incompatible units", async () => {
    // A whole-sport athletics session: this competitor entered a sprint (a TIME,
    // where they won outright) and a field event (a DISTANCE, where they trailed
    // a longer jump) - two numbers on unrelated scales. Comparing them as raw
    // numbers (the bug) picked whichever satisfied "min wins" regardless of what
    // was actually measured; rank fixes that because 1st is 1st either way.
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-ath', sports: { name: 'Athletics' } },
      },
      live_state: { event: { participants: [
        { id: 'c1', name: 'A', marks: { m100: 12.0, mlj: 3.0 } },
        { id: 'c2', name: 'B', marks: { mlj: 6.0 } },
      ] } },
    });
    const participants: FixtureParticipants = {
      resolved: [{ user_id: 'a', team_id: 'ta', organization_id: 'org1', competitor_id: 'c1', name: 'A' }],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    // Sole entrant in the 100m (rank 1) beats 2nd-of-2 in the long jump (rank 2) -
    // the sprint mark is what should represent this appearance, not the jump.
    expect(rows[0].stats).toEqual({ mark: 12.0, rank: 1, measured: 1, podium: 1 });
  });

  it('does not count a 4th-place finish as a podium', async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-pl', sports: { name: 'Powerlifting' } },
      },
      live_state: { event: { participants: [
        { id: 'c1', name: 'A', marks: { m63: 140 } },
        { id: 'c2', name: 'B', marks: { m63: 130 } },
        { id: 'c3', name: 'C', marks: { m63: 120 } },
        { id: 'c4', name: 'D', marks: { m63: 110 } },
      ] } },
    });
    const participants: FixtureParticipants = {
      resolved: [
        { user_id: 'd', team_id: 'td', organization_id: 'org4', competitor_id: 'c4', name: 'D' },
      ],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    expect(rows[0].stats).toEqual({ mark: 110, rank: 4, measured: 1 });
  });

  it('captures nothing for a competitor scored only by the simple "Team ranking" console', async () => {
    const db = fakeDb({
      id: 'fx1', round: 'Final', stage_sequence: null,
      home_team_id: null, away_team_id: null,
      lock_version: 1, scheduled_at: new Date('2026-09-13'),
      winner_team_id: null, home_score: null, away_score: null,
      tournament_disciplines: {
        tournament_sports: { sport_id: 'sport-athletics', sports: { name: 'Athletics' } },
      },
      // The simple console only ever writes an org's placement, never a mark.
      live_state: { eventRanking: { rows: [{ orgId: 'org1', place: 1 }] } },
    });
    const participants: FixtureParticipants = {
      resolved: [{ user_id: 'u1', team_id: 'solo-u1', organization_id: 'org1', competitor_id: null, name: 'Someone' }],
      unmatched: [],
    };
    const rows = await buildPlayerStatRows(db, 'fx1', participants);
    expect(rows[0].stats).toEqual({});
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

describe('buildPlayerStatRows · who actually played', () => {
  const ittf = presetByKey('ittf_bo5_11')!;
  const pts = (side: 'A' | 'B', n: number) => Array.from({ length: n }, () => ({ t: 'point', side }));
  const squad: FixtureParticipants = {
    resolved: [
      { user_id: 'a1', team_id: 'tA', organization_id: 'oA', competitor_id: null, name: 'Karan' },
      { user_id: 'a2', team_id: 'tA', organization_id: 'oA', competitor_id: null, name: 'Priya' },
      { user_id: 'a3', team_id: 'tA', organization_id: 'oA', competitor_id: null, name: 'Bench' },
      { user_id: 'b1', team_id: 'tB', organization_id: 'oB', competitor_id: null, name: 'Sameer' },
      { user_id: 'b2', team_id: 'tB', organization_id: 'oB', competitor_id: null, name: 'Isha' },
    ],
    unmatched: [],
  };
  const fixture = (live_state: unknown, entry_type = 'team') => fakeDb({
    id: 'fx1', round: 'Final', stage_sequence: null, home_team_id: 'tA', away_team_id: 'tB',
    live_state, lock_version: 1, scheduled_at: new Date('2026-10-04'),
    winner_team_id: 'tA', home_score: 1, away_score: 0,
    tournament_disciplines: {
      disciplines: { name: 'Mixed', entry_type },
      tournament_sports: { sport_id: 'sp-tt', sports: { name: 'Table Tennis' } },
    },
  });

  it('a tie: one line per rubber played, with its own result, stats, partner and opponents', async () => {
    const rows = await buildPlayerStatRows(fixture({
      tie: {
        activeRubber: 1,
        rubbers: [
          { key: 'ms', label: "Men's Singles", winner: 'A', status: 'completed', state: {},
            lineup: { A: ['a1'], B: ['b1'] }, rally: pts('A', 33), format: ittf, firstServer: 'A' },
          { key: 'xd', label: 'Mixed Doubles', winner: 'B', status: 'completed', state: {},
            lineup: { A: ['a1', 'a2'], B: ['b1', 'b2'] } },
        ],
      },
    }), 'fx1', squad);

    const karan = rows.filter((r) => r.user_id === 'a1');
    expect(karan.map((r) => [r.rubber_key, r.outcome, r.position])).toEqual([['ms', 'won', 'singles'], ['xd', 'lost', 'doubles']]);
    expect(karan[0].opponent_user_ids).toEqual(['b1']);
    expect(karan[0].stats.points_won).toBe(33);
    expect(karan[1]).toMatchObject({ partner_user_id: 'a2', opponent_user_ids: ['b1', 'b2'] });
    // The bench player is in the squad but played nothing.
    expect(rows.find((r) => r.user_id === 'a3')).toMatchObject({ played: false, rubber_key: null, outcome: null });
  });

  it('a single match: the named lineup plays, the rest of a big squad does not', async () => {
    const rows = await buildPlayerStatRows(fixture({ lineup: { A: ['a2'], B: ['b2'] } }), 'fx1', squad);
    expect(rows.filter((r) => r.played).map((r) => [r.user_id, r.outcome, r.opponent_user_ids])).toEqual([
      ['a2', 'won', ['b2']], ['b2', 'lost', ['a2']],
    ]);
    expect(rows.filter((r) => !r.played).map((r) => r.user_id).sort()).toEqual(['a1', 'a3', 'b1']);
  });
});
