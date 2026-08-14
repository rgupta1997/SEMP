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

  function useNotificationFeed(params?: {
    championshipId?: string;
    unread?: boolean;
  }) {
    return useQuery({
      queryKey: ['notifications', 'feed', params],
      queryFn: () => client.getFeed(params),
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
  ) {
    const queryClient = useQueryClient();

    useEffect(() => {
      const channel = subscribeToNotifications(
        supabase,
        {
          onNotification: () => {
            // Refresh the unread badge immediately.
            void queryClient.refetchQueries({
              queryKey: ['/notifications/unread-count'],
              type: 'active',
            });

            // Refresh the existing notification feed.
            void queryClient.invalidateQueries({
              queryKey: ['/notifications?take=15'],
            });

            // Refresh notification package queries.
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
    }, [supabase, queryClient]);
  }

  return {
    useNotificationFeed,
    useUnreadCount,
    useMarkNotificationRead,
    useMarkAllNotificationsRead,
    useSendNotification,
    useReactToNotification,
    useNotificationRealtime,
  };
}