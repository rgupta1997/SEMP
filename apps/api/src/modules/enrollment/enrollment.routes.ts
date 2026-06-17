import { Router } from 'express';
import { assignRoleSchema, enrollOrganizationSchema, reviewEnrollmentSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError, BusinessRuleError } from '../../shared/errors.js';
import { createNotification } from '../notifications/audience.js';

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
    const championship = await prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { status: true } });
    if (!championship) throw new NotFoundError('Championship');
    if (championship.status !== 'registration_open') {
      throw new BusinessRuleError('This championship is not open for registration');
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

  // Approve / reject an enrollment (stamps reviewer + timestamp).
  router.patch('/championship-organizations/:id', enrollmentOrganiser, validateBody(reviewEnrollmentSchema), asyncHandler(async (req, res) => {
    const existing = await prisma.championship_organizations.findUnique({
      where: { id: req.params.id },
      include: { organizations: { select: { name: true, short_name: true } }, championships: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Enrollment');
    const row = await prisma.championship_organizations.update({
      where: { id: req.params.id },
      data: {
        status: req.body.status,
        rejection_note: req.body.status === 'rejected' ? req.body.rejection_note ?? null : null,
        reviewed_by: req.user!.id,
        reviewed_at: new Date(),
      },
    });

    // An approval is announced to everyone in the championship.
    if (req.body.status === 'approved' && existing.status !== 'approved') {
      const orgName = existing.organizations?.short_name || existing.organizations?.name || 'An organization';
      await createNotification(prisma, {
        championship_id: existing.championship_id,
        sender_id: req.user!.id,
        type: 'enrollment_approved',
        audience: 'all',
        title: `${orgName} has joined the championship`,
        body: `${existing.organizations?.name ?? orgName} has been approved to participate${existing.championships?.name ? ` in ${existing.championships.name}` : ''}.`,
      });
    }

    res.json(row);
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

  // List championship-scoped role assignments.
  router.get('/championships/:eventId/roles', asyncHandler(async (req, res) => {
    const rows = await prisma.user_championship_roles.findMany({
      where: { championship_id: req.params.eventId },
      include: { users_user_championship_roles_user_idTousers: true, roles: true },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(rows);
  }));

  return router;
}
