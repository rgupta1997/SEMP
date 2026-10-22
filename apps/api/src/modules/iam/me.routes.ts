import { Router } from 'express';
import { shootoutOf, type Shootout } from '@semp/shared';
import { myMatchStats } from '../records/my-match-stats.service.js';
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

// A match that has happened. A squad place the person no longer holds still counts for these.
const PLAYED_STATUSES = ['completed', 'walkover'];

/** A squad place as the history rules read it. */
interface SquadPlace { team_id: string; is_active: boolean; left_at: Date | null }

// Played on or before the day they left - finished time, else the scheduled one. A match
// with neither date cannot be placed either side of it, so it stays theirs.
const playedBy = (leftAt: Date) => ({
  OR: [
    { completed_at: { lte: leftAt } },
    { completed_at: null, scheduled_at: { lte: leftAt } },
    { completed_at: null, scheduled_at: null },
  ],
});

/**
 * Which fixtures are this person's. A current squad: all of its matches. A squad they
 * have left: only matches played while they were on it - up to `left_at`, or every played
 * match when the row predates that column and the date is unknown.
 */
export function myFixturesWhere(places: SquadPlace[]) {
  const current = places.filter((p) => p.is_active).map((p) => p.team_id);
  const clauses: object[] = current.length
    ? [{ home_team_id: { in: current } }, { away_team_id: { in: current } }]
    : [];
  for (const p of places.filter((x) => !x.is_active)) {
    const played = { status: { in: PLAYED_STATUSES }, ...(p.left_at ? playedBy(p.left_at) : {}) };
    clauses.push({ home_team_id: p.team_id, ...played }, { away_team_id: p.team_id, ...played });
  }
  // Nothing at all matches an empty OR in Prisma, which is the right answer for no squads.
  return { OR: clauses };
}

/** Did this fixture happen while they held this (now inactive) place? */
export function playedWhileOn(f: { status: string; completed_at?: Date | null; scheduled_at?: Date | null }, leftAt: Date | null) {
  if (!PLAYED_STATUSES.includes(f.status)) return false;
  if (!leftAt) return true;
  const when = f.completed_at ?? f.scheduled_at ?? null;
  return !when || when <= leftAt;
}

type Result = 'won' | 'lost' | 'draw' | 'pending';

/** Shoot-out kicks as [mine, theirs], or null when the match was not settled on penalties. */
function pensFor(s: Shootout | null | undefined, isHome: boolean): [number, number] | null {
  return s ? (isHome ? [s.home, s.away] : [s.away, s.home]) : null;
}

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
    pens: pensFor(shootoutOf(f.live_state), isHome),
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
  teams_fixtures_home_team_idToteams: { select: { id: true, name: true, short_name: true, organizations: { select: { short_name: true, name: true } } } },
  teams_fixtures_away_team_idToteams: { select: { id: true, name: true, short_name: true, organizations: { select: { short_name: true, name: true } } } },
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

// MatchSummary built from a `matchSelect` row. `shootouts` comes from loadShootouts.
function summariseLean(f: FixtureRow, myTeamIds: Set<string>, shootouts?: Map<string, Shootout>) {
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
    my_team: mine ? { id: mine.id, name: mine.name, short_name: mine.short_name ?? null } : null,
    opponent: opp ? { id: opp.id, name: opp.name, short_name: opp.short_name ?? null, organization: opp.organizations?.short_name ?? opp.organizations?.name ?? null } : null,
    my_score: (isHome ? f.home_score : f.away_score) ?? null,
    opp_score: (isHome ? f.away_score : f.home_score) ?? null,
    pens: pensFor(shootouts?.get(f.id), isHome),
    result: resultFor(f, myTeamIds),
  };
}

// fixture_awards select for the achievement views. championship + sport + tournament
// all come from the fixture's own discipline draw (a roster spans championships).
const awardSelect = {
  id: true, award_name: true, created_at: true, recipient_team_id: true,
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
    level: 'match' as const,
    team_award: !!a.recipient_team_id,
  };
}

// Sport / tournament / event awards, in the same shape as a match award so every
// achievement view lists them side by side. There is no match, so no opponent or result.
const championshipAwardSelect = {
  id: true, award_name: true, created_at: true, level: true, recipient_team_id: true,
  teams: { select: { name: true } },
  championships: { select: { id: true, name: true } },
  tournaments: { select: { id: true, name: true } },
  tournament_sports: { select: { sports: { select: { name: true } } } },
} as const;

const LEVEL_ROUND: Record<string, string> = {
  tournament_sport: 'Sport award', tournament: 'Tournament award', championship: 'Event award',
};

