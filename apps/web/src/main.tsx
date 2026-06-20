import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Keep recently-loaded data for 30s so navigating between screens (and back)
    // serves the cache instantly instead of blocking on a refetch every time;
    // anything older refetches quietly in the background while the cached view
    // shows. Mutations still invalidate the relevant keys immediately (below), so
    // edits are reflected at once. Master data is cached far longer (see useApi).
    //
    // refetchOnWindowFocus is OFF on purpose: re-focusing the tab (which includes
    // clicking into DevTools and back) must NOT refetch every active query — on a
    // setup page that's dozens of revalidations for nothing. Data still refreshes
    // when you navigate to a page (and it's stale) and after any mutation, which is
    // all that's actually needed.
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
  // Refresh data after EVERY successful mutation — done globally so it fires even
  // when the component that triggered it has already navigated away (e.g. the match
  // console signs off then immediately returns to "My matches"). A mutation may
  // narrow the scope via meta.invalidate; otherwise everything is refreshed.
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, mutation) => {
      const keys = mutation.meta?.invalidate as string[] | undefined;
      if (!keys?.length) { queryClient.invalidateQueries(); return; }
      // Match by path PREFIX, not exact key, so invalidating a base path (e.g.
      // '/disciplines') also refreshes its parameterized reads
      // ('/disciplines?sport_id=…') and sub-paths. This is what keeps the
      // aggressively-cached master data correct after any add/edit/delete.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === 'string' && keys.some((key) => k === key || k.startsWith(key));
        },
      });
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
