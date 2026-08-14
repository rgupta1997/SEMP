import type {
  SupabaseClient,
  RealtimeChannel,
} from '@supabase/supabase-js';

export interface NotificationRealtimeOptions {
  userId: string;
  onNotification: () => void;
}

export function subscribeToNotifications(
  supabase: SupabaseClient,
  options: NotificationRealtimeOptions,
): RealtimeChannel {
  console.log(
    '[notifications realtime] creating channel',
  );

  const channel = supabase
    .channel(`notifications:${options.userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_deliveries',
        filter: `user_id=eq.${options.userId}`,
      },
      (payload) => {
        console.log(
          '[notifications realtime] INSERT received',
          payload,
        );

        options.onNotification();
      },
    );

  console.log(
    '[notifications realtime] subscribing to channel',
  );

  channel.subscribe((status, error) => {
    console.log(
      '[notifications realtime] status:',
      status,
      error,
    );
  });

  return channel;
}

export async function unsubscribeFromNotifications(
  supabase: SupabaseClient,
  channel: RealtimeChannel,
): Promise<void> {
  await supabase.removeChannel(channel);
}