function mapChampionshipAward(a: any) {
  return {
    id: a.id,
    award_name: a.award_name,
    date: a.created_at,
    championship: a.championships ? { id: a.championships.id, name: a.championships.name } : null,
    tournament: a.tournaments ? { id: a.tournaments.id, name: a.tournaments.name } : null,
    sport: a.tournament_sports?.sports?.name ?? null,
    discipline: null,
    opponent_team_name: null,
    my_team_name: a.teams?.name ?? null,
    round: LEVEL_ROUND[a.level] ?? null,
    result: 'pending' as const,
    fixture_id: null,
    level: a.level as 'tournament_sport' | 'tournament' | 'championship',
    team_award: !!a.recipient_team_id,
  };
}

export function makeMeRouter(prisma: Prisma): Router {
  const router = Router();

  // Every award this person holds: their own, and their teams', at every level.
  async function loadMyAwards(userId: string, myTeamIds: Set<string>) {
    const mine = { OR: [{ recipient_user_id: userId }, { recipient_team_id: { in: [...myTeamIds] } }] };
    const [matchRows, eventRows] = await Promise.all([
      prisma.fixture_awards.findMany({ where: mine, select: awardSelect, orderBy: { created_at: 'desc' } }),
      prisma.championship_awards.findMany({ where: mine, select: championshipAwardSelect, orderBy: { created_at: 'desc' } }),
    ]);
    return [...matchRows.map((a) => mapAward(a, myTeamIds)), ...eventRows.map(mapChampionshipAward)]
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
  }

  // Shoot-outs for a list of lean rows. Only a level score with a winner can be one, so
  // the (large) live_state is read for those few rows, not the whole career.
  async function loadShootouts(rows: FixtureRow[]): Promise<Map<string, Shootout>> {
    const ids = rows
      .filter((f) => f.winner_team_id && f.home_score != null && f.home_score === f.away_score)
      .map((f) => f.id as string);
    const out = new Map<string, Shootout>();
    if (ids.length === 0) return out;
    const logs = await prisma.fixtures.findMany({ where: { id: { in: ids } }, select: { id: true, live_state: true } });
    for (const l of logs) {
      const s = shootoutOf(l.live_state);
      if (s) out.set(l.id, s);
    }
    return out;
  }

  // Membership load shared by the dashboard + achievements: the user's teams with
  // their sport, organization, and the championships each roster is entered into.
  //
  // `activeOnly` (default true) means "what can act right now"; the dashboard's
  // career totals ask a different question - what have they ever played.
  async function loadMembershipMeta(userId: string, { activeOnly = true }: { activeOnly?: boolean } = {}) {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: userId, ...(activeOnly ? { is_active: true } : {}) },
      select: {
        team_id: true,
        is_active: true,
        left_at: true,
        teams: {
          select: {
            sports: { select: { id: true, name: true, icon: true } },
            organizations: { select: { id: true, name: true, short_name: true } },
            // Archived events leave My Game's championship cards along with the event.
            team_entries: {
              where: { championships: { archived_at: null } },
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
              where: { championships: { archived_at: null } },
              include: {
                championships: { select: { id: true, name: true, slug: true, status: true } },
                tournament_disciplines: { include: { disciplines: true, tournament_sports: { include: { tournaments: { select: { id: true, name: true } } } } } },
              },
              orderBy: { created_at: 'asc' },
            },
            team_members: { where: { is_active: true }, include: { users: { select: { id: true, name: true, email: true, phone: true } } } },
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
      // The token's org is as old as the sign-in; someone removed since is not a member.
      if (organizationId && !req.user!.isSuperAdmin && !await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active' }, select: { id: true },
      })) organizationId = null;
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
    // For an internal event, the units it invited - the same test squadEntryRefusal
    // applies - so the entry panel only offers events a squad can actually enter.
    const intraIds = rows.filter((r) => r.championships && r.championships.entry_level !== 'organization').map((r) => r.championship_id);
    const invitations = intraIds.length
      ? await prisma.championship_invitations.findMany({
        where: { championship_id: { in: intraIds }, org_unit_id: { not: null }, status: { in: ['pending', 'accepted'] } },
        select: { championship_id: true, org_unit_id: true },
      })
      : [];
    const invitedBy = new Map<string, string[]>();
    for (const i of invitations) invitedBy.set(i.championship_id, [...(invitedBy.get(i.championship_id) ?? []), i.org_unit_id!]);
    res.json(rows.map((r) => ({
      ...r,
      invited_unit_ids: invitedBy.get(r.championship_id) ?? [],
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
        // An archived event's matches leave the official's list with the event.
        tournament_disciplines: {
          tournament_sports: { tournaments: { championship_id: { in: eventIds }, championships: { archived_at: null } } },
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

  // Resolve the user's team memberships once - current and left (`is_active` says which):
  // the membership rows (with team + sport + the championships/disciplines each roster is
  // entered into) plus a Set of team ids for matching.
  async function loadMyTeams(userId: string) {
    const memberships = await prisma.team_members.findMany({
      where: { user_id: userId },
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
    // Every team ever played for, not just the ones still on the current roster -
    // this is a career summary, and leaving a team must not erase matches already
    // locked while you were on it. Nor add the ones it played after.
    const { memberships, teamIds } = await loadMembershipMeta(req.user!.id, { activeOnly: false });

    if (teamIds.size === 0) {
      res.json({ stats: { total_events: 0, total_matches: 0, wins: 0, losses: 0, draws: 0 }, championships: [], recent_matches: [], achievements: [] });
      return;
    }

    const fixtures = await prisma.fixtures.findMany({
      where: myFixturesWhere(memberships),
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
      /** Still on one of the squads entered here. */
      on_squad: boolean;
    };
    const eventMap = new Map<string, EventCard>();
    for (const m of memberships) {
      for (const entry of m.teams.team_entries) {
        const ev = entry.championships;
        if (!ev) continue;
        let card = eventMap.get(ev.id);
        if (!card) {
          card = { id: ev.id, name: ev.name, slug: ev.slug, status: ev.status, start_date: ev.start_date, end_date: ev.end_date, venue: ev.venue, team_count: 0, match_count: 0, win_count: 0, _sports: new Set(), on_squad: false };
          eventMap.set(ev.id, card);
        }
        card.team_count++;
        if (m.is_active) card.on_squad = true;
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
    // An old squad's event with none of its matches theirs was entered after they left.
    for (const [id, c] of eventMap) if (!c.on_squad && c.match_count === 0) eventMap.delete(id);

    const championships = [...eventMap.values()]
      .map((c) => ({
        id: c.id, name: c.name, slug: c.slug, status: c.status,
        start_date: c.start_date, end_date: c.end_date, venue: c.venue,
        team_count: c.team_count, match_count: c.match_count, win_count: c.win_count,
        sports: [...c._sports],
      }))
      .sort((a, b) => (b.start_date?.getTime() ?? 0) - (a.start_date?.getTime() ?? 0));

    const { wins, losses, draws } = tally(fixtures, teamIds);
    const recentRows = fixtures.slice(0, 5);
    const recentPens = await loadShootouts(recentRows);
    const recent_matches = recentRows.map((f) => summariseLean(f, teamIds, recentPens));

    // Achievements - awards this user has received, newest first, with match context.
    const achievements = await loadMyAwards(req.user!.id, teamIds);

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
    // What is coming up and the teams list read the squads they are on now; the record
    // (recent results, games, wins, events, sports) also keeps squads they have left, up
    // to the day they left - the same rule as the profile.
    const { memberships: places, teamIds } = await loadMembershipMeta(req.user!.id, { activeOnly: false });
    const memberships = places.filter((m) => m.is_active);
    const ids = memberships.map((m) => m.team_id);

    const empty = {
      next: null, live: [], pending: [], recent: [], teams: [],
      stats: { games: 0, events: 0, sports: 0, wins: 0 },
    };
    if (places.length === 0) { res.json(empty); return; }

    const mine = { OR: [{ home_team_id: { in: ids } }, { away_team_id: { in: ids } }] };
    const record = myFixturesWhere(places);
    const leftPlaces = places.filter((m) => !m.is_active);
    // Archived events drop out of what is still to do - next, live, owed scorecards.
    // Played results stay: they are the player's history.
    const activeEvent = { tournament_disciplines: { tournament_sports: { tournaments: { championships: { archived_at: null } } } } };

    const [upcoming, live, played, officiating] = await Promise.all([
      // Next fixture: the soonest one still to come. Unscheduled fixtures have a
      // null scheduled_at and are deliberately excluded - "next" has to have a when.
      prisma.fixtures.findMany({
        where: { ...mine, ...activeEvent, status: 'scheduled', scheduled_at: { gte: new Date() } },
        select: matchSelect, orderBy: { scheduled_at: 'asc' }, take: 1,
      }),
      prisma.fixtures.findMany({
        where: { ...mine, ...activeEvent, status: 'live' },
        select: matchSelect, orderBy: { scheduled_at: 'asc' }, take: 4,
      }),
      prisma.fixtures.findMany({
        where: { ...record, status: { in: PLAYED_STATUSES } },
        select: matchSelect, orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }], take: 5,
      }),
      // Anything this person is the official on that still owes a scorecard. This is
      // the one pending action the data can actually answer today; the rest of the
      // queue (availability, invitations) needs tables that do not exist yet.
      prisma.fixtures.findMany({
        where: {
          ...activeEvent,
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
    // A squad they left adds the events and sport of the matches they played for it -
    // not every event it entered, some of which came after they had gone.
    if (leftPlaces.length) {
      const leftPlayed = await prisma.fixtures.findMany({
        where: { ...myFixturesWhere(leftPlaces), tournament_disciplines: { tournament_sports: { tournaments: { championships: { archived_at: null } } } } },
        select: { home_team_id: true, away_team_id: true, tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } } } },
      });
      const leftIds = new Set(leftPlaces.map((m) => m.team_id));
      const sportOfTeam = new Map(leftPlaces.map((m) => [m.team_id, m.teams?.sports?.id]));
      for (const f of leftPlayed) {
        const ev = f.tournament_disciplines?.tournament_sports?.tournaments?.championship_id;
        if (ev) eventIds.add(ev);
        for (const t of [f.home_team_id, f.away_team_id]) {
          const sport = t && leftIds.has(t) ? sportOfTeam.get(t) : undefined;
          if (sport) sportIds.add(sport);
        }
      }
    }

    // Counted from completed fixtures only, so the strip agrees with the record
    // rather than with what is merely scheduled.
    const playedPens = await loadShootouts(played);
    const allPlayed = await prisma.fixtures.count({
      where: { ...record, status: { in: PLAYED_STATUSES } },
    });
    const allWins = await prisma.fixtures.count({
      where: { ...record, status: { in: PLAYED_STATUSES }, winner_team_id: { in: [...teamIds] } },
    });

    res.json({
      next: upcoming[0] ? summariseLean(upcoming[0] as FixtureRow, teamIds) : null,
      live: live.map((f) => summariseLean(f as FixtureRow, teamIds)),
      recent: played.map((f) => summariseLean(f as FixtureRow, teamIds, playedPens)),
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
    // Past squads too, as on the dashboard: an award stays theirs after leaving the team,
    // and mapAward needs the team to tell which side was theirs.
    const { teamIds } = await loadMembershipMeta(req.user!.id, { activeOnly: false });
    if (teamIds.size === 0) {
      res.json({ achievements: [] });
      return;
    }
    res.json({ achievements: await loadMyAwards(req.user!.id, teamIds) });
  }));

  // GET /me/matches - full match list, filterable by championship/status/organisation.
  //
  // Current squads give every match; squads the person has left (dropped, or removed
  // from the organisation) give the matches played while they were on it (myFixturesWhere).
  router.get('/me/matches', asyncHandler(async (req, res) => {
    const orgId = typeof req.query.organization_id === 'string' ? req.query.organization_id : undefined;
    const places = await prisma.team_members.findMany({
      where: { user_id: req.user!.id, ...(orgId ? { teams: { organization_id: orgId } } : {}) },
      select: { team_id: true, is_active: true, left_at: true, teams: { select: { organizations: { select: { id: true, name: true } } } } },
    });
    // Named only from the person's own squads, so an id from elsewhere reveals nothing.
    const org = orgId ? places[0]?.teams?.organizations ?? null : undefined;
    const teamIds = new Set(places.map((p) => p.team_id));
    if (teamIds.size === 0) {
      res.json({ matches: [], total: 0, ...(org !== undefined ? { organization: org } : {}) });
      return;
    }
    const eventId = typeof req.query.championship_id === 'string' ? req.query.championship_id : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const fixtures = await prisma.fixtures.findMany({
      where: {
        ...myFixturesWhere(places),
        ...(status ? { status } : {}),
        ...(eventId
          ? { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: eventId } } } }
          : {}),
      },
      include: fixtureInclude,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });

    const matches = fixtures.map((f) => toMatchSummary(f, teamIds));
    res.json({ matches, total: matches.length, ...(org !== undefined ? { organization: org } : {}) });
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

    // Verify the user is on one of the two teams - or was, for a match played while they
    // were on it (the same rule as the matches list).
    const home = f.teams_fixtures_home_team_idToteams;
    const away = f.teams_fixtures_away_team_idToteams;
    let homeMember = home?.team_members?.find((tm: any) => tm.user_id === req.user!.id);
    let awayMember = away?.team_members?.find((tm: any) => tm.user_id === req.user!.id);
    let formerMember = false;
    if (!homeMember && !awayMember && PLAYED_STATUSES.includes(f.status)) {
      const past = await prisma.team_members.findFirst({
        where: { user_id: req.user!.id, is_active: false, team_id: { in: [f.home_team_id, f.away_team_id].filter(Boolean) } },
      });
      // Only a match from their time on the squad - not one the team played after they left.
      if (past && playedWhileOn(f, past.left_at)) {
        formerMember = true;
        if (past.team_id === f.home_team_id) homeMember = past; else awayMember = past;
      }
    }
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
        pens: pensFor(shootoutOf(f.live_state), isHome),
        result: resultFor(f, myTeamIds),
        venue: ground ? { ground: ground.name, venue_name: ground.venues?.name ?? null, city: ground.venues?.city ?? null } : null,
        sport: mine.sports?.name ?? ts?.sports?.name ?? null,
        discipline: f.tournament_disciplines?.disciplines?.name ?? null,
        tournament: ts?.tournaments?.name ?? null,
        championship: championship ? { id: championship.id, name: championship.name, slug: championship.slug } : null,
        my_team: { id: mine.id, name: mine.name, organization: mine.organizations?.name ?? null },
        opponent: opp ? { id: opp.id, name: opp.name, organization: opp.organizations?.name ?? null } : null,
        my_role: myMember?.role ?? null,
        former_member: formerMember,
        jersey_number: myMember?.jersey_number ?? null,
        // The squad as it is today; someone who has left it is not shown its people.
        teammates: (formerMember ? [] : mine.team_members ?? [])
          .map((tm: any) => ({ name: tm.users?.name ?? '-', phone: tm.users?.phone ?? null, role: tm.role, jersey_number: tm.jersey_number }))
          .sort((a: any, b: any) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)),
      },
      // THE PLAYER'S OWN NUMBERS. Everything needed was already being written -
      // the spine row and the typed per-category detail - and nothing read it back
      // for the person it belonged to, so this endpoint returned a scoreline and
      // not one statistic the player had produced.
      my_stats: await myMatchStats(prisma, f.id, req.user!.id,
        mine.sports?.name ?? ts?.sports?.name ?? null),
    });
  }));

  // GET /me/championships/:eventId - full participation detail for one championship.
  router.get('/me/championships/:eventId', asyncHandler(async (req, res) => {
    const eventId = req.params.eventId;
    const { memberships, teamIds } = await loadMyTeams(req.user!.id);

    // The user's rosters entered into this championship, paired with that entry. A squad
    // they have left still opens the page, for the matches they played on it - as a
    // former member: their record only (Overview, My matches), no roster or standings.
    const inEvent = memberships
      .map((m) => ({ m, entry: m.teams.team_entries.find((e) => e.championship_id === eventId) }))
      .filter((x): x is { m: typeof x.m; entry: NonNullable<typeof x.entry> } => !!x.entry);
    if (inEvent.length === 0) throw new NotFoundError('Championship');
    const myMemberships = inEvent.filter((x) => x.m.is_active);
    const formerMember = myMemberships.length === 0;

    const championship = await prisma.championships.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true, description: true, archived_at: true },
    });
    // Archived: gone from a participant's view, the same as not existing.
    if (!championship || championship.archived_at) throw new NotFoundError('Championship');

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
    // in others, so filter by the fixture's championship via its discipline draw. A squad
    // they left gives only the matches played while they were on it (myFixturesWhere).
    const fixtures = await prisma.fixtures.findMany({
      where: {
        ...myFixturesWhere(inEvent.map((x) => x.m)),
        tournament_disciplines: { tournament_sports: { tournaments: { championship_id: eventId } } },
      },
      select: matchSelect,
      orderBy: [{ scheduled_at: 'desc' }, { created_at: 'desc' }],
    });
    // Left before playing any of it: nothing here is theirs, the same as not having entered.
    if (formerMember && fixtures.length === 0) throw new NotFoundError('Championship');

    const eventPens = await loadShootouts(fixtures);
    const matches = fixtures.map((f) => summariseLean(f, teamIds, eventPens));
    const { wins, losses, draws } = tally(fixtures, teamIds);
    // "Matches" on the Overview card means matches actually PLAYED - a
    // freshly-drawn fixture isn't a match yet, just a schedule slot.
    const played = fixtures.filter((f) => f.status === 'completed').length;

    // Championship-wide standings (read-only) - read the materialized championship-
    // scope table maintained by the standings engine.
    const standings = formerMember ? [] : await readStandings(prisma, eventId, 'championship', null);

    res.json({
      championship,
      stats: { matches: played, wins, losses, draws },
      teams,
      matches,
      standings,
      former_member: formerMember,
    });
  }));

  return router;
}
