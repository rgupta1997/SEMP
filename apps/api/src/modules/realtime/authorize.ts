import jwt from 'jsonwebtoken';
import { notificationChannelPath } from '@semp/notifications/core/channels.js';
import {
  REALTIME_TOKEN_AUDIENCE,
  REALTIME_TOKEN_ISSUER,
} from './token-key.js';

/**
 * The AppSync Events Lambda authorizer's decision, as a pure function.
 *
 * Pure, and separated from the Lambda entrypoint, because this is the code that
 * replaces the Postgres RLS policy that used to keep one user's notifications away
 * from another's. It is the only thing standing between per-user channels and a
 * cross-account leak, so it has to be testable exhaustively with no AWS, no network
 * and no mocks - see authorize.test.ts, which runs the whole hostile channel table.
 */

export type AppSyncAuthorizerOperation =
  | 'EVENT_CONNECT'
  | 'EVENT_SUBSCRIBE'
  | 'EVENT_PUBLISH';

export interface AppSyncAuthorizerEvent {
  authorizationToken?: string;
  requestContext?: {
    operation?: string;
    /** null on EVENT_CONNECT - the channel is not known at connect time. */
    channel?: string | null;
    channelNamespaceName?: string | null;
  };
}

export interface AppSyncAuthorizerResult {
  isAuthorized: boolean;
  handlerContext?: { userId: string };
  ttlOverride?: number;
}

const DENY: AppSyncAuthorizerResult = { isAuthorized: false };

export interface AuthorizeOptions {
  /** The DERIVED realtime key - never JWT_SECRET. See token-key.ts. */
  key: Buffer | string;
  /** Ceiling for ttlOverride; must not exceed the token TTL the API mints with. */
  maxTtlSeconds: number;
  /** Injectable so expiry behaviour is testable without fake timers. */
  nowSeconds?: number;
}

export function authorize(
  event: AppSyncAuthorizerEvent,
  opts: AuthorizeOptions,
): AppSyncAuthorizerResult {
  const token = event.authorizationToken;
  if (!token) return DENY;

  let claims: jwt.JwtPayload;
  try {
    // `algorithms` is NOT optional. Without it jsonwebtoken will honour whatever the
    // token's own header asks for, which is the algorithm-confusion hole: a token
    // claiming `alg: none` is accepted unsigned. Pinning it to the one algorithm we
    // ever mint with closes that.
    //
    // audience/issuer are checked HERE rather than read off the payload afterwards,
    // so a token minted for anything else - including a session token - is rejected
    // by the library rather than by a hand-rolled comparison someone can drop.
    const decoded = jwt.verify(token, opts.key, {
      algorithms: ['HS256'],
      audience: REALTIME_TOKEN_AUDIENCE,
      issuer: REALTIME_TOKEN_ISSUER,
    });
    if (typeof decoded === 'string') return DENY;
    claims = decoded;
  } catch {
    // Expired, forged, wrong audience, wrong key, malformed. All the same answer,
    // and deliberately no detail in the response: an authorizer that explains itself
    // to the caller is an oracle. The Lambda logs the reason; the client gets "no".
    return DENY;
  }

  const userId = claims.sub;
  if (typeof userId !== 'string' || userId.length === 0) return DENY;

  // Never outlive the token. The authorizer result is cached by AppSync on
  // (apiId, channel, operation, token), so a TTL longer than the token's remaining
  // life means an EXPIRED token keeps working for the rest of that window.
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const remaining = typeof claims.exp === 'number' ? claims.exp - now : 0;
  if (remaining <= 0) return DENY;
  const ttlOverride = Math.max(0, Math.min(remaining, opts.maxTtlSeconds));

  const operation = event.requestContext?.operation;

  if (operation === 'EVENT_CONNECT') {
    // The channel is null here by design - AppSync does not know it yet. A valid
    // token is the whole test; per-channel authority is decided on subscribe.
    return { isAuthorized: true, handlerContext: { userId }, ttlOverride };
  }

  if (operation === 'EVENT_SUBSCRIBE') {
    // ---------------------------------------------------------------------------
    // THE WILDCARD DEFENCE. Read before changing.
    // ---------------------------------------------------------------------------
    // AppSync permits wildcards in a subscribe request and hands the authorizer the
    // wildcard AS A LITERAL STRING. So `/notifications/*` arrives here verbatim, and
    // any check looser than equality lets it through:
    //
    //   channel.startsWith(prefix)        -> '/notifications/*' passes
    //   channel.includes(userId)          -> '/notifications/user/X/../Y' passes
    //   regex with an unanchored group    -> usually passes something
    //
    // and the result is one user receiving every user's notifications, with no
    // error, no log and no visible symptom. Exact equality against the single legal
    // string is the only check that cannot be fooled, and it costs nothing.
    //
    // Deliberately NOT normalising, lowercasing or decodeURIComponent-ing first:
    // every one of those turns a string that is not this user's channel into one
    // that might be. Whatever AppSync hands over either equals the one legal value
    // or it does not.
    return event.requestContext?.channel === notificationChannelPath(userId)
      ? { isAuthorized: true, handlerContext: { userId }, ttlOverride }
      : DENY;
  }

  // Publishing is AWS_IAM-only on the API, so only the publisher Lambda's signed
  // requests can reach it and this branch should be unreachable. Denying explicitly
  // rather than falling through means a template drift that flips publish to
  // AWS_LAMBDA fails closed instead of letting any signed-in browser forge pings to
  // anyone. Unknown operations take the same path: default-deny, never default-allow.
  return DENY;
}
