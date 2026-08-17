import { Router, json } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { can } from '../../http/middleware/can.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { createNotification } from '../notifications/audience.js';

// Claiming an achievement earned elsewhere (J4-E5).
//
// The record's value comes from nobody being able to write to it directly. A claim
// keeps that intact by being a REQUEST: invisible until an institution vouches for it,
// and permanently marked as a human judgement rather than a locked result once it is
// approved. Those are different kinds of fact and the record says which is which.

const claimSchema = z.object({
  organization_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  detail: z.string().max(2000).nullish(),
  sport_id: z.string().uuid().nullish(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  evidence_url: z.string().url().max(500).nullish(),
});

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  // Required on rejection, checked below rather than in the schema so the message can
  // say why. A refusal nobody can learn from just gets resubmitted unchanged.
  note: z.string().max(1000).nullish(),
});

export function makeClaimsRouter(prisma: Prisma): Router {
  const router = Router();

  const assertValidator = async (req: any, organizationId: string) => {
    const allowed = await can(prisma, 'achievement.validate', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to validate claims for this institution.');
  };

  // ---- submit (J4-E5-S1) ------------------------------------------------------
  router.post('/claims', validateBody(claimSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof claimSchema>;

    // You may only ask an institution you actually belong to. Otherwise anybody could
    // queue work for any sports office on the platform.
    const membership = await prisma.organization_members.findFirst({
      where: { user_id: req.user!.id, organization_id: body.organization_id, status: 'active' },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenError('You can only claim against an institution you belong to.');

    const dupe = await prisma.achievement_claims.findFirst({
      where: { user_id: req.user!.id, organization_id: body.organization_id, status: 'pending',
               title: { equals: body.title, mode: 'insensitive' }, occurred_on: new Date(body.occurred_on) },
      select: { id: true },
    });
    if (dupe) throw new BusinessRuleError('You already have this claim waiting for a decision.');

    const claim = await prisma.achievement_claims.create({
      data: {
        user_id: req.user!.id, organization_id: body.organization_id,
        title: body.title, detail: body.detail ?? null, sport_id: body.sport_id ?? null,
        occurred_on: new Date(body.occurred_on), evidence_url: body.evidence_url ?? null,
      },
    });

    // Tell the people who can act on it. A queue nobody is told about is a drawer.
    const validators = await prisma.organization_members.findMany({
      where: { organization_id: body.organization_id, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { user_id: true },
    });
    const claimant = await prisma.users.findUnique({ where: { id: req.user!.id }, select: { name: true } });
    for (const v of validators) {
      await createNotification(prisma, {
        target_user_id: v.user_id, sender_id: req.user!.id, organization_id: body.organization_id,
        type: 'claim_submitted', audience: 'all', // ignored for a direct notification - target_user_id drives visibility
        title: 'An achievement claim needs review',
        body: `${claimant?.name ?? 'Someone'} claims: ${body.title}`,
      }).catch((e) => console.error('[claims] notify failed', e));
    }

    res.status(201).json(claim);
  }));

  /** My own claims, including the rejected ones and why - that is the point of the note. */
  router.get('/me/claims', asyncHandler(async (req, res) => {
    const rows = await prisma.achievement_claims.findMany({
      where: { user_id: req.user!.id }, orderBy: { created_at: 'desc' }, take: 200,
      include: {
        organizations: { select: { name: true } }, sports: { select: { name: true } },
        claim_evidence: { select: { id: true, filename: true, mime: true, size_bytes: true } },
      },
    });
    res.json({ rows });
  }));

  // ---- evidence ----------------------------------------------------------------
  //
  // Uploaded as base64 JSON rather than multipart: it avoids a body-parser dependency
  // for one endpoint, and the files here are small and few. The larger body limit is
  // scoped to THIS route - raising it globally would widen every other endpoint's
  // exposure for the sake of one that needs it.
  const MAX_BYTES = 3 * 1024 * 1024;
  const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

  const evidenceSchema = z.object({
    filename: z.string().min(1).max(255),
    mime: z.string().refine((m) => ALLOWED.includes(m), 'Upload an image or a PDF.'),
    data: z.string().min(1),
  });

  router.post('/claims/:claimId/evidence', json({ limit: '5mb' }), validateBody(evidenceSchema),
    asyncHandler(async (req, res) => {
      const claim = await prisma.achievement_claims.findUnique({
        where: { id: req.params.claimId },
        select: { id: true, user_id: true, status: true },
      });
      if (!claim) throw new NotFoundError('Claim');
      // Only the claimant, and only while it is still theirs to change. Letting evidence
      // be added after a decision would mean the decision was made against a different
      // claim from the one now on file.
      if (claim.user_id !== req.user!.id) throw new ForbiddenError('This claim belongs to somebody else.');
      if (claim.status !== 'pending') throw new BusinessRuleError('This claim has already been decided, so its evidence is fixed.');

      const body = req.body as z.infer<typeof evidenceSchema>;
      const bytes = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!bytes.length) throw new BusinessRuleError('That file appears to be empty.');
      if (bytes.length > MAX_BYTES) throw new BusinessRuleError('Keep the file under 3MB.');

      const count = await prisma.claim_evidence.count({ where: { claim_id: claim.id } });
      if (count >= 5) throw new BusinessRuleError('Five files is enough to make a case.');

      const row = await prisma.claim_evidence.create({
        data: {
          claim_id: claim.id, filename: body.filename.slice(0, 255), mime: body.mime,
          size_bytes: bytes.length, bytes, uploaded_by: req.user!.id,
        },
        select: { id: true, filename: true, mime: true, size_bytes: true },
      });
      res.status(201).json(row);
    }));

  /** The file itself. The claimant and the institution's validators, nobody else. */
  router.get('/claim-evidence/:evidenceId', asyncHandler(async (req, res) => {
    const ev = await prisma.claim_evidence.findUnique({
      where: { id: req.params.evidenceId },
      include: { achievement_claims: { select: { user_id: true, organization_id: true } } },
    });
    if (!ev) throw new NotFoundError('Evidence');

    if (ev.achievement_claims.user_id !== req.user!.id) {
      await assertValidator(req, ev.achievement_claims.organization_id);
    }

    res.set('Content-Type', ev.mime);
    // Never inline HTML-ish content, and never let a browser sniff its way to executing
    // an upload. The allow-list already blocks it; this is the second lock.
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${ev.filename.replace(/["\r\n]/g, '')}"`);
    res.send(Buffer.from(ev.bytes));
  }));

  // ---- review (J4-E5-S2) ------------------------------------------------------
  router.get('/organizations/:id/claims', asyncHandler(async (req, res) => {
    await assertValidator(req, req.params.id);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const rows = await prisma.achievement_claims.findMany({
      where: { organization_id: req.params.id, ...(status === 'all' ? {} : { status }) },
      orderBy: { created_at: 'desc' }, take: 300,
      include: {
        users_achievement_claims_user_idTousers: { select: { id: true, name: true, email: true } },
        sports: { select: { name: true } },
        claim_evidence: { select: { id: true, filename: true, mime: true, size_bytes: true } },
      },
    });
    const pending = await prisma.achievement_claims.count({ where: { organization_id: req.params.id, status: 'pending' } });
    res.json({ rows, pending });
  }));

  router.post('/claims/:claimId/decision', validateBody(decisionSchema), asyncHandler(async (req, res) => {
    const claim = await prisma.achievement_claims.findUnique({
      where: { id: req.params.claimId },
      include: { users_achievement_claims_user_idTousers: { select: { id: true, name: true } } },
    });
    if (!claim) throw new NotFoundError('Claim');
    await assertValidator(req, claim.organization_id);
    if (claim.status !== 'pending') throw new BusinessRuleError('This claim has already been decided.');

    const { decision, note } = req.body as z.infer<typeof decisionSchema>;
    if (decision === 'rejected' && (note ?? '').trim().length < 5) {
      throw new BusinessRuleError('Give a reason for the rejection - the claimant sees it, and a refusal they cannot learn from just gets resubmitted.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      let achievementId: string | null = null;

      if (decision === 'approved') {
        // Marked `validated_claim`, never `locked_result`. A reader must always be able
        // to tell "somebody vouched for this" from "the system watched it happen".
        const ach = await tx.achievements.create({
          data: {
            user_id: claim.user_id, organization_id: claim.organization_id,
            sport_id: claim.sport_id, kind: 'award', title: claim.title,
            detail: { claimed: true, note: claim.detail, evidence_url: claim.evidence_url } as object,
            occurred_on: claim.occurred_on, source: 'validated_claim',
          },
        });
        achievementId = ach.id;
      }

      return tx.achievement_claims.update({
        where: { id: claim.id },
        data: {
          status: decision, decided_by: req.user!.id, decided_at: new Date(),
          decision_note: note ?? null, achievement_id: achievementId,
        },
      });
    });

    await audit(prisma, req, {
      action: decision === 'approved' ? AUDIT_ACTIONS.claimApproved : AUDIT_ACTIONS.claimRejected,
      target: { type: 'achievement_claims', id: claim.id, label: `${claim.users_achievement_claims_user_idTousers?.name}: ${claim.title}` },
      organizationId: claim.organization_id,
      summary: decision === 'approved'
        ? `Validated ${claim.users_achievement_claims_user_idTousers?.name}'s claim "${claim.title}" - it is now on their record`
        : `Declined ${claim.users_achievement_claims_user_idTousers?.name}'s claim "${claim.title}" - ${note}`,
      diff: { status: { from: 'pending', to: decision } },
    });

    await createNotification(prisma, {
      target_user_id: claim.user_id, sender_id: req.user!.id, organization_id: claim.organization_id,
      type: decision === 'approved' ? 'claim_approved' : 'claim_rejected', audience: 'all',
      title: decision === 'approved' ? 'Your claim was validated' : 'Your claim was not accepted',
      body: decision === 'approved' ? `"${claim.title}" is now on your record.` : `"${claim.title}" — ${note}`,
    }).catch((e) => console.error('[claims] notify failed', e));

    res.json(updated);
  }));

  return router;
}
