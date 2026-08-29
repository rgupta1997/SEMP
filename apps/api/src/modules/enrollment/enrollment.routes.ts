import { Router } from 'express';
import { assignRoleSchema, bulkAssignRoleSchema, enrollOrganizationSchema, reviewEnrollmentSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError, BusinessRuleError } from '../../shared/errors.js';
import { findEntrant } from '../championships/contingent.js';
import { notify } from '@semp/notifications/server/notify.js';

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

  // An ORGANISATION applies to a championship.
  //
  // Only ever an organisation. Campuses and departments do not "enter" anything -
  // in an internal championship the SQUADS are the competitors, and they are added
  // from Teams exactly as an organisation's squads are. There was briefly an
  // entrant-enrolment step for units here; it was a layer the model does not have.
  router.post('/championships/:eventId/enroll', guards.enrollSelf, validateBody(enrollOrganizationSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({
      where: { id: req.params.eventId },
      select: { name: true, status: true, visibility: true, entry_level: true, host_organization_id: true },
    });
    if (!championship) throw new NotFoundError('Championship');

    // An internal championship is contested between the host's own campuses or
    // departments. Nobody applies to it - not even the host, whose entry is created
    // with the event - so this route is closed for them entirely.
    if (championship.entry_level !== 'organization') {
      throw new BusinessRuleError('This championship is contested inside its host organisation. Its teams are added from Teams, not by applying.');
    }
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

    const existing = await findEntrant(prisma, req.params.eventId, { orgId: req.body.organization_id, unitId: null });
    if (existing) throw new BusinessRuleError('Your organization has already applied to this championship');

    const row = await prisma.championship_organizations.create({
      data: {
        championship_id: req.params.eventId,
        organization_id: req.body.organization_id,
        applied_by: req.user!.id,
        status: 'pending',
      },
    });

    // Best-effort - the application is already committed, and a notification
    // hiccup must never be reported back as a failed application.
    try {
      await notify(prisma, {
        type: 'registration_submitted',
        championshipId: req.params.eventId,
        userId: req.user!.id,
        senderId: req.user!.id,
        data: { championshipName: championship.name },
      });
      const org = await prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { name: true, short_name: true } });
      await notify(prisma, {
        type: 'participant_approval_pending',
        championshipId: req.params.eventId,
        senderId: req.user!.id,
        data: { orgName: org?.short_name || org?.name, championshipName: championship.name },
      });
    } catch (err) {
      console.error(`[enrollment] registration notifications failed for ${row.id}:`, err);
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
      await notify(prisma, {
        type: 'enrollment_approved',
        championshipId: existing.championship_id,
        senderId: req.user!.id,
        data: {
          orgName,
          bodyOrgName: existing.organizations?.name ?? orgName,
          championshipName: existing.championships?.name,
        },
      });
    }

    if (req.body.status === 'rejected' && existing.status !== 'rejected') {
      try {
        await notify(prisma, {
          type: 'registration_rejected',
          organizationId: existing.organization_id,
          senderId: req.user!.id,
          data: { reason: req.body.rejection_note ?? null, championshipName: existing.championships?.name },
        });
      } catch (err) {
        console.error(`[enrollment] registration_rejected notification failed for ${existing.id}:`, err);
      }
    }

    res.json(row);
  }));

  // Withdraw an entry.
  //
  // Written for the intra case, where the organiser enters their own campuses and
  // will sometimes enter the wrong one - there is no "reject" to undo it with,
  // because an intra entry is approved on arrival.
  //
  // Refused once the entry has teams: a squad is people who were told they are
  // playing, and silently deleting it is how somebody turns up to a fixture that no
  // longer exists. The message says what to remove first rather than doing it.
  router.delete('/championship-organizations/:id', enrollmentOrganiser, asyncHandler(async (req, res) => {
    const entry = await prisma.championship_organizations.findUnique({
      where: { id: req.params.id },
      include: {
        organizations: { select: { name: true } },
        org_units: { select: { name: true } },
      },
    });
    if (!entry) throw new NotFoundError('Entry');

    const label = entry.org_units?.name ?? entry.organizations?.name ?? 'That entry';
    const teams = await prisma.team_entries.count({ where: { championship_organization_id: entry.id } });
    if (teams > 0) {
      throw new BusinessRuleError(`${label} has ${teams} team${teams === 1 ? '' : 's'} in this championship. Remove them first — withdrawing would delete squads people have already been picked for.`);
    }

    await prisma.championship_organizations.delete({ where: { id: entry.id } });
    res.json({ ok: true, withdrawn: label });
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
      include: { users_user_championship_roles_user_idTousers: true, roles: true },
      orderBy: { assigned_at: 'desc' },
    });
    res.json(rows);
  }));

  return router;
}
