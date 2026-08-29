import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from './error.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { isCampusAdmin } from '../../modules/iam/campus-admin.js';
import { ROLE_CODES, roleWhereByCode, type PermissionCode } from '@semp/shared';
import { hostOrgManages } from '../../modules/championships/manage-access.js';
import { can } from './can.js';

// Server-side authorization. The client mirrors these rules for UX, but this is
// the real boundary: every mutation must pass through here. Authority is
// championship-scoped (organiser of THIS championship), organization-scoped
// (an owner/admin member of the org), or platform-wide (super admin).
export function makeGuards(prisma: Prisma) {
  let organiserRoleId: string | null | undefined;
  async function getOrganiserRoleId(): Promise<string | null> {
    if (organiserRoleId === undefined) {
      const r = await prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES.organiser), select: { id: true } });
      organiserRoleId = r?.id ?? null;
    }
    return organiserRoleId;
  }

  async function organisesChampionship(userId: string, championshipId: string): Promise<boolean> {
    const rid = await getOrganiserRoleId();
    if (!rid) return false;
    const row = await prisma.user_championship_roles.findFirst({
      where: { user_id: userId, championship_id: championshipId, role_id: rid },
      select: { id: true },
    });
    return !!row;
  }

  // The real question every management guard is asking. Three answers, in the order
  // they are cheapest to establish:
  //
  //   1. an Organiser row on the event itself,
  //   2. any event role on the event whose definition grants `event.manage`, and
  //   3. the senior staff of the institution HOSTING it.
  //
  // (2) is new and is what makes the event vocabulary configurable at all. Until the
  // event roles were given permission arrays they granted nothing, so authority over
  // an event could only ever come from the hard-coded Organiser lookup in (1) - a
  // role an institution defined itself could not run an event however it was
  // configured. See manage-access.ts for why (3) is not a shortcut but the normal
  // case for an institution's own event.
  async function managesChampionship(userId: string, championshipId: string): Promise<boolean> {
    if (await organisesChampionship(userId, championshipId)) return true;
    if (await can(prisma, 'event.manage', { user: { id: userId }, scope: { championshipId } })) return true;
    return hostOrgManages(prisma, userId, championshipId);
  }

  // Does the user hold one of `roles` in this organization? Replaces the old
  // single-org `account_type === 'organization'` check now that membership is
  // many-to-many. owner/admin == the former "POC".
  async function orgRole(userId: string, orgId: string | null | undefined, roles: string[]): Promise<boolean> {
    if (!orgId) return false;
    const row = await prisma.organization_members.findFirst({
      where: { user_id: userId, organization_id: orgId, role: { in: roles }, status: 'active' },
      select: { id: true },
    });
    return !!row;
  }
  const ORG_ADMIN = ['owner', 'admin'];

  /**
   * The guard every organisation-scoped route should be using.
   *
   * The routers wrote their own `orgAdmin` middleware - `orgRole(u.id, orgId,
   * ['owner','admin'])` - which reads organization_members and nothing else. That is
   * why "the Owner decides who is a Sports Admin" did not work: granting somebody the
   * Org Admin role through the Roles screen wrote a user_org_roles row that the
   * permission engine honoured and these guards could not see. The engine widened
   * billing, two people routes and the module settings; everything else - members,
   * roles, the organisation's own profile - stayed membership-only, so a granted role
   * was a role in name.
   *
   * The membership check survives as the FALLBACK, so nothing that works today
   * stops working: this can only ever widen. Which permission each route asks for is
   * the interesting part, and it is stated at the route.
   */
  function orgPermission(
    permission: PermissionCode,
    opts: {
      orgId?: (req: Request) => string | null | undefined;
      /**
       * The campus or batch this request is ABOUT, when it is about one.
       *
       * Naming it makes a campus-scoped grant answer only for its own campus - see
       * `orgUnitId` on PermissionScope. Leaving it out asks the organisation-wide
       * question, which is what navigation and the dashboards want.
       */
      unitId?: (req: Request) => string | null | undefined;
      fallbackRoles?: string[];
    } = {},
  ): RequestHandler {
    const roles = opts.fallbackRoles ?? ORG_ADMIN;
    return asyncHandler(async (req, _res, next) => {
      const u = req.user!;
      if (u.isSuperAdmin) return next();
      const orgId = (opts.orgId ?? ((r: Request) => r.params.id))(req);
      if (!orgId) throw new ForbiddenError('No organization specified');
      const allowed = await can(prisma, permission, {
        user: { id: u.id, isSuperAdmin: u.isSuperAdmin },
        scope: { organizationId: orgId, orgUnitId: opts.unitId?.(req) ?? null },
        // The membership fallback is org-wide by nature, so it is NOT narrowed by the
        // unit: an owner/admin member has always reached every campus, and taking
        // that away here would be a silent behaviour change dressed up as a scope fix.
        fallback: () => orgRole(u.id, orgId, roles),
      });
      if (!allowed) throw new ForbiddenError('You do not have permission to do this in this organization');
      next();
    });
  }

  // ---- championship resolvers (walk a resource back to its owning championship) ----
  const championshipOfTournament = async (id?: string | null) =>
    id ? (await prisma.tournaments.findUnique({ where: { id }, select: { championship_id: true } }))?.championship_id : null;
  const championshipOfVenue = async (id?: string | null) =>
    id ? (await prisma.venues.findUnique({ where: { id }, select: { championship_id: true } }))?.championship_id : null;
  const championshipOfVenueGround = async (id?: string | null) =>
    id ? (await prisma.venue_grounds.findUnique({ where: { id }, select: { venues: { select: { championship_id: true } } } }))?.venues?.championship_id : null;
  const championshipOfTournamentSport = async (id?: string | null) =>
    id ? (await prisma.tournament_sports.findUnique({ where: { id }, select: { tournaments: { select: { championship_id: true } } } }))?.tournaments?.championship_id : null;
  const championshipOfTournamentDiscipline = async (id?: string | null) =>
    id ? (await prisma.tournament_disciplines.findUnique({
      where: { id },
      select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } },
    }))?.tournament_sports?.tournaments?.championship_id : null;
  const fixtureContext = async (id?: string | null) =>
    id ? prisma.fixtures.findUnique({
      where: { id },
      select: { official_id: true, tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { championship_id: true } } } } } } },
    }) : null;
  const championshipOfFixture = async (id?: string | null) =>
    (await fixtureContext(id))?.tournament_disciplines?.tournament_sports?.tournaments?.championship_id ?? null;

  // ---- guard: super admin OR organiser of the resolved championship ----
  function championshipManager(resolveChampionshipId: (req: Request) => Promise<string | null | undefined>): RequestHandler {
    return asyncHandler(async (req, _res, next) => {
      const user = req.user!;
      if (user.isSuperAdmin) return next();
      const championshipId = await resolveChampionshipId(req);
      if (!championshipId) throw new NotFoundError('Championship');
      if (!(await managesChampionship(user.id, championshipId))) throw new ForbiddenError('You do not manage this championship');
      next();
    });
  }

  // Guard for generic CRUD: resolve championship from body on create, from :id on update/delete.
  function championshipCrudGuard(resolvers: {
    body: (req: Request) => Promise<string | null | undefined>;
    byId: (id: string) => Promise<string | null | undefined>;
  }): RequestHandler {
    return championshipManager((req) => (req.method === 'POST' ? resolvers.body(req) : resolvers.byId(req.params.id)));
  }

  // ---- guard: managing a specific team - an owner/admin of the owning
  // organization, the team's own captain / vice-captain, or super ----
  const teamManager: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const team = await prisma.teams.findUnique({
      where: { id: req.params.id },
      select: {
        organization_id: true,
        org_unit_id: true,
        team_members: { where: { user_id: u.id, is_active: true }, select: { role: true } },
      },
    });
    if (!team) throw new NotFoundError('Team');
    // Owner/admin of the owning organization.
    if (await orgRole(u.id, team.organization_id, ORG_ADMIN)) return next();
    // ...or anybody the institution has GRANTED `team.manage`, narrowed to the unit
    // this squad plays for. Sports Admin holds it by definition - "runs sport day to
    // day ... people, teams, events" - and this guard could not see the grant at all,
    // so the role reached squads only by also happening to be the campus's named
    // administrator.
    if (await can(prisma, 'team.manage', {
      user: { id: u.id, isSuperAdmin: u.isSuperAdmin },
      scope: { organizationId: team.organization_id, orgUnitId: team.org_unit_id },
    })) return next();
    // The administrator of the campus or batch this squad plays FOR.
    //
    // Their whole job is their own unit's squads, so this is the narrowest possible
    // widening: it grants nothing on an organisation-level team (org_unit_id null),
    // and nothing on another unit's team.
    if (await isCampusAdmin(prisma, u.id, team.org_unit_id)) return next();
    // The team's own captain / vice-captain.
    if (team.team_members.some((m) => m.role === 'captain' || m.role === 'vice_captain')) return next();
    throw new ForbiddenError('Only the team captain, the campus administrator or an organization owner/admin can manage this team');
  });

  // ---- guard: creating teams - an owner/admin of the org(s) named in the body ----
  const teamCreate: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();

    // Each row is judged on its OWN pair. A campus administrator may create squads
    // for their campus and no other, so checking the organisation alone - as this
    // did - both refused them wrongly and, for an org admin, said nothing about
    // which unit a squad was being created for.
    const rows: Array<{ organization_id?: string; org_unit_id?: string | null }> =
      Array.isArray(req.body?.teams) ? req.body.teams : [req.body ?? {}];
    if (rows.length === 0 || !rows.some((r) => r?.organization_id)) {
      throw new ForbiddenError('No organization specified');
    }

    for (const r of rows) {
      if (!r?.organization_id) throw new ForbiddenError('No organization specified');
      if (await orgRole(u.id, r.organization_id, ORG_ADMIN)) continue;
      // A granted `team.create`, judged against the unit named ON THIS ROW - so a
      // campus-scoped Sports Admin creates squads for their campus and no other.
      if (await can(prisma, 'team.create', {
        user: { id: u.id, isSuperAdmin: u.isSuperAdmin },
        scope: { organizationId: r.organization_id, orgUnitId: r.org_unit_id ?? null },
      })) continue;
      if (await isCampusAdmin(prisma, u.id, r.org_unit_id)) {
        // ...and the campus must belong to the organisation named on the row, or
        // this is a route for building squads inside somebody else's institution.
        const owned = await prisma.org_units.findFirst({
          where: { id: r.org_unit_id!, organization_id: r.organization_id },
          select: { id: true },
        });
        if (owned) continue;
      }
      throw new ForbiddenError('You can only create teams for an organization you administer, or for a campus you run');
    }
    return next();
  });

  // ---- guard: managing a specific user (PATCH/DELETE /users/:id) - super admin,
  // or an owner/admin of the target user's home organization ----
  const manageUser: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const target = await prisma.users.findUnique({
      where: { id: req.params.id },
      select: { organization_id: true },
    });
    if (!target) throw new NotFoundError('User');
    if (await orgRole(u.id, target.organization_id, ORG_ADMIN)) return next();
    throw new ForbiddenError('You can only manage users in an organization you own or administer');
  });

  // ---- guard: enrolling an organization you own/administer into a championship ----
  const enrollSelf: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const orgId = req.body?.organization_id;
    if (await orgRole(u.id, orgId, ORG_ADMIN)) return next();
    // `event.enroll` exists in the catalogue precisely for this - "Entering YOUR
    // organisation into somebody else's championship" - and this guard was reading
    // membership instead, so the permission was unreachable and Sports Admin, which
    // holds it, could not enter its own institution into anything.
    if (orgId && await can(prisma, 'event.enroll', {
      user: { id: u.id, isSuperAdmin: u.isSuperAdmin },
      scope: { organizationId: orgId },
    })) return next();
    throw new ForbiddenError('You do not have permission to enter that organization into a championship');
  });

  // ---- guard: recording a fixture result - assigned official, organiser, or super ----
  const fixtureScorer: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const fx = await fixtureContext(req.params.id);
    if (!fx) throw new NotFoundError('Fixture');
    if (fx.official_id === u.id) return next();
    const championshipId = fx.tournament_disciplines?.tournament_sports?.tournaments?.championship_id;
    if (championshipId && (await managesChampionship(u.id, championshipId))) return next();
    throw new ForbiddenError('Not authorized to score this fixture');
  });

  return {
    orgPermission,
    championshipManager,
    championshipCrudGuard,
    teamManager,
    teamCreate,
    manageUser,
    enrollSelf,
    fixtureScorer,
    organisesChampionship,
    managesChampionship,
    orgRole,
    resolvers: {
      championshipOfTournament, championshipOfVenue, championshipOfVenueGround,
      championshipOfTournamentSport, championshipOfTournamentDiscipline, championshipOfFixture,
    },
  };
}

export type Guards = ReturnType<typeof makeGuards>;

// re-export a couple of plain helpers for convenience
export type { Request, Response, NextFunction };
