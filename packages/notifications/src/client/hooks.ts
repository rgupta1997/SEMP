import { useEffect } from 'react';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  createNotificationClient,
  type NotificationRequest,
} from './api.js';

import type { NotificationRealtimeTransport } from './realtime.js';

// See useUnreadCount for why this exists and why it is 2 minutes rather than 30s.
const UNREAD_POLL_MS = 120_000;

// Upper bound on the random delay before a push-triggered refetch.
export const NOTIFICATION_REFETCH_JITTER_MS = 2_000;

/**
 * Delays a push-triggered refetch by a random interval, collapsing anything that
 * arrives in the meantime into the same one.
 *
 * ---------------------------------------------------------------------------
 * A throughput guard, not politeness.
 * ---------------------------------------------------------------------------
 * A championship-wide notification pings every recipient's open tab at the same
 * instant. Refetching immediately means N simultaneous requests against an HTTP API
 * throttled at 25 req/s with a burst of 50 (DefaultRouteSettings in
 * infra/semp-api.yaml) - so a single all-hands announcement 429s itself, and the
 * larger the audience the more certainly it fails. That is exactly backwards.
 * Spreading the same requests over a couple of seconds turns the spike into a queue.
 *
 * The coalescing half matters because the transport carries no payload: two pings a
 * moment apart are two notifications, but one refetch answers both, and there is
 * nothing a second request would learn that the first did not.
 *
 * Cost: up to ~2s of added latency on a notification sent to one person. Against the
 * 120s poll that is still unambiguously live.
 *
 * Extracted as a plain function so it can be tested with fake timers and no DOM -
 * this behaviour only misbehaves under load, which is the hardest kind to notice.
 */
export function createRefetchCoalescer(
  run: () => void,
  delayMs: number = NOTIFICATION_REFETCH_JITTER_MS,
  random: () => number = Math.random,
) {
  let pending: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(): void {
      if (pending) return; // already queued - coalesce
      pending = setTimeout(() => {
        pending = null;
        run();
      }, random() * delayMs);
    },
    cancel(): void {
      if (pending) clearTimeout(pending);
      pending = null;
    },
  };
}

