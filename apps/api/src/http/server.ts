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
import { makeInstitutionsRouter } from '../modules/iam/institutions.routes.js';
import { makeEventsRouter } from '../modules/events/events.routes.js';
import { makeEnrollmentRouter } from '../modules/enrollment/enrollment.routes.js';
import { makeTeamsRouter } from '../modules/teams/teams.routes.js';
import { makeVenuesRouter, makeVenueGroundsRouter } from '../modules/venues/venues.routes.js';
import { makeFixturesRouter } from '../modules/fixtures/fixtures.routes.js';
import { makeNotificationsRouter } from '../modules/notifications/notifications.routes.js';

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

  // Everything below requires authentication.
  api.use(requireAuth);

  const guards = makeGuards(prisma);

  // ----- "Me"-scoped read endpoints (resolved from the authenticated user) -----
  api.use('/', makeMeRouter(prisma));

  // ----- Notifications — global per-user feed + bell (visibility is event-scoped) -----
  api.use('/', makeNotificationsRouter(prisma));

  // ----- Users — scoped create/edit + bulk import (see users.routes) -----
  api.use('/users', makeUsersRouter(prisma));

  // ----- Phase 1: platform setup (generic CRUD) — writes are super-admin only -----
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
    listFilters: ['sport_id'], orderBy: { display_order: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  api.use('/tournament-formats', makeCrudRouter(prisma.tournament_formats, {
    name: 'Tournament format', createSchema: createFormatSchema, updateSchema: updateFormatSchema,
    orderBy: { name: 'asc' }, writeGuards: [requireSuperAdmin],
  }));
  // Institutions — open reads, create by super/organiser (with optional POC),
  // edits/deletes super-admin only (see institutions.routes).
  api.use('/institutions', makeInstitutionsRouter(prisma));

  // ----- Phase 2: event creation — setup-resource writes require the event's organiser -----
  api.use('/events', makeEventsRouter(prisma));
  api.use('/venues', makeVenuesRouter(prisma));
  api.use('/venue-grounds', makeVenueGroundsRouter(prisma));
  api.use('/sponsors', makeCrudRouter(prisma.sponsors, {
    name: 'Sponsor', createSchema: createSponsorSchema, updateSchema: updateSponsorSchema,
    listFilters: ['event_id'], orderBy: { display_order: 'asc' },
    writeGuards: [guards.eventCrudGuard({ body: async (req) => req.body?.event_id, byId: guards.resolvers.eventOfSponsor })],
  }));
  api.use('/tournaments', makeCrudRouter(prisma.tournaments, {
    name: 'Tournament', createSchema: createTournamentSchema, updateSchema: updateTournamentSchema,
    listFilters: ['event_id'], orderBy: { created_at: 'desc' },
    writeGuards: [guards.eventCrudGuard({ body: async (req) => req.body?.event_id, byId: guards.resolvers.eventOfTournament })],
  }));
  api.use('/tournament-sports', makeCrudRouter(prisma.tournament_sports, {
    name: 'Tournament sport', createSchema: createTournamentSportSchema, updateSchema: updateTournamentSportSchema,
    listFilters: ['tournament_id', 'sport_id'], orderBy: { display_order: 'asc' },
    writeGuards: [guards.eventCrudGuard({ body: async (req) => guards.resolvers.eventOfTournament(req.body?.tournament_id), byId: guards.resolvers.eventOfTournamentSport })],
  }));
  api.use('/tournament-disciplines', makeCrudRouter(prisma.tournament_disciplines, {
    name: 'Tournament discipline', createSchema: createTournamentDisciplineSchema, updateSchema: updateTournamentDisciplineSchema,
    listFilters: ['tournament_sport_id', 'discipline_id'], orderBy: { display_order: 'asc' },
    writeGuards: [guards.eventCrudGuard({ body: async (req) => guards.resolvers.eventOfTournamentSport(req.body?.tournament_sport_id), byId: guards.resolvers.eventOfTournamentDiscipline })],
  }));

  // ----- Phase 3: enrollment & role assignment -----
  api.use('/', makeEnrollmentRouter(prisma));

  // ----- Phase 4: teams & rosters -----
  api.use('/', makeTeamsRouter(prisma));

  // ----- Phase 5: fixtures -----
  api.use('/', makeFixturesRouter(prisma));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
