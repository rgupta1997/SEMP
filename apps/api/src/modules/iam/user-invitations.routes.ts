import { Router } from 'express';
import { createUserInvitationSchema } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { last10, describeInviteTarget, applyInvitation } from './user-invitations.service.js';
import { INVITE_TTL_DAYS, hashInviteToken, inviteAcceptUrl, issueInviteToken } from './invite-token.js';
import { env } from '../../config/env.js';
import { sendInvitationEmail } from '../comms/email.js';
import { notify } from '@semp/notifications/server/notify.js';

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
    const { mobile, email, target_type, target_id, role } = req.body as {
      mobile?: string; email?: string; target_type: string; target_id: string; role?: string;
    };
    await assertManagesTarget(actor.id, actor.isSuperAdmin, target_type, target_id);

    const normalized = mobile ? last10(mobile) : null;
    if (mobile && (normalized?.length ?? 0) < 10) throw new BusinessRuleError('Enter a valid 10-digit mobile number');
    const addr = email ? email.trim().toLowerCase() : null;

    const existing = await prisma.user_invitations.findFirst({
      where: {
        target_type, target_id, status: 'pending',
        ...(addr ? { email: addr } : { mobile: normalized }),
      },
      select: { id: true },
    });
    if (existing) throw new BusinessRuleError(addr ? 'That address has already been invited' : 'That number has already been invited');

    // Only an email-addressed invitation gets a token: a mobile one is applied when
    // that number next signs in, so there is nothing to put in a link.
    const issued = addr ? issueInviteToken() : null;

    const row = await prisma.user_invitations.create({
      data: {
        mobile: normalized,
        email: addr,
        target_type,
        target_id,
        role: role ?? null,
        invited_by: actor.id,
        status: 'pending',
        token_hash: issued?.token_hash ?? null,
        expires_at: issued?.expires_at ?? null,
      },
    });

    if (addr && issued) {
      await deliverEmailInvite({
        invitationId: row.id,
        email: addr,
        token: issued.token,
        targetType: target_type,
        targetId: target_id,
        role: role ?? null,
        inviterId: actor.id,
      });
    }

    // The plaintext token is never echoed back - the link is the mail's to carry.
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
    await prisma.user_invitations.update({ where: { id: inv.id }, data: { status: 'revoked', revoked_at: new Date(), responded_at: new Date() } });
    res.json({ ok: true });
  }));

  // Send the invitation, and tell the invitee in-app too if they already have an
  // account. Best-effort: the invitation row is already committed, and failing the
  // request now would leave the caller believing nothing happened.
  //
  // TODO(outbox): as with championship invitations, nothing retries this. A lost POST
  // means an invitation that exists in the database and nowhere else.
  async function deliverEmailInvite(input: {
    invitationId: string;
    email: string;
    token: string;
    targetType: string;
    targetId: string;
    role: string | null;
    inviterId: string;
  }): Promise<void> {
    try {
      const [target, inviter, existingUser] = await Promise.all([
        describeInviteTarget(prisma, input.targetType, input.targetId),
        prisma.users.findUnique({ where: { id: input.inviterId }, select: { name: true } }),
        prisma.users.findFirst({
          where: { email: { equals: input.email, mode: 'insensitive' }, is_active: true },
          select: { id: true, name: true },
        }),
      ]);
      if (!target) return;

      // For an org_member invite the caller's role IS the label; for championship
      // targets the role is implied by the target type.
      const roleLabel = input.targetType === 'org_member'
        ? (input.role ? input.role[0].toUpperCase() + input.role.slice(1) : target.roleLabel)
        : target.roleLabel;

      await sendInvitationEmail(input.email, {
        organizationName: target.name,
        role: roleLabel,
        acceptUrl: inviteAcceptUrl(env.WEB_APP_URL, input.token),
        // Worth the extra read: it changes the subject line and adds an "Invited by"
        // row, and it is most of what separates this from a phishing mail.
        inviterName: inviter?.name ?? null,
        inviteeName: existingUser?.name ?? null,
        ttlDays: INVITE_TTL_DAYS,
      }, `user-invite-${input.invitationId}`);

      // Only meaningful for somebody who can already see a feed.
      if (existingUser) {
        await notify(prisma, {
          type: 'org_invitation',
          userId: existingUser.id,
          senderId: input.inviterId,
          data: {
            organizationName: target.name,
            role: roleLabel,
            inviterName: inviter?.name ?? null,
          },
        });
      }
    } catch (err) {
      console.error(`[user-invitations] could not deliver invite ${input.invitationId}:`, err);
    }
  }

  return router;
}

/**
 * The token-addressed half of the flow, for the person holding the link.
 *
 * Split into its own router because the two halves sit on opposite sides of the
 * global requireAuth gate: reading an invitation has to work for a stranger who has
 * not signed in yet - that is the whole point of the link - while accepting it needs
 * to know who is accepting.
 */
export function makePublicInviteRouter(prisma: Prisma): Router {
  const router = Router();

  // What the link is for. Deliberately thin: enough to decide whether to accept, and
  // nothing that would turn a guessed token into a directory of who was invited where.
  router.get('/invites/:token', asyncHandler(async (req, res) => {
    const inv = await prisma.user_invitations.findFirst({
      where: { token_hash: hashInviteToken(req.params.token) },
      select: { id: true, target_type: true, target_id: true, role: true, status: true, expires_at: true, invited_by: true },
    });
    // One answer for missing, spent and expired alike - a distinct "already accepted"
    // would confirm to a guesser that the token was real.
    if (!inv || inv.status !== 'pending' || (inv.expires_at && inv.expires_at.getTime() < Date.now())) {
      throw new NotFoundError('Invitation');
    }

    const [target, inviter] = await Promise.all([
      describeInviteTarget(prisma, inv.target_type, inv.target_id),
      prisma.users.findUnique({ where: { id: inv.invited_by }, select: { name: true } }),
    ]);
    if (!target) throw new NotFoundError('Invitation');

    res.json({
      organization_name: target.name,
      role: inv.target_type === 'org_member'
        ? (inv.role ? inv.role[0].toUpperCase() + inv.role.slice(1) : target.roleLabel)
        : target.roleLabel,
      invited_by: inviter?.name ?? null,
      expires_at: inv.expires_at,
    });
  }));

  return router;
}

/** Accepting - behind requireAuth, because the signed-in user is who joins. */
export function makeInviteAcceptRouter(prisma: Prisma): Router {
  const router = Router();

  router.post('/invites/:token/accept', asyncHandler(async (req, res) => {
    const user = req.user!;
    const token_hash = hashInviteToken(req.params.token);

    const inv = await prisma.user_invitations.findFirst({ where: { token_hash } });
    if (!inv || inv.status !== 'pending') throw new NotFoundError('Invitation');
    if (inv.expires_at && inv.expires_at.getTime() < Date.now()) {
      throw new BusinessRuleError('This invitation has expired. Ask whoever invited you to send a new one.');
    }

    await applyInvitation(prisma, inv, user.id);

    // Claimed by whoever was signed in, and the token is retired in the same write so
    // a forwarded link cannot be redeemed a second time.
    await prisma.user_invitations.update({
      where: { id: inv.id },
      data: { status: 'accepted', accepted_user_id: user.id, responded_at: new Date(), token_hash: null },
    });

    res.json({ ok: true, target_type: inv.target_type, target_id: inv.target_id });
  }));

  return router;
}
