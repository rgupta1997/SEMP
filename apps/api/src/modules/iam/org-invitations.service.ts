import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { BusinessRuleError, ConflictError, NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { inviteEmail, sendEmail } from '../comms/email.js';
import { createNotification } from '../notifications/audience.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { normalizeEmail } from './auth-tokens.service.js';
import { domainOf } from './org-domains.service.js';

// Inviting the sports office team (J1-E3).
//
// An invitation is a single-use, expiring token addressed to an email address. It is
// delivered two ways, and the second is the one that currently works:
//
//   * by email - the acceptance link. Module 02 is not wired, so with
//     AUTH_EMAIL_BYPASS on this logs and the link comes back to the inviter to pass
//     on however they like.
//   * in-app - if the address already belongs to an account, a notification lands in
//     that person's inbox immediately. That is the right channel regardless of
//     email: an invitation to join an institution belongs where everything else the
//     product tells you lives.
//
// Accepting the token is proof the invitee controls that mailbox, exactly as a
// one-time code is - so it stands in for verification, and an invited person never
// has to verify the same address twice.

const INVITE_TTL_DAYS = 14;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// 32 bytes of CSPRNG, url-safe. Long enough that guessing is not a strategy, unlike
// the 6-digit codes which lean on an attempt budget instead.
const generateToken = () => randomBytes(32).toString('base64url');

export const inviteAcceptUrl = (token: string): string => {
  const base = env.WEB_ORIGIN.split(',')[0]?.trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/invite/${token}`;
};

const ORG_TARGET = 'org_member';

export interface CreatedInvitation {
  id: string;
  email: string;
  role: string;
  expires_at: Date;
  accept_url: string;
  /** Only while email delivery is bypassed - lets the inviter pass the link on by hand. */
  dev_token?: string;
  notified_in_app: boolean;
  outside_claimed_domain: boolean;
}

// The organisation as the invitation flow needs it: the name for the email, and the
// claimed domains for the outside-our-domain warning. Loaded once per request, so a
// batch of 200 does not re-read it 200 times.
type InvitingOrg = { id: string; name: string; org_domains: { domain: string; verified: boolean }[] };

async function loadInvitingOrg(prisma: Prisma, organizationId: string): Promise<InvitingOrg> {
  const org = await prisma.organizations.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, org_domains: { select: { domain: true, verified: true } } },
  });
  if (!org) throw new NotFoundError('Organization');
  return org;
}

export async function inviteToOrganization(
  prisma: Prisma, req: Request,
  { organizationId, email, role }: { organizationId: string; email: string; role: string },
): Promise<CreatedInvitation> {
  return inviteOne(prisma, req, await loadInvitingOrg(prisma, organizationId), email, role);
}

async function inviteOne(
  prisma: Prisma, req: Request, org: InvitingOrg, email: string, role: string,
): Promise<CreatedInvitation> {
  const addr = normalizeEmail(email);

  const existingUser = await prisma.users.findFirst({
    where: { email: { equals: addr, mode: 'insensitive' } },
    select: { id: true, name: true },
  });

  // Already a member? Say so rather than sending an invitation that would do nothing.
  if (existingUser) {
    const member = await prisma.organization_members.findFirst({
      where: { user_id: existingUser.id, organization_id: org.id },
      select: { status: true },
    });
    if (member?.status === 'active') throw new ConflictError('They are already a member of this organisation');
  }

  const live = await prisma.user_invitations.findFirst({
    where: {
      email: { equals: addr, mode: 'insensitive' },
      target_type: ORG_TARGET, target_id: org.id, status: 'pending',
    },
    select: { id: true },
  });
  if (live) throw new ConflictError('That address already has a pending invitation - revoke it first to send a new one');

  const token = generateToken();
  const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  const row = await prisma.user_invitations.create({
    data: {
      email: addr,
      mobile: null,
      target_type: ORG_TARGET,
      target_id: org.id,
      role,
      invited_by: req.user!.id,
      status: 'pending',
      token_hash: hashToken(token),
      expires_at,
    },
  });

  const accept_url = inviteAcceptUrl(token);
  await sendEmail({ to: addr, ...inviteEmail(org.name, role, accept_url, INVITE_TTL_DAYS) });

  // Someone who already has an account gets it in their inbox straight away.
  let notified = false;
  if (existingUser) {
    await createNotification(prisma, {
      organization_id: org.id,
      target_user_id: existingUser.id,
      sender_id: req.user!.id,
      type: 'org_invitation',
      audience: 'all', // ignored for direct notifications - target_user_id drives visibility
      title: `You've been invited to join ${org.name}`,
      body: `As ${role}. Open the invitation to accept it.`,
    });
    notified = true;
  }

  // The domain check is a warning, not a refusal (J1-E3-S1: "I am warned before the
  // invitation is sent, and may proceed deliberately") - a coach on a personal
  // address is a real case, and refusing it would just push people to workarounds.
  const claimed = org.org_domains.some((d) => d.verified && d.domain.toLowerCase() === domainOf(addr));

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.memberInvited,
    target: { type: 'user_invitations', id: row.id, label: addr },
    organizationId: org.id,
    summary: `Invited ${addr} to join ${org.name} as ${role}`,
    diff: { role: { from: null, to: role }, outside_claimed_domain: { from: null, to: !claimed } },
  });

  return {
    id: row.id,
    email: addr,
    role,
    expires_at,
    accept_url,
    ...(env.AUTH_EMAIL_BYPASS ? { dev_token: token } : {}),
    notified_in_app: notified,
    outside_claimed_domain: !claimed,
  };
}

