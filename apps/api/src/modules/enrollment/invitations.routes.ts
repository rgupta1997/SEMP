import { Router } from 'express';
import { createInvitationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { createNotification } from '../notifications/audience.js';

const ORG_ADMIN = ['owner', 'admin'];

export function makeInvitationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const eventOrganiser = guards.championshipManager(async (req) => req.params.eventId);

  // The organizations the signed-in user owns/administers — the set an invitation
  // can be addressed to (and accepted/declined on behalf of).
  const myAdminOrgIds = async (userId: string): Promise<string[]> => {
    const rows = await prisma.organization_members.findMany({
      where: { user_id: userId, role: { in: ORG_ADMIN }, status: 'active' },
      select: { organization_id: true },
    });
    return rows.map((r) => r.organization_id);
  };

  // ----- Host side -----

  // Invite an organization picked from the master list. The request goes straight
  // to that org's owners/admins — no POC mobile number.
  router.post('/championships/:eventId/invitations', eventOrganiser, validateBody(createInvitationSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { id: true } });
    if (!championship) throw new NotFoundError('Championship');
    const org = await prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { id: true, name: true } });
    if (!org) throw new NotFoundError('Organization');
    const existing = await prisma.championship_invitations.findFirst({
      where: { championship_id: req.params.eventId, organization_id: org.id, status: 'pending' },
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

  // The host's invitation list for a championship.
  router.get('/championships/:eventId/invitations', eventOrganiser, asyncHandler(async (req, res) => {
    const rows = await prisma.championship_invitations.findMany({
      where: { championship_id: req.params.eventId },
      include: { organizations: { select: { id: true, name: true, short_name: true, city: true } } },
      orderBy: { created_at: 'desc' },
    });
    res.json(rows);
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

  // Accept — the invitation already names the organization; only its owners/admins
  // can accept. Because the host explicitly invited this org, accepting enrolls them
  // as APPROVED straight away — no second trip through the Approvals queue. Stamped
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

    const enrollment = await prisma.championship_organizations.upsert({
      where: { championship_id_organization_id: { championship_id: inv.championship_id, organization_id: inv.organization_id } },
      update: { status: 'approved', reviewed_by: inv.invited_by, reviewed_at: new Date() },
      create: {
        championship_id: inv.championship_id,
        organization_id: inv.organization_id,
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
    await createNotification(prisma, {
      championship_id: inv.championship_id,
      sender_id: req.user!.id,
      type: 'enrollment_approved',
      audience: 'all',
      title: `${org?.short_name || org?.name || 'An organization'} has joined the championship`,
      body: `${org?.name ?? 'An organization'} accepted the invitation to ${inv.championships?.name ?? 'the championship'} and can now enter teams.`,
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
