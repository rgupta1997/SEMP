import { Router } from 'express';
import { assignRoleSchema, bulkAssignRoleSchema, enrollOrganizationSchema, reviewEnrollmentSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError, BusinessRuleError } from '../../shared/errors.js';
import { findEntrant } from '../championships/contingent.js';
import { notifyApplicationReceived, notifyEnrollmentApproved, notifyRegistrationRejected } from './enrollment.notifications.js';

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
    const org = await prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { name: true, short_name: true } });
    await notifyApplicationReceived(
      prisma, req.params.eventId, championship.name, req.user!.id, org?.short_name || org?.name, req.user!.id,
    );

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

    // An approval is announced to everyone in the championship, AND separately
    // confirmed directly to the applicant org - the broadcast is news for the room,
    // not a decision notice for the org that was actually waiting on it.
    if (req.body.status === 'approved' && existing.status !== 'approved') {
      await notifyEnrollmentApproved(prisma, existing, req.user!.id);

      // This org can also have been invited directly (Setup - Invite), a separate
      // table with no link to this one - so approving it here left that invitation
      // sitting "pending" forever: the org read as already in everywhere an
      // organiser looks (Approved, Participating) and simultaneously still "invited,
      // awaiting a decision" everywhere the org itself looks (its Invitations tab,
      // My Events). Settle it here rather than leaving it to accept/decline an
      // invitation to something it is already inside.
      await prisma.championship_invitations.updateMany({
        where: {
          championship_id: existing.championship_id,
          organization_id: existing.organization_id,
          org_unit_id: null,
          status: 'pending',
        },
        data: { status: 'accepted', accepted_by: req.user!.id, responded_at: new Date() },
      });
    }

    if (req.body.status === 'rejected' && existing.status !== 'rejected') {
      await notifyRegistrationRejected(
        prisma, existing.organization_id, existing.championships?.name, req.body.rejection_note ?? null, existing.id, req.user!.id,
      );
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

  // Can this organiser row be removed from the team? Two people are protected:
  //
  //   1. Whoever the championship was created under. Their row is seeded at
  //      creation time (see POST /championships) WITHOUT an `assigned_by` - nobody
  //      "added" them, the event exists because of them - so `assigned_by === null`
  //      is exactly that row and no other. Most championships here have no host
  //      organisation at all (an individual ran `POST /championships` themselves),
  //      so this is the only signal that works for them.
  //   2. When there IS a host organisation, any active member of it - removing an
  //      institution's own staff from an event their institution is hosting would
  //      read as kicking the host out of its own championship, no matter who
  //      happened to add that particular row.
  async function isProtectedOrganiser(championshipId: string, row: { user_id: string; assigned_by: string | null }): Promise<boolean> {
    if (row.assigned_by === null) return true;
    const championship = await prisma.championships.findUnique({
      where: { id: championshipId },
      select: { host_organization_id: true },
    });
    if (!championship?.host_organization_id) return false;
    return !!(await prisma.organization_members.findFirst({
      where: { organization_id: championship.host_organization_id, user_id: row.user_id, status: 'active' },
      select: { id: true },
    }));
  }

  // Remove a co-organiser (or any championship-scoped role holder) from the
  // championship - except a protected one; see `isProtectedOrganiser`. The
  // championship's host organisation (when it has one) keeps access regardless -
  // `managesChampionship` also grants owner/admin members of the host org - so
  // removing every OTHER row here can never lock everyone out.
  router.delete('/championships/:eventId/roles/:assignmentId', eventOrganiser, asyncHandler(async (req, res) => {
    const row = await prisma.user_championship_roles.findFirst({
      where: { id: req.params.assignmentId, championship_id: req.params.eventId },
    });
    if (!row) throw new NotFoundError('Assignment');
    if (await isProtectedOrganiser(req.params.eventId, row)) {
      throw new BusinessRuleError("This person is the championship's default organiser and can't be removed from the organising team.");
    }
    await prisma.user_championship_roles.delete({ where: { id: row.id } });
    res.status(204).send();
  }));

  // List championship-scoped role assignments.
  router.get('/championships/:eventId/roles', asyncHandler(async (req, res) => {
    const [rows, championship] = await Promise.all([
      prisma.user_championship_roles.findMany({
        where: { championship_id: req.params.eventId },
        include: { users_user_championship_roles_user_idTousers: true, roles: true },
        orderBy: { assigned_at: 'desc' },
      }),
      prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { host_organization_id: true } }),
    ]);

    const hostMemberIds = championship?.host_organization_id
      ? new Set((await prisma.organization_members.findMany({
        where: {
          organization_id: championship.host_organization_id,
          status: 'active',
          user_id: { in: rows.map((r) => r.user_id) },
        },
        select: { user_id: true },
      })).map((m) => m.user_id))
      : new Set<string>();

    res.json(rows.map((r) => ({ ...r, is_host: r.assigned_by === null || hostMemberIds.has(r.user_id) })));
  }));

  return router;
}
