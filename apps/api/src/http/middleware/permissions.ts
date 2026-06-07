import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from './error.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

// Server-side authorization. The client mirrors these rules for UX, but this is
// the real boundary: every mutation must pass through here. Authority is
// event-scoped (organiser of THIS event), institution-scoped (own institution),
// or platform-wide (super admin).
export function makeGuards(prisma: Prisma) {
  let organiserRoleId: string | null | undefined;
  async function getOrganiserRoleId(): Promise<string | null> {
    if (organiserRoleId === undefined) {
      const r = await prisma.roles.findUnique({ where: { name: 'Organiser' }, select: { id: true } });
      organiserRoleId = r?.id ?? null;
    }
    return organiserRoleId;
  }

  async function organisesEvent(userId: string, eventId: string): Promise<boolean> {
    const rid = await getOrganiserRoleId();
    if (!rid) return false;
    const row = await prisma.user_event_roles.findFirst({
      where: { user_id: userId, event_id: eventId, role_id: rid },
      select: { id: true },
    });
    return !!row;
  }

  // ---- event resolvers (walk a resource back to its owning event) ----
  const eventOfTournament = async (id?: string | null) =>
    id ? (await prisma.tournaments.findUnique({ where: { id }, select: { event_id: true } }))?.event_id : null;
  const eventOfSponsor = async (id?: string | null) =>
    id ? (await prisma.sponsors.findUnique({ where: { id }, select: { event_id: true } }))?.event_id : null;
  const eventOfVenue = async (id?: string | null) =>
    id ? (await prisma.venues.findUnique({ where: { id }, select: { event_id: true } }))?.event_id : null;
  const eventOfVenueGround = async (id?: string | null) =>
    id ? (await prisma.venue_grounds.findUnique({ where: { id }, select: { venues: { select: { event_id: true } } } }))?.venues?.event_id : null;
  const eventOfTournamentSport = async (id?: string | null) =>
    id ? (await prisma.tournament_sports.findUnique({ where: { id }, select: { tournaments: { select: { event_id: true } } } }))?.tournaments?.event_id : null;
  const eventOfTournamentDiscipline = async (id?: string | null) =>
    id ? (await prisma.tournament_disciplines.findUnique({
      where: { id },
      select: { tournament_sports: { select: { tournaments: { select: { event_id: true } } } } },
    }))?.tournament_sports?.tournaments?.event_id : null;
  const fixtureContext = async (id?: string | null) =>
    id ? prisma.fixtures.findUnique({
      where: { id },
      select: { official_id: true, tournament_disciplines: { select: { tournament_sports: { select: { tournaments: { select: { event_id: true } } } } } } },
    }) : null;
  const eventOfFixture = async (id?: string | null) =>
    (await fixtureContext(id))?.tournament_disciplines?.tournament_sports?.tournaments?.event_id ?? null;

  // ---- guard: super admin OR organiser of the resolved event ----
  function eventManager(resolveEventId: (req: Request) => Promise<string | null | undefined>): RequestHandler {
    return asyncHandler(async (req, _res, next) => {
      const user = req.user!;
      if (user.isSuperAdmin) return next();
      const eventId = await resolveEventId(req);
      if (!eventId) throw new NotFoundError('Event');
      if (!(await organisesEvent(user.id, eventId))) throw new ForbiddenError('You do not manage this event');
      next();
    });
  }

  // Guard for generic CRUD: resolve event from body on create, from :id on update/delete.
  function eventCrudGuard(resolvers: {
    body: (req: Request) => Promise<string | null | undefined>;
    byId: (id: string) => Promise<string | null | undefined>;
  }): RequestHandler {
    return eventManager((req) => (req.method === 'POST' ? resolvers.body(req) : resolvers.byId(req.params.id)));
  }

  // ---- guard: organiser-capable account (to create a brand-new event) ----
  const organiserAccount: RequestHandler = (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin || u.accountType === 'organiser') return next();
    throw new ForbiddenError('Organiser account required');
  };

  // ---- guard: managing a specific team — institution staff (POC) of the owning
  // institution, or the team's captain / vice-captain, or super ----
  const teamManager: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const team = await prisma.teams.findUnique({
      where: { id: req.params.id },
      select: {
        institution_id: true,
        team_members: { where: { user_id: u.id, is_active: true }, select: { role: true } },
      },
    });
    if (!team) throw new NotFoundError('Team');
    // Institution staff (POC) of the owning institution.
    if (u.accountType === 'institution' && team.institution_id && team.institution_id === u.institutionId) return next();
    // Captain / vice-captain of this specific team.
    if (team.team_members.some((m) => m.role === 'captain' || m.role === 'vice_captain')) return next();
    throw new ForbiddenError('Only the team captain or an institution admin can manage this team');
  });

  // ---- guard: creating teams for your own institution ----
  const teamCreate: RequestHandler = (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const ids: string[] = Array.isArray(req.body?.teams)
      ? req.body.teams.map((t: any) => t?.institution_id)
      : [req.body?.institution_id];
    if (ids.length > 0 && ids.every((id) => id && id === u.institutionId)) return next();
    throw new ForbiddenError('You can only create teams for your own institution');
  };

  // ---- guard: managing a specific user (PATCH/DELETE /users/:id) — super admin,
  // or the institution POC of the target user's own institution ----
  const manageUser: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const target = await prisma.users.findUnique({
      where: { id: req.params.id },
      select: { institution_id: true },
    });
    if (!target) throw new NotFoundError('User');
    if (u.accountType === 'institution' && u.institutionId && target.institution_id === u.institutionId) return next();
    throw new ForbiddenError('You can only manage users in your own institution');
  });

  // ---- guard: enrolling your own institution into an event ----
  const enrollSelf: RequestHandler = (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (req.body?.institution_id && req.body.institution_id === u.institutionId) return next();
    throw new ForbiddenError('You can only enroll your own institution');
  };

  // ---- guard: recording a fixture result — assigned official, organiser, or super ----
  const fixtureScorer: RequestHandler = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    const fx = await fixtureContext(req.params.id);
    if (!fx) throw new NotFoundError('Fixture');
    if (fx.official_id === u.id) return next();
    const eventId = fx.tournament_disciplines?.tournament_sports?.tournaments?.event_id;
    if (eventId && (await organisesEvent(u.id, eventId))) return next();
    throw new ForbiddenError('Not authorized to score this fixture');
  });

  return {
    eventManager,
    eventCrudGuard,
    organiserAccount,
    teamManager,
    teamCreate,
    manageUser,
    enrollSelf,
    fixtureScorer,
    organisesEvent,
    resolvers: {
      eventOfTournament, eventOfSponsor, eventOfVenue, eventOfVenueGround,
      eventOfTournamentSport, eventOfTournamentDiscipline, eventOfFixture,
    },
  };
}

export type Guards = ReturnType<typeof makeGuards>;

// re-export a couple of plain helpers for convenience
export type { Request, Response, NextFunction };
