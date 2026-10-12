import { createHash, randomBytes } from 'node:crypto';

// The token in an invitation link.
//
// Three deliberate differences from the six-digit codes in auth-tokens.service.ts,
// all of which follow from a link being a different thing from a code:
//
//   1. It is 32 random bytes, not six digits. A code is protected by a per-address
//      attempt counter and a ten-minute life; a link has neither, and 10^6 is a few
//      seconds of guessing against an endpoint that must answer strangers.
//   2. It is base64url, so it survives being a path segment untouched.
//   3. It lives on the invitation row rather than in auth_tokens, because it
//      authorises joining an organisation rather than proving an address.
//
// Only the sha256 hash is stored - the same rule as auth_tokens, for the same reason:
// read access to the table must not let anyone accept somebody else's invitation.
// uq_user_invitations_token indexes the hash, so lookup is by hash, never by scan.

const TOKEN_BYTES = 32;

/** Days an invitation link stays good. Matches the template's `ttlDays` default. */
export const INVITE_TTL_DAYS = 7;

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface IssuedInvite {
  /** Plaintext. Goes in the link, is never stored, and cannot be recovered later. */
  token: string;
  token_hash: string;
  expires_at: Date;
}

export function issueInviteToken(ttlDays: number = INVITE_TTL_DAYS): IssuedInvite {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    token,
    token_hash: hashInviteToken(token),
    expires_at: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  };
}

/** The link we put in the mail. `webAppUrl` is already trailing-slash-free. */
export const inviteAcceptUrl = (webAppUrl: string, token: string): string =>
  `${webAppUrl}/invites/${token}`;
