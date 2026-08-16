import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

// A verification ticket is the receipt for "this person proved they own this
// address, just now". It is what carries proof across the two requests a
// code-verified flow needs: verify the code, then choose a password.
//
// It is NOT a session. It authorises exactly one thing - completing the purpose it
// names - and it is worthless on its own, because the step that redeems it also
// consumes the underlying auth_tokens row (see consumeById). So a replayed ticket
// buys nothing: the second redemption finds the code already burned.
//
// Ten minutes: long enough to pick a password, short enough that a ticket left in a
// browser history or a proxy log is dead by the time anyone reads it.
const TICKET_TTL_SECONDS = 10 * 60;

export type TicketPurpose = 'signup' | 'password_reset';

export interface TicketPayload {
  email: string;
  purpose: TicketPurpose;
  /** The auth_tokens row this ticket rests on. Redeeming consumes it. */
  tid: string;
}

export function signVerificationTicket(payload: TicketPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TICKET_TTL_SECONDS, subject: 'verification' });
}

// Returns the payload, or null for anything that isn't a live ticket of the
// expected purpose. Never throws - callers turn null into "start again".
export function readVerificationTicket(token: string, purpose: TicketPurpose): TicketPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { subject: 'verification' }) as TicketPayload;
    if (decoded.purpose !== purpose) return null;
    if (!decoded.email || !decoded.tid) return null;
    return decoded;
  } catch {
    return null;
  }
}
