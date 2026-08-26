import { env } from '../../config/env.js';

// The one place the API talks to the outside world by email.
//
// Transport, retries and DNS belong to a Lambda-hosted email service that already
// exists outside this repo (docs/eos/02-communications.md); this module renders the
// message and hands it over. That service is not wired yet, so with
// AUTH_EMAIL_BYPASS on we log the message and the caller surfaces the code
// in-band instead. Wiring module 02 replaces the body of sendEmail() and nothing else.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(message: EmailMessage): Promise<{ delivered: boolean }> {
  if (env.AUTH_EMAIL_BYPASS) {
    console.info(`[email:bypass] to=${message.to} subject=${JSON.stringify(message.subject)}`);
    if (message.text) console.info(`[email:bypass] ${message.text}`);
    return { delivered: false };
  }

  // TODO(module 02): POST to the email service and let it own retries/bounces.
  throw new Error('Email delivery is not wired yet - set AUTH_EMAIL_BYPASS=true for now');
}

// ---------- templates ----------

// The same code, two errands. Saying which one it is matters: a "reset your
// password" mail arriving unbidden is how someone learns their account is being
// probed, and a "confirm your email" mail is meaningless to an existing user.
export function otpEmail(
  code: string,
  ttlMinutes: number,
  purpose: 'signup' | 'password_reset' = 'signup',
): Omit<EmailMessage, 'to'> {
  const what = purpose === 'password_reset' ? 'password reset' : 'email verification';
  return {
    subject: `${code} is your Sportagon ${what} code`,
    text: `Your ${what} code is ${code}. It expires in ${ttlMinutes} minutes.`,
    html: `<p>Your ${what} code is <strong style="font-size:20px;letter-spacing:.15em">${code}</strong>.</p>
<p>It expires in ${ttlMinutes} minutes. If you didn't ask for it, you can ignore this email${purpose === 'password_reset' ? ' - your password has not changed' : ''}.</p>`,
  };
}

// The acceptance link. Deliberately says who invited them and to what - an
// unexplained "click here" from a product you have never used is indistinguishable
// from phishing.
export function inviteEmail(orgName: string, role: string, acceptUrl: string, ttlDays: number): Omit<EmailMessage, 'to'> {
  return {
    subject: `You've been invited to join ${orgName} on Sportagon`,
    text: `You've been invited to join ${orgName} as ${role}. Accept here: ${acceptUrl} (the link expires in ${ttlDays} days).`,
    html: `<p>You've been invited to join <strong>${orgName}</strong> on Sportagon as <strong>${role}</strong>.</p>
<p><a href="${acceptUrl}">Accept the invitation</a></p>
<p>The link expires in ${ttlDays} days. If you weren't expecting this, you can ignore it.</p>`,
  };
}
