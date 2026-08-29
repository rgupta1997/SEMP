import { Router } from 'express';
import { createVerificationRequestSchema, reviewVerificationRequestSchema } from '@semp/shared';
import { notify } from '@semp/notifications/server/notify.js';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireSuperAdmin } from '../../http/middleware/auth.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';

// Asking to be verified, and answering.
//
// `organizations.verified` has existed since 20260815000000 with no route to it.
// Administration → Organization Profile listed what verification asks for and then
// said "Contact play@sportagon.in to start it", with an honest comment on the
// missing button: "nothing routes such a request to anyone, and a button that
// silently does nothing is worse than a sentence telling you who to talk to".
//
// This is the routing. Two sides, and they are deliberately asymmetric:
//
//   THE ORGANISATION  submits, reads its own latest request, and can withdraw a
//                     pending one. Gated on `org.manage`, so whoever runs the
//                     institution can vouch for it and a Viewer cannot.
//   THE PLATFORM      lists the queue and approves or rejects with a note.
//                     requireSuperAdmin, which is what "once approved by the super
//                     admin the tick is given" means.
//
// VERIFICATION IS A TRUST SIGNAL, NOT AN ACCESS GATE. An unverified organisation
// runs events, enters championships and issues certificates exactly as a verified
// one does; what it does not carry is the tick. So approving flips one boolean and
// moves nothing else, and rejecting takes nothing away.

/** What the organisation's own screen is allowed to see about its request. */
const own = {
  id: true, status: true, created_at: true, reviewed_at: true, review_note: true,
  contact_name: true, contact_role: true, contact_email: true, contact_phone: true,
  registered_name: true, registration_id: true, website: true, address: true,
  document_url: true, note: true,
} as const;

