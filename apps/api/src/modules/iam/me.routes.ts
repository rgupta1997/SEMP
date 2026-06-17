import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

// "Me"-scoped read endpoints — everything is resolved from the authenticated
// user, never from a path/query id, so a participant can only ever see their own.

// Full include used whenever we hydrate a fixture into a MatchSummary / detail.
const fixtureInclude = {
  teams_fixtures_home_team_idToteams: { include: { organizations: true, sports: true } },
  teams_fixtures_away_team_idToteams: { include: { organizations: true, sports: true } },
  tournament_disciplines: {
    include: {
      disciplines: true,
      tournament_sports: { include: { sports: true, tournaments: { include: { championships: true } } } },
    },
  },
  venue_grounds: { include: { venues: true } },
} as const;

type FixtureRow = any;

type Result = 'won' | 'lost' | 'draw' | 'pending';

// W/L/D/pending for a fixture relative to the set of teams the user plays for.
function resultFor(f: FixtureRow, myTeamIds: Set<string>): Result {
  if (f.status !== 'completed') return 'pending';
  const isHome = f.home_team_id != null && myTeamIds.has(f.home_team_id);
  const myTeamId = isHome ? f.home_team_id : f.away_team_id;
  if (f.winner_team_id) return f.winner_team_id === myTeamId ? 'won' : 'lost';
  if (f.home_score != null && f.away_score != null && f.home_score === f.away_score) return 'draw';
  return 'pending';
}

// Compact match shape used by the dashboard, championship detail and the matches list.
function toMatchSummary(f: FixtureRow, myTeamIds: Set<string>) {
  const isHome = f.home_team_id != null && myTeamIds.has(f.home_team_id);
  const mine = isHome ? f.teams_fixtures_home_team_idToteams : f.teams_fixtures_away_team_idToteams;
  const opp = isHome ? f.teams_fixtures_away_team_idToteams : f.teams_fixtures_home_team_idToteams;
  const ts = f.tournament_disciplines?.tournament_sports;
  const championship = ts?.tournaments?.championships;
  const myScore = isHome ? f.home_score : f.away_score;
  const oppScore = isHome ? f.away_score : f.home_score;
  return {
    id: f.id,
    round: f.round,
    status: f.status,
    scheduled_at: f.scheduled_at,
    sport: mine?.sports?.name ?? ts?.sports?.name ?? null,
    discipline: f.tournament_disciplines?.disciplines?.name ?? null,
    championship: championship ? { id: championship.id, name: championship.name, slug: championship.slug } : null,
    my_team: mine ? { id: mine.id, name: mine.name } : null,
    opponent: opp
      ? { id: opp.id, name: opp.name, organization: opp.organizations?.short_name ?? opp.organizations?.name ?? null }
      : null,
    my_score: myScore ?? null,
    opp_score: oppScore ?? null,
    result: resultFor(f, myTeamIds),
  };
}

// Aggregate a points table (win = 3, draw = 1) by organization from completed fixtures.
function buildStandings(fixtures: FixtureRow[]) {
  type Row = { organization_id: string; organization: any; played: number; won: number; drawn: number; lost: number; points: number };
  const table = new Map<string, Row>();
  const ensure = (inst: any): Row | null => {
    if (!inst) return null;
    if (!table.has(inst.id)) table.set(inst.id, { organization_id: inst.id, organization: inst, played: 0, won: 0, drawn: 0, lost: 0, points: 0 });
    return table.get(inst.id)!;
  };
  for (const f of fixtures) {
    if (f.status !== 'completed') continue;
    const home = ensure(f.teams_fixtures_home_team_idToteams?.organizations);
    const away = ensure(f.teams_fixtures_away_team_idToteams?.organizations);
    if (!home && !away) continue;
    if (home) home.played++;
    if (away) away.played++;
    const draw = f.winner_team_id == null && f.home_score != null && f.away_score != null && f.home_score === f.away_score;
    if (draw) {
      if (home) { home.drawn++; home.points += 1; }
      if (away) { away.drawn++; away.points += 1; }
    } else if (f.winner_team_id) {
      const homeWon = f.winner_team_id === f.home_team_id;
      if (home) { if (homeWon) { home.won++; home.points += 3; } else { home.lost++; } }
      if (away) { if (!homeWon) { away.won++; away.points += 3; } else { away.lost++; } }
    }
  }
  return [...table.values()].sort((a, b) => b.points - a.points || b.won - a.won || a.lost - b.lost);
}

