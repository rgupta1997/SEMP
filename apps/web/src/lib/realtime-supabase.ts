import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import type { OpenChannel } from './realtime-appsync';

// The ONLY file in this repo that imports @supabase/supabase-js - the Supabase twin of
// realtime-appsync.ts, used where the API says REALTIME_TRANSPORT=supabase (beta, whose
// database is Supabase). Reached only through `await import('./realtime-supabase')` in
// lib/realtime.ts, so a deploy on AppSync never downloads it; architecture.test.ts
// enforces both.
//
// Delivery is the same PING as AppSync: an INSERT into notification_deliveries for this
// user wakes the feed, which re-fetches. RLS (user_id = auth.uid()) decides who receives
// which row, using the token the API minted with the project's JWT secret.

interface ConnectInput {
  url: string;
  /** The project's publishable (anon) key - public by design. */
  key: string;
  /** The user id to filter on, as the server gave it. */
  channel: string;
  authToken: string;
  onMessage: () => void;
  onError: () => void;
}

let client: SupabaseClient | null = null;
let clientFor: string | null = null;
let currentToken: string | null = null;

// One client per project. The token is read through `accessToken` on every (re)connect,
// so a fresh grant only needs `currentToken` updated - lib/realtime.ts reconnects before
// each token expires, exactly as it does for AppSync.
function clientOf(url: string, key: string): SupabaseClient {
  if (client && clientFor === `${url}|${key}`) return client;
  client = createClient(url, key, {
    accessToken: async () => currentToken,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clientFor = `${url}|${key}`;
  return client;
}

/** Open the user's channel; resolves once Supabase confirms the subscription. */
export async function connectChannel(input: ConnectInput): Promise<OpenChannel> {
  currentToken = input.authToken;
  const sb = clientOf(input.url, input.key);
  try {
    await sb.realtime.setAuth(input.authToken);
  } catch {
    // An older socket may refuse the push; the subscribe below presents the token anyway.
  }

  const channel: RealtimeChannel = sb
    .channel(`notifications:${input.channel}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notification_deliveries', filter: `user_id=eq.${input.channel}` },
      () => input.onMessage(),
    );

  let opened = false;
  // Our own close() also reports CLOSED; that is not an error to reconnect from.
  let closing = false;
  try {
    await new Promise<void>((resolve, reject) => {
      // Same 10s bound as the AppSync ACK: a socket that never answers must not hang the session.
      const timer = setTimeout(() => reject(new Error('subscribe timed out')), 10_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          opened = true;
          clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          // Before it opened this is a failed connect; after, the connection is finished.
          if (opened) { if (!closing) input.onError(); }
          else reject(new Error(`subscribe ${status.toLowerCase()}`));
        }
      });
    });
  } catch (err) {
    closing = true;
    void sb.removeChannel(channel);
    throw err;
  }

  return {
    close: () => { closing = true; void sb.removeChannel(channel); },
  };
}
