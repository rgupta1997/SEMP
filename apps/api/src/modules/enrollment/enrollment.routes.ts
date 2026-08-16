import { Router } from 'express';
import { assignRoleSchema, bulkAssignRoleSchema, bulkReviewEnrollmentsSchema, enrollOrganizationSchema, reviewEnrollmentSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError, BusinessRuleError } from '../../shared/errors.js';
import { createNotification } from '../notifications/audience.js';
import { memoizedAuthorizer, reviewEnrollment, reviewEnrollmentsBulk } from './review.service.js';

export function makeEnrollmentRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of the championship named in the route param (for the approve queue).
  const eventOrganiser = guards.championshipManager(async (req) => req.params.eventId);
  // organiser of the championship that owns this enrollment row (for approve/reject).
  const enrollmentOrganiser = guards.championshipManager(async (req) => {
    const ei = await prisma.championship_organizations.findUnique({ where: { id: req.params.id }, select: { championship_id: true } });
    return ei?.championship_id;
  });

  // Organization applies to a championship (status: pending, stamps applied_by).
  router.post('/championships/:eventId/enroll', guards.enrollSelf, validateBody(enrollOrganizationSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { status: true, visibility: true } });
    if (!championship) throw new NotFoundError('Championship');
    if (championship.status !== 'registration_open') {
      throw new BusinessRuleError('This championship is not open for registration');
    }
    // Private championships are invite-only: an org may enroll only if the organiser
    // has invited it (the usual path is accepting the invitation, which enrolls
    // directly - this guard just closes the apply-by-id side door).
    if (championship.visibility === 'private') {
      const invited = await prisma.championship_invitations.findFirst({
        where: { championship_id: req.params.eventId, organization_id: req.body.organization_id },
        select: { id: true },
      });
      if (!invited) throw new BusinessRuleError('This championship is private - organizations join by invitation from the organiser.');
    }
    const existing = await prisma.championship_organizations.findUnique({
      where: { championship_id_organization_id: { championship_id: req.params.eventId, organization_id: req.body.organization_id } },
    });
    if (existing) throw new BusinessRuleError('Your organization has already applied to this championship');

    const row = await prisma.championship_organizations.create({
      data: {
        championship_id: req.params.eventId,
        organization_id: req.body.organization_id,
        applied_by: req.user!.id,
        status: 'pending',
      },
    });

    // Tell the organising team, or an application sits unseen until somebody happens
    // to open the Approvals tab. Direct notifications, so only they are pinged.
    const [org, champ, organisers] = await Promise.all([
      prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { name: true } }),
      prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { name: true } }),
      prisma.user_championship_roles.findMany({
        where: { championship_id: req.params.eventId },
        select: { user_id: true },
      }),
    ]);
    for (const o of [...new Map(organisers.map((r) => [r.user_id, r])).values()]) {
      await createNotification(prisma, {
        championship_id: req.params.eventId,
        target_user_id: o.user_id,
        sender_id: req.user!.id,
        // Something to DO, not something that happened: this is what puts a row in
        // the organiser's approvals queue.
        type: 'enrollment_requested',
        audience: 'all',
        title: `${org?.name ?? 'An organisation'} applied to ${champ?.name ?? 'your championship'}`,
        body: 'Review it on the championship’s Approvals tab.',
      });
    }

    res.status(201).json(row);
  }));

  // Enrollment queue for an championship (optionally filtered by status).
  router.get('/championships/:eventId/enrollments', asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const rows = await prisma.championship_organizations.findMany({
      where: { championship_id: req.params.eventId, ...(status ? { status } : {}) },
      include: { organizations: true },
      orderBy: { applied_at: 'asc' },
    });
    res.json(rows);
  }));

  // Decide a whole selection at once - twelve programmes across six sports is not
  // seventy-two clicks (J2-E2-S2). Declared before '/:id' or Express would match
  // 'bulk' as an enrollment id. A selection can span championships, so the organiser
  // guard runs per enrolment (memoized) rather than once for the route.
  router.patch('/championship-organizations/bulk', validateBody(bulkReviewEnrollmentsSchema), asyncHandler(async (req, res) => {
    const { ids, status, rejection_note } = req.body as { ids: string[]; status: 'approved' | 'rejected'; rejection_note?: string };
    const authorize = req.user!.isSuperAdmin
      ? undefined
      : memoizedAuthorizer((championshipId) => guards.organisesChampionship(req.user!.id, championshipId));
    const results = await reviewEnrollmentsBulk(prisma, req, ids, { status, rejection_note }, authorize);
    res.json({
      results,
      reviewed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  }));

  // Approve / reject an enrollment (stamps reviewer + timestamp).
  router.patch('/championship-organizations/:id', enrollmentOrganiser, validateBody(reviewEnrollmentSchema), asyncHandler(async (req, res) => {
    const { status, rejection_note } = req.body as { status: 'approved' | 'rejected'; rejection_note?: string };
    res.json(await reviewEnrollment(prisma, req, req.params.id, { status, rejection_note }));
  }));

  // Assign an championship-scoped role to a user (e.g. Captain) via user_championship_roles.
  router.post('/championships/:eventId/roles', eventOrganiser, validateBody(assignRoleSchema), asyncHandler(async (req, res) => {
    // Idempotent: re-assigning the same (user, championship, role) returns the existing row
    // instead of a 409, so a double-click can't error out the organiser.
    const row = await prisma.user_championship_roles.upsert({
      where: {
        user_id_championship_id_role_id: {
          user_id: req.body.user_id,
          championship_id: req.params.eventId,
          role_id: req.body.role_id,
        },
      },
      update: {},
      create: {
        championship_id: req.params.eventId,
        user_id: req.body.user_id,
        role_id: req.body.role_id,
        assigned_by: req.user!.id,
      },
    });
    res.status(201).json(row);
  }));

  // Bulk-assign one role to several users at once (multi-select picker). Idempotent
  // per (user, championship, role) like the single endpoint - one round-trip.
  router.post('/championships/:eventId/roles/bulk', eventOrganiser, validateBody(bulkAssignRoleSchema), asyncHandler(async (req, res) => {
    const { user_ids, role_id } = req.body as { user_ids: string[]; role_id: string };
    const eventId = req.params.eventId;
    const rows = await prisma.$transaction(
      [...new Set(user_ids)].map((user_id) => prisma.user_championship_roles.upsert({
        where: { user_id_championship_id_role_id: { user_id, championship_id: eventId, role_id } },
        update: {},
        create: { championship_id: eventId, user_id, role_id, assigned_by: req.user!.id },
      })),
    );
    res.status(201).json(rows);
  }));

  // List championship-scoped role assignments.
  router.get('/championships/:eventId/roles', asyncHandler(async (req, res) => {
    const rows = await prisma.user_championship_roles.findMany({
      where: { championship_id: req.params.eventId },
      // NEVER `users: true`. That serialises the whole row - the bcrypt hash, and
      // since J1-E5 the person's date of birth, gender and consent record too,
      // none of which may appear against a named individual (J1-E5-S4). The rest
      // of the codebase uses an explicit projection for exactly this reason; this
      // was the one site that did not.
      include: {
        users_user_championship_roles_user_idTousers: {
          select: { id: true, name: true, email: true, phone: true, avatar_url: true },
        },
        roles: true,
      },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(rows);
  }));

  return router;
}