export function createNotificationHooks(
  request: NotificationRequest,
) {
  const client = createNotificationClient(request);

  // `enabled` gates the query (e.g. only fetch while a drawer/panel is open)
  // and is stripped before it's used as part of the query key or sent to the client.
  function useNotificationFeed(params?: {
    championshipId?: string;
    unread?: boolean;
    take?: number;
    enabled?: boolean;
  }) {
    const { enabled = true, ...feedParams } = params ?? {};

    return useQuery({
      queryKey: ['notifications', 'feed', feedParams],
      queryFn: () => client.getFeed(feedParams),
      enabled,
    });
  }

  // The badge's safety net.
  //
  // Live delivery (useNotificationRealtime below) is the fast path, and when it
  // works this interval never shows a change anyone notices. It exists for when
  // it does NOT work: a transport that drops a message, a socket that dies
  // without reconnecting, a misconfigured deploy. All of those fail SILENTLY -
  // the bell simply stops counting and nothing anywhere reports an error - so
  // without a poll the only thing standing between a broken transport and a
  // feature that is quietly dead for everyone is somebody noticing.
  //
  // This makes that failure "the badge is up to two minutes late" instead. It is a
  // safety net, not the mechanism, so it should bound worst-case staleness rather
  // than imitate push - and the interval is not free: API Gateway throttles the
  // whole API at 25 req/s (DefaultRouteSettings in infra/semp-api.yaml), shared with
  // every other request the app makes. At 60s, 500 signed-in users would spend a
  // third of that budget on a query that normally finds nothing; 120s makes it a
  // sixth. The query itself is cheap either way - a cursor-based range scan against
  // notification_deliveries (see the API's cursor.ts), not an anti-join.
  //
  // refetchOnWindowFocus overrides the app-wide `false` in main.tsx for this one
  // query: a backgrounded tab is exactly where a socket dies unnoticed, so coming
  // back to it is the moment a stale badge is most likely and most visible.
  function useUnreadCount() {
    return useQuery({
      queryKey: ['notifications', 'unread-count'],
      queryFn: () => client.getUnreadCount(),
      refetchInterval: UNREAD_POLL_MS,
      refetchOnWindowFocus: true,
    });
  }

  function useMarkNotificationRead() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: (notificationId: string) =>
        client.markRead(notificationId),

      // Without this, the app-wide MutationCache.onSuccess fallback in
      // main.tsx sees no meta.invalidate and calls invalidateQueries()
      // with NO filter - refetching every active query in the whole app
      // (dashboard, postable-championships, everything), not just this
      // notification family. This scopes that fallback down to just
      // queries whose key starts with 'notifications'.
      meta: { invalidate: ['notifications'] },

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      },
    });
  }

  function useMarkAllNotificationsRead() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: () => client.markAllRead(),

      // See useMarkNotificationRead above - scopes the global
      // MutationCache fallback to the notification family only.
      meta: { invalidate: ['notifications'] },

      // onSuccess: () => {
      //   // Only the feed's per-item read state changes here - the badge
      //   // count is markSeen's job (see useMarkNotificationsSeen below).
      //   // Both fire together on drawer-open; invalidating 'notifications'
      //   // (prefix-matches unread-count too) here as well as there caused
      //   // two redundant unread-count refetches back to back.
      //   queryClient.invalidateQueries({
      //     queryKey: ['notifications', 'feed'],
      //   });
      // },
    });
  }

  // Updates the cursor (last_seen_at) only - drives the badge count.
  // Kept as its own mutation, separate from useMarkAllNotificationsRead,
  // which writes per-item notification_reads rows for feed-list state.
  function useMarkNotificationsSeen() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: () => client.markSeen(),

      // See useMarkNotificationRead above - scopes the global
      // MutationCache fallback to the notification family only.
      meta: { invalidate: ['notifications'] },

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications', 'unread-count'],
        });
      },
    });
  }

  function useSendNotification() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: (input: {
        championshipId?: string;
        organizationId?: string;
        teamId?: string;
        userId?: string;
        audience: unknown;
        title: string;
        body?: string;
      }) => client.sendManual(input),

      // See useMarkNotificationRead above - scopes the global
      // MutationCache fallback to the notification family only.
      meta: { invalidate: ['notifications'] },

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      },
    });
  }

  function useReactToNotification() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: ({
        notificationId,
        reaction,
      }: {
        notificationId: string;
        reaction: string;
      }) =>
        client.react(notificationId, reaction),

      // See useMarkNotificationRead above - scopes the global
      // MutationCache fallback to the notification family only.
      meta: { invalidate: ['notifications'] },

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      },
    });
  }

  function useNotificationRealtime(
    // Null when no transport is configured. Delivery is an enhancement, so the
    // absence of one is a no-op rather than an error - see the note at the top of
    // the web app's lib/realtime.ts for why that path must never throw.
    //
    // The reference must be STABLE. It is a module singleton in the web app, so this
    // is free today; constructed in a component or a useMemo with sloppy deps, this
    // effect would tear down and rebuild a WebSocket on every render, which AppSync
    // bills per connection-minute and per operation.
    transport: NotificationRealtimeTransport | null,
    userId: string | undefined,
  ) {
    const queryClient = useQueryClient();

    useEffect(() => {
      if (!userId || !transport) return;

      // Jittered and coalesced - see createRefetchCoalescer for why a push must
      // not refetch immediately.
      const coalescer = createRefetchCoalescer(() => {
        // Refresh the unread badge - only if something is actively observing
        // it, to avoid waking up unmounted queries.
        void queryClient.refetchQueries({
          queryKey: ['notifications', 'unread-count'],
          type: 'active',
        });

        // Prefix-invalidate everything else under the 'notifications' key -
        // covers the feed (['notifications', 'feed', ...]) and any other
        // notification-package query, mounted or not.
        void queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      });

      const teardown = transport.subscribe({
        userId,
        onNotification: () => coalescer.schedule(),
      });

      return () => {
        coalescer.cancel();
        teardown();
      };
    }, [transport, queryClient, userId]);
  }

  return {
    useNotificationFeed,
    useUnreadCount,
    useMarkNotificationRead,
    useMarkAllNotificationsRead,
    useMarkNotificationsSeen,
    useSendNotification,
    useReactToNotification,
    useNotificationRealtime,
  };
}