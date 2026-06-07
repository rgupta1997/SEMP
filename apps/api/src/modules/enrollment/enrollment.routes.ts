import { Router } from 'express';
import { assignRoleSchema, enrollInstitutionSchema, reviewEnrollmentSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError, BusinessRuleError } from '../../shared/errors.js';

export function makeEnrollmentRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // organiser of the event named in the route param (for the approve queue).
  const eventOrganiser = guards.eventManager(async (req) => req.params.eventId);
  // organiser of the event that owns this enrollment row (for approve/reject).
  const enrollmentOrganiser = guards.eventManager(async (req) => {
    const ei = await prisma.event_institutions.findUnique({ where: { id: req.params.id }, select: { event_id: true } });
    return ei?.event_id;
  });

  // Institution applies to an event (status: pending, stamps applied_by).
  router.post('/events/:eventId/enroll', guards.enrollSelf, validateBody(enrollInstitutionSchema), asyncHandler(async (req, res) => {
    const event = await prisma.events.findUnique({ where: { id: req.params.eventId }, select: { status: true } });
    if (!event) throw new NotFoundError('Event');
    if (event.status !== 'registration_open') {
      throw new BusinessRuleError('This event is not open for registration');
    }
    const existing = await prisma.event_institutions.findUnique({
      where: { event_id_institution_id: { event_id: req.params.eventId, institution_id: req.body.institution_id } },
    });
    if (existing) throw new BusinessRuleError('Your institution has already applied to this event');

    const row = await prisma.event_institutions.create({
      data: {
        event_id: req.params.eventId,
        institution_id: req.body.institution_id,
        applied_by: req.user!.id,
        status: 'pending',
      },
    });
    res.status(201).json(row);
  }));

  // Enrollment queue for an event (optionally filtered by status).
  router.get('/events/:eventId/enrollments', asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const rows = await prisma.event_institutions.findMany({
      where: { event_id: req.params.eventId, ...(status ? { status } : {}) },
      include: { institutions: true },
      orderBy: { applied_at: 'asc' },
    });
    res.json(rows);
  }));

  // Approve / reject an enrollment (stamps reviewer + timestamp).
  router.patch('/event-institutions/:id', enrollmentOrganiser, validateBody(reviewEnrollmentSchema), asyncHandler(async (req, res) => {
    const existing = await prisma.event_institutions.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Enrollment');
    const row = await prisma.event_institutions.update({
      where: { id: req.params.id },
      data: {
        status: req.body.status,
        rejection_note: req.body.status === 'rejected' ? req.body.rejection_note ?? null : null,
        reviewed_by: req.user!.id,
        reviewed_at: new Date(),
      },
    });
    res.json(row);
  }));

  // Assign an event-scoped role to a user (e.g. Captain) via user_event_roles.
  router.post('/events/:eventId/roles', eventOrganiser, validateBody(assignRoleSchema), asyncHandler(async (req, res) => {
    // Idempotent: re-assigning the same (user, event, role) returns the existing row
    // instead of a 409, so a double-click can't error out the organiser.
    const row = await prisma.user_event_roles.upsert({
      where: {
        user_id_event_id_role_id: {
          user_id: req.body.user_id,
          event_id: req.params.eventId,
          role_id: req.body.role_id,
        },
      },
      update: {},
      create: {
        event_id: req.params.eventId,
        user_id: req.body.user_id,
        role_id: req.body.role_id,
        assigned_by: req.user!.id,
      },
    });
    res.status(201).json(row);
  }));

  // List event-scoped role assignments.
  router.get('/events/:eventId/roles', asyncHandler(async (req, res) => {
    const rows = await prisma.user_event_roles.findMany({
      where: { event_id: req.params.eventId },
      include: { users_user_event_roles_user_idTousers: true, roles: true },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(rows);
  }));

  return router;
}
