import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { AuthProvider } from './lib/auth';
import { useAuth } from './lib/auth';
import { notificationTransport } from './lib/realtime';
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
  const { ctx } = useAuth();

  // Must sit inside AuthProvider (it reads ctx) and above App, so exactly one
  // subscription exists per signed-in tab rather than one per screen that happens
  // to show the bell. `notificationTransport` is a module singleton - the hook's
  // effect depends on that reference, so anything less stable would rebuild a
  // WebSocket on every render.
  notificationHooks.useNotificationRealtime(
    notificationTransport,
    ctx?.user.id,
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