export function makeVerificationRequestsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // Reading and submitting are the same authority: `org.manage`. Vouching for the
  // institution to the platform is an act of running it, and the reply - which may
  // say what was wrong with the last attempt - is not for the whole directory.
  const orgManager = guards.orgPermission('org.manage');

  // ---- the organisation's side ---------------------------------------------

  /**
   * The latest request, whatever state it is in, plus where the organisation stands.
   *
   * One endpoint rather than "is there a pending one" and "what did they say",
   * because the screen renders one of four states from the same fact and splitting
   * it would let the two answers disagree mid-render.
   */
  router.get('/organizations/:id/verification-request', orgManager, asyncHandler(async (req, res) => {
    const [org, latest] = await Promise.all([
      prisma.organizations.findUnique({ where: { id: req.params.id }, select: { verified: true } }),
      prisma.org_verification_requests.findFirst({
        where: { organization_id: req.params.id },
        orderBy: { created_at: 'desc' },
        select: own,
      }),
    ]);
    if (!org) throw new NotFoundError('Organization');
    res.json({ verified: org.verified, request: latest ?? null });
  }));

  router.post('/organizations/:id/verification-request', orgManager,
    validateBody(createVerificationRequestSchema), asyncHandler(async (req, res) => {
      const organizationId = req.params.id;
      const org = await prisma.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, verified: true },
      });
      if (!org) throw new NotFoundError('Organization');

      // Already verified. Refused rather than accepted-and-ignored: a queue entry
      // whose answer is already yes wastes the reviewer's attention, and the screen
      // does not offer the form in this state anyway.
      if (org.verified) throw new BusinessRuleError('This organisation is already verified.');

      // One open request at a time. The database enforces this too (a partial unique
      // index on status = 'pending'), and it is checked here as well so the answer is
      // a sentence rather than a constraint violation.
      const open = await prisma.org_verification_requests.findFirst({
        where: { organization_id: organizationId, status: 'pending' },
        select: { id: true, created_at: true },
      });
      if (open) throw new BusinessRuleError('A verification request is already being reviewed.');

      const row = await prisma.org_verification_requests.create({
        data: {
          ...req.body,
          organization_id: organizationId,
          submitted_by: req.user!.id,
        },
        select: own,
      });

      await audit(prisma, req, {
        action: AUDIT_ACTIONS.orgVerificationRequested,
        target: { type: 'org_verification_requests', id: row.id, label: org.name },
        organizationId,
        summary: 'Requested verification from Sportagon',
        diff: { status: { from: null, to: 'pending' } },
      });

      res.status(201).json(row);
    }));

  /**
   * Withdraw a pending request.
   *
   * Not a delete. The history of what was submitted and when is the audit trail for
   * why the tick was eventually given or refused, and an organisation that withdraws
   * and resubmits a better request should be able to see both.
   */
  router.delete('/organizations/:id/verification-request', orgManager, asyncHandler(async (req, res) => {
    const open = await prisma.org_verification_requests.findFirst({
      where: { organization_id: req.params.id, status: 'pending' },
      select: { id: true },
    });
    if (!open) throw new NotFoundError('Verification request');

    const row = await prisma.org_verification_requests.update({
      where: { id: open.id },
      data: { status: 'withdrawn', updated_at: new Date() },
      select: own,
    });

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgVerificationWithdrawn,
      target: { type: 'org_verification_requests', id: row.id, label: 'Verification request' },
      organizationId: req.params.id,
      summary: 'Withdrew the verification request',
      diff: { status: { from: 'pending', to: 'withdrawn' } },
    });

    res.json(row);
  }));

  // ---- the platform's side -------------------------------------------------

  router.get('/verification-requests', requireSuperAdmin, asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const rows = await prisma.org_verification_requests.findMany({
      where: status ? { status } : undefined,
      orderBy: { created_at: 'desc' },
      include: {
        organizations: {
          select: { id: true, name: true, short_name: true, kind: true, city: true, country: true, code: true, verified: true, created_at: true },
        },
        users_org_verification_requests_submitted_byTousers: { select: { id: true, name: true, email: true } },
        users_org_verification_requests_reviewed_byTousers: { select: { id: true, name: true } },
      },
    });
    res.json(rows);
  }));

  /**
   * Approve or reject.
   *
   * The status and `organizations.verified` move TOGETHER, in one transaction. Two
   * writes would leave the pair able to disagree - a request marked approved beside
   * an organisation with no tick reads as a bug in the product rather than as a
   * failed write, and the person who has to work out which is which is a support
   * engineer six weeks later.
   */
  router.post('/verification-requests/:id/review', requireSuperAdmin,
    validateBody(reviewVerificationRequestSchema), asyncHandler(async (req, res) => {
      const { status, review_note } = req.body as { status: 'approved' | 'rejected'; review_note?: string };
      const existing = await prisma.org_verification_requests.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true, organization_id: true, organizations: { select: { name: true } } },
      });
      if (!existing) throw new NotFoundError('Verification request');
      // Only a live request can be answered. Re-approving a withdrawn one would flip
      // the tick on an organisation that had taken the request back.
      if (existing.status !== 'pending') {
        throw new BusinessRuleError(`This request is already ${existing.status}.`);
      }

      const organizationId = existing.organization_id;
      const orgName = existing.organizations?.name ?? 'the organisation';

      const [row] = await prisma.$transaction([
        prisma.org_verification_requests.update({
          where: { id: existing.id },
          data: {
            status,
            review_note: review_note ?? null,
            reviewed_by: req.user!.id,
            reviewed_at: new Date(),
            updated_at: new Date(),
          },
          select: own,
        }),
        // Rejection leaves `verified` alone rather than setting it false: an
        // organisation verified years ago whose fresh request is refused for a
        // paperwork reason has not thereby lost its tick, and un-verifying is a
        // separate, deliberate act with its own audit action.
        ...(status === 'approved'
          ? [prisma.organizations.update({ where: { id: organizationId }, data: { verified: true } })]
          : []),
      ]);

      await audit(prisma, req, {
        action: status === 'approved' ? AUDIT_ACTIONS.orgVerified : AUDIT_ACTIONS.orgVerificationRejected,
        target: { type: 'organizations', id: organizationId, label: orgName },
        organizationId,
        summary: status === 'approved'
          ? `Verified ${orgName}`
          : `Refused verification for ${orgName}`,
        diff: {
          status: { from: 'pending', to: status },
          ...(status === 'approved' ? { verified: { from: false, to: true } } : {}),
        },
      });

      // Best-effort, like every other notify() call on a mutation path: the decision
      // is recorded and must not be rolled back because a notification row failed.
      try {
        await notify(prisma as any, {
          type: status === 'approved' ? 'org_verification_approved' : 'org_verification_rejected',
          organizationId,
          senderId: req.user!.id,
          data: { organizationName: orgName, reason: review_note ?? null },
        });
      } catch (e) {
        console.error('[verification] notify failed', e);
      }

      res.json(row);
    }));

  return router;
}
