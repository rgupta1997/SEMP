import { Router } from 'express';
import { bulkAssignOfficialsSchema, createChampionshipSchema, updateChampionshipSchema, updateChampionshipStatusSchema, type ChampionshipStatus } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError } from '../../shared/errors.js';
import { assertChampionshipTransition } from './domain/championship-lifecycle.js';
import { createNotification } from '../notifications/audience.js';
import { recomputeStandings } from '../standings/standings.service.js';

// Prisma include that pulls just the sport names offered by a championship, plus a
// helper that flattens them to a distinct, sorted `sports: string[]` and drops the
// nested rows. Powers the sport filter on Discover / Championships.
const championshipSportsInclude = {
  tournaments: { select: { tournament_sports: { select: { sports: { select: { name: true } } } } } },
} as const;
function withSports(c: any) {
  const set = new Set<string>();
  for (const t of c.tournaments ?? []) for (const ts of t.tournament_sports ?? []) if (ts.sports?.name) set.add(ts.sports.name);
  const { tournaments, ...rest } = c;
  return { ...rest, sports: [...set].sort() };
}

// Mask a contact number for spectators: keep the last 3 digits, hide the rest.
function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 3) return '•••';
  return '•'.repeat(digits.length - 3) + digits.slice(-3);
}

// Only two kinds of viewer may see real contact numbers for a championship:
//   1. the organiser / organising team (a user_championship_roles "Organiser" row), or
//   2. an owner of an organization enrolled in that championship.
// Everyone else - officials, players, org admins/members, and spectators - gets
// the phone masked.
async function isChampionshipInsider(prisma: Prisma, userId: string, championshipId: string): Promise<boolean> {
  const [organiser, enrolledOwner] = await Promise.all([
    prisma.user_championship_roles.findFirst({
      where: { user_id: userId, championship_id: championshipId, roles: { name: 'Organiser' } },
      select: { id: true },
    }),
    prisma.championship_organizations.findFirst({
      where: {
        championship_id: championshipId,
        organizations: { organization_members: { some: { user_id: userId, role: 'owner', status: 'active' } } },
      },
      select: { id: true },
    }),
  ]);
  return !!(organiser || enrolledOwner);
}

// Human-readable lifecycle notification copy per target status. Returned undefined
// for statuses we don't announce (e.g. back to draft).
function lifecycleMessage(status: ChampionshipStatus): { title: string; body: string } | undefined {
  switch (status) {
    case 'registration_open':
      return { title: 'Registration is open', body: 'This championship is now open for organization registration.' };
    case 'ongoing':
      return { title: 'The championship is now live', body: 'Matches are underway - good luck to all teams.' };
    case 'completed':
      return { title: 'The championship has concluded', body: 'Thanks for taking part. Final standings are available.' };
    default:
      return undefined;
  }
}

