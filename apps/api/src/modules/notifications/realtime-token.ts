import jwt from 'jsonwebtoken';
import { notificationChannelPath } from '@semp/notifications/core/channels.js';
import { env } from '../../config/env.js';
import {
  realtimeSigningKey,
  REALTIME_TOKEN_AUDIENCE,
  REALTIME_TOKEN_ISSUER,
} from '../realtime/token-key.js';

/**
 * Mints the short-lived token the browser presents to AppSync Events.
 *
 * Short-lived by design: it leaves this process, is handed to a third-party service,
 * and rides WebSocket handshakes, so it is the credential in this system most likely
 * to be observed somewhere it should not be. Fifteen minutes bounds that.
 *
 * ---------------------------------------------------------------------------
 * Signed with a DERIVED key, not env.JWT_SECRET. This is the whole point.
 * ---------------------------------------------------------------------------
 * parseAuth() verifies session tokens with `jwt.verify(token, env.JWT_SECRET)` and
 * passes no audience option, so it accepts anything signed with that secret. Sign
 * this token with JWT_SECRET and the mint endpoint is handing out working API
 * sessions - which would defeat the short lifetime entirely, since the blast radius
 * of a leak stops being "someone sees notification ids" and becomes "someone is
 * signed in as that user". See modules/realtime/token-key.ts, and the paired guard
 * in parseAuth that also rejects any token carrying an `aud`.
 *
 * The previous implementation signed with SUPABASE_JWT_SECRET so that Supabase
 * Realtime's RLS check could resolve auth.uid(). That secret is gone: RLS is no
 * longer what enforces per-user isolation - the AppSync Lambda authorizer is.
 */
export function mintRealtimeToken(userId: string): {
  token: string;
  expires_at: number;
  endpoint: string | undefined;
  region: string | undefined;
  channel: string;
} {
  const ttl = env.REALTIME_TOKEN_TTL_SECONDS;

  const token = jwt.sign({ sub: userId }, realtimeSigningKey(env.JWT_SECRET), {
    algorithm: 'HS256',
    audience: REALTIME_TOKEN_AUDIENCE,
    issuer: REALTIME_TOKEN_ISSUER,
    expiresIn: ttl,
  });

  return {
    token,
    // Seconds, matching the client's expectation - it refreshes two minutes early.
    expires_at: Math.floor(Date.now() / 1000) + ttl,

    // The endpoint and the channel come from the SERVER, deliberately.
    //
    // The endpoint could have been a VITE_ constant, but Vite inlines those at build
    // time: the frontend would then need a rebuild every time the stack is replaced,
    // and would silently point at a dead endpoint until someone remembered. The
    // stack-output comment on VITE_API_URL in infra/semp-api.yaml describes living
    // with exactly that.
    //
    // The channel is server-side because the client has no business deciding which
    // channel it may listen on. It is told, the authorizer independently enforces
    // the same rule, and a client-side bug can at worst produce a rejected subscribe
    // rather than a subscription to somebody else's notifications.
    // Assembled, not passed through. Amplify's events client requires exactly
    // `https://<host>/event` and derives the wss:// URL from it - see the comment on
    // APPSYNC_EVENTS_HTTP_ENDPOINT in config/env.schema.ts for what happens when
    // this shape is wrong, which is "nothing, silently".
    endpoint: env.APPSYNC_EVENTS_HTTP_ENDPOINT
      ? `https://${env.APPSYNC_EVENTS_HTTP_ENDPOINT}/event`
      : undefined,
    region: env.APPSYNC_EVENTS_REGION,
    channel: notificationChannelPath(userId),
  };
}
