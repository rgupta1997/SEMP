import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  acceptInvitationSchema, changePasswordSchema, identifySchema, loginSchema,
  otpRequestSchema, otpVerifySchema, resetPasswordSchema, verifiedSignupSchema,
  type VerificationPurpose,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { requireAuth, signToken } from '../../http/middleware/auth.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { otpEmail, sendEmail } from '../comms/email.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { consumeById, issueToken, normalizeEmail, recentTokenCount, verifyToken } from './auth-tokens.service.js';
import { readVerificationTicket, signVerificationTicket } from './verification-ticket.js';
import { buildAuthContext } from './me-context.js';
import { resolveOrgByEmail } from './org-domains.service.js';
import { acceptInvitation, readInvitation } from './org-invitations.service.js';
import { findUserByPhone } from './users.helpers.js';

function publicUser(u: any) {
  const { password_hash, ...rest } = u;
  return rest;
}

// Per-address code budget. The in-process IP limiter on the router is best-effort
// (see rate-limit.ts); this one is DB-backed and is the limit that actually holds.
const OTP_WINDOW_MIN = 15;
const OTP_MAX_PER_WINDOW = 5;

// Every failure is a 401 with a plain explanation. None of them reveal whether the
// address exists - they only describe the state of the code that was typed.
const OTP_FAILURE_MESSAGE: Record<string, string> = {
  not_found: 'That code has expired or was already used. Request a new one.',
  expired: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
  mismatch: 'That code is not right. Check it and try again.',
};

function tokenFor(u: any): string {
  return signToken({
    id: u.id,
    email: u.email,
    isSuperAdmin: u.is_super_admin,
    organizationId: u.organization_id ?? null,
  });
}

