import { useEffect, useSyncExternalStore } from 'react';

// A page can put its own title in the top bar (AppShell) instead of a large heading
// on the page itself. Unset, the top bar shows the workspace name as before.

let current: string | null = null;
const listeners = new Set<() => void>();
const set = (t: string | null) => { current = t; listeners.forEach((l) => l()); };

/** Show `title` in the top bar while this page is mounted. Null does nothing, so a
 *  nested component that does not set one never clears its page's. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    set(title);
    return () => set(null);
  }, [title]);
}

/** The title a page asked for, or null - read by the top bar. */
export function useShellTitle(): string | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
  );
}
