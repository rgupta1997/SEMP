import type {
  NotificationRealtimeTransport,
  NotificationRealtimeTeardown,
  NotificationRealtimeOptions,
} from '@semp/notifications/client/realtime.js';

import { api, tokenStore } from './api';

// Live notification delivery over AppSync Events. Replaces Supabase Realtime, which
// read Supabase's own Postgres WAL and so could not survive the move to RDS.
//
// ---------------------------------------------------------------------------
// NOTHING IN THIS MODULE MAY THROW AT IMPORT TIME.
// ---------------------------------------------------------------------------
// Realtime is an enhancement: without it the notification bell stops updating the
// instant something happens and falls back to its 2-minute poll. Everything else in
// the product - championships, scoring, certificates, the whole workspace - has no
// dependency on it at all.
//
// This module is imported by main.tsx and by the auth provider, which is to say at
// the very root of the render tree. A throw here is not a broken bell, it is a WHITE
// PAGE with a console error, and nothing else in the app gets a chance to load. So
// every failure path below degrades to "no live delivery" instead.
//
// Note what is NOT here: any VITE_ variable. The endpoint, region and channel all
// come from the response to POST /notifications/realtime-token. Vite inlines env
// vars at BUILD time, so a VITE_ endpoint would need a frontend rebuild every time
// the stack is replaced - and would silently point at a dead endpoint until someone
// remembered. infra/semp-api.yaml's own comment on VITE_API_URL describes living
// with exactly that. Here there is nothing to forget.

/**
 * Refetch this many ms before the token's real expiry, so a long-open tab never
 * presents an expired token and loses its connection. Tokens are minted with a
 * 15-minute TTL server-side (REALTIME_TOKEN_TTL_SECONDS) - refreshing 2 minutes
 * early leaves comfortable margin.
 */
const REFRESH_BUFFER_MS = 2 * 60 * 1000;

interface RealtimeGrant {
  token: string;
  /** ms, to compare against Date.now(). */
  expiresAt: number;
  endpoint: string;
  region: string;
  channel: string;
}

let grantCache: RealtimeGrant | null = null;
let inflight: Promise<RealtimeGrant | null> | null = null;
let warnedUnconfigured = false;

/**
 * Fetch (or reuse) a grant: the token plus everything needed to connect with it.
 *
 * Per the old Supabase implementation's notes, this may be called concurrently and
 * many times, so the cache and the in-flight guard below avoid hammering the backend
 * while still always returning a token with real time left on it.
 */