// Tally wins/losses/draws over a set of fixtures, from the user's perspective.
function tally(fixtures: FixtureRow[], myTeamIds: Set<string>) {
  let wins = 0, losses = 0, draws = 0;
  for (const f of fixtures) {
    const r = resultFor(f, myTeamIds);
    if (r === 'won') wins++;
    else if (r === 'lost') losses++;
    else if (r === 'draw') draws++;
  }
  return { wins, losses, draws };
}

export function makeMeRouter(prisma: Prisma): Router {
  const router = Router();

  // Teams the current user belongs to (across all championships), with sport + championship + roster.
  router.get('/me/teams', asyncHandler(async (req, res) => {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: req.user!.id, is_active: true },
      include: {
        teams: {
          include: {
            sports: true,
            championships: { select: { id: true, name: true, slug: true, status: true } },
            organizations: { select: { id: true, name: true, short_name: true } },
            tournament_disciplines: { include: { disciplines: true } },
            team_members: { include: { users: { select: { id: true, name: true, email: true, phone: true } } } },
          },
        },
      },
      orderBy: { joined_at: 'desc' },
    });
    res.json(memberships.map((m) => ({ membership_role: m.role, jersey_number: m.jersey_number, ...m.teams })));
  }));

  // Enrollment status for the current user's organization, across championships.
  router.get('/me/enrollments', asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.json([]);
      return;
    }
    const rows = await prisma.championship_organizations.findMany({
      where: { organization_id: organizationId },
      include: { championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true } } },
      orderBy: { applied_at: 'desc' },
    });
    res.json(rows);
  }));

  // Fixtures the current user is assigned to officiate (only for championships they're assigned to).
  router.get('/me/officiating', asyncHandler(async (req, res) => {
    // Get championships this official is assigned to
    const officialEvents = await prisma.championship_officials.findMany({
      where: { user_id: req.user!.id, is_active: true },
      select: { championship_id: true },
    });
    const eventIds = officialEvents.map((e) => e.championship_id);

    if (eventIds.length === 0) {
      res.json([]);
      return;
    }

    const rows = await prisma.fixtures.findMany({
      where: {
        official_id: req.user!.id,
        tournament_disciplines: {
          tournament_sports: { tournaments: { championship_id: { in: eventIds } } },
        },
      },
      include: {
        teams_fixtures_home_team_idToteams: { include: { organizations: true } },
        teams_fixtures_away_team_idToteams: { include: { organizations: true } },
        tournament_disciplines: {
          include: {
            disciplines: true,
            tournament_sports: { include: { sports: true, tournaments: { include: { championships: true } } } },
          },
        },
        venue_grounds: { include: { venues: true } },
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });
    res.json(rows);
  }));

  // -------------------------------------------------------------------------
  // Participant dashboard — cross-championship career view with on-demand drill-down.
  // -------------------------------------------------------------------------

  // Resolve the user's active team memberships once: returns the membership rows
  // (with team + championship + sport + discipline) plus a Set of team ids for matching.
  async function loadMyTeams(userId: string) {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: userId, is_active: true },
      include: {
        teams: {
          include: {
            sports: { select: { id: true, name: true, icon: true } },
            championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true } },
            organizations: { select: { id: true, name: true, short_name: true } },
            tournament_disciplines: { include: { disciplines: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    const teamIds = new Set(memberships.map((m) => m.team_id));
    return { memberships, teamIds };
  }

  // GET /me/dashboard — fast landing summary: career stats, championship cards, recent 5.
  router.get('/me/dashboard', asyncHandler(async (req, res) => {
    const { memberships, teamIds } = await loadMyTeams(req.user!.id);

    if (teamIds.size === 0) {
      res.json({ stats: { total_events: 0, total_matches: 0, wins: 0, losses: 0, draws: 0 }, championships: [], recent_matches: [] });
      return;
    }

    const ids = [...teamIds];
    const fixtures = await prisma.fixtures.findMany({
      where: { OR: [{ home_team_id: { in: ids } }, { away_team_id: { in: ids } }] },
      include: fixtureInclude,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    // Group memberships by championship to build championship cards.
    type EventCard = {
      id: string; name: string; slug: string; status: string;
      start_date: Date | null; end_date: Date | null; venue: string | null;
      team_count: number; match_count: number; win_count: number; sports: string[];
      _teamIds: Set<string>; _sports: Set<string>;
    };
    const eventMap = new Map<string, EventCard>();
    for (const m of memberships) {
      const ev = m.teams.championships;
      if (!ev) continue;
      let card = eventMap.get(ev.id);
      if (!card) {
        card = {
          id: ev.id, name: ev.name, slug: ev.slug, status: ev.status,
          start_date: ev.start_date, end_date: ev.end_date, venue: ev.venue,
          team_count: 0, match_count: 0, win_count: 0, sports: [],
          _teamIds: new Set(), _sports: new Set(),
        };
        eventMap.set(ev.id, card);
      }
      card.team_count++;
      card._teamIds.add(m.team_id);
      if (m.teams.sports?.name) card._sports.add(m.teams.sports.name);
    }

    // Attribute each fixture to its championship card.
    for (const f of fixtures) {
      const evId = f.tournament_disciplines?.tournament_sports?.tournaments?.championships?.id;
      const card = evId ? eventMap.get(evId) : undefined;
      if (!card) continue;
      card.match_count++;
      if (resultFor(f, teamIds) === 'won') card.win_count++;
    }

    const championships = [...eventMap.values()]
      .map((c) => ({
        id: c.id, name: c.name, slug: c.slug, status: c.status,
        start_date: c.start_date, end_date: c.end_date, venue: c.venue,
        team_count: c.team_count, match_count: c.match_count, win_count: c.win_count,
        sports: [...c._sports],
      }))
      .sort((a, b) => (b.start_date?.getTime() ?? 0) - (a.start_date?.getTime() ?? 0));

    const { wins, losses, draws } = tally(fixtures, teamIds);
    const recent_matches = fixtures.slice(0, 5).map((f) => toMatchSummary(f, teamIds));

    res.json({
      stats: { total_events: eventMap.size, total_matches: fixtures.length, wins, losses, draws },
      championships,
      recent_matches,
    });
  }));

  // GET /me/matches — full match list, filterable by championship/status.
  router.get('/me/matches', asyncHandler(async (req, res) => {
    const { teamIds } = await loadMyTeams(req.user!.id);
    if (teamIds.size === 0) {
      res.json({ matches: [], total: 0 });
      return;
    }
    const ids = [...teamIds];
    const eventId = typeof req.query.championship_id === 'string' ? req.query.championship_id : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const fixtures = await prisma.fixtures.findMany({
      where: {
        OR: [{ home_team_id: { in: ids } }, { away_team_id: { in: ids } }],
        ...(status ? { status } : {}),
        ...(eventId
          ? { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: eventId } } } }
          : {}),
      },
      include: fixtureInclude,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    const matches = fixtures.map((f) => toMatchSummary(f, teamIds));
    res.json({ matches, total: matches.length });
  }));

  // GET /me/matches/:fixtureId — single match detail, scoped to the user's team.
  router.get('/me/matches/:fixtureId', asyncHandler(async (req, res) => {
    const f: FixtureRow = await prisma.fixtures.findUnique({
      where: { id: req.params.fixtureId },
      include: {
        ...fixtureInclude,
        teams_fixtures_home_team_idToteams: {
          include: {
            organizations: true,
            sports: true,
            team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true, phone: true } } } },
          },
        },
        teams_fixtures_away_team_idToteams: {
          include: {
            organizations: true,
            sports: true,
            team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true, phone: true } } } },
          },
        },
      },
    });
    if (!f) throw new NotFoundError('Match');

    // Verify the user is on one of the two teams.
    const home = f.teams_fixtures_home_team_idToteams;
    const away = f.teams_fixtures_away_team_idToteams;
    const homeMember = home?.team_members?.find((tm: any) => tm.user_id === req.user!.id);
    const awayMember = away?.team_members?.find((tm: any) => tm.user_id === req.user!.id);
    if (!homeMember && !awayMember) throw new ForbiddenError('You are not part of this match');

    const isHome = !!homeMember;
    const mine = isHome ? home : away;
    const opp = isHome ? away : home;
    const myMember = isHome ? homeMember : awayMember;
    const myTeamIds = new Set<string>([mine.id]);

    const ts = f.tournament_disciplines?.tournament_sports;
    const championship = ts?.tournaments?.championships;
    const ground = f.venue_grounds;

    res.json({
      fixture: {
        id: f.id,
        round: f.round,
        status: f.status,
        scheduled_at: f.scheduled_at,
        duration_minutes: f.duration_minutes,
        notes: f.notes,
        home_score: f.home_score,
        away_score: f.away_score,
        my_score: isHome ? f.home_score : f.away_score,
        opp_score: isHome ? f.away_score : f.home_score,
        result: resultFor(f, myTeamIds),
        venue: ground ? { ground: ground.name, venue_name: ground.venues?.name ?? null, city: ground.venues?.city ?? null } : null,
        sport: mine.sports?.name ?? ts?.sports?.name ?? null,
        discipline: f.tournament_disciplines?.disciplines?.name ?? null,
        tournament: ts?.tournaments?.name ?? null,
        championship: championship ? { id: championship.id, name: championship.name, slug: championship.slug } : null,
        my_team: { id: mine.id, name: mine.name, organization: mine.organizations?.name ?? null },
        opponent: opp ? { id: opp.id, name: opp.name, organization: opp.organizations?.name ?? null } : null,
        my_role: myMember?.role ?? null,
        jersey_number: myMember?.jersey_number ?? null,
        teammates: (mine.team_members ?? [])
          .map((tm: any) => ({ name: tm.users?.name ?? '—', phone: tm.users?.phone ?? null, role: tm.role, jersey_number: tm.jersey_number }))
          .sort((a: any, b: any) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)),
      },
    });
  }));

  // GET /me/championships/:eventId — full participation detail for one championship.
  router.get('/me/championships/:eventId', asyncHandler(async (req, res) => {
    const eventId = req.params.eventId;
    const { memberships, teamIds } = await loadMyTeams(req.user!.id);

    const myMemberships = memberships.filter((m) => m.teams.championships?.id === eventId);
    if (myMemberships.length === 0) throw new NotFoundError('Championship');

    const championship = await prisma.championships.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true, description: true },
    });
    if (!championship) throw new NotFoundError('Championship');

    const myTeamIdsInEvent = new Set(myMemberships.map((m) => m.team_id));

    // Rosters for the user's teams in this championship.
    const teamsWithRoster = await prisma.teams.findMany({
      where: { id: { in: [...myTeamIdsInEvent] } },
      include: {
        sports: { select: { name: true, icon: true } },
        tournament_disciplines: { include: { disciplines: { select: { name: true } } } },
        team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true, phone: true } } } },
      },
    });

    const teams = myMemberships.map((m) => {
      const t = teamsWithRoster.find((x) => x.id === m.team_id);
      return {
        id: m.team_id,
        name: t?.name ?? m.teams.name,
        sport: t?.sports?.name ?? m.teams.sports?.name ?? null,
        discipline: t?.tournament_disciplines?.disciplines?.name ?? m.teams.tournament_disciplines?.disciplines?.name ?? null,
        role: m.role,
        jersey_number: m.jersey_number,
        status: t?.status ?? m.teams.status,
        roster: (t?.team_members ?? [])
          .map((tm) => ({ name: tm.users?.name ?? '—', phone: tm.users?.phone ?? null, role: tm.role, jersey_number: tm.jersey_number }))
          .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)),
      };
    });

    // All fixtures for the user's teams in this championship.
    const fixtures = await prisma.fixtures.findMany({
      where: {
        OR: [{ home_team_id: { in: [...myTeamIdsInEvent] } }, { away_team_id: { in: [...myTeamIdsInEvent] } }],
      },
      include: fixtureInclude,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    const matches = fixtures.map((f) => toMatchSummary(f, teamIds));
    const { wins, losses, draws } = tally(fixtures, teamIds);

    // Championship-wide standings (read-only) — aggregated from all completed fixtures.
    const eventFixtures = await prisma.fixtures.findMany({
      where: {
        status: 'completed',
        tournament_disciplines: { tournament_sports: { tournaments: { championship_id: eventId } } },
      },
      include: {
        teams_fixtures_home_team_idToteams: { include: { organizations: true } },
        teams_fixtures_away_team_idToteams: { include: { organizations: true } },
      },
    });

    res.json({
      championship,
      stats: { matches: fixtures.length, wins, losses, draws },
      teams,
      matches,
      standings: buildStandings(eventFixtures),
    });
  }));

  return router;
}
