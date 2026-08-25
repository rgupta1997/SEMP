import { Router } from 'express';
import { bulkAssignOfficialsSchema, createChampionshipSchema, updateChampionshipSchema, updateChampionshipStatusSchema, type ChampionshipStatus } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { assertChampionshipTransition } from './domain/championship-lifecycle.js';
import { notify } from '@semp/notifications/server/notify.js';
import { recomputeStandingsAtomic } from '../standings/standings.service.js';
import { signShareToken } from '../public/share-token.js';
import { listChampionshipFixtures } from './fixtures-list.js';
import { findUserByPhone } from '../iam/users.helpers.js';
import { ROLE_CODES, roleWhereByCode } from '@semp/shared';

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

// Mask an email for spectators: keep the first 2 chars of the local part + domain.
function maskEmail(email?: string | null): string | null {
  if (!email) return email ?? null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const shown = local.slice(0, 2);
  return `${shown}${'•'.repeat(Math.max(1, local.length - shown.length))}@${domain}`;
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

  // Private championships are visible only to people already involved: any
  // championship role (organiser/official), active officiating, playing on an
  // entered team, or belonging to an org that is enrolled or invited. Everyone
  // else simply never sees them (Discover, Browse, or by direct id).
  const involvedChampionshipIds = async (userId: string): Promise<Set<string>> => {
    const [roleRows, officialRows, memberRows, orgRows] = await Promise.all([
      prisma.user_championship_roles.findMany({ where: { user_id: userId }, select: { championship_id: true } }),
      prisma.championship_officials.findMany({ where: { user_id: userId, is_active: true }, select: { championship_id: true } }),
      prisma.team_members.findMany({ where: { user_id: userId, is_active: true }, select: { teams: { select: { team_entries: { select: { championship_id: true } } } } } }),
      prisma.organization_members.findMany({ where: { user_id: userId, status: 'active' }, select: { organization_id: true } }),
    ]);
    const ids = new Set<string>();
    for (const r of roleRows) ids.add(r.championship_id);
    for (const o of officialRows) ids.add(o.championship_id);
    for (const m of memberRows) for (const e of m.teams?.team_entries ?? []) ids.add(e.championship_id);
    const orgIds = orgRows.map((o) => o.organization_id);
    if (orgIds.length) {
      const [enrolled, invited] = await Promise.all([
        prisma.championship_organizations.findMany({ where: { organization_id: { in: orgIds } }, select: { championship_id: true } }),
        prisma.championship_invitations.findMany({ where: { organization_id: { in: orgIds } }, select: { championship_id: true } }),
      ]);
      for (const e of enrolled) ids.add(e.championship_id);
      for (const i of invited) ids.add(i.championship_id);
    }
    return ids;
  };

  const canSeeChampionship = async (user: { id: string; isSuperAdmin?: boolean }, championship: { id: string; visibility: string }): Promise<boolean> => {
    if (championship.visibility !== 'private' || user.isSuperAdmin) return true;
    return (await involvedChampionshipIds(user.id)).has(championship.id);
  };

  // -------------------------------------------------------------------------
  // DISCOVER - every PUBLIC championship, open to any authenticated user
  // (spectators included), plus private ones the user is involved in. The
  // "Host" and "Championships" views are derived from /mine.
  // -------------------------------------------------------------------------
  router.get('/', asyncHandler(async (req, res) => {
    const where = req.user!.isSuperAdmin
      ? {}
      : { OR: [{ visibility: 'public' }, { id: { in: [...(await involvedChampionshipIds(req.user!.id))] } }] };
    const championships = await prisma.championships.findMany({
      where,
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
      prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.organiser), select: { id: true } }),
      prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.official), select: { id: true } }),
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

  // GET single championship. A private one 404s for outsiders (same as not existing,
  // so its presence is never leaked by direct id).
  router.get('/:id', asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.id } });
    if (!championship) throw new NotFoundError('Championship');
    if (!(await canSeeChampionship(req.user!, championship))) throw new NotFoundError('Championship');
    res.json(championship);
  }));

  // The view-only public share token for this championship (organiser/super only).
  // The frontend builds the link as `<origin>/c/<token>`.
  router.get('/:id/share-link', ownChampionship, asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!championship) throw new NotFoundError('Championship');
    res.json({ token: signShareToken(req.params.id) });
  }));

  // CREATE championship - any authenticated user may host. Creator is auto-assigned
  // Organiser, and a default season (named after the championship) is created so the
  // organiser can jump straight to adding sports - they never have to make a season
  // by hand (they can still rename/add more on the Seasons tab).
  router.post('/', validateBody(createChampionshipSchema), asyncHandler(async (req, res) => {
    // Who is hosting. Sent explicitly when the organiser is creating from inside an
    // organisation; otherwise inferred, but only when there is exactly one candidate.
    // Belonging to two institutions makes the answer a question, and a question that
    // guesses is how an event ends up filed under the wrong college.
    let hostOrgId: string | null = req.body.host_organization_id ?? null;
    if (hostOrgId) {
      const may = await prisma.organization_members.findFirst({
        where: {
          user_id: req.user!.id, organization_id: hostOrgId,
          status: 'active', role: { in: ['owner', 'admin'] },
        },
        select: { id: true },
      });
      if (!may && !req.user!.isSuperAdmin) {
        throw new ForbiddenError('You cannot host an event on behalf of that organisation');
      }
    } else {
      const admin = await prisma.organization_members.findMany({
        where: { user_id: req.user!.id, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { organization_id: true },
        take: 2,
      });
      if (admin.length === 1) hostOrgId = admin[0].organization_id;
    }

    const championship = await prisma.championships.create({
      data: { ...req.body, host_organization_id: hostOrgId },
    });
    const organiserRole = await prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.organiser) });
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
      try { await recomputeStandingsAtomic(prisma, updated.id); }
      catch (err) { console.error(`[standings] final recompute failed for ${updated.id}:`, err); }
    }

    // Best-effort, matching every other side-effect notification in this codebase -
    // the status change already committed above, so a notify() failure (e.g. an
    // audience that resolves to nobody yet, or a status the templates don't cover)
    // must never turn into a failed response for a status change that already happened.
    try {
      await notify(prisma, {
        type: 'event_lifecycle',
        championshipId: updated.id,
        senderId: req.user!.id,
        data: { status: req.body.status },
      });
    } catch (err) {
      console.error(`[notifications] event_lifecycle notify failed for ${updated.id}:`, err);
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
  // powers the schedule timeline (Gantt) view. Shared with the public share page.
  router.get('/:id/fixtures', asyncHandler(async (req, res) => {
    res.json(await listChampionshipFixtures(prisma, req.params.id));
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
    const maskMail = (e?: string | null) => (insider ? (e ?? null) : maskEmail(e));

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
          return { id: m.users!.id, name: m.users!.name, email: maskMail(m.users!.email), phone: mask(m.users!.phone), role: m.role, jersey_number: m.jersey_number };
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

  // Look a competitor up by phone for event (powerlifting/swimming) scoring: returns the
  // matched user plus the org they're rostered under *within this championship* (a team
  // entered in it), so officials can enter athletes by phone and auto-fill their org.
  router.get('/:id/competitors/lookup', asyncHandler(async (req, res) => {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const user = await findUserByPhone(prisma, phone);
    if (!user) { res.json({ found: false }); return; }
    // The org of a team this user is a member of and that is entered in this championship.
    const team = await prisma.teams.findFirst({
      where: {
        team_entries: { some: { championship_id: req.params.id } },
        team_members: { some: { user_id: user.id } },
      },
      include: { organizations: { select: { id: true, name: true } } },
    });
    const org = team?.organizations ?? null;
    res.json({ found: true, userId: user.id, name: user.name, orgId: org?.id ?? null, org: org?.name ?? null });
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
        user: user && !insider ? { ...user, phone: maskPhone(user.phone), email: maskEmail(user.email) } : user,
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
