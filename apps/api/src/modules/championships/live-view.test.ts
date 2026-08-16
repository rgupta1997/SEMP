import { describe, it, expect } from 'vitest';
import { championshipLiveView } from './live-view.js';

// The live view (J2-E6). Two things worth pinning: elapsed time is measured from
// kick-off and not from the last update, and the payload carries no contact
// details - it is shaped so it could be served to a public follower unchanged.

const NOW = new Date('2026-08-16T14:30:00Z').getTime();

const fixture = (over: Record<string, unknown> = {}) => ({
  id: 'fx1', round: 'SF', status: 'live',
  scheduled_at: new Date('2026-08-16T14:00:00Z'),
  live_started_at: new Date('2026-08-16T14:05:00Z'),
  home_score: 2, away_score: 1, live_state: {},
  teams_fixtures_home_team_idToteams: { id: 'tA', name: 'Falcons', organizations: { short_name: 'IIMB' } },
  teams_fixtures_away_team_idToteams: { id: 'tB', name: 'Eagles', organizations: { short_name: 'IIMA' } },
  venue_grounds: { name: 'Court 1', venues: { name: 'Sports Complex' } },
  users: { id: 'off1', name: 'R. Iyer' },
  tournament_disciplines: {
    disciplines: { name: 'Mens' },
    tournament_sports: { sports: { name: 'Badminton', icon: '🏸' } },
  },
  ...over,
});

const db = (live: any[], next: any[] = []) => {
  const calls: any[] = [];
  return {
    calls,
    prisma: {
      fixtures: {
        findMany: async (args: any) => { calls.push(args.where); return args.where.status === 'live' ? live : next; },
      },
    } as any,
  };
};

describe('championshipLiveView', () => {
  it('flattens a live fixture into a card', async () => {
    const { prisma } = db([fixture()]);
    const out = await championshipLiveView(prisma, 'champ1', NOW);
    expect(out.live[0]).toMatchObject({
      id: 'fx1', sport: 'Badminton', discipline: 'Mens', round: 'SF',
      home_team: 'Falcons (IIMB)', away_team: 'Eagles (IIMA)',
      home_score: 2, away_score: 1,
      venue: 'Sports Complex · Court 1',
      official: 'R. Iyer',
    });
  });

  // Elapsed since kick-off, not since the last score tap. The column exists
  // precisely because `updated_at` moves on every point.
  it('reports minutes since kick-off', async () => {
    const { prisma } = db([fixture()]);
    const out = await championshipLiveView(prisma, 'champ1', NOW);
    expect(out.live[0].elapsed_minutes).toBe(25);
  });

  it('reports no elapsed time for a match with no recorded kick-off', async () => {
    const { prisma } = db([fixture({ live_started_at: null })]);
    expect((await championshipLiveView(prisma, 'champ1', NOW)).live[0].elapsed_minutes).toBeNull();
  });

  // Clock skew between the API and the database must not produce "-3 minutes".
  it('never reports negative elapsed time', async () => {
    const { prisma } = db([fixture({ live_started_at: new Date(NOW + 60_000) })]);
    expect((await championshipLiveView(prisma, 'champ1', NOW)).live[0].elapsed_minutes).toBe(0);
  });

  // The payload is public-safe by construction: the official's name, never their
  // phone or email.
  it('carries the official\'s name and nothing else about them', async () => {
    const { prisma } = db([fixture()]);
    const card = (await championshipLiveView(prisma, 'champ1', NOW)).live[0] as Record<string, unknown>;
    expect(card.official).toBe('R. Iyer');
    expect(JSON.stringify(card)).not.toMatch(/@|phone|email/i);
  });

  it('scopes both queries to the championship', async () => {
    const { prisma, calls } = db([fixture()]);
    await championshipLiveView(prisma, 'champ1', NOW);
    for (const where of calls) {
      expect(JSON.stringify(where)).toContain('champ1');
    }
  });

  // The empty state has to say what is coming, not just that nothing is on.
  it('returns what is next so an empty state has something to say', async () => {
    const { prisma } = db([], [fixture({ id: 'fx2', status: 'scheduled', live_started_at: null })]);
    const out = await championshipLiveView(prisma, 'champ1', NOW);
    expect(out.live).toEqual([]);
    expect(out.next[0].id).toBe('fx2');
  });

  // A match nobody marked completed sits in 'live' indefinitely. Rendering
  // "74950′" (which the dev data really did) is worse than no clock, and an
  // unclosed match is a job for the organiser rather than a scoreline.
  it('flags a match left live for days instead of showing an absurd clock', async () => {
    const { prisma } = db([fixture({ live_started_at: new Date(NOW - 3 * 24 * 60 * 60_000) })]);
    const card = (await championshipLiveView(prisma, 'champ1', NOW)).live[0];
    expect(card.stale).toBe(true);
    expect(card.elapsed_minutes).toBeNull();
    // The kick-off time itself is still reported, so the UI can say how long ago.
    expect(card.started_at).toBeInstanceOf(Date);
  });

  it('does not flag a match that is merely long', async () => {
    const { prisma } = db([fixture({ live_started_at: new Date(NOW - 3 * 60 * 60_000) })]);
    const card = (await championshipLiveView(prisma, 'champ1', NOW)).live[0];
    expect(card.stale).toBe(false);
    expect(card.elapsed_minutes).toBe(180);
  });

  it('stamps the payload so a polling client can show its own staleness', async () => {
    const { prisma } = db([]);
    expect((await championshipLiveView(prisma, 'champ1', NOW)).as_of).toBe('2026-08-16T14:30:00.000Z');
  });
});
