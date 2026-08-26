import { Router } from 'express';
import { createUserInvitationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { last10 } from './user-invitations.service.js';

// Invite a person by mobile to a role (org member / co-organiser / official). When
// they sign in with that number the invite is auto-applied (see the service).
export function makeUserInvitationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // The actor must manage the invitation's target: owner/admin of the org, or
  // organiser of the championship.
  async function assertManagesTarget(userId: string, isSuper: boolean, targetType: string, targetId: string) {
    if (isSuper) return;
    if (targetType === 'org_member') {
      if (await guards.orgRole(userId, targetId, ['owner', 'admin'])) return;
    } else if (await guards.managesChampionship(userId, targetId)) {
      return;
    }
    throw new ForbiddenError('You do not manage this target');
  }

  router.post('/user-invitations', validateBody(createUserInvitationSchema), asyncHandler(async (req, res) => {
    const actor = req.user!;
    const { mobile, target_type, target_id, role } = req.body as { mobile: string; target_type: string; target_id: string; role?: string };
    await assertManagesTarget(actor.id, actor.isSuperAdmin, target_type, target_id);
    const normalized = last10(mobile);
    if (normalized.length < 10) throw new BusinessRuleError('Enter a valid 10-digit mobile number');
    const existing = await prisma.user_invitations.findFirst({
      where: { mobile: normalized, target_type, target_id, status: 'pending' }, select: { id: true },
    });
    if (existing) throw new BusinessRuleError('That number has already been invited');
    const row = await prisma.user_invitations.create({
      data: { mobile: normalized, target_type, target_id, role: role ?? null, invited_by: actor.id, status: 'pending' },
    });
    res.status(201).json(row);
  }));

  // Pending invites for a target (so the host can see/cancel who's been invited).
  router.get('/user-invitations', asyncHandler(async (req, res) => {
    const actor = req.user!;
    const target_type = req.query.target_type as string | undefined;
    const target_id = req.query.target_id as string | undefined;
    if (!target_type || !target_id) { res.json([]); return; }
    await assertManagesTarget(actor.id, actor.isSuperAdmin, target_type, target_id);
    const rows = await prisma.user_invitations.findMany({
      where: { target_type, target_id, status: 'pending' },
      orderBy: { created_at: 'desc' },
    });
    res.json(rows);
  }));

  router.delete('/user-invitations/:id', asyncHandler(async (req, res) => {
    const actor = req.user!;
    const inv = await prisma.user_invitations.findUnique({ where: { id: req.params.id } });
    if (!inv) throw new NotFoundError('Invitation');
    await assertManagesTarget(actor.id, actor.isSuperAdmin, inv.target_type, inv.target_id);
    await prisma.user_invitations.update({ where: { id: inv.id }, data: { status: 'cancelled', responded_at: new Date() } });
    res.json({ ok: true });
  }));

  return router;
}