export function makeEventsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of THIS championship (or super) - for mutations on /:id and its children.
  const ownChampionship = guards.championshipManager(async (req) => req.params.id);

  // -------------------------------------------------------------------------
  // DISCOVER - every championship, open to any authenticated user (spectators
  // included). The "Host" and "Championships" views are derived from /mine.
  // -------------------------------------------------------------------------
  router.get('/', asyncHandler(async (_req, res) => {
    const championships = await prisma.championships.findMany({
      orderBy: { created_at: 'desc' },
      include: championshipSportsInclude,
    });
    res.json(championships.map(withSports));
  }));

  // -------------------------------------------------------------------------
  // MINE - championships the user is involved in, each tagged with the roles
  // they hold (organiser / official / player / member). Powers the
  // "Championships" page and (filtered to organiser) the "Host" page.
  // -------------------------------------------------------------------------
  router.get('/mine', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const roles = new Map<string, Set<string>>();
    const add = (id: string, role: string) => {
      if (!roles.has(id)) roles.set(id, new Set());
      roles.get(id)!.add(role);
    };

    // One round-trip, not two: the role lookups don't depend on the data queries, so
    // fire all six together rather than awaiting the roles first (each sequential
    // await is a full network round-trip to the remote pooler - ~700ms each).
    const [orgRole, offRole, championshipRoleRows, officialRows, memberRows, enrolledRows] = await Promise.all([
      prisma.roles.findUnique({ where: { name: 'Organiser' }, select: { id: true } }),
      prisma.roles.findUnique({ where: { name: 'Official' }, select: { id: true } }),
      prisma.user_championship_roles.findMany({ where: { user_id: userId }, select: { championship_id: true, role_id: true } }),
      prisma.championship_officials.findMany({ where: { user_id: userId, is_active: true }, select: { championship_id: true } }),
      prisma.team_members.findMany({ where: { user_id: userId, is_active: true }, select: { teams: { select: { team_entries: { select: { championship_id: true } } } } } }),
      prisma.championship_organizations.findMany({
        where: { organizations: { organization_members: { some: { user_id: userId, status: 'active' } } } },
        select: { championship_id: true },
      }),
    ]);

    for (const r of championshipRoleRows) {
      if (offRole && r.role_id === offRole.id) add(r.championship_id, 'official');
      else add(r.championship_id, 'organiser');
    }
    for (const o of officialRows) add(o.championship_id, 'official');
    for (const m of memberRows) for (const e of m.teams?.team_entries ?? []) add(e.championship_id, 'player');
    for (const e of enrolledRows) add(e.championship_id, 'member');

    const ids = [...roles.keys()];
    if (ids.length === 0) { res.json([]); return; }
    const championships = await prisma.championships.findMany({
      where: { id: { in: ids } },
      orderBy: { created_at: 'desc' },
      include: championshipSportsInclude,
    });
    res.json(championships.map((c) => ({ ...withSports(c), my_roles: [...(roles.get(c.id) ?? [])] })));
  }));

  // GET single championship
  router.get('/:id', asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.id } });
    if (!championship) throw new NotFoundError('Championship');
    res.json(championship);
  }));

  // CREATE championship - any authenticated user may host. Creator is auto-assigned
  // Organiser, and a default season (named after the championship) is created so the
  // organiser can jump straight to adding sports - they never have to make a season
  // by hand (they can still rename/add more on the Seasons tab).
  router.post('/', validateBody(createChampionshipSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.create({ data: req.body });
    const organiserRole = await prisma.roles.findUnique({ where: { name: 'Organiser' } });
    if (organiserRole) {
      await prisma.user_championship_roles.create({
        data: { championship_id: championship.id, user_id: req.user!.id, role_id: organiserRole.id },
      });
    }
    await prisma.tournaments.create({
      data: { championship_id: championship.id, name: championship.name, status: 'active' },
    });
    // Seed a default venue from the host city so disciplines have a venue to assign
    // right away (the organiser can rename it or add more on the Venues tab).
    if (championship.venue) {
      await prisma.venues.create({
        data: { championship_id: championship.id, name: championship.venue, city: championship.venue },
      });
    }
    res.status(201).json(championship);
  }));

  // UPDATE championship
  router.patch('/:id', ownChampionship, validateBody(updateChampionshipSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.update({ where: { id: req.params.id }, data: req.body });
    res.json(championship);
  }));

  // DELETE championship - host (organiser) or super admin only, via ownChampionship.
  // Most child FKs are ON DELETE NO ACTION in the DB, and every championship has at
  // least the creator's organiser role row, so we remove dependents in dependency
  // order inside one transaction. (officials, notifications and invitations cascade
  // automatically through their own FKs.)
  router.delete('/:id', ownChampionship, asyncHandler(async (req, res) => {
    const id = req.params.id;
    await prisma.$transaction([
      // Fixtures sit at the bottom - they reference teams, grounds and disciplines.
      prisma.fixtures.deleteMany({ where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: id } } } } }),
      // Rosters are cross-championship now, so only their entries for this
      // championship are removed - the teams + members survive for other events.
      prisma.team_entries.deleteMany({ where: { championship_id: id } }),
      prisma.tournament_disciplines.deleteMany({ where: { tournament_sports: { tournaments: { championship_id: id } } } }),
      prisma.tournament_sports.deleteMany({ where: { tournaments: { championship_id: id } } }),
      prisma.tournaments.deleteMany({ where: { championship_id: id } }),
      prisma.venue_grounds.deleteMany({ where: { venues: { championship_id: id } } }),
      prisma.venues.deleteMany({ where: { championship_id: id } }),
      prisma.championship_organizations.deleteMany({ where: { championship_id: id } }),
      prisma.sponsors.deleteMany({ where: { championship_id: id } }),
      prisma.user_championship_roles.deleteMany({ where: { championship_id: id } }),
      prisma.championships.delete({ where: { id } }),
    ]);
    res.status(204).send();
  }));

  // Status transition (validated lifecycle) - defined before generic /:id routes.
  router.patch('/:id/status', ownChampionship, validateBody(updateChampionshipStatusSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.id } });
    if (!championship) throw new NotFoundError('Championship');
    assertChampionshipTransition(championship.status as ChampionshipStatus, req.body.status as ChampionshipStatus);
    const updated = await prisma.championships.update({ where: { id: req.params.id }, data: { status: req.body.status } });

    // Freeze a final, accurate snapshot at the moment of completion (fixture-driven
    // recomputes stop once a championship is completed).
    if (req.body.status === 'completed') {
      try { await recomputeStandings(prisma, updated.id); }
      catch (err) { console.error(`[standings] final recompute failed for ${updated.id}:`, err); }
    }

    // Lifecycle announcement → organizations + captains only.
    const msg = lifecycleMessage(req.body.status as ChampionshipStatus);
    if (msg) {
      await createNotification(prisma, {
        championship_id: updated.id,
        sender_id: req.user!.id,
        type: 'event_lifecycle',
        audience: 'organizations_captains',
        title: msg.title,
        body: msg.body,
      });
    }

    res.json(updated);
  }));

  // All draws (tournament_disciplines) across the championship, flattened with their
  // sport/discipline/tournament names - powers team entry (single + bulk).
  router.get('/:id/draws', asyncHandler(async (req, res) => {
    const draws = await prisma.tournament_disciplines.findMany({
      where: { tournament_sports: { tournaments: { championship_id: req.params.id } } },
      include: {
        disciplines: true,
        tournament_sports: { include: { sports: true, tournaments: { select: { id: true, name: true } } } },
      },
      orderBy: { display_order: 'asc' },
    });
    res.json(draws);
  }));

  // All fixtures across the championship, flattened with team / ground / sport names -
  // powers the schedule timeline (Gantt) view.
  router.get('/:id/fixtures', asyncHandler(async (req, res) => {
    const fixtures = await prisma.fixtures.findMany({
      where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: req.params.id } } } },
      include: {
        teams_fixtures_home_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
        teams_fixtures_away_team_idToteams: { select: { id: true, name: true, organizations: { select: { short_name: true, name: true } } } },
        venue_grounds: { select: { id: true, name: true, venues: { select: { name: true } } } },
        tournament_disciplines: {
          select: {
            entry_type: true,
            disciplines: { select: { name: true } },
            tournament_sports: {
              select: {
                sports: { select: { name: true, icon: true } },
                tournaments: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });
    res.json(fixtures.map((f) => ({
      id: f.id,
      status: f.status,
      round: f.round,
      scheduled_at: f.scheduled_at,
      duration_minutes: f.duration_minutes,
      tournament_discipline_id: f.tournament_discipline_id,
      entry_type: f.tournament_disciplines?.entry_type ?? null,
      home_score: f.home_score,
      away_score: f.away_score,
      winner_team_id: f.winner_team_id,
      // Raw FK / position fields so the Schedule "Fixtures" view (DrawCard, bracket,
      // grid, fixture editor) can render and edit straight from this one
      // championship-wide list instead of a per-draw request each.
      home_team_id: f.home_team_id,
      away_team_id: f.away_team_id,
      venue_ground_id: f.venue_ground_id,
      official_id: f.official_id,
      pool_number: f.pool_number,
      bracket_position: f.bracket_position,
      ground: f.venue_grounds ? { id: f.venue_grounds.id, name: f.venue_grounds.name, venue: f.venue_grounds.venues?.name ?? null } : null,
      sport: f.tournament_disciplines?.tournament_sports?.sports?.name ?? null,
      sport_icon: f.tournament_disciplines?.tournament_sports?.sports?.icon ?? null,
      tournament: f.tournament_disciplines?.tournament_sports?.tournaments ?? null,
      discipline: f.tournament_disciplines?.disciplines?.name ?? null,
      home: f.teams_fixtures_home_team_idToteams,
      away: f.teams_fixtures_away_team_idToteams,
    })));
  }));

  // All grounds across the championship's venues - used to schedule fixtures to a ground.
  router.get('/:id/grounds', asyncHandler(async (req, res) => {
    const grounds = await prisma.venue_grounds.findMany({
      where: { venues: { championship_id: req.params.id } },
      include: { venues: { select: { id: true, name: true } } },
      orderBy: [{ venue_id: 'asc' }, { display_order: 'asc' }],
    });
    res.json(grounds);
  }));

  // NOTE: standings (GET /:id/standings) and scoring rules now live in the
  // standings module (standings.routes.ts), mounted under /championships. They read
  // the materialized `standings` table rather than recomputing on every request.

  // -------------------------------------------------------------------------
  // EVENT PARTICIPANTS - organizations → teams → players for this championship.
  // Every APPROVED organization appears (even before it has created a team), and
  // every entered team appears (even before it has players) so the host can see who
  // has joined and who still needs to build a squad. Phones are masked for outsiders.
  // -------------------------------------------------------------------------
  router.get('/:id/participants', asyncHandler(async (req, res) => {
    const insider = req.user!.isSuperAdmin || await isChampionshipInsider(prisma, req.user!.id, req.params.id);
    const mask = (p?: string | null) => (insider ? (p ?? null) : maskPhone(p));

    const [teams, approvedOrgs] = await Promise.all([
      prisma.teams.findMany({
        where: { team_entries: { some: { championship_id: req.params.id } } },
        include: {
          team_members: { include: { users: { select: { id: true, name: true, email: true, phone: true } } } },
          organizations: { select: { id: true, name: true, short_name: true } },
          sports: { select: { id: true, name: true, icon: true } },
        },
      }),
      prisma.championship_organizations.findMany({
        where: { championship_id: req.params.id, status: 'approved' },
        include: { organizations: { select: { id: true, name: true, short_name: true } } },
      }),
    ]);

    type OrgBucket = { orgId: string; org: { id: string; name: string; short_name: string | null } | null; teams: Map<string, any>; players: Set<string> };
    const orgs = new Map<string, OrgBucket>();
    const ensureOrg = (org: { id: string; name: string; short_name: string | null } | null): OrgBucket => {
      const orgId = org?.id ?? 'unaffiliated';
      let bucket = orgs.get(orgId);
      if (!bucket) { bucket = { orgId, org, teams: new Map(), players: new Set() }; orgs.set(orgId, bucket); }
      return bucket;
    };

    // Seed every approved org so it shows even with no teams yet.
    for (const ao of approvedOrgs) if (ao.organizations) ensureOrg(ao.organizations);

    for (const team of teams) {
      const bucket = ensureOrg(team.organizations ?? null);
      const players = team.team_members
        .filter((m) => m.users)
        .map((m) => {
          bucket.players.add(m.users!.id);
          return { id: m.users!.id, name: m.users!.name, email: m.users!.email, phone: mask(m.users!.phone), role: m.role, jersey_number: m.jersey_number };
        });
      bucket.teams.set(team.id, { team_id: team.id, team_name: team.name, sport: team.sports, players });
    }

    const organizations = [...orgs.values()]
      .map((b) => ({
        orgId: b.orgId,
        org: b.org,
        playerCount: b.players.size,
        teams: [...b.teams.values()].sort((a, b2) => a.team_name.localeCompare(b2.team_name)),
      }))
      .sort((a, b) => (a.org?.name ?? 'Unaffiliated').localeCompare(b.org?.name ?? 'Unaffiliated'));

    res.json({ organizations });
  }));

  // -------------------------------------------------------------------------
  // EVENT OFFICIALS - officials assigned to this championship
  // -------------------------------------------------------------------------
  router.get('/:id/officials', asyncHandler(async (req, res) => {
    const insider = req.user!.isSuperAdmin || await isChampionshipInsider(prisma, req.user!.id, req.params.id);
    const officials = await prisma.championship_officials.findMany({
      where: { championship_id: req.params.id, is_active: true },
      include: {
        users_championship_officials_user_idTousers: { select: { id: true, name: true, email: true, phone: true, account_type: true } },
        users_championship_officials_assigned_byTousers: { select: { id: true, name: true } },
      },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(officials.map((o) => {
      const user = o.users_championship_officials_user_idTousers;
      return {
        id: o.id,
        user: user && !insider ? { ...user, phone: maskPhone(user.phone) } : user,
        assigned_by: o.users_championship_officials_assigned_byTousers,
        assigned_at: o.assigned_at,
        notes: o.notes,
      };
    }));
  }));

  // Assign official to championship
  router.post('/:id/officials', ownChampionship, asyncHandler(async (req, res) => {
    const { user_id, notes } = req.body;
    if (!user_id) throw new NotFoundError('user_id required');
    
    const existing = await prisma.championship_officials.findUnique({
      where: { championship_id_user_id: { championship_id: req.params.id, user_id } },
    });
    if (existing) {
      // Reactivate if inactive
      const updated = await prisma.championship_officials.update({
        where: { id: existing.id },
        data: { is_active: true, notes },
        include: { users_championship_officials_user_idTousers: { select: { id: true, name: true, email: true } } },
      });
      res.json({ ...updated, user: updated.users_championship_officials_user_idTousers });
      return;
    }

    const official = await prisma.championship_officials.create({
      data: { championship_id: req.params.id, user_id, assigned_by: req.user!.id, notes },
      include: { users_championship_officials_user_idTousers: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json({ ...official, user: official.users_championship_officials_user_idTousers });
  }));

  // Bulk-assign several officials in one request (multi-select picker). Upserts each
  // (championship, user): a previously-removed official is reactivated. One round-trip.
  router.post('/:id/officials/bulk', ownChampionship, validateBody(bulkAssignOfficialsSchema), asyncHandler(async (req, res) => {
    const { user_ids, notes } = req.body as { user_ids: string[]; notes?: string };
    const championshipId = req.params.id;
    const rows = await prisma.$transaction(
      [...new Set(user_ids)].map((user_id) => prisma.championship_officials.upsert({
        where: { championship_id_user_id: { championship_id: championshipId, user_id } },
        update: { is_active: true, notes },
        create: { championship_id: championshipId, user_id, assigned_by: req.user!.id, notes },
        include: { users_championship_officials_user_idTousers: { select: { id: true, name: true, email: true } } },
      })),
    );
    res.status(201).json(rows.map((o) => ({ ...o, user: o.users_championship_officials_user_idTousers })));
  }));

  // Remove official from championship
  router.delete('/:id/officials/:officialId', ownChampionship, asyncHandler(async (req, res) => {
    await prisma.championship_officials.update({
      where: { id: req.params.officialId },
      data: { is_active: false },
    });
    res.status(204).send();
  }));

  // -------------------------------------------------------------------------
  // EVENT INSTITUTIONS (enrollments) - already exists via enrollment router
  // but add a convenience read endpoint here
  // -------------------------------------------------------------------------
  router.get('/:id/organizations', asyncHandler(async (req, res) => {
    const enrollments = await prisma.championship_organizations.findMany({
      where: { championship_id: req.params.id },
      include: {
        organizations: true,
        users_championship_organizations_applied_byTousers: { select: { id: true, name: true, email: true } },
      },
      orderBy: { applied_at: 'desc' },
    });
    res.json(enrollments);
  }));

  return router;
}
