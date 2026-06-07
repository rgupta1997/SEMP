import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // staleTime 0 (default) + refetch-on-mount means navigating to a screen always
    // pulls fresh data; refetch on focus keeps a left-open tab current.
    queries: { retry: false, refetchOnWindowFocus: true },
  },
  // Refresh data after EVERY successful mutation — done globally so it fires even
  // when the component that triggered it has already navigated away (e.g. the match
  // console signs off then immediately returns to "My matches"). A mutation may
  // narrow the scope via meta.invalidate; otherwise everything is refreshed.
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const keys = mutation.meta?.invalidate as string[] | undefined;
      if (keys?.length) keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      else queryClient.invalidateQueries();
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
