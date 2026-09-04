import express, { Router, type RequestHandler } from 'express';
import cors from 'cors';
import {
  createDisciplineSchema, createFormatSchema,
  createPermissionSchema, createRoleSchema, createSportSchema, updateDisciplineSchema,
  updateFormatSchema, updatePermissionSchema, updateRoleSchema,
  updateSportSchema,
  createTournamentSchema, updateTournamentSchema,
  createTournamentSportSchema, updateTournamentSportSchema,
  createTournamentDisciplineSchema, updateTournamentDisciplineSchema,
} from '@semp/shared';
import type { Prisma } from '../infra/prisma.js';
import { env } from '../config/env.js';
import { makeCrudRouter } from './crud.js';
import { errorHandler } from './middleware/error.js';
import { parseAuth, requireAuth, requireSuperAdmin } from './middleware/auth.js';
import { makeGuards } from './middleware/permissions.js';
import { makeEntitlementGuards } from './middleware/entitlements.js';
import { makeOrgUnitsRouter } from '../modules/iam/org-units.routes.js';
import { makeAuditRouter } from '../modules/iam/audit.routes.js';
import { makeOrgEventsRouter } from '../modules/enrollment/org-events.routes.js';
import { makeOrgDashboardRouter } from '../modules/enrollment/org-dashboard.routes.js';
import { makeOrgRolesRouter } from '../modules/iam/org-roles.routes.js';
import { makeVerificationRequestsRouter } from '../modules/iam/verification-requests.routes.js';
import { makeSignInRouter } from '../modules/iam/signin.routes.js';
import { makeAuthRouter } from '../modules/iam/auth.routes.js';
import { makeMeRouter } from '../modules/iam/me.routes.js';
import { makeUsersRouter } from '../modules/iam/users.routes.js';
import { makeOrganizationsRouter } from '../modules/iam/organizations.routes.js';
import { makeEventsRouter } from '../modules/championships/championships.routes.js';
import { makeChampionshipTemplatesRouter } from '../modules/championships/templates.routes.js';
import { makeStandingsRouter } from '../modules/standings/standings.routes.js';
import { makeEnrollmentRouter } from '../modules/enrollment/enrollment.routes.js';
import { makeInvitationsRouter } from '../modules/enrollment/invitations.routes.js';
import { makeUserInvitationsRouter } from '../modules/iam/user-invitations.routes.js';
import { makeTeamsRouter } from '../modules/teams/teams.routes.js';
import { makeMatrixImportRouter } from '../modules/import/matrix-import.routes.js';
import { makePublicRouter } from '../modules/public/public.routes.js';
import { makeVenuesRouter, makeVenueGroundsRouter } from '../modules/venues/venues.routes.js';
import { makeProfileRouter } from '../modules/records/profile.routes.js';
import { makeRecordsRouter } from '../modules/records/records.routes.js';
import { makeClaimsRouter } from '../modules/records/claims.routes.js';
import { makeCertificatesRouter } from '../modules/certificates/certificates.routes.js';
import { makePeopleRouter } from '../modules/people/people.routes.js';
import { makeReportsRouter } from '../modules/reports/reports.routes.js';
import { makeBenchmarkRouter } from '../modules/reports/benchmark.routes.js';
import { makeImpactRouter, makeImpactBuilder } from '../modules/reports/impact.routes.js';
import { makeFixturesRouter } from '../modules/fixtures/fixtures.routes.js';
import { makeScoringFormatsRouter } from '../modules/scoring/formats.routes.js';
import { makeNotificationsRouter } from '../modules/notifications/notifications.routes.js';
import { makeDemoRequestsRouter } from '../modules/marketing/demo-requests.routes.js';
import { makeFeedbackRouter } from '../modules/marketing/feedback.routes.js';
import { makeDemosRouter } from '../modules/demos/demos.routes.js';
import { makeBillingRouter } from '../modules/billing/billing.routes.js';
import { applyDuePlanChanges } from '../modules/billing/subscription.service.js';
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
  // Phone-first sign-in (Option B): identify, code, chooser, session, signup.
  // Mounted before the legacy email+password router so its routes win on overlap.
  api.use('/auth', makeSignInRouter(prisma));
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
  api.use('/championship-templates', makeChampionshipTemplatesRouter(prisma));
  // Standings (materialized tables + scoring rules) - also under /championships/:id.
  api.use('/championships', makeStandingsRouter(prisma));
  // Matrix import (sections × sport/discipline) - builds the whole setup from a sheet.
  api.use('/championships', makeMatrixImportRouter(prisma));
  api.use('/venues', makeVenuesRouter(prisma));
  api.use('/venue-grounds', makeVenueGroundsRouter(prisma));
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
  api.use('/', makeScoringFormatsRouter(prisma));

  // ----- Records, certificates, people and reports (lifted from the wave branch) -----

  // The subscription gate. Declared before anything it guards, because a gate has
  // to be mounted ahead of the router it stands in front of - Express matches in
  // mount order, and a guard added afterwards would never run.
  const ents = makeEntitlementGuards(prisma);

  /** Gate on the organisation named in the path, not on the caller's own. */
  const orgParam = { organizationIdFrom: (req: any) => req.params.id as string | undefined };

  /**
   * Land any plan change that has come due for this caller, before the snapshot
   * is taken.
   *
   * A downgrade is scheduled for the end of a paid period, and the API has no
   * long-lived process to fire a timer on - it runs as a Lambda. So the change
   * is applied lazily, on the read that would otherwise report a stale tier.
   * This is that read: the shell fetches it once per session, which makes it the
   * earliest point at which a stale plan could be seen.
   *
   * Scoped to the caller, and a no-op when nothing is due - one indexed query
   * against a partial index. Errors are swallowed: a sweep that fails must not
   * take the whole workspace down with it, and /billing/sweep is the safety net.
   */
  const landDuePlanChanges: RequestHandler = (req, _res, next) => {
    if (!req.user) return next();
    applyDuePlanChanges(prisma, { userId: req.user.id, organizationId: req.user.organizationId ?? undefined })
      .then(() => next())
      .catch(() => next());
  };

  // What this caller's subscription makes available, on both ladders. The shell
  // renders every lock from this one payload rather than asking per capability.
  api.get('/me/entitlements', landDuePlanChanges, ents.readSnapshot);

  // ----- Plans, checkout, invoices - both ladders (guards are inside) -----
  api.use('/billing', makeBillingRouter(prisma));

  // Mounted under /organizations because every route is institution-scoped.
  //
  // Importing a roll from a file is a paid capability; adding people one at a time
  // is not. The gate goes on the import paths only, so a free organisation is
  // never locked out of having members - just out of the bulk route to them.
  api.use('/organizations/:id/people/import', ents.requireCapability('bulk_player_upload', orgParam));
  api.use('/organizations', makePeopleRouter(prisma));

  // Role grants inside an organisation, and the catalogue the matrix is generated
  // from. Mounted at the root because its paths are already fully qualified.
  api.use('/', makeOrgRolesRouter(prisma));

  // ----- Organisation verification: the org asks, the platform answers -----
  // Mounted at the root because it serves both sides - /organizations/:id/... for the
  // institution and /verification-requests for the platform queue.
  api.use('/', makeVerificationRequestsRouter(prisma));

  // The audit trail. 864 entries were already being written with nothing to read them.
  api.use('/organizations/:id/audit', ents.requireCapability('audit_logs', orgParam));
  api.use('/', makeAuditRouter(prisma));

  // Campuses and units - the concrete scopes a campus_unit role is granted against,
  // and the entrants of an intra-organisation championship.
  //
  // NOT gated as a whole path any more. `multi_campus` means "more than one campus",
  // and blanket-gating the route made reading the structure a paid feature: placing
  // a player in a department, naming a team's campus and listing an intra event's
  // entrants all read this tree, so a free organisation could not see the shape of
  // itself. The capability is now asserted where it actually applies - creating a
  // SECOND campus - inside the handler, which is also the only place that can tell
  // whether this is the second one.
  api.use('/organizations', makeOrgUnitsRouter(prisma));
  api.use('/organizations', makeOrgEventsRouter(prisma));
  api.use('/organizations', makeOrgDashboardRouter(prisma));

  // The permanent record - lifetime timeline + achievements, READ ONLY. A timeline
  // entry changes only by correcting the locked result behind it.
  api.use('/', makeRecordsRouter(prisma));

  // The controlled half of a sports profile, kept apart from the verified half so
  // an edit can never reach a locked record.
  api.use('/', makeProfileRouter(prisma));

  // Leadership reporting. The impact report is handed the SAME builders the report
  // tabs use, so a board pack and the screen it was promised on cannot disagree.
  //
  // Gated on the subscription as well as on the permission. Until now the padlock
  // on the Reports nav item was the only thing standing between an unentitled org
  // and the whole report - which is to say, nothing at all, since the route was
  // reachable by typing the URL. The permission gate inside each handler still
  // applies; this asks the prior question of whether the tenant has it to permit.
  const reportsRouter = makeReportsRouter(prisma);
  api.use('/organizations/:id/reports', ents.requireCapability('advanced_reports', orgParam));
  api.use('/organizations/:id/report-jobs', ents.requireCapability('advanced_reports', orgParam));
  api.use('/', reportsRouter);
  // Benchmarking is its own capability one tier higher: comparing yourself against
  // peer institutions is a different product from reporting on yourself.
  api.use('/organizations/:id/reports/benchmark', ents.requireCapability('benchmarking', orgParam));
  api.use('/', makeBenchmarkRouter(prisma));
  api.use('/', makeImpactRouter(prisma, makeImpactBuilder(prisma, (reportsRouter as any).builders)));

  // Certificates. Public verification lives in the public router above.
  api.use('/', makeCertificatesRouter(prisma));

  // External achievement claims.
  api.use('/', makeClaimsRouter(prisma));


  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
