import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { AuthProvider } from './lib/auth';
import { supabase } from './lib/supabase';
import { notificationHooks } from './lib/notification';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },

  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const keys = mutation.meta?.invalidate as
        | string[]
        | undefined;

      if (!keys?.length) {
        queryClient.invalidateQueries();
        return;
      }

      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];

          return (
            typeof k === 'string' &&
            keys.some(
              (key) =>
                k === key ||
                k.startsWith(key),
            )
          );
        },
      });
    },
  }),
});

function NotificationRealtimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  console.log(
    '[notifications] realtime provider mounted',
  );

  notificationHooks.useNotificationRealtime(
    supabase,
  );

  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NotificationRealtimeProvider>
          <App />
        </NotificationRealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);