export interface BulkInviteResult {
  sent: CreatedInvitation[];
  skipped: { email: string; reason: string }[];
}

// Invite a whole list in one request - a pasted set of addresses or an uploaded
// sheet. Deliberately PARTIALLY successful: one address that is already a member, or
// already has a live invitation, or is repeated in the sheet, is reported and
// stepped over rather than taking the rest of the batch down with it. Whoever pasted
// 40 addresses should not have to work out which one the 400 was about.
//
// Sequential on purpose: each invitation writes a row, an audit entry and possibly a
// notification, and firing 200 of those at a pooled connection concurrently is how
// you exhaust the pool. The schema caps the list at 200 to keep this inside the
// request budget.
export async function inviteManyToOrganization(
  prisma: Prisma, req: Request,
  { organizationId, invites }: { organizationId: string; invites: { email: string; role: string }[] },
): Promise<BulkInviteResult> {
  const org = await loadInvitingOrg(prisma, organizationId);
  const result: BulkInviteResult = { sent: [], skipped: [] };
  const seen = new Set<string>();

  for (const { email, role } of invites) {
    const addr = normalizeEmail(email);
    if (!z.string().email().safeParse(addr).success) {
      result.skipped.push({ email: email.trim().slice(0, 80), reason: 'Not a valid email address' });
      continue;
    }
    if (seen.has(addr)) {
      result.skipped.push({ email: addr, reason: 'Listed more than once' });
      continue;
    }
    seen.add(addr);
    try {
      result.sent.push(await inviteOne(prisma, req, org, addr, role));
    } catch (e) {
      result.skipped.push({ email: addr, reason: e instanceof Error ? e.message : 'Could not be invited' });
    }
  }
  return result;
}

export async function listOrganizationInvitations(prisma: Prisma, organizationId: string) {
  const rows = await prisma.user_invitations.findMany({
    where: { target_type: ORG_TARGET, target_id: organizationId, email: { not: null } },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, email: true, role: true, status: true, created_at: true,
      expires_at: true, revoked_at: true, responded_at: true,
      users_user_invitations_invited_byTousers: { select: { name: true, email: true } },
    },
  });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    // An expired invitation is not "pending" in any useful sense - say so, so the
    // members list doesn't show someone as invited forever.
    status: r.status === 'pending' && r.expires_at && r.expires_at.getTime() < now ? 'expired' : r.status,
    created_at: r.created_at,
    expires_at: r.expires_at,
    responded_at: r.responded_at,
    invited_by: r.users_user_invitations_invited_byTousers,
  }));
}

