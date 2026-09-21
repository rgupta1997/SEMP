import type { OtpPurpose } from '@semp/shared';
import { compact, nonEmpty, sendMail, type MailAddress, type MailResult } from './mail-client.js';

// The one place the API decides what an email SAYS. mail-client.ts decides how it
// travels; this file owns the errand and the props that describe it.
//
// Bodies live in the mail service as reviewed templates, so there is no HTML here
// any more - only the data each template needs. Adding a message means adding a
// function here and, usually, asking the mail team for a template.

/** Raw escape hatch, for the rare message no template covers. Prefer a template. */
export interface EmailMessage {
  to: MailAddress | MailAddress[];
  subject: string;
  html?: string;
  text?: string;
}

export async function sendEmail(message: EmailMessage): Promise<MailResult> {
  return sendMail(message);
}

// ---------- OTP ----------

// The same six digits, five different errands. Saying which one it is matters: a
// "reset your password" mail arriving unbidden is how someone learns their account is
// being probed, and a "confirm your email" mail is meaningless to an existing user.
//
// `purpose` is free text and lands in the body - "Use the code below to {purpose}."
// so these are written to read after "to".
const OTP_PURPOSE_PHRASE: Record<OtpPurpose, string> = {
  sign_in: 'sign in to Sportagon',
  signup: 'create your Sportagon account',
  password_reset: 'reset your password',
  verify_email: 'confirm your email address',
  verify_phone: 'confirm your phone number',
};

/**
 * KNOWN REGRESSION: the `otp` template's subject is fixed - "{code} is your Sportagon
 * verification code" - and cannot name the errand. Until it can, a password-reset code
 * and a sign-in code are indistinguishable in the inbox list, which is exactly the
 * signal that tells someone their account is being probed. `purpose` reaches the body
 * only. Raised with the mail team; see docs/integration-guide.md.
 */
export async function sendOtpEmail(
  to: string,
  code: string,
  ttlMinutes: number,
  purpose: OtpPurpose,
  opts: { name?: string | null; tokenId: string },
): Promise<MailResult> {
  return sendMail({
    to,
    template: 'otp',
    data: compact({
      code,
      // Sent explicitly: omitted, the template renders "expires in 10 minutes"
      // whatever OTP_TTL_MIN actually enforces, and the mail would be lying.
      ttlMinutes,
      purpose: OTP_PURPOSE_PHRASE[purpose],
      // Optional because a signup code is issued before the users row exists.
      name: nonEmpty(opts.name),
    }),
    // Somebody actively waiting on a screen.
    priority: 1,
    // Keyed on the TOKEN, not the address. A resend issues a fresh code and
    // invalidates the old one, so an address-keyed key would dedupe the second mail
    // and leave the user reading a code that no longer works.
    idempotencyKey: `otp-${purpose}-${opts.tokenId}`,
    metadata: { kind: 'otp', purpose },
  });
}

// ---------- welcome ----------

// What the product actually does, in the recipient's words rather than ours. These
// are the only part of the welcome mail we control - see the caveat on
// sendWelcomeEmail - and they are kept in step with the landing page on purpose, so
// the first email says what the site that sold it said.
const WELCOME_HIGHLIGHTS = [
  'Set up a multi-sport championship in minutes',
  'Auto-generate clash-free fixtures across venues',
  'Live scores, standings and medal tallies - and zero spreadsheets',
];

/**
 * Sent once, when an account is created.
 *
 * CAVEAT, recorded because it will read as a bug otherwise: the template's fixed body
 * says "Sportagon helps you find courts, book slots, and keep your game going" - copy
 * written for the booking product that shares this mail service, not for an event
 * platform. It is not overridable per message; the body lives in the mail service's
 * repository and is shared by every caller. A Sportagon-EOS welcome template has been
 * requested. `highlights` and the CTA below are the parts we do control, which is why
 * they carry the description of what this product is.
 *
 * The template also closes with "just reply to this email - a real person reads it",
 * which is a promise about the reply-to address. Make sure it reaches a monitored
 * inbox before this goes anywhere near production volume.
 */
export async function sendWelcomeEmail(
  to: string,
  name: string,
  appUrl: string,
  userId: string,
): Promise<MailResult> {
  return sendMail({
    to,
    template: 'welcome',
    data: compact({
      name: nonEmpty(name) ?? 'there',
      ctaUrl: `${appUrl}/home`,
      ctaLabel: 'Open Sportagon',
      highlights: WELCOME_HIGHLIGHTS,
    }),
    // Nobody is waiting on this one the way they wait on a code.
    priority: 5,
    // One account, one welcome - for all time, not just for one retry.
    idempotencyKey: `welcome-${userId}`,
    metadata: { kind: 'welcome', userId },
  });
}

// ---------- invitations ----------

/**
 * A person invited to an organisation, addressed to an email with no account yet.
 *
 * `inviterName` is worth going out of the way for: it changes the subject line and
 * adds an "Invited by" row, and it is most of what separates this from phishing - the
 * recipient has by definition never seen this product before.
 */
export async function sendInvitationEmail(
  to: string,
  invite: {
    organizationName: string;
    role: string;
    acceptUrl: string;
    inviterName?: string | null;
    inviteeName?: string | null;
    ttlDays?: number;
    message?: string | null;
  },
  idempotencyKey: string,
): Promise<MailResult> {
  return sendMail({
    to,
    template: 'invitation',
    data: compact({
      organizationName: invite.organizationName,
      role: invite.role,
      acceptUrl: invite.acceptUrl,
      inviterName: nonEmpty(invite.inviterName),
      inviteeName: nonEmpty(invite.inviteeName),
      ttlDays: invite.ttlDays,
      message: nonEmpty(invite.message),
    }),
    priority: 3,
    idempotencyKey,
    metadata: { kind: 'invitation' },
  });
}

// ---------- generic ----------

export interface NotificationEmail {
  subject: string;
  paragraphs: string[];
  heading?: string | null;
  greeting?: string | null;
  details?: Array<{ label: string; value: string }>;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  footnote?: string | null;
}

/**
 * The branded escape hatch, for a message with no template of its own yet.
 *
 * Unlike every other template this one has no fixed copy - everything the recipient
 * reads comes from us, so it is also the only one where a typo ships unreviewed. Ask
 * for a real template once a message recurs.
 */
export function notificationMailData(n: NotificationEmail): Record<string, unknown> {
  return compact({
    subject: n.subject,
    paragraphs: n.paragraphs.map((p) => p.trim()).filter(Boolean),
    heading: nonEmpty(n.heading),
    greeting: nonEmpty(n.greeting),
    // Values must be STRINGS - a number here is a 422 - and the rupee helper the
    // booking templates use does not apply, so anything numeric is formatted upstream.
    details: n.details?.filter((d) => nonEmpty(d.label) && nonEmpty(d.value)),
    ctaUrl: nonEmpty(n.ctaUrl),
    ctaLabel: nonEmpty(n.ctaLabel),
    footnote: nonEmpty(n.footnote),
  });
}

export async function sendNotificationEmail(
  to: MailAddress | MailAddress[],
  n: NotificationEmail,
  opts: { idempotencyKey?: string; priority?: number; metadata?: Record<string, unknown> } = {},
): Promise<MailResult> {
  return sendMail({
    to,
    template: 'generic-notification',
    data: notificationMailData(n),
    priority: opts.priority ?? 5,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    metadata: opts.metadata,
  });
}
