import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { api, tokenStore } from './api';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Realtime is an enhancement: without it the notification bell stops updating
// on its own and the feed refreshes when a page does. Everything else in the
// product - championships, scoring, certificates, the whole workspace - has no
// dependency on it at all.
//
// So the missing-config path must not throw. This module is imported by main.tsx
// and by the auth provider, which is to say at the very root of the render tree:
// a throw here is not a broken bell, it is a WHITE PAGE with a console error, and
// nothing else in the app gets a chance to load. Degrading instead means a
// developer without Supabase credentials still gets a working application, and
// the one feature that genuinely needs them says so.
export const realtimeConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

if (!realtimeConfigured && import.meta.env.DEV) {
  console.warn(
    '[notifications] Realtime is off: set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local to enable live ' +
      'notification delivery. The rest of the app is unaffected.',
  );
}

// Refetch this many ms before the token's real expiry, so a long-open tab
// never actually presents an expired token to Realtime and loses its
// connection. Tokens are minted with a 15-minute TTL server-side
// (realtime-token.ts) - refreshing 2 minutes early leaves comfortable margin.
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

let tokenCache: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

// Passed to Supabase as the `accessToken` option below. The client calls
// this repeatedly over the life of the app (not just once at startup) and
// automatically pushes whatever it returns to Realtime to keep the
// connection authorized - see the token-refresh explanation for why this
// pattern (vs. a one-time token) is what actually solves the expiry problem.
//
// Per Supabase's docs this function "may be called concurrently and many
// times" - the cache + in-flight guard below avoid hammering the backend
// on every call while still always returning a token with real time left.
async function fetchRealtimeToken(): Promise<string | null> {
  // Nobody is signed in yet - on the login screen, or on a cold load before the
  // stored session is read. Asking for a token here can only 401, and a request
  // whose sole outcome is an error in everyone's console is worth not making.
  if (!tokenStore.get()) {
    tokenCache = null;
    return null;
  }

  const now = Date.now();

  if (tokenCache && tokenCache.expiresAt - now > REFRESH_BUFFER_MS) {
    return tokenCache.token;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    try {
      const result = await api<{
        token: string;
        expires_at: number;
      }>('POST', '/notifications/realtime-token');

      tokenCache = {
        token: result.token,
        // expires_at from the server is in seconds; store as ms to match Date.now().
        expiresAt: result.expires_at * 1000,
      };

      return result.token;
    } catch {
      // Not authenticated yet, or the request failed - Realtime simply has
      // no valid token until the next successful call. Not fatal: the
      // subscription in realtime.ts already handles reconnect/backoff.
      tokenCache = null;
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * `null` when Realtime is not configured. Callers must handle that - which is
 * two call sites, both of them notification delivery, and both a no-op without
 * a client.
 */
export const supabase: SupabaseClient | null = realtimeConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      accessToken: fetchRealtimeToken,
    })
  : null;