export async function revokeInvitation(prisma: Prisma, req: Request, organizationId: string, invitationId: string) {
  const row = await prisma.user_invitations.findFirst({
    where: { id: invitationId, target_type: ORG_TARGET, target_id: organizationId },
  });
  if (!row) throw new NotFoundError('Invitation');
  if (row.status !== 'pending') throw new BusinessRuleError('That invitation is no longer pending');

  await prisma.user_invitations.update({
    where: { id: row.id },
    // The token hash goes with it: a revoked link must be dead, not merely flagged.
    data: { status: 'revoked', revoked_at: new Date(), token_hash: null },
  });

  await audit(prisma, req, {
    action: AUDIT_ACTIONS.memberInviteRevoked,
    target: { type: 'user_invitations', id: row.id, label: row.email ?? row.mobile ?? '' },
    organizationId,
    summary: `Revoked the invitation for ${row.email ?? row.mobile}`,
    diff: { status: { from: 'pending', to: 'revoked' } },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// accepting
// ---------------------------------------------------------------------------

export interface InvitationView {
  email: string;
  role: string;
  organization: { id: string; name: string; logo_url: string | null; verified: boolean };
  invited_by: string | null;
  expires_at: Date | null;
  /** true -> they sign in / are added to the account they have; false -> they set a password */
  has_account: boolean;
}

async function loadLiveInvitation(prisma: Prisma, token: string) {
  const row = await prisma.user_invitations.findFirst({
    where: { token_hash: hashToken(token), status: 'pending' },
    include: { users_user_invitations_invited_byTousers: { select: { name: true, email: true } } },
  });
  if (!row) throw new UnauthorizedError('This invitation link is no longer valid. Ask for a new one.');
  if (row.expires_at && row.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('This invitation has expired. Ask for a new one.');
  }
  return row;
}

// Public: describe the invitation so the accept screen can render, without spending it.
export async function readInvitation(prisma: Prisma, token: string): Promise<InvitationView> {
  const row = await loadLiveInvitation(prisma, token);
  const org = await prisma.organizations.findUnique({
    where: { id: row.target_id },
    select: { id: true, name: true, logo_url: true, verified: true },
  });
  if (!org) throw new NotFoundError('Organization');

  const user = row.email
    ? await prisma.users.findFirst({ where: { email: { equals: row.email, mode: 'insensitive' } }, select: { id: true } })
    : null;

  return {
    email: row.email ?? '',
    role: row.role ?? 'member',
    organization: org,
    invited_by: row.users_user_invitations_invited_byTousers?.name ?? null,
    expires_at: row.expires_at,
    has_account: !!user,
  };
}

// Spend the invitation. Holding the token is proof the invitee controls that mailbox,
// which is the same standard the one-time code flow uses - so an invited person is
// never asked to verify the same address twice.
export async function acceptInvitation(
  prisma: Prisma, req: Request,
  { token, name, phone, password }: { token: string; name?: string; phone?: string; password?: string },
) {
  const row = await loadLiveInvitation(prisma, token);
  const addr = normalizeEmail(row.email ?? '');
  if (!addr) throw new BusinessRuleError('This invitation has no email address');

  const org = await prisma.organizations.findUnique({
    where: { id: row.target_id },
    select: { id: true, name: true, logo_url: true, verified: true },
  });
  if (!org) throw new NotFoundError('Organization');

  let user = await prisma.users.findFirst({ where: { email: { equals: addr, mode: 'insensitive' } } });
  const isNewAccount = !user;

  if (!user) {
    // First time here: they choose their own password. Nobody ever hands one over.
    if (!name?.trim() || !phone?.trim() || !password) {
      throw new BusinessRuleError('Enter your name, phone number and a password to finish setting up your account');
    }
    if (password.length < 6) throw new BusinessRuleError('Choose a password of at least 6 characters');

    const bcrypt = (await import('bcryptjs')).default;
    user = await prisma.users.create({
      data: {
        name: name.trim(), email: addr, phone: phone.trim(),
        password_hash: await bcrypt.hash(password, 10),
        is_super_admin: false,
        organization_id: org.id,
      },
    });
  } else if (!user.is_active) {
    throw new UnauthorizedError('This account has been deactivated');
  }

  // The membership carries the role the invitation stated - which is the point of
  // inviting rather than letting someone request to join.
  await prisma.organization_members.upsert({
    where: { user_id_organization_id: { user_id: user.id, organization_id: org.id } },
    update: { role: row.role ?? 'member', status: 'active' },
    create: { user_id: user.id, organization_id: org.id, role: row.role ?? 'member', status: 'active' },
  });

  if (!user.organization_id) {
    user = await prisma.users.update({ where: { id: user.id }, data: { organization_id: org.id } });
  }

  await prisma.user_invitations.update({
    where: { id: row.id },
    data: { status: 'accepted', accepted_user_id: user.id, responded_at: new Date(), token_hash: null },
  });

  await audit(prisma, req, {
    actorUserId: user.id,
    action: AUDIT_ACTIONS.memberInviteAccepted,
    target: { type: 'organization_members', id: user.id, label: `${user.name} (${addr})` },
    organizationId: org.id,
    summary: `${addr} accepted the invitation to join ${org.name} as ${row.role ?? 'member'}`,
    diff: { role: { from: null, to: row.role ?? 'member' }, new_account: { from: null, to: isNewAccount } },
  });

  return { user, organization: org, role: row.role ?? 'member', is_new_account: isNewAccount };
}
