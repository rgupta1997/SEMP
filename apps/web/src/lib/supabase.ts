import { createClient } from '@supabase/supabase-js';

import { api } from './api';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not configured');
}

if (!supabasePublishableKey) {
  throw new Error(
    'VITE_SUPABASE_PUBLISHABLE_KEY is not configured',
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

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    accessToken: fetchRealtimeToken,
  },
);