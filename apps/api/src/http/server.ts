import express, { Router } from 'express';
import cors from 'cors';
import {
  createDisciplineSchema, createFormatSchema,
  createPermissionSchema, createRoleSchema, createSportSchema, updateDisciplineSchema,
  updateFormatSchema, updatePermissionSchema, updateRoleSchema,
  updateSportSchema,
  createSponsorSchema, updateSponsorSchema, createTournamentSchema, updateTournamentSchema,
  createTournamentSportSchema, updateTournamentSportSchema,
  createTournamentDisciplineSchema, updateTournamentDisciplineSchema,
} from '@semp/shared';
import type { Prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { makeCrudRouter } from './crud.js';
import { errorHandler } from './middleware/error.js';
import { parseAuth, requireAuth, requireSuperAdmin } from './middleware/auth.js';
import { makeGuards } from './middleware/permissions.js';
import { makeAuthRouter } from '../modules/iam/auth.routes.js';
import { makeMeRouter } from '../modules/iam/me.routes.js';
import { makeUsersRouter } from '../modules/iam/users.routes.js';
import { makeOrganizationsRouter } from '../modules/iam/organizations.routes.js';
import { makeEventsRouter } from '../modules/championships/championships.routes.js';
import { makeStandingsRouter } from '../modules/standings/standings.routes.js';
import { makeEnrollmentRouter } from '../modules/enrollment/enrollment.routes.js';
import { makeInvitationsRouter } from '../modules/enrollment/invitations.routes.js';
import { makeUserInvitationsRouter } from '../modules/iam/user-invitations.routes.js';
import { makeTeamsRouter } from '../modules/teams/teams.routes.js';
import { makeMatrixImportRouter } from '../modules/import/matrix-import.routes.js';
import { makePublicRouter } from '../modules/public/public.routes.js';
import { makeVenuesRouter, makeVenueGroundsRouter } from '../modules/venues/venues.routes.js';
import { makeFixturesRouter } from '../modules/fixtures/fixtures.routes.js';
import { makeNotificationsRouter } from '../modules/notifications/notifications.routes.js';
import { makeDemoRequestsRouter } from '../modules/marketing/demo-requests.routes.js';
import { makeFeedbackRouter } from '../modules/marketing/feedback.routes.js';
import { makeDemosRouter } from '../modules/demos/demos.routes.js';
import { BusinessRuleError } from '../shared/errors.js';

export function buildApp(prisma: Prisma) {
  const app = express();
  // Allow any localhost origin in dev (Vite may pick 5173/5174/...), plus an
  // explicit production allowlist. WEB_ORIGIN may be a comma-separated list so the
  // same backend can serve, e.g., the Netlify site and a custom domain.
  const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error('Not allowed by CORS'));
    },
  }));
  app.use(express.json());
  app.use(parseAuth);

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const api = Router();

  // Public auth routes
  api.use('/auth', makeAuthRouter(prisma));

  // "Book a demo" leads - the POST is public (the landing page is unauthenticated);
  // reads/triage inside the router are gated to super-admins. Mounted before the
  // global requireAuth so anonymous visitors can submit.
  api.use('/demo-requests', makeDemoRequestsRouter(prisma));

  // User feedback - POST is public (the public championship pages are unauthenticated and
  // a signed-in sender's id is captured opportunistically); reads/triage inside the router
  // are gated to super-admins. Mounted before the global requireAuth.
  api.use('/feedback', makeFeedbackRouter(prisma));

  // Public, view-only championship pages via a share token (Overview + Standings).
  // Mounted before requireAuth so anyone with the link can view without signing in.
  api.use('/public', makePublicRouter(prisma));

  // Everything below requires authentication.
  api.use(requireAuth);

  const guards = makeGuards(prisma);

  // ----- Demo sandboxes - super-admin only (guards are inside the router) -----
  api.use('/demos', makeDemosRouter(prisma));

  // ----- "Me"-scoped read endpoints (resolved from the authenticated user) -----
  api.use('/', makeMeRouter(prisma));

  // ----- Notifications - global per-user feed + bell (visibility is championship-scoped) -----
  api.use('/', makeNotificationsRouter(prisma));

  // ----- Users - scoped create/edit + bulk import (see users.routes) -----
  api.use('/users', makeUsersRouter(prisma));

  // ----- Phase 1: platform setup (generic CRUD) - writes are super-admin only -----
  api.use('/permissions', makeCrudRouter(prisma.permissions, {
    name: 'Permission', createSchema: createPermissionSchema, updateSchema: updatePermissionSchema,
    orderBy: { code: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  api.use('/roles', makeCrudRouter(prisma.roles, {
    name: 'Role', createSchema: createRoleSchema, updateSchema: updateRoleSchema,
    orderBy: { name: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  api.use('/sports', makeCrudRouter(prisma.sports, {
    name: 'Sport', createSchema: createSportSchema, updateSchema: updateSportSchema,
    orderBy: { name: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  api.use('/disciplines', makeCrudRouter(prisma.disciplines, {
    name: 'Discipline', createSchema: createDisciplineSchema, updateSchema: updateDisciplineSchema,
    listFilters: ['sport_id'], orderBy: { display_order: 'asc' },
    // Editing/deleting the master catalogue stays super-admin only, but any authed
    // organiser may add a new discipline (e.g. an age/gender category) while setting
    // up their championship - createGuards empty = just the global requireAuth.
    writeGuards: [requireSuperAdmin], createGuards: [],
  }));
  api.use('/tournament-formats', makeCrudRouter(prisma.tournament_formats, {
    name: 'Tournament format', createSchema: createFormatSchema, updateSchema: updateFormatSchema,
    orderBy: { name: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  // Organizations - open reads; any user can create (becomes owner); member
  // management requires an owner/admin (see organizations.routes).
  api.use('/organizations', makeOrganizationsRouter(prisma));

  // ----- Phase 2: championship creation - setup-resource writes require the championship's organiser -----
  api.use('/championships', makeEventsRouter(prisma));
  // Standings (materialized tables + scoring rules) - also under /championships/:id.
  api.use('/championships', makeStandingsRouter(prisma));
  // Matrix import (sections × sport/discipline) - builds the whole setup from a sheet.
  api.use('/championships', makeMatrixImportRouter(prisma));
  api.use('/venues', makeVenuesRouter(prisma));
  api.use('/venue-grounds', makeVenueGroundsRouter(prisma));
  api.use('/sponsors', makeCrudRouter(prisma.sponsors, {
    name: 'Sponsor', createSchema: createSponsorSchema, updateSchema: updateSponsorSchema,
    listFilters: ['championship_id'], orderBy: { display_order: 'asc' },
    writeGuards: [guards.championshipCrudGuard({ body: async (req) => req.body?.championship_id, byId: guards.resolvers.championshipOfSponsor })],
  }));
  api.use('/tournaments', makeCrudRouter(prisma.tournaments, {
    name: 'Tournament', createSchema: createTournamentSchema, updateSchema: updateTournamentSchema,
    listFilters: ['championship_id'], orderBy: { created_at: 'desc' },
    writeGuards: [guards.championshipCrudGuard({ body: async (req) => req.body?.championship_id, byId: guards.resolvers.championshipOfTournament })],
  }));
  // The FKs into a tournament_discipline (fixtures, team_entries) are NoAction, so
  // deleting a setup-phase sport/discipline first clears what points at it. Removing
  // fixtures cascades to fixture_awards; team_entries are enrollment links. standings
  // hold only a loose scope_id (no FK) so they don't block.
  const clearDisciplineRefs = async (disciplineIds: string[]) => {
    if (disciplineIds.length === 0) return;
    // Never silently wipe real results: block if any fixture has been played/scored.
    const played = await prisma.fixtures.count({
      where: {
        tournament_discipline_id: { in: disciplineIds },
        OR: [{ status: { in: ['completed', 'walkover', 'bye'] } }, { home_score: { not: null } }, { away_score: { not: null } }],
      },
    });
    if (played > 0) throw new BusinessRuleError('There are completed or scored matches here - remove or void those results before deleting.');
    await prisma.$transaction([
      prisma.fixtures.deleteMany({ where: { tournament_discipline_id: { in: disciplineIds } } }),
      prisma.team_entries.deleteMany({ where: { tournament_discipline_id: { in: disciplineIds } } }),
    ]);
  };
  api.use('/tournament-sports', makeCrudRouter(prisma.tournament_sports, {
    name: 'Tournament sport', createSchema: createTournamentSportSchema, updateSchema: updateTournamentSportSchema,
    listFilters: ['tournament_id', 'sport_id'], orderBy: { display_order: 'asc' },
    writeGuards: [guards.championshipCrudGuard({ body: async (req) => guards.resolvers.championshipOfTournament(req.body?.tournament_id), byId: guards.resolvers.championshipOfTournamentSport })],
    beforeDelete: async (id) => {
      const disciplines = await prisma.tournament_disciplines.findMany({ where: { tournament_sport_id: id }, select: { id: true } });
      await clearDisciplineRefs(disciplines.map((d) => d.id));
      await prisma.tournament_disciplines.deleteMany({ where: { tournament_sport_id: id } });
    },
  }));
  api.use('/tournament-disciplines', makeCrudRouter(prisma.tournament_disciplines, {
    name: 'Tournament discipline', createSchema: createTournamentDisciplineSchema, updateSchema: updateTournamentDisciplineSchema,
    listFilters: ['tournament_sport_id', 'discipline_id'], orderBy: { display_order: 'asc' },
    include: { disciplines: true }, // so the UI can show each discipline's own name

    writeGuards: [guards.championshipCrudGuard({ body: async (req) => guards.resolvers.championshipOfTournamentSport(req.body?.tournament_sport_id), byId: guards.resolvers.championshipOfTournamentDiscipline })],
    beforeDelete: async (id) => { await clearDisciplineRefs([id]); },
  }));

  // ----- Phase 3: enrollment, invitations & role assignment -----
  api.use('/', makeEnrollmentRouter(prisma));
  api.use('/', makeInvitationsRouter(prisma));
  api.use('/', makeUserInvitationsRouter(prisma));

  // ----- Phase 4: teams & rosters -----
  api.use('/', makeTeamsRouter(prisma));

  // ----- Phase 5: fixtures -----
  api.use('/', makeFixturesRouter(prisma));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
