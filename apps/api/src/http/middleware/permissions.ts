import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from './error.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { ROLE_CODES, roleWhereByCode } from '../../modules/iam/role-codes.js';
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
  // Still used by callers outside this file (invitation acceptance), which is a
  // membership question rather than a permission one - "are you the org's admin",
  // not "may you do X". Guards here go through can() instead.
  const ORG_ADMIN = ['owner', 'admin'];
  void ORG_ADMIN;

  // ---- championship resolvers (walk a resource back to its owning championship) ----
  const championshipOfTournament = async (id?: string | null) =>
    id ? (await prisma.tournaments.findUnique({ where: { id }, select: { championship_id: true } }))?.championship_id : null;
  const championshipOfSponsor = async (id?: string | null) =>
    id ? (await prisma.sponsors.findUnique({ where: { id }, select: { championship_id: true } }))?.championship_id : null;
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
      if (!(await organisesChampionship(user.id, championshipId))) throw new ForbiddenError('You do not manage this championship');
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
        team_members: { where: { user_id: u.id, is_active: true }, select: { role: true } },
      },
    });
    if (!team) throw new NotFoundError('Team');

    // The team's own captain, always. This is NOT a fallback - it is a rule about THIS
    // team, and no organisation-scoped role can express "captain of the team in front
    // of you". Kept first so it reads as the first-class authority it is.
    if (team.team_members.some((m) => m.role === 'captain' || m.role === 'vice_captain')) return next();

    // Everything else is a grant. `team.manage` is retired from the fallbacks: an
    // owner or admin gets here through the org_owner / org_admin role rows, which the
    // organisation can edit - so removing team.manage from org_admin now actually
    // removes it. (RETIRED: fallback was orgRole(u.id, org, ['owner','admin']).)
    const allowed = await can(prisma, 'team.manage', {
      user: u,
      scope: { organizationId: team.organization_id },
    });
    if (allowed) return next();
    throw new ForbiddenError('Only the team captain or an organization owner/admin can manage this team');
  });

  // ---- guard: creating teams - an owner/admin of the org(s) named in the body ----
  const teamCreate: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const ids: string[] = Array.isArray(req.body?.teams)
      ? req.body.teams.map((t: any) => t?.organization_id)
      : [req.body?.organization_id];
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (unique.length === 0) throw new ForbiddenError('No organization specified');
    // EVERY organisation named must permit it, not any - creating teams in bulk
    // across orgs is the rule most likely to be silently loosened by a rewrite.
    // (RETIRED: fallback was orgRole(u.id, id, ['owner','admin']).)
    const ok = await Promise.all(unique.map((id) => can(prisma, 'team.create', {
      user: u,
      scope: { organizationId: id },
    })));
    if (ok.every(Boolean)) return next();
    throw new ForbiddenError('You can only create teams for an organization you own or administer');
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
    // (RETIRED: fallback was orgRole(u.id, target.organization_id, ['owner','admin']).)
    const allowed = await can(prisma, 'org.member.manage', {
      user: u,
      scope: { organizationId: target.organization_id },
    });
    if (allowed) return next();
    throw new ForbiddenError('You can only manage users in an organization you own or administer');
  });

  // ---- guard: enrolling an organization you own/administer into a championship ----
  // Checks `event.enroll`, not `event.approve`: entering your own organisation and
  // deciding who may enter yours are opposite sides of the same handshake, and this
  // guard was reading the host's permission for the entrant's action.
  // (RETIRED: fallback was orgRole(u.id, body.organization_id, ['owner','admin']).)
  const enrollSelf: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const allowed = await can(prisma, 'event.enroll', {
      user: u,
      scope: { organizationId: req.body?.organization_id },
    });
    if (allowed) return next();
    throw new ForbiddenError('Only an organization owner/admin can enroll that organization');
  });

  // ---- guard: recording a fixture result - assigned official, organiser, or super ----
  const fixtureScorer: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const fx = await fixtureContext(req.params.id);
    if (!fx) throw new NotFoundError('Fixture');
    if (fx.official_id === u.id) return next();
    const championshipId = fx.tournament_disciplines?.tournament_sports?.tournaments?.championship_id;
    if (championshipId && (await organisesChampionship(u.id, championshipId))) return next();
    throw new ForbiddenError('Not authorized to score this fixture');
  });

  return {
    championshipManager,
    championshipCrudGuard,
    teamManager,
    teamCreate,
    manageUser,
    enrollSelf,
    fixtureScorer,
    organisesChampionship,
    orgRole,
    resolvers: {
      championshipOfTournament, championshipOfSponsor, championshipOfVenue, championshipOfVenueGround,
      championshipOfTournamentSport, championshipOfTournamentDiscipline, championshipOfFixture,
    },
  };
}

export type Guards = ReturnType<typeof makeGuards>;

// re-export a couple of plain helpers for convenience
export type { Request, Response, NextFunction };
