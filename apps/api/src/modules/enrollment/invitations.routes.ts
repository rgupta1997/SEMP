import { Router } from 'express';
import { acceptInvitationSchema, createInvitationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { createNotification } from '../notifications/audience.js';

// Mobile numbers are entered free-form ("+91 98765 43210", "9876543210", …), so
// match an invitation to a user by the last 10 digits rather than exact string.
const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);

export function makeInvitationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  const eventOrganiser = guards.championshipManager(async (req) => req.params.eventId);

  // ----- Host side -----

  // Invite an organization by name + POC mobile (neither has to exist yet).
  router.post('/championships/:eventId/invitations', eventOrganiser, validateBody(createInvitationSchema), asyncHandler(async (req, res) => {
    const championship = await prisma.championships.findUnique({ where: { id: req.params.eventId }, select: { id: true } });
    if (!championship) throw new NotFoundError('Championship');
    const existing = await prisma.championship_invitations.findFirst({
      where: { championship_id: req.params.eventId, poc_mobile: req.body.poc_mobile, org_name: req.body.org_name, status: 'pending' },
      select: { id: true },
    });
    if (existing) throw new BusinessRuleError('That organization and POC have already been invited');
    const row = await prisma.championship_invitations.create({
      data: {
        championship_id: req.params.eventId,
        org_name: req.body.org_name,
        poc_mobile: req.body.poc_mobile,
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
      include: { organizations: { select: { id: true, name: true, short_name: true } } },
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

  // ----- POC side -----

  // Pending invitations addressed to the signed-in user (matched by mobile).
  router.get('/me/invitations', asyncHandler(async (req, res) => {
    const me = await prisma.users.findUnique({ where: { id: req.user!.id }, select: { phone: true } });
    const mine = me?.phone ? last10(me.phone) : '';
    if (mine.length < 10) { res.json([]); return; }
    const rows = await prisma.$queryRaw<any[]>`
      select ci.id, ci.org_name, ci.poc_mobile, ci.status, ci.created_at,
             c.id as championship_id, c.name as championship_name, c.slug as championship_slug,
             c.status as championship_status, c.start_date, c.end_date, c.venue
      from championship_invitations ci
      join championships c on c.id = ci.championship_id
      where ci.status = 'pending'
        and right(regexp_replace(ci.poc_mobile, '[^0-9]', '', 'g'), 10) = ${mine}
      order by ci.created_at desc`;
    res.json(rows);
  }));

  // Accept — choose which org you represent; creates a pending enrollment that
  // surfaces in the host's Approvals queue (idempotent if already applied).
  router.post('/invitations/:id/accept', validateBody(acceptInvitationSchema), asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findUnique({
      where: { id: req.params.id },
      include: { championships: { select: { name: true } } },
    });
    if (!inv) throw new NotFoundError('Invitation');
    if (inv.status !== 'pending') throw new BusinessRuleError('This invitation is no longer pending');

    const me = await prisma.users.findUnique({ where: { id: req.user!.id }, select: { phone: true } });
    if (!me?.phone || last10(me.phone) !== last10(inv.poc_mobile)) throw new ForbiddenError('This invitation was not addressed to you');
    if (!(await guards.orgRole(req.user!.id, req.body.organization_id, ['owner', 'admin']))) {
      throw new ForbiddenError('Pick an organization you own or administer');
    }

    const enrollment = await prisma.championship_organizations.upsert({
      where: { championship_id_organization_id: { championship_id: inv.championship_id, organization_id: req.body.organization_id } },
      update: {},
      create: {
        championship_id: inv.championship_id,
        organization_id: req.body.organization_id,
        applied_by: req.user!.id,
        status: 'pending',
      },
    });
    await prisma.championship_invitations.update({
      where: { id: inv.id },
      data: { status: 'accepted', accepted_by: req.user!.id, organization_id: req.body.organization_id, responded_at: new Date() },
    });

    const org = await prisma.organizations.findUnique({ where: { id: req.body.organization_id }, select: { name: true, short_name: true } });
    await createNotification(prisma, {
      championship_id: inv.championship_id,
      sender_id: req.user!.id,
      type: 'manual',
      audience: 'all',
      title: `${org?.short_name || org?.name || 'An organization'} accepted your invitation`,
      body: `${org?.name ?? 'An organization'} applied to ${inv.championships?.name ?? 'the championship'} and is awaiting approval.`,
    });

    res.status(201).json(enrollment);
  }));

  // Decline.
  router.post('/invitations/:id/decline', asyncHandler(async (req, res) => {
    const inv = await prisma.championship_invitations.findUnique({ where: { id: req.params.id }, select: { id: true, status: true, poc_mobile: true } });
    if (!inv) throw new NotFoundError('Invitation');
    const me = await prisma.users.findUnique({ where: { id: req.user!.id }, select: { phone: true } });
    if (!me?.phone || last10(me.phone) !== last10(inv.poc_mobile)) throw new ForbiddenError('This invitation was not addressed to you');
    if (inv.status === 'pending') {
      await prisma.championship_invitations.update({ where: { id: inv.id }, data: { status: 'declined', accepted_by: req.user!.id, responded_at: new Date() } });
    }
    res.json({ ok: true });
  }));

  return router;
}
