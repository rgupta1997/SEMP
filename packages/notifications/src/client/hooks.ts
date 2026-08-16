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

import {
  subscribeToNotifications,
  unsubscribeFromNotifications,
} from './realtime.js';

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

  function useUnreadCount() {
    return useQuery({
      queryKey: ['notifications', 'unread-count'],
      queryFn: () => client.getUnreadCount(),
    });
  }

  function useMarkNotificationRead() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: (notificationId: string) =>
        client.markRead(notificationId),

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

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      },
    });
  }

  // Updates the cursor (last_seen_at) only - drives the badge count.
  // Kept as its own mutation, separate from useMarkAllNotificationsRead,
  // which writes per-item notification_reads rows for feed-list state.
  function useMarkNotificationsSeen() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: () => client.markSeen(),

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

      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ['notifications'],
        });
      },
    });
  }

  function useNotificationRealtime(
    supabase: Parameters<
      typeof subscribeToNotifications
    >[0],
    userId: string | undefined,
  ) {
    const queryClient = useQueryClient();

    useEffect(() => {
      if (!userId) return;

      const channel = subscribeToNotifications(
        supabase,
        {
          userId,
          onNotification: () => {
            // Refresh the unread badge immediately - only if something is
            // actively observing it, to avoid waking up unmounted queries.
            void queryClient.refetchQueries({
              queryKey: ['notifications', 'unread-count'],
              type: 'active',
            });

            // Prefix-invalidate everything else under the 'notifications'
            // key - covers the feed (['notifications', 'feed', ...]) and
            // any other notification-package query, mounted or not.
            void queryClient.invalidateQueries({
              queryKey: ['notifications'],
            });
          },
        },
      );

      return () => {
        void unsubscribeFromNotifications(
          supabase,
          channel,
        );
      };
    }, [supabase, queryClient, userId]);
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