import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './api';

// GET list/item with the path as the cache key.
export function useApi<T = any>(path: string | null, enabled = true) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api('GET', path as string),
    enabled: enabled && path !== null,
  });
}

// Mutation that refreshes the given query keys (paths) on success. Invalidation is
// declared via `meta` so the global MutationCache (main.tsx) performs it — that way
// it still runs if this component unmounts before the request resolves (e.g. an
// action that navigates away). An empty list means "refresh everything".
export function useApiMutation<TBody = any, TRes = any>(
  fn: (body: TBody) => Promise<TRes>,
  invalidate: (string | null)[] = [],
  onSuccess?: (res: TRes) => void,
) {
  return useMutation({
    mutationFn: fn,
    meta: { invalidate: invalidate.filter(Boolean) as string[] },
    onSuccess: (res) => { onSuccess?.(res); },
  });
}

// Client-side search + sort + pagination for list screens.
// `search(row)` returns the text to match the query against.
// `sorts` is a map of named comparators (ascending); direction is applied on top.
export interface TableControlsOpts<T> {
  search?: (row: T) => string;
  sorts?: Record<string, (a: T, b: T) => number>;
  initialSort?: string;
  initialDir?: 'asc' | 'desc';
  pageSize?: number;
}

export function useTableControls<T>(rows: T[], opts: TableControlsOpts<T> = {}) {
  const { search, sorts, initialSort = '', initialDir = 'asc', pageSize = 10 } = opts;
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(initialSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!search || !query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => search(r).toLowerCase().includes(q));
  }, [rows, query, search]);

  const sorted = useMemo(() => {
    const cmp = sorts?.[sortKey];
    if (!cmp) return filtered;
    const out = [...filtered].sort(cmp);
    return dir === 'desc' ? out.reverse() : out;
  }, [filtered, sorts, sortKey, dir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const view = useMemo(
    () => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [sorted, safePage, pageSize],
  );

  // Reset to the first page whenever the result count changes (search/filter applied).
  useEffect(() => { setPage(0); }, [query, total]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setDir('asc'); }
  };

  return {
    query, setQuery,
    sortKey, dir, toggleSort, setSortKey, setDir,
    page: safePage, setPage, pageCount, pageSize, total,
    view,
  };
}

export function fmtDate(d?: string | Date | null): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDateRange(a?: string | Date | null, b?: string | Date | null): string {
  if (!a || !b) return fmtDate(a) || fmtDate(b);
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
