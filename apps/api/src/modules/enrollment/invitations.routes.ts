import { Router } from 'express';
import { createInvitationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { assertEntrantAllowed, eligibleEntrants, findEntrant, loadEventShape } from '../championships/contingent.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { notify } from '@semp/notifications/server/notify.js';
const ORG_ADMIN = ['owner', 'admin'];

export function makeInvitationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const eventOrganiser = guards.championshipManager(async (req) => req.params.eventId);

  // The organizations the signed-in user owns/administers - the set an invitation
  // can be addressed to (and accepted/declined on behalf of).
  const myAdminOrgIds = async (userId: string): Promise<string[]> => {
    const rows = await prisma.organization_members.findMany({
      where: { user_id: userId, role: { in: ORG_ADMIN }, status: 'active' },
      select: { organization_id: true },
    });
    return rows.map((r) => r.organization_id);
  };

  // ----- Host side -----

  // Who may be invited, for the picker.
  //
  // An OPEN championship invites organisations, and any of them may be asked - so
  // there is no list to enumerate and this returns none. An INTERNAL one invites the
  // host's own campuses or batches, which is a known, finite set, and offering the
  // wrong one is the commonest mistake there is.
  router.get('/championships/:eventId/invitable', eventOrganiser, asyncHandler(async (req, res) => {
    const shape = await loadEventShape(prisma, req.params.eventId);
    const [candidates, invited] = await Promise.all([
      eligibleEntrants(prisma, shape),
      prisma.championship_invitations.findMany({
        where: { championship_id: req.params.eventId, org_unit_id: { not: null } },
        select: { id: true, org_unit_id: true, status: true },
      }),
    ]);
    const byUnit = new Map(invited.map((i) => [i.org_unit_id as string, i]));
    res.json({
      level: shape.entry_level,
      intra: shape.entry_level !== 'organization',
      units: candidates.map((c) => {
        const row = byUnit.get(c.unitId!);
        return { ...c, invited: !!row, invitation_id: row?.id ?? null, status: row?.status ?? null };
      }),
    });
  }));

  // Invite an organisation (open championship) or one of the host's own campuses
  // (internal championship). The request goes straight to that org's owners/admins,
  // or to the campus's administrator - no POC mobile number.
  router.post('/championships/:eventId/invitations', eventOrganiser, validateBody(createInvitationSchema), asyncHandler(async (req, res) => {
    const shape = await loadEventShape(prisma, req.params.eventId);
    const intra = shape.entry_level !== 'organization';

    // ---- internal: a campus or batch of the HOST ---------------------------
    if (intra) {
      const unitId = req.body.org_unit_id as string | undefined;
      if (!unitId) {
        throw new BusinessRuleError('This championship is contested inside its host organisation. Invite one of its campuses or batches, not an organisation.');
      }
      // Reuses the entrant validator: it checks the unit belongs to the host, is of
      // the right type for this level, is ACTIVE, and sits inside the campus the
      // event is limited to. Every one of those is a way to invite the wrong thing.
      await assertEntrantAllowed(prisma, shape, { orgId: shape.host_organization_id!, unitId });

      const unit = await prisma.org_units.findUnique({
        where: { id: unitId },
        select: { id: true, name: true, org_units: { select: { name: true } } },
      });
      const parentName = unit?.org_units?.name ?? null;
      const champName = (await prisma.championships.findUnique({
        where: { id: req.params.eventId }, select: { name: true },
      }))?.name ?? null;
      const already = await prisma.championship_invitations.findFirst({
        where: { championship_id: req.params.eventId, org_unit_id: unitId, status: { in: ['pending', 'accepted'] } },
        select: { id: true },
      });
      if (already) throw new BusinessRuleError(`${unit?.name ?? 'That campus'} has already been invited`);

      const row = await prisma.championship_invitations.create({
        data: {
          championship_id: req.params.eventId,
          organization_id: shape.host_organization_id,
          org_unit_id: unitId,
          // The human label every existing reader already prints.
          org_name: unit?.name ?? 'Campus',
          invited_by: req.user!.id,
          // ACCEPTED on arrival. There is nobody outside the organisation to
          // negotiate with, so an accept step would be the host asking its own
          // campus for permission - a rubber stamp that only delays the squad being
          // built, and a "pending" badge that never resolves for anyone who never
          // logs in. Adding a campus IS entering it.
          status: 'accepted',
          accepted_by: req.user!.id,
          responded_at: new Date(),
        },
      });
      // Names the CAMPUS, not the institution. `enrollment_approved` would have
      // announced "Northfield has joined the championship" on an event contested
      // between Northfield's own campuses - true, useless, and hiding the one fact
      // the reader wants.
      await notify(prisma, {
        type: 'contingent_added',
        championshipId: req.params.eventId,
        senderId: req.user!.id,
        data: {
          unitName: unit?.name ?? 'A campus',
          parentName: parentName ?? undefined,
          championshipName: champName ?? undefined,
        },
      });

      return void res.status(201).json(row);
    }

    // ---- open: another organisation ---------------------------------------
    const org = await prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { id: true, name: true } });
    if (!org) throw new NotFoundError('Organization');
    const existing = await prisma.championship_invitations.findFirst({
      where: { championship_id: req.params.eventId, organization_id: org.id, org_unit_id: null, status: 'pending' },
      select: { id: true },
    });
    if (existing) throw new BusinessRuleError('That organization has already been invited');
    const row = await prisma.championship_invitations.create({
      data: {
        championship_id: req.params.eventId,
        organization_id: org.id,
        org_name: org.name,
        invited_by: req.user!.id,
        status: 'pending',
      },
    });
    res.status(201).json(row);
  }));

  // Withdraw an invitation. For an internal championship this is how a campus is
  // taken out again - refused once it has squads, because withdrawing would leave
  // people picked for a fixture their campus is no longer in.
  router.delete('/championships/:eventId/invitations/:id', eventOrganiser, asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findFirst({
      where: { id: req.params.id, championship_id: req.params.eventId },
      select: { id: true, org_unit_id: true, org_name: true },
    });
    if (!inv) throw new NotFoundError('Invitation');

    if (inv.org_unit_id) {
      const squads = await prisma.team_entries.count({
        where: { championship_id: req.params.eventId, teams: { org_unit_id: inv.org_unit_id } },
      });
      if (squads > 0) {
        throw new BusinessRuleError(`${inv.org_name} has ${squads} squad${squads === 1 ? '' : 's'} in this championship. Remove them first — withdrawing now would leave people picked for a campus that is no longer taking part.`);
      }
    }

    await prisma.championship_invitations.delete({ where: { id: inv.id } });
    res.json({ ok: true, withdrawn: inv.org_name });
  }));

  // The host's invitation list for a championship.
  router.get('/championships/:eventId/invitations', eventOrganiser, asyncHandler(async (req, res) => {
    const rows = await prisma.championship_invitations.findMany({
      where: { championship_id: req.params.eventId },
      include: {
        organizations: { select: { id: true, name: true, short_name: true, city: true } },
        org_units: { select: { id: true, name: true, code: true, type: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    // `target` is resolved here so the invitation list, like every other list in
    // this product, never has to decide for itself whether to print the unit or the
    // organisation.
    res.json(rows.map((r) => ({
      ...r,
      target: r.org_units?.name ?? r.organizations?.name ?? r.org_name,
      is_unit: !!r.org_unit_id,
    })));
  }));

  // Cancel a pending invitation.
  router.delete('/championships/:eventId/invitations/:id', eventOrganiser, asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findUnique({ where: { id: req.params.id }, select: { championship_id: true } });
    if (!inv || inv.championship_id !== req.params.eventId) throw new NotFoundError('Invitation');
    await prisma.championship_invitations.update({ where: { id: req.params.id }, data: { status: 'cancelled', responded_at: new Date() } });
    res.json({ ok: true });
  }));

  // ----- Invited org (POC) side -----

  // Pending invitations addressed to an organization the signed-in user administers.
  router.get('/me/invitations', asyncHandler(async (req, res) => {
    const orgIds = await myAdminOrgIds(req.user!.id);
    if (orgIds.length === 0) { res.json([]); return; }
    const rows = await prisma.championship_invitations.findMany({
      where: { status: 'pending', organization_id: { in: orgIds } },
      include: {
        organizations: { select: { id: true, name: true } },
        championships: { select: { id: true, name: true, slug: true, status: true, start_date: true, end_date: true, venue: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(rows.map((inv) => ({
      id: inv.id,
      org_name: inv.organizations?.name ?? inv.org_name,
      organization_id: inv.organization_id,
      status: inv.status,
      created_at: inv.created_at,
      championship_id: inv.championship_id,
      championship_name: inv.championships?.name,
      championship_slug: inv.championships?.slug,
      championship_status: inv.championships?.status,
      start_date: inv.championships?.start_date,
      end_date: inv.championships?.end_date,
      venue: inv.championships?.venue,
    })));
  }));

  // Accept - the invitation already names the organization; only its owners/admins
  // can accept. Because the host explicitly invited this org, accepting enrolls them
  // as APPROVED straight away - no second trip through the Approvals queue. Stamped
  // as reviewed by the inviting organiser. Idempotent if already enrolled.
  router.post('/invitations/:id/accept', asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findUnique({
      where: { id: req.params.id },
      include: { championships: { select: { name: true } } },
    });
    if (!inv) throw new NotFoundError('Invitation');
    if (inv.status !== 'pending') throw new BusinessRuleError('This invitation is no longer pending');
    if (!inv.organization_id) throw new BusinessRuleError('This invitation is not linked to an organization');
    if (!(await guards.orgRole(req.user!.id, inv.organization_id, ORG_ADMIN))) {
      throw new ForbiddenError('This invitation was not addressed to an organization you administer');
    }

    // An invitation is always addressed to an ORGANISATION, so the contingent it
    // creates never names a unit - an intra event's entrants are the host's own
    // campuses and there is nobody to invite. Written as an explicit null rather
    // than omitted so that intent is visible at the call site.
    const existing = await findEntrant(prisma, inv.championship_id, { orgId: inv.organization_id, unitId: null });
    const enrollment = existing
      ? await prisma.championship_organizations.update({
        where: { id: existing.id },
        data: { status: 'approved', reviewed_by: inv.invited_by, reviewed_at: new Date() },
      })
      : await prisma.championship_organizations.create({
        data: {
          championship_id: inv.championship_id,
          organization_id: inv.organization_id,
          org_unit_id: null,
          applied_by: req.user!.id,
          status: 'approved',
          reviewed_by: inv.invited_by,
          reviewed_at: new Date(),
        },
      });
    await prisma.championship_invitations.update({
      where: { id: inv.id },
      data: { status: 'accepted', accepted_by: req.user!.id, responded_at: new Date() },
    });

    const org = await prisma.organizations.findUnique({ where: { id: inv.organization_id }, select: { name: true, short_name: true } });
    await notify(prisma, {
      type: 'enrollment_approved',
      championshipId: inv.championship_id,
      senderId: req.user!.id,
      data: {
        orgName: org?.short_name || org?.name || 'An organization',
        bodyOrgName: org?.name ?? 'An organization',
        championshipName: inv.championships?.name,
      },
    });

    res.status(201).json(enrollment);
  }));

  // Decline.
  router.post('/invitations/:id/decline', asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, organization_id: true } });
    if (!inv) throw new NotFoundError('Invitation');
    if (!inv.organization_id || !(await guards.orgRole(req.user!.id, inv.organization_id, ORG_ADMIN))) {
      throw new ForbiddenError('This invitation was not addressed to an organization you administer');
    }
    if (inv.status === 'pending') {
      await prisma.championship_invitations.update({ where: { id: inv.id }, data: { status: 'declined', accepted_by: req.user!.id, responded_at: new Date() } });
    }
    res.json({ ok: true });
  }));

  return router;
}