export function makeAuthRouter(prisma: Prisma): Router {
  const router = Router();

  router.post('/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user || !user.password_hash) throw new UnauthorizedError('Invalid credentials');
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');
    const context = await buildAuthContext(prisma, user);
    res.json({ token: tokenFor(user), ...context });
  }));

  // NOTE: the old self-serve `POST /auth/register` and `POST /auth/signup` are gone.
  // Both created an account from an email nobody had proved they owned, which is
  // exactly the hole /auth/signup/complete exists to close - leaving them mounted
  // would have made email verification optional in practice. Admin-provisioned
  // logins are unaffected (users.routes + must_change_password).

  // ---------------------------------------------------------------------------
  // Email-first entry (FR-AUTH-1/2/3/4)
  //
  // A one-time code is NOT a way to sign in. It is proof that you own an address,
  // and it gates the only two things that need that proof:
  //
  //   signing up             identify -> code -> choose a password -> account
  //   forgetting that one    identify -> code -> choose a password
  //
  // /login is the everyday door once an account exists.
  //
  // Signing up NEVER puts anyone inside an institution, even when their email domain
  // matches one. Membership is granted by that institution - by approving a request
  // or by inviting - so a public account and access to an organisation's workspace
  // stay two separate things for the same person.
  //
  // Which door a person gets is decided by whether the address is registered, which
  // `identify` reports. That does make it an account-existence oracle - a deliberate
  // product-level trade-off for a screen that never asks someone to guess whether
  // they already have an account. The rate limiter on /auth is the mitigation; this
  // knowingly overrides the "never distinguish no-account from no-domain" line in
  // docs/eos/01-identity-tenancy-workspace.md §4.2.
  // ---------------------------------------------------------------------------

  // Which organisation owns this address's domain, and does an account already
  // exist for it? The domain half reads `org_domains` only; the existence half is
  // one indexed lookup, and is what routes the screen to sign-in or sign-up.
  router.post('/identify', validateBody(identifySchema), asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string };
    const addr = normalizeEmail(email);
    const [org, existing] = await Promise.all([
      resolveOrgByEmail(prisma, addr),
      prisma.users.findFirst({ where: { email: { equals: addr, mode: 'insensitive' } }, select: { id: true } }),
    ]);

    const settings = (org?.settings ?? {}) as { auth?: { methods?: string[] } };

    res.json({
      organization: org
        ? {
          id: org.id, name: org.name, short_name: org.short_name,
          logo_url: org.logo_url, city: org.city, kind: org.kind, verified: org.verified,
        }
        : null,
      // true  -> ask for their password (and offer "forgotten it?")
      // false -> send a code and walk them through creating an account
      registered: !!existing,
      auth_methods: settings.auth?.methods?.length ? settings.auth.methods : ['password'],
    });
  }));

  // Send a one-time code for a stated purpose. Signing up an address that already
  // exists is refused outright: the screen knows which case it is, so a mismatch
  // means something is wrong rather than that we should quietly do the other thing.
  router.post('/otp/request', validateBody(otpRequestSchema), asyncHandler(async (req, res) => {
    const { email, purpose } = req.body as { email: string; purpose: VerificationPurpose };
    const addr = normalizeEmail(email);
    const kind = purpose === 'password_reset' ? 'password_reset' : 'otp';

    const existing = await prisma.users.findFirst({
      where: { email: { equals: addr, mode: 'insensitive' } },
      select: { id: true, is_active: true },
    });

    if (purpose === 'signup' && existing) {
      throw new ConflictError('An account with this email already exists - sign in instead');
    }
    // Reset for an address with no (or a disabled) account: the same 200 shape, and
    // no email. `identify` is where the screen learns whether an account exists;
    // repeating that here would add a second, noisier oracle.
    if (purpose === 'password_reset' && (!existing || !existing.is_active)) {
      res.json({ sent: true });
      return;
    }

    const recent = await recentTokenCount(prisma, { email: addr, kind, windowMin: OTP_WINDOW_MIN });
    if (recent >= OTP_MAX_PER_WINDOW) {
      // Deliberately the success shape, minus the code: telling a script it has been
      // throttled tells it the address is worth retrying later.
      res.json({ sent: true });
      return;
    }

    const { code, expires_at } = await issueToken(prisma, { email: addr, kind, userId: existing?.id ?? null });
    await sendEmail({ to: addr, ...otpEmail(code, env.OTP_TTL_MIN, purpose) });

    res.json({
      sent: true,
      expires_at,
      // The email service isn't wired yet (module 02). Until it is, the code comes
      // back in-band so the flow works; env.ts refuses to boot in production with
      // this on. Removing the bypass removes this field and nothing else.
      ...(env.AUTH_EMAIL_BYPASS ? { dev_code: code, bypass: true } : {}),
    });
  }));

  // Check the code. Grants NO session and creates nothing - it returns a ten-minute
  // ticket that the next step redeems. The code stays live until then, so a ticket
  // that is never redeemed leaves nothing half-done.
  router.post('/otp/verify', validateBody(otpVerifySchema), asyncHandler(async (req, res) => {
    const { email, code, purpose } = req.body as { email: string; code: string; purpose: VerificationPurpose };
    const addr = normalizeEmail(email);
    const kind = purpose === 'password_reset' ? 'password_reset' : 'otp';

    const result = await verifyToken(prisma, { email: addr, kind, code });
    if (!result.ok) throw new UnauthorizedError(OTP_FAILURE_MESSAGE[result.reason]);

    const org = purpose === 'signup' ? await resolveOrgByEmail(prisma, addr) : null;

    res.json({
      verified: true,
      verification_token: signVerificationTicket({ email: addr, purpose, tid: result.token.id }),
      // Lets the next screen name the institution they are about to join.
      organization: org ? { id: org.id, name: org.name, logo_url: org.logo_url, verified: org.verified } : null,
    });
  }));

  // Finish signing up: a name, a phone number and a password of their own. The
  // address comes from the ticket and never from the body, so a caller cannot
  // verify one address and register a different one.
  router.post('/signup/complete', validateBody(verifiedSignupSchema), asyncHandler(async (req, res) => {
    const { verification_token, name, phone, password } = req.body as
      { verification_token: string; name: string; phone: string; password: string };

    const ticket = readVerificationTicket(verification_token, 'signup');
    if (!ticket) throw new UnauthorizedError('That verification has expired. Start again.');

    const addr = ticket.email;
    if (await prisma.users.findFirst({ where: { email: { equals: addr, mode: 'insensitive' } } })) {
      throw new ConflictError('An account with this email already exists');
    }
    if (await findUserByPhone(prisma, phone)) {
      throw new ConflictError('An account with this phone number already exists');
    }

    // Burning the code here, rather than at verify, is what makes the ticket
    // single-use: a replay finds nothing left to consume.
    if (!(await consumeById(prisma, ticket.tid))) {
      throw new UnauthorizedError('That verification has already been used. Start again.');
    }

    const org = await resolveOrgByEmail(prisma, addr);
    const password_hash = await bcrypt.hash(password, 10);

    // Signing up creates a PERSON, never a membership. A matching email domain says
    // where someone plausibly belongs - it is not permission to be inside an
    // institution's workspace, and an institution must not acquire members without
    // an admin agreeing to it. So `organization_id` stays null and the match is
    // returned for the caller to act on: they request, an admin approves.
    const user = await prisma.users.create({
      data: { name: name.trim(), email: addr, phone, password_hash, is_super_admin: false },
    });

    await audit(prisma, req, {
      actorUserId: user.id,
      action: AUDIT_ACTIONS.authSignupVerified,
      target: { type: 'users', id: user.id, label: `${user.name} (${addr})` },
      // No organizationId: this account belongs to no institution yet, and writing
      // one here would put the entry in a timeline the person has no relationship to.
      summary: `${addr} verified their email and created an account`,
      diff: { matched_domain: { from: null, to: !!org } },
    });

    const context = await buildAuthContext(prisma, user);
    res.status(201).json({
      token: tokenFor(user),
      ...context,
      // The institution this address's domain points at, if any. A suggestion the
      // person may act on - NOT somewhere they have been put.
      matched_organization: org ? { id: org.id, name: org.name, logo_url: org.logo_url, verified: org.verified } : null,
      is_new_account: true,
    });
  }));

  // Set a new password after proving ownership by code (FR-AUTH-3). Signs them in,
  // because making someone re-type the password they just chose is theatre.
  router.post('/reset-password', validateBody(resetPasswordSchema), asyncHandler(async (req, res) => {
    const { verification_token, password } = req.body as { verification_token: string; password: string };

    const ticket = readVerificationTicket(verification_token, 'password_reset');
    if (!ticket) throw new UnauthorizedError('That verification has expired. Request a new code.');

    const user = await prisma.users.findFirst({ where: { email: { equals: ticket.email, mode: 'insensitive' } } });
    if (!user) throw new UnauthorizedError('That reset is no longer valid. Request a new code.');
    if (!user.is_active) throw new UnauthorizedError('This account has been deactivated');

    if (!(await consumeById(prisma, ticket.tid))) {
      throw new UnauthorizedError('That code has already been used. Request a new one.');
    }

    const password_hash = await bcrypt.hash(password, 10);
    const updated = await prisma.users.update({
      where: { id: user.id },
      // A reset also clears a forced first-login change - they have just chosen it.
      data: { password_hash, must_change_password: false },
    });

    await audit(prisma, req, {
      actorUserId: user.id,
      action: AUDIT_ACTIONS.passwordReset,
      target: { type: 'users', id: user.id, label: `${user.name} (${user.email})` },
      organizationId: user.organization_id,
      summary: `${user.email} reset their password after verifying by email`,
    });

    const context = await buildAuthContext(prisma, updated);
    res.json({ token: tokenFor(updated), ...context });
  }));

  // ---------------------------------------------------------------------------
  // Invitations (J1-E3). Public: holding the token is the proof, exactly as holding
  // a one-time code is - it was delivered to that mailbox. So an invited person is
  // never asked to verify the same address twice.
  // ---------------------------------------------------------------------------

  // What the accept screen renders. Does not spend the invitation.
  router.get('/invite/:token', asyncHandler(async (req, res) => {
    res.json(await readInvitation(prisma, req.params.token));
  }));

  // Spend it: join the organisation, creating the account first if there isn't one.
  router.post('/invite/accept', validateBody(acceptInvitationSchema), asyncHandler(async (req, res) => {
    const { token, name, phone, password } = req.body as
      { token: string; name?: string; phone?: string; password?: string };
    const { user, organization, role, is_new_account } =
      await acceptInvitation(prisma, req, { token, name, phone, password });

    const context = await buildAuthContext(prisma, user);
    res.json({
      token: tokenFor(user),
      ...context,
      joined_organization: { ...organization, role },
      is_new_account,
    });
  }));

  router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await prisma.users.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new NotFoundError('User');
    const context = await buildAuthContext(prisma, user);
    // Identity/permissions are per-user and change (roles, must_change_password,
    // org membership). Never let the browser cache or 304-revalidate it - always
    // serve a fresh 200 so a stale context can't linger after those change.
    res.set('Cache-Control', 'no-store');
    res.json(context);
  }));

  // Change your own password. Provisioned users (must_change_password) skip the
  // current-password check - they just authenticated with the temporary one. A
  // normal change requires the current password. Clears the must-change flag.
  router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body as { current_password?: string; new_password: string };
    const user = await prisma.users.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.password_hash) throw new UnauthorizedError('Invalid credentials');

    if (!user.must_change_password) {
      const ok = current_password ? await bcrypt.compare(current_password, user.password_hash) : false;
      if (!ok) throw new UnauthorizedError('Current password is incorrect');
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    const updated = await prisma.users.update({
      where: { id: user.id },
      data: { password_hash, must_change_password: false },
    });
    const context = await buildAuthContext(prisma, updated);
    res.json(context);
  }));

  return router;
}

export { publicUser };
