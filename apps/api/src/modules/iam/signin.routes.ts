import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import {
  identifySubjectSchema, otpCheckSchema, otpSendSchema,
  passwordSignInSchema, phoneSignupSchema, sessionSchema,
  type OtpPurpose,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { signToken } from '../../http/middleware/auth.js';
import { ConflictError, UnauthorizedError, ValidationError } from '../../shared/errors.js';
import {
  consumeById, issueToken, normalizeEmail, normalizePhone,
  recentTokenCount, verifyToken, type TokenSubject,
} from './auth-tokens.service.js';
import { accountsForSubject, accountsMatchingPassword, phoneHasCapacity, type AccountChoice } from './accounts.service.js';
import { readVerificationTicket, signVerificationTicket } from './verification-ticket.js';
import { sendEmail, otpEmail } from '../comms/email.js';
import { sendSms, otpSms } from '../comms/sms.js';

// Phone-first sign-in (Option B).
//
//   identify  -> which doors are open for this subject
//   otp/send  -> a code, by SMS or email depending on the subject
//   otp/check -> a ticket, never a session
//   session   -> a ticket (+ a chosen account) becomes a session
//   password  -> the same, without a code
//
// The rule that shapes all of it: a PHONE resolves to a SET of accounts. Every path
// that starts from a number can therefore end in a chooser - including the password
// path, because two accounts can share a password.

const OTP_WINDOW_MIN = 15;
const OTP_MAX_PER_WINDOW = 5;

const OTP_FAILURE: Record<string, string> = {
  not_found: 'That code has expired or was never sent. Ask for a new one.',
  expired: 'That code has expired. Ask for a new one.',
  too_many_attempts: 'Too many wrong attempts. Ask for a new code.',
  mismatch: 'That code is not right.',
};

/** Subjects are validated as one-or-the-other; this narrows the body to the token shape. */
function toSubject(body: { phone?: string; email?: string }): TokenSubject {
  return body.phone !== undefined
    ? ({ phone: body.phone } as TokenSubject)
    : ({ email: body.email as string } as TokenSubject);
}

const isPhone = (s: TokenSubject): s is { phone: string } =>
  'phone' in s && (s as { phone?: string }).phone !== undefined;

// 'otp' for anything that is a sign-in or a verification; 'password_reset' stands
// apart so a code minted to reset a password cannot be spent signing in and vice versa.
const kindFor = (purpose: OtpPurpose) => (purpose === 'password_reset' ? 'password_reset' : 'otp');

export function makeSignInRouter(prisma: Prisma): Router {
  const router = Router();

  const sessionFor = (u: { id: string; email: string; is_super_admin: boolean; organization_id: string | null }) =>
    signToken({ id: u.id, email: u.email, isSuperAdmin: u.is_super_admin, organizationId: u.organization_id ?? null });

  /** A ticket plus one account becomes a session. Shared by every path that ends in one. */
  async function grant(accountId: string, tid: string) {
    // Burning the code here - not at check time - is what makes a replayed ticket
    // worthless: the second attempt finds it already consumed.
    const burned = await consumeById(prisma, tid);
    if (!burned) throw new UnauthorizedError('That sign-in has already been used. Start again.');

    const user = await prisma.users.findFirst({
      where: { id: accountId, is_active: true },
      select: { id: true, name: true, email: true, is_super_admin: true, organization_id: true, must_change_password: true },
    });
    if (!user) throw new UnauthorizedError('That account is no longer available');

    return {
      token: sessionFor(user),
      user: { id: user.id, name: user.name, email: user.email },
      must_change_password: user.must_change_password,
    };
  }

  /** One account -> straight in. Several -> the chooser, holding the ticket. */
  function resolveOrChoose(accounts: AccountChoice[], ticket: string) {
    if (accounts.length === 1) return null;
    return { choose: true, verification_token: ticket, accounts };
  }

  // ---- 1. Which doors are open? ------------------------------------------
  // Answers about the SUBJECT, not about a specific account: how many accounts a
  // number reaches, and whether any of them can take a password. It does not say
  // which, and it never says "no such account" for an email - `registered:false`
  // is the same answer a fresh address gets, which is the whole point.
  router.post('/identify', validateBody(identifySubjectSchema), asyncHandler(async (req, res) => {
    const subject = toSubject(req.body);
    const accounts = await accountsForSubject(prisma, subject);

    res.json({
      registered: accounts.length > 0,
      account_count: accounts.length,
      // Both are offered on a number; an unregistered subject gets neither.
      methods: accounts.length === 0 ? [] : isPhone(subject) ? ['otp', 'password'] : ['password', 'otp'],
      can_sign_up: isPhone(subject) ? await phoneHasCapacity(prisma, subject.phone) : true,
    });
  }));

  // ---- 2. Send a code ------------------------------------------------------
  router.post('/otp/send', validateBody(otpSendSchema), asyncHandler(async (req, res) => {
    const { purpose } = req.body as { purpose: OtpPurpose };
    const subject = toSubject(req.body);
    const kind = kindFor(purpose);

    const accounts = await accountsForSubject(prisma, subject);

    if (purpose === 'signup' && !isPhone(subject) && accounts.length > 0) {
      throw new ConflictError('An account with this email already exists - sign in instead');
    }
    if (purpose === 'signup' && isPhone(subject) && !(await phoneHasCapacity(prisma, subject.phone))) {
      throw new ConflictError(`This number already has ${env.MAX_ACCOUNTS_PER_PHONE} accounts`);
    }
    // Sign-in or reset for something with no account: the success shape, no message
    // sent. `identify` is where a screen learns whether an account exists; repeating
    // it here would add a second, noisier oracle.
    if ((purpose === 'sign_in' || purpose === 'password_reset') && accounts.length === 0) {
      res.json({ sent: true });
      return;
    }

    const recent = await recentTokenCount(prisma, { ...subject, kind, windowMin: OTP_WINDOW_MIN } as never);
    if (recent >= OTP_MAX_PER_WINDOW) {
      // Deliberately the success shape: telling a script it has been throttled tells
      // it the subject is worth retrying later.
      res.json({ sent: true });
      return;
    }

    // A phone token carries no user_id even when it resolves to exactly one account:
    // it proves the NUMBER, and binding it to a user here would pre-empt the chooser.
    const userId = !isPhone(subject) && accounts.length === 1 ? accounts[0].id : null;
    const { code, expires_at } = await issueToken(prisma, { ...subject, kind, userId } as never);

    if (isPhone(subject)) {
      await sendSms({ to: normalizePhone(subject.phone), ...otpSms(code, env.OTP_TTL_MIN) });
    } else {
      const addr = normalizeEmail((subject as { email: string }).email);
      const mailPurpose = purpose === 'password_reset' ? 'password_reset' : 'signup';
      await sendEmail({ to: addr, ...otpEmail(code, env.OTP_TTL_MIN, mailPurpose) });
    }

    const bypassed = isPhone(subject) ? env.OTP_SMS_BYPASS : env.AUTH_EMAIL_BYPASS;
    res.json({
      sent: true,
      expires_at,
      // No delivery service is wired yet. Until one is, the code comes back in-band
      // so the flow works end to end; env.ts refuses to boot in production with
      // either bypass on. Wiring a provider removes this field and nothing else.
      ...(bypassed ? { dev_code: code, bypass: true } : {}),
    });
  }));

  // ---- 3. Check the code ---------------------------------------------------
  // Grants no session and creates nothing. Returns a ten-minute ticket, and - when
  // the subject is a number reaching several accounts - the list to choose from.
  router.post('/otp/check', validateBody(otpCheckSchema), asyncHandler(async (req, res) => {
    const { code, purpose } = req.body as { code: string; purpose: OtpPurpose };
    const subject = toSubject(req.body);

    const result = await verifyToken(prisma, { ...subject, kind: kindFor(purpose), code } as never);
    if (!result.ok) throw new UnauthorizedError(OTP_FAILURE[result.reason]);

    const ticket = signVerificationTicket({
      ...(isPhone(subject) ? { phone: normalizePhone(subject.phone) } : { email: normalizeEmail((subject as { email: string }).email) }),
      purpose,
      tid: result.token.id,
    });

    // signup / verify_* have nothing to sign into yet - the ticket is the whole answer.
    if (purpose !== 'sign_in') {
      res.json({ verified: true, verification_token: ticket });
      return;
    }

    const accounts = await accountsForSubject(prisma, subject);
    if (accounts.length === 0) throw new UnauthorizedError('That account is no longer available');

    const choose = resolveOrChoose(accounts, ticket);
    if (choose) { res.json({ verified: true, ...choose }); return; }

    res.json({ verified: true, ...(await grant(accounts[0].id, result.token.id)) });
  }));

  // ---- 4. Redeem a ticket for a session -----------------------------------
  // The chooser posts here with the account it picked.
  router.post('/session', validateBody(sessionSchema), asyncHandler(async (req, res) => {
    const { verification_token, account_id } = req.body as { verification_token: string; account_id?: string };
    const ticket = readVerificationTicket(verification_token, 'sign_in');
    if (!ticket) throw new UnauthorizedError('That sign-in has expired. Start again.');

    const subject: TokenSubject = ticket.phone
      ? ({ phone: ticket.phone } as TokenSubject)
      : ({ email: ticket.email as string } as TokenSubject);

    const accounts = await accountsForSubject(prisma, subject);
    // The chosen account must be one the ticket actually reaches - otherwise a
    // verified code for one number would open any account whose id was guessed.
    const chosen = account_id ? accounts.find((a) => a.id === account_id) : accounts[0];
    if (!chosen) throw new UnauthorizedError('That account is not available for this sign-in');
    if (!account_id && accounts.length > 1) throw new ValidationError('Choose which account to open');

    res.json(await grant(chosen.id, ticket.tid));
  }));

  // ---- 5. Password sign-in -------------------------------------------------
  // Ends in the chooser too. A phone reaches several accounts, and the password only
  // tells them apart when they differ - reusing one password across both is common,
  // and proves ownership without saying which was meant.
  router.post('/password', validateBody(passwordSignInSchema), asyncHandler(async (req, res) => {
    const { password } = req.body as { password: string };
    const subject = toSubject(req.body);

    const matched = await accountsMatchingPassword(prisma, subject, password);
    // One message for "no such subject" and "wrong password" alike: two messages is
    // an account-existence oracle behind a login form.
    if (matched.length === 0) throw new UnauthorizedError('Those details do not match an account');

    if (matched.length > 1) {
      // A short-lived ticket standing for "this password was proved", so the chooser
      // does not have to send the password a second time.
      const { code, expires_at: _ } = await issueToken(prisma, { ...subject, kind: 'otp' } as never);
      const check = await verifyToken(prisma, { ...subject, kind: 'otp', code } as never);
      if (!check.ok) throw new UnauthorizedError('Could not start that sign-in. Try again.');
      const ticket = signVerificationTicket({
        ...(isPhone(subject) ? { phone: normalizePhone(subject.phone) } : { email: normalizeEmail((subject as { email: string }).email) }),
        purpose: 'sign_in',
        tid: check.token.id,
      });
      res.json({ choose: true, verification_token: ticket, accounts: matched });
      return;
    }

    const user = await prisma.users.findUnique({
      where: { id: matched[0].id },
      select: { id: true, name: true, email: true, is_super_admin: true, organization_id: true, must_change_password: true },
    });
    if (!user) throw new UnauthorizedError('Those details do not match an account');

    res.json({
      token: sessionFor(user),
      user: { id: user.id, name: user.name, email: user.email },
      must_change_password: user.must_change_password,
    });
  }));

  // ---- 6. Sign up ----------------------------------------------------------
  // Both addresses are proved before the row exists, and both come from their
  // tickets rather than the body - so a caller cannot verify one address and
  // register another.
  router.post('/signup', validateBody(phoneSignupSchema), asyncHandler(async (req, res) => {
    const { phone_token, email_token, name, password } = req.body as {
      phone_token: string; email_token: string; name: string; password: string;
    };

    const phoneTicket = readVerificationTicket(phone_token, 'verify_phone');
    const emailTicket = readVerificationTicket(email_token, 'verify_email');
    if (!phoneTicket?.phone) throw new UnauthorizedError('Verify your phone number again');
    if (!emailTicket?.email) throw new UnauthorizedError('Verify your email address again');

    const phone = phoneTicket.phone;
    const email = normalizeEmail(emailTicket.email);

    // Email is still the account key - it is what makes phone1+email2 a different
    // account from phone1+email1 rather than a duplicate.
    const clash = await prisma.users.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw new ConflictError('An account with this email already exists - sign in instead');
    if (!(await phoneHasCapacity(prisma, phone))) {
      throw new ConflictError(`This number already has ${env.MAX_ACCOUNTS_PER_PHONE} accounts`);
    }

    const both = await Promise.all([consumeById(prisma, phoneTicket.tid), consumeById(prisma, emailTicket.tid)]);
    if (!both.every(Boolean)) throw new UnauthorizedError('That sign-up has already been used. Start again.');

    const now = new Date();
    const created = await prisma.users.create({
      data: {
        name,
        email,
        phone,
        password_hash: await bcrypt.hash(password, 10),
        // Both proved a moment ago, so both are stamped. Two columns, not one flag:
        // a later email change re-opens that one without doubting the number.
        email_verified_at: now,
        phone_verified_at: now,
      },
      select: { id: true, name: true, email: true, is_super_admin: true, organization_id: true },
    });

    res.status(201).json({ token: sessionFor(created), user: { id: created.id, name: created.name, email: created.email } });
  }));

  // ---- 7. Forgotten password ----------------------------------------------
  // Reachable from either subject. The ticket names what was proved, and the new
  // password is set on the account the person then chooses - because a number can
  // reach several, and resetting "the" password on a shared number is meaningless.
  router.post('/reset-password', validateBody(sessionSchema.extend({ password: z.string().min(6) })), asyncHandler(async (req, res) => {
    const { verification_token, account_id, password } = req.body as {
      verification_token: string; account_id?: string; password: string;
    };
    const ticket = readVerificationTicket(verification_token, 'password_reset');
    if (!ticket) throw new UnauthorizedError('That reset has expired. Start again.');

    const subject: TokenSubject = ticket.phone
      ? ({ phone: ticket.phone } as TokenSubject)
      : ({ email: ticket.email as string } as TokenSubject);

    const accounts = await accountsForSubject(prisma, subject);
    const chosen = account_id ? accounts.find((a) => a.id === account_id) : accounts[0];
    if (!chosen) throw new UnauthorizedError('That account is not available for this reset');
    if (!account_id && accounts.length > 1) {
      // Same chooser, different errand: say which account is being reset before it is.
      res.json({ choose: true, verification_token, accounts });
      return;
    }

    const burned = await consumeById(prisma, ticket.tid);
    if (!burned) throw new UnauthorizedError('That reset has already been used. Start again.');

    await prisma.users.update({
      where: { id: chosen.id },
      // A reset clears the forced-change flag: they have just chosen this password,
      // so demanding they choose another on first sign-in is nonsense.
      data: { password_hash: await bcrypt.hash(password, 10), must_change_password: false },
    });

    res.json({ reset: true });
  }));

  return router;
}
