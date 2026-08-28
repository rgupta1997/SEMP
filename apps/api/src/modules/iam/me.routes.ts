import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { readStandings } from '../standings/standings.service.js';
import { permissionsFor } from '../../http/middleware/can.js';

// "Me"-scoped read endpoints - everything is resolved from the authenticated
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

// Fixture shape for the user's match views. A roster can now play across several
// championships, so a fixture's championship + sport come from its own discipline
// draw (not the team). Shape matches toMatchSummary so the same MatchRow renders it.
const matchSelect = {
  id: true, round: true, status: true, scheduled_at: true,
  home_team_id: true, away_team_id: true, home_score: true, away_score: true, winner_team_id: true,
  teams_fixtures_home_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
  teams_fixtures_away_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
  tournament_disciplines: {
    select: {
      disciplines: { select: { name: true } },
      tournament_sports: {
        select: {
          sports: { select: { name: true } },
          tournaments: { select: { championships: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  },
} as const;

// MatchSummary built from a `matchSelect` row.
function summariseLean(f: FixtureRow, myTeamIds: Set<string>) {
  const isHome = f.home_team_id != null && myTeamIds.has(f.home_team_id);
  const mine = isHome ? f.teams_fixtures_home_team_idToteams : f.teams_fixtures_away_team_idToteams;
  const opp = isHome ? f.teams_fixtures_away_team_idToteams : f.teams_fixtures_home_team_idToteams;
  const ts = f.tournament_disciplines?.tournament_sports;
  const ev = ts?.tournaments?.championships;
  return {
    id: f.id, round: f.round, status: f.status, scheduled_at: f.scheduled_at,
    sport: ts?.sports?.name ?? null,
    discipline: f.tournament_disciplines?.disciplines?.name ?? null,
    championship: ev ? { id: ev.id, name: ev.name, slug: ev.slug } : null,
    my_team: mine ? { id: mine.id, name: mine.name } : null,
    opponent: opp ? { id: opp.id, name: opp.name, organization: opp.organizations?.short_name ?? opp.organizations?.name ?? null } : null,
    my_score: (isHome ? f.home_score : f.away_score) ?? null,
    opp_score: (isHome ? f.away_score : f.home_score) ?? null,
    result: resultFor(f, myTeamIds),
  };
}

// fixture_awards select for the achievement views. championship + sport + tournament
// all come from the fixture's own discipline draw (a roster spans championships).
const awardSelect = {
  id: true, award_name: true, created_at: true,
  fixtures: {
    select: {
      id: true, round: true, status: true,
      home_team_id: true, away_team_id: true, home_score: true, away_score: true, winner_team_id: true,
      teams_fixtures_home_team_idToteams: { select: { id: true, name: true } },
      teams_fixtures_away_team_idToteams: { select: { id: true, name: true } },
      tournament_disciplines: {
        select: {
          disciplines: { select: { name: true } },
          tournament_sports: {
            select: {
              sports: { select: { name: true } },
              tournaments: { select: { id: true, name: true, championships: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  },
} as const;

// One award with full match context, for grouping (dashboard) or listing (details page).
function mapAward(a: any, myTeamIds: Set<string>) {
  const f: FixtureRow = a.fixtures;
  const isHome = f?.home_team_id != null && myTeamIds.has(f.home_team_id);
  const mine = isHome ? f?.teams_fixtures_home_team_idToteams : f?.teams_fixtures_away_team_idToteams;
  const opp = isHome ? f?.teams_fixtures_away_team_idToteams : f?.teams_fixtures_home_team_idToteams;
  const ts = f?.tournament_disciplines?.tournament_sports;
  const ev = ts?.tournaments?.championships ?? null;
  const tournament = ts?.tournaments ?? null;
  return {
    id: a.id,
    award_name: a.award_name,
    date: a.created_at,
    championship: ev ? { id: ev.id, name: ev.name } : null,
    tournament: tournament ? { id: tournament.id, name: tournament.name } : null,
    sport: ts?.sports?.name ?? null,
    discipline: f?.tournament_disciplines?.disciplines?.name ?? null,
    opponent_team_name: opp?.name ?? null,
    my_team_name: mine?.name ?? null,
    round: f?.round ?? null,
    result: f ? resultFor(f, myTeamIds) : 'pending',
    fixture_id: f?.id ?? null,
  };
}

export function makeMeRouter(prisma: Prisma): Router {
  const router = Router();

  // Membership load shared by the dashboard + achievements: the user's teams with
  // their sport, organization, and the championships each roster is entered into.
  async function loadMembershipMeta(userId: string) {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: userId, is_active: true },
      select: {
        team_id: true,
        teams: {
          select: {
            sports: { select: { id: true, name: true, icon: true } },
            organizations: { select: { id: true, name: true, short_name: true } },
            team_entries: {
              select: {
                championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true } },
              },
            },
          },
        },
      },
    });
    return { memberships, teamIds: new Set(memberships.map((m) => m.team_id)) };
  }

  // Teams the current user belongs to, with sport + roster + the championships the
  // roster is entered into (team_entries).
  /**
   * What this person may do in one scope, straight from the engine.
   *
   * `permissionsFor` existed, was exported, and was called by nothing - so there was
   * no way for a client to ask the engine anything. The web app therefore decided
   * authority from `organization_members.role` alone (permissions.tsx,
   * `canManageOrg`), which is why a role the Owner granted through the Roles screen
   * widened the sidebar and not a single control on the page behind it.
   *
   * It is a MIRROR, never the boundary: every mutation is still checked server-side.
   * A super admin gets `['*']`.
   *
   * `orgUnitId` narrows the question to one campus or batch, which is what makes a
   * campus-scoped grant answer honestly rather than as if it reached the whole
   * institution.
   */
  router.get('/me/permissions', asyncHandler(async (req, res) => {
    const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
    const championshipId = typeof req.query.championshipId === 'string' ? req.query.championshipId : undefined;
    const orgUnitId = typeof req.query.orgUnitId === 'string' ? req.query.orgUnitId : undefined;
    if (!organizationId && !championshipId) {
      // Permissions only mean anything inside a scope. Answering the unscoped
      // question with an empty list would read as "you may do nothing".
      throw new NotFoundError('Scope');
    }
    const permissions = await permissionsFor(prisma, {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId, championshipId, orgUnitId },
    });
    res.json({ scope: { organizationId: organizationId ?? null, championshipId: championshipId ?? null, orgUnitId: orgUnitId ?? null }, permissions });
  }));

  router.get('/me/teams', asyncHandler(async (req, res) => {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: req.user!.id, is_active: true },
      include: {
        teams: {
          include: {
            sports: true,
            organizations: { select: { id: true, name: true, short_name: true } },
            team_entries: {
              include: {
                championships: { select: { id: true, name: true, slug: true, status: true } },
                tournament_disciplines: { include: { disciplines: true, tournament_sports: { include: { tournaments: { select: { id: true, name: true } } } } } },
              },
              orderBy: { created_at: 'asc' },
            },
            team_members: { include: { users: { select: { id: true, name: true, email: true, phone: true } } } },
          },
        },
      },
      orderBy: { joined_at: 'desc' },
    });
    res.json(memberships.map((m) => ({ membership_role: m.role, jersey_number: m.jersey_number, ...m.teams })));
  }));

  // Enrollment status for the user's organization(s), across championships. Resolution:
  //   ?organization_id=  → that specific org (must be an active member) - team entries
  //                        must be scoped to THAT team's org.
  //   ?scope=all         → EVERY org the user is an active member of, so an application
  //                        made under any of their orgs (incl. one just created on the
  //                        fly) shows up - used by Discover so the CTA flips correctly.
  //   (none)             → their primary org (JWT, else first active owner/admin).
  router.get('/me/enrollments', asyncHandler(async (req, res) => {
    const requested = typeof req.query.organization_id === 'string' ? req.query.organization_id : null;
    const scopeAll = req.query.scope === 'all';
    let orgIds: string[] = [];
    if (requested) {
      // Only expose an org's enrollments to one of its active members (or a super admin).
      const member = await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: requested, status: 'active' },
        select: { id: true },
      });
      if (!member && !req.user!.isSuperAdmin) { res.json([]); return; }
      orgIds = [requested];
    } else if (scopeAll) {
      const memberships = await prisma.organization_members.findMany({
        where: { user_id: req.user!.id, status: 'active' },
        select: { organization_id: true },
      });
      orgIds = [...new Set(memberships.map((m) => m.organization_id))];
    } else {
      // JWT may lack organizationId if the user self-created an org after their last login.
      // Fall back to their first active owner/admin membership derived from DB.
      let organizationId = req.user!.organizationId;
      if (!organizationId) {
        const membership = await prisma.organization_members.findFirst({
          where: { user_id: req.user!.id, role: { in: ['owner', 'admin'] }, status: 'active' },
          orderBy: { joined_at: 'asc' },
        });
        organizationId = membership?.organization_id ?? null;
      }
      orgIds = organizationId ? [organizationId] : [];
    }
    if (orgIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await prisma.championship_organizations.findMany({
      where: { organization_id: { in: orgIds } },
      include: {
        championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, entry_level: true } },
        org_units: { select: { id: true, name: true, code: true, type: true } },
      },
      orderBy: { applied_at: 'desc' },
    });

    // An organisation has ONE entry per inter-org championship and one per CAMPUS in
    // an intra one. So this list can legitimately carry the same championship name
    // several times, and a client that printed only `championships.name` would show
    // three identical rows with no way to tell which campus each was for.
    //
    // `entity_name` is what to print, resolved here rather than in each of the three
    // screens that render this list.
    res.json(rows.map((r) => ({
      ...r,
      entity_id: r.org_unit_id ?? r.organization_id,
      entity_name: r.org_units?.name ?? null,
      label: r.org_units
        ? `${r.championships?.name ?? 'Championship'} · ${r.org_units.name}`
        : r.championships?.name ?? 'Championship',
    })));
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
  // Participant dashboard - cross-championship career view with on-demand drill-down.
  // -------------------------------------------------------------------------

  // Resolve the user's active team memberships once: returns the membership rows
  // (with team + sport + the championships/disciplines each roster is entered into)
  // plus a Set of team ids for matching.
  async function loadMyTeams(userId: string) {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: userId, is_active: true },
      include: {
        teams: {
          include: {
            sports: { select: { id: true, name: true, icon: true } },
            organizations: { select: { id: true, name: true, short_name: true } },
            team_entries: {
              include: {
                championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true } },
                tournament_disciplines: { include: { disciplines: { select: { id: true, name: true } }, tournament_formats: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    const teamIds = new Set(memberships.map((m) => m.team_id));
    return { memberships, teamIds };
  }

  // GET /me/dashboard - fast landing summary: career stats, championship cards, recent 5.
  //
  // A roster can be entered into several championships, so each fixture's championship
  // is taken from its own discipline draw (matchSelect walks that chain); the
  // championship cards come from the team_entries the user's rosters hold.
  router.get('/me/dashboard', asyncHandler(async (req, res) => {
    const { memberships, teamIds } = await loadMembershipMeta(req.user!.id);

    if (teamIds.size === 0) {
      res.json({ stats: { total_events: 0, total_matches: 0, wins: 0, losses: 0, draws: 0 }, championships: [], recent_matches: [], achievements: [] });
      return;
    }

    const ids = [...teamIds];
    const fixtures = await prisma.fixtures.findMany({
      where: { OR: [{ home_team_id: { in: ids } }, { away_team_id: { in: ids } }] },
      select: matchSelect,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    // Championship cards from the rosters' entries; counts attributed by each
    // fixture's own championship.
    type EventCard = {
      id: string; name: string; slug: string; status: string;
      start_date: Date | null; end_date: Date | null; venue: string | null;
      team_count: number; match_count: number; win_count: number;
      _sports: Set<string>;
    };
    const eventMap = new Map<string, EventCard>();
    for (const m of memberships) {
      for (const entry of m.teams.team_entries) {
        const ev = entry.championships;
        if (!ev) continue;
        let card = eventMap.get(ev.id);
        if (!card) {
          card = { id: ev.id, name: ev.name, slug: ev.slug, status: ev.status, start_date: ev.start_date, end_date: ev.end_date, venue: ev.venue, team_count: 0, match_count: 0, win_count: 0, _sports: new Set() };
          eventMap.set(ev.id, card);
        }
        card.team_count++;
        if (m.teams.sports?.name) card._sports.add(m.teams.sports.name);
      }
    }
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
    const recent_matches = fixtures.slice(0, 5).map((f) => summariseLean(f, teamIds));

    // Achievements - awards this user has received, newest first, with match context.
    const awardRows = await prisma.fixture_awards.findMany({
      where: { recipient_user_id: req.user!.id },
      select: awardSelect,
      orderBy: { created_at: 'desc' },
    });
    const achievements = awardRows.map((a) => mapAward(a, teamIds));

    res.json({
      stats: { total_events: eventMap.size, total_matches: fixtures.length, wins, losses, draws },
      championships,
      recent_matches,
      achievements,
    });
  }));

  // GET /me/achievements - every award the user has received, newest first, with
  // full match context. Powers the dedicated achievements detail page.

  // ---- My Game (F-040..F-044) -------------------------------------------
  // The personal context's landing screen. One request, because it is the first
  // thing rendered after sign-in and four round trips there is four chances to
  // show a half-drawn page.
  //
  // Everything here is derived from team membership. A person with no team gets
  // empty arrays rather than an error - "you have not played yet" is a legitimate
  // state, and the screen says so rather than looking broken.
  router.get('/me/home', asyncHandler(async (req, res) => {
    const { memberships, teamIds } = await loadMembershipMeta(req.user!.id);
    const ids = [...teamIds];

    const empty = {
      next: null, live: [], pending: [], recent: [], teams: [],
      stats: { games: 0, events: 0, sports: 0, wins: 0 },
    };
    if (ids.length === 0) { res.json(empty); return; }

    const mine = { OR: [{ home_team_id: { in: ids } }, { away_team_id: { in: ids } }] };

    const [upcoming, live, played, officiating] = await Promise.all([
      // Next fixture: the soonest one still to come. Unscheduled fixtures have a
      // null scheduled_at and are deliberately excluded - "next" has to have a when.
      prisma.fixtures.findMany({
        where: { ...mine, status: 'scheduled', scheduled_at: { gte: new Date() } },
        select: matchSelect, orderBy: { scheduled_at: 'asc' }, take: 1,
      }),
      prisma.fixtures.findMany({
        where: { ...mine, status: 'live' },
        select: matchSelect, orderBy: { scheduled_at: 'asc' }, take: 4,
      }),
      prisma.fixtures.findMany({
        where: { ...mine, status: { in: ['completed', 'walkover'] } },
        select: matchSelect, orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }], take: 5,
      }),
      // Anything this person is the official on that still owes a scorecard. This is
      // the one pending action the data can actually answer today; the rest of the
      // queue (availability, invitations) needs tables that do not exist yet.
      prisma.fixtures.findMany({
        where: {
          official_id: req.user!.id,
          status: { in: ['live', 'completed'] },
          scorecard_status: { in: ['draft', 'submitted'] },
        },
        select: { ...matchSelect, scorecard_status: true },
        orderBy: { scheduled_at: 'desc' }, take: 5,
      }),
    ]);

    const sportIds = new Set<string>();
    const eventIds = new Set<string>();
    for (const m of memberships) {
      if (m.teams?.sports?.id) sportIds.add(m.teams.sports.id);
      for (const e of m.teams?.team_entries ?? []) {
        if (e.championships?.id) eventIds.add(e.championships.id);
      }
    }

    // Counted from completed fixtures only, so the strip agrees with the record
    // rather than with what is merely scheduled.
    const wins = played.filter((f) => resultFor(f as FixtureRow, teamIds) === 'won').length;
    const allPlayed = await prisma.fixtures.count({
      where: { ...mine, status: { in: ['completed', 'walkover'] } },
    });
    const allWins = await prisma.fixtures.count({
      where: { ...mine, status: { in: ['completed', 'walkover'] }, winner_team_id: { in: ids } },
    });

    res.json({
      next: upcoming[0] ? summariseLean(upcoming[0] as FixtureRow, teamIds) : null,
      live: live.map((f) => summariseLean(f as FixtureRow, teamIds)),
      recent: played.map((f) => summariseLean(f as FixtureRow, teamIds)),
      pending: officiating.map((f) => ({
        ...summariseLean(f as FixtureRow, teamIds),
        reason: f.scorecard_status === 'draft' ? 'Submit the scorecard' : 'Awaiting lock',
      })),
      teams: memberships.map((m) => ({
        id: m.team_id,
        name: (m.teams as any)?.name ?? null,
        organization: m.teams?.organizations?.short_name ?? m.teams?.organizations?.name ?? null,
        sport: m.teams?.sports?.name ?? null,
        role: (m as any).role ?? 'player',
      })),
      stats: { games: allPlayed, events: eventIds.size, sports: sportIds.size, wins: allWins },
    });
  }));

  router.get('/me/achievements', asyncHandler(async (req, res) => {
    const { teamIds } = await loadMembershipMeta(req.user!.id);
    if (teamIds.size === 0) {
      res.json({ achievements: [] });
      return;
    }
    const awardRows = await prisma.fixture_awards.findMany({
      where: { recipient_user_id: req.user!.id },
      select: awardSelect,
      orderBy: { created_at: 'desc' },
    });
    res.json({ achievements: awardRows.map((a) => mapAward(a, teamIds)) });
  }));

  // GET /me/matches - full match list, filterable by championship/status.
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

  // GET /me/matches/:fixtureId - single match detail, scoped to the user's team.
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
          .map((tm: any) => ({ name: tm.users?.name ?? '-', phone: tm.users?.phone ?? null, role: tm.role, jersey_number: tm.jersey_number }))
          .sort((a: any, b: any) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)),
      },
    });
  }));

  // GET /me/championships/:eventId - full participation detail for one championship.
  router.get('/me/championships/:eventId', asyncHandler(async (req, res) => {
    const eventId = req.params.eventId;
    const { memberships, teamIds } = await loadMyTeams(req.user!.id);

    // The user's rosters entered into this championship, paired with that entry.
    const myMemberships = memberships
      .map((m) => ({ m, entry: m.teams.team_entries.find((e) => e.championship_id === eventId) }))
      .filter((x): x is { m: typeof x.m; entry: NonNullable<typeof x.entry> } => !!x.entry);
    if (myMemberships.length === 0) throw new NotFoundError('Championship');

    const championship = await prisma.championships.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true, description: true },
    });
    if (!championship) throw new NotFoundError('Championship');

    const myTeamIdsInEvent = new Set(myMemberships.map((x) => x.m.team_id));

    // Rosters for the user's teams in this championship.
    const teamsWithRoster = await prisma.teams.findMany({
      where: { id: { in: [...myTeamIdsInEvent] } },
      include: {
        sports: { select: { name: true, icon: true } },
        team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true, phone: true } } } },
      },
    });

    const teams = myMemberships.map(({ m, entry }) => {
      const t = teamsWithRoster.find((x) => x.id === m.team_id);
      const td = entry.tournament_disciplines;
      return {
        id: m.team_id,
        name: t?.name ?? m.teams.name,
        sport: t?.sports?.name ?? m.teams.sports?.name ?? null,
        discipline: td?.disciplines?.name ?? null,
        entry_type: td?.entry_type ?? null,
        squad_min: td?.squad_min ?? null,
        squad_max: td?.squad_max ?? null,
        format: td?.tournament_formats?.name ?? null,
        role: m.role,
        jersey_number: m.jersey_number,
        status: entry.status,
        roster: (t?.team_members ?? [])
          .map((tm) => ({ name: tm.users?.name ?? '-', phone: tm.users?.phone ?? null, role: tm.role, jersey_number: tm.jersey_number }))
          .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)),
      };
    });

    // Fixtures for the user's teams in THIS championship - a roster may also play
    // in others, so filter by the fixture's championship via its discipline draw.
    const fixtures = await prisma.fixtures.findMany({
      where: {
        OR: [{ home_team_id: { in: [...myTeamIdsInEvent] } }, { away_team_id: { in: [...myTeamIdsInEvent] } }],
        tournament_disciplines: { tournament_sports: { tournaments: { championship_id: eventId } } },
      },
      select: matchSelect,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    const matches = fixtures.map((f) => summariseLean(f, teamIds));
    const { wins, losses, draws } = tally(fixtures, teamIds);

    // Championship-wide standings (read-only) - read the materialized championship-
    // scope table maintained by the standings engine.
    const standings = await readStandings(prisma, eventId, 'championship', null);

    res.json({
      championship,
      stats: { matches: fixtures.length, wins, losses, draws },
      teams,
      matches,
      standings,
    });
  }));

  return router;
}