export async function fetchRealtimeGrant(): Promise<RealtimeGrant | null> {
  // Nobody is signed in yet - on the login screen, or on a cold load before the
  // stored session is read. Asking for a token here can only 401, and a request
  // whose sole outcome is an error in everyone's console is worth not making.
  if (!tokenStore.get()) {
    grantCache = null;
    return null;
  }

  const now = Date.now();

  if (grantCache && grantCache.expiresAt - now > REFRESH_BUFFER_MS) {
    return grantCache;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const result = await api<{
        token: string;
        expires_at: number;
        endpoint?: string;
        region?: string;
        channel: string;
      }>('POST', '/notifications/realtime-token');

      // The server is the one that decides whether live delivery is on at all
      // (REALTIME_TRANSPORT). No endpoint means it is off - a normal, supported
      // state, not an error: the bell keeps working on its poll.
      if (!result.endpoint || !result.region) {
        if (import.meta.env.DEV && !warnedUnconfigured) {
          warnedUnconfigured = true;
          console.warn(
            '[notifications] live delivery is off: the API returned no AppSync ' +
              'endpoint. Set REALTIME_TRANSPORT=appsync and its companions in the ' +
              'API environment to enable it. The rest of the app is unaffected.',
          );
        }
        grantCache = null;
        return null;
      }

      grantCache = {
        token: result.token,
        // expires_at from the server is in seconds; store ms to match Date.now().
        expiresAt: result.expires_at * 1000,
        endpoint: result.endpoint,
        region: result.region,
        // The CHANNEL comes from the server too. The client never builds a channel
        // path: it is told which one it may listen on, the AppSync authorizer
        // independently enforces the same rule, and so a bug here can at worst
        // produce a rejected subscribe rather than a subscription to someone
        // else's notifications.
        channel: result.channel,
      };

      return grantCache;
    } catch {
      // Not authenticated yet, or the request failed. Live delivery simply has no
      // grant until the next successful call; the session loop below retries with
      // backoff. Never rethrown - see the white-page note at the top.
      grantCache = null;
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Drops the cached grant. Called on sign-out. */
export function clearRealtimeToken(): void {
  grantCache = null;
}

/**
 * Called when the session changes - sign-in, sign-up, session adoption, refresh.
 *
 * Replaces Supabase's `realtime.setAuth()` and occupies the exact same position in
 * auth.tsx, which matters: the comments there describe a real race, where
 * applyContext() sets ctx.user and immediately triggers the hook's first subscribe,
 * racing the token fetch, so any event in that window was silently missed.
 *
 * This provides a STRONGER guarantee than setAuth() did. It discards the previous
 * session's grant (so a new subscribe cannot present a stale token) and then warms
 * the cache, so the subscribe that follows is a cache hit - a microtask rather than
 * a network round trip.
 *
 * MUST NOT REJECT. It sits on an `await` inside refresh(), which runs in the auth
 * provider's mount effect; a rejection there lands in the catch that clears
 * tokenStore and bounces a perfectly good session to the login page.
 */
export async function realtimeAuthChanged(): Promise<void> {
  grantCache = null;
  liveSessions.forEach((reconnect) => reconnect());
  try {
    await fetchRealtimeGrant();
  } catch {
    // fetchRealtimeGrant already swallows everything; this is belt and braces
    // because of what a rejection here would do (see above).
  }
}

/** Sessions that want to be told when auth changed under them. */
const liveSessions = new Set<() => void>();

/**
 * The re-subscribe cycle - the part that keeps a long-open tab connected.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, and why it is not optional.
 * ---------------------------------------------------------------------------
 * Supabase's client took an `accessToken` CALLBACK and called it repeatedly over the
 * connection's life, which is what made a 15-minute TTL safe for a tab open all day.
 * Amplify's events client does not do that: it captures a token at connect time.
 * AppSync separately closes the connection when the authorizer's cached decision
 * expires. So the naive implementation does this:
 *
 *   minute 0   connect, fine
 *   minute 15  AppSync closes the connection on TTL
 *              Amplify reconnects with the SAME captured, now-expired token
 *              the authorizer refuses it, backoff, refuse, backoff...
 *              the bell is dead and nothing in the UI says so
 *
 * Every smoke test finishes inside fifteen minutes, which is precisely why that
 * reaches production. So the cycle below re-connects on OUR schedule, comfortably
 * before the token expires, making the connection structurally incapable of
 * outliving the credential behind it. One extra connect per ~13 minutes per tab is
 * negligible against connection-minute billing.
 */
function createSession(
  options: NotificationRealtimeOptions,
): NotificationRealtimeTeardown {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let channel: { close(): void } | null = null;
  let attempt = 0;

  const closeChannel = () => {
    // The connection may still be a pending promise when teardown runs - React
    // effect cleanups are synchronous and StrictMode double-invokes, so this is the
    // common case on the very first mount, not an edge case. `cancelled` is what
    // the async body checks; this just closes whatever already exists.
    try {
      channel?.close();
    } catch {
      // A close() on a socket that never opened is not worth a console entry.
    }
    channel = null;
  };

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void cycle(), ms);
  };

  const cycle = async (): Promise<void> => {
    if (cancelled) return;

    closeChannel();

    const grant = await fetchRealtimeGrant();
    if (cancelled) return;

    if (!grant) {
      // Signed out, or live delivery is off server-side. Do nothing and do not
      // retry in a tight loop - realtimeAuthChanged() wakes this up when a session
      // appears. The poll covers the gap either way.
      return;
    }

    try {
      const { connectChannel } = await import('./realtime-appsync');
      if (cancelled) return;

      const opened = await connectChannel({
        endpoint: grant.endpoint,
        region: grant.region,
        channel: grant.channel,
        authToken: grant.token,
        onMessage: options.onNotification,
        // A transport-level error means this connection is finished; rebuild it
        // rather than waiting for the scheduled cycle.
        onError: () => {
          if (!cancelled) schedule(backoffMs(++attempt));
        },
      });

      if (cancelled) {
        // Opened after teardown. Close it immediately or it lives on as a billed,
        // unreachable socket.
        opened.close();
        return;
      }

      channel = opened;
      attempt = 0;

      // Re-connect before the token expires, never after.
      const lifetime = grant.expiresAt - Date.now() - REFRESH_BUFFER_MS;
      schedule(Math.max(lifetime, 30_000));
    } catch {
      // Connect failed - network, authorizer, or a cold Lambda. Back off; never
      // throw out of here.
      if (!cancelled) schedule(backoffMs(++attempt));
    }
  };

  const reconnect = () => {
    attempt = 0;
    schedule(0);
  };

  liveSessions.add(reconnect);
  void cycle();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    liveSessions.delete(reconnect);
    closeChannel();
  };
}

/** Capped exponential backoff with jitter. Mirrors the shape used in lib/api.ts. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 30_000);
  return base + Math.floor(Math.random() * 500);
}

/**
 * The singleton the hook receives.
 *
 * A module singleton, deliberately: useNotificationRealtime's effect depends on this
 * reference, so anything less stable would rebuild a WebSocket on every render.
 *
 * Never null. Whether live delivery is actually available is discovered at runtime
 * from the mint response rather than known at build time, which is what removes the
 * whole class of "the endpoint was baked into a stale bundle" failure.
 */
export const notificationTransport: NotificationRealtimeTransport = {
  subscribe: createSession,
};
