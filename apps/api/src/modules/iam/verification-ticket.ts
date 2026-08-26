import jwt from 'jsonwebtoken';
import type { OtpPurpose } from '@semp/shared';
import { env } from '../../config/env.js';

// A verification ticket is the receipt for "this person proved they own this
// address or number, just now". It is what carries proof across the two requests a
// code-verified flow needs: check the code, then do the thing the proof unlocks.
//
// It is NOT a session. It authorises exactly one thing - completing the purpose it
// names - and it is worthless on its own, because the step that redeems it also
// consumes the underlying auth_tokens row (see consumeById). So a replayed ticket
// buys nothing: the second redemption finds the code already burned.
//
// Ten minutes: long enough to pick a password or choose an account, short enough
// that a ticket left in a browser history or a proxy log is dead by the time
// anyone reads it.
const TICKET_TTL_SECONDS = 10 * 60;

export type TicketPurpose = OtpPurpose;

export interface TicketPayload {
  /** Exactly one of these is set - whichever address was actually proved. */
  email?: string;
  phone?: string;
  purpose: TicketPurpose;
  /** The auth_tokens row this ticket rests on. Redeeming consumes it. */
  tid: string;
}

export function signVerificationTicket(payload: TicketPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TICKET_TTL_SECONDS, subject: 'verification' });
}

/**
 * Returns the payload, or null for anything that is not a live ticket of the
 * expected purpose. Never throws - callers turn null into "start again".
 *
 * The purpose check matters more than it looks: without it a code proved for
 * "verify your email during signup" would be redeemable as "reset this password",
 * which is a full account takeover from a single intercepted code.
 */
export function readVerificationTicket(token: string, purpose: TicketPurpose): TicketPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { subject: 'verification' }) as TicketPayload;
    if (decoded.purpose !== purpose) return null;
    if (!decoded.tid) return null;
    // A ticket must say what it proved. One or the other, never neither.
    if (!decoded.email && !decoded.phone) return null;
    return decoded;
  } catch {
    return null;
  }
}
