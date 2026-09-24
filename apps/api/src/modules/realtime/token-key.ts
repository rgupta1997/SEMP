import { hkdfSync } from 'node:crypto';

/**
 * The key that signs realtime tokens - DERIVED from JWT_SECRET, never JWT_SECRET.
 *
 * This is a security boundary, not a style choice. parseAuth() in
 * http/middleware/auth.ts verifies session tokens with `jwt.verify(token,
 * env.JWT_SECRET)` and passes NO audience option, so it accepts anything signed with
 * that secret. If the realtime token were signed with JWT_SECRET directly it would
 * verify there too: the mint endpoint would be handing out working API sessions.
 *
 * An `aud` claim alone does not fix that - the verifier has to be told to check it,
 * and a check someone must remember is a check that eventually goes missing. A
 * derived key makes cross-acceptance cryptographically impossible instead: a token
 * signed with this key produces an "invalid signature" against JWT_SECRET, and a
 * session token produces the same against this one. Both directions verified in
 * token-key.test.ts.
 *
 * HKDF over the existing secret rather than a new secret in AppSecret, deliberately:
 * provisioning secrets out of band is already a documented friction point in
 * infra/RUNBOOK-rds.md, and one more would be one more thing to forget on a deploy.
 *
 * The `info` string is versioned. Changing it rotates every realtime token without
 * touching sessions - which also means changing it casually signs everyone out of
 * live notifications until their next token refresh.
 */
const REALTIME_KEY_INFO = 'semp:appsync-events:v1';

export const REALTIME_TOKEN_AUDIENCE = 'appsync-events';
export const REALTIME_TOKEN_ISSUER = 'semp-api';

/**
 * Exported as ONE function because both sides must derive identically: the API mints
 * with it, the AppSync Lambda authorizer verifies with it. Two implementations of
 * the same derivation is a silent total outage the day they drift.
 */
export function realtimeSigningKey(jwtSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', jwtSecret, '', REALTIME_KEY_INFO, 32));
}
