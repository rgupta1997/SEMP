import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge } from '../components/ui';

interface Championship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  sports?: string[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', registration_open: 'Registration open', ongoing: 'Live', completed: 'Completed',
};

// Discover — every championship on the platform, open to any signed-in user.
// Searchable and filterable by sport / status so the list never dumps everything.
export function DiscoverPage() {
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');
  const [sport, setSport] = useState('');
  const [status, setStatus] = useState('');

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of championships) for (const s of c.sports ?? []) set.add(s);
    return [...set].sort();
  }, [championships]);
  const statusOptions = useMemo(
    () => [...new Set(championships.map((c) => c.status))].sort(),
    [championships],
  );

  const filtered = useMemo(
    () => championships.filter((c) =>
      (!sport || (c.sports ?? []).includes(sport)) &&
      (!status || c.status === status)),
    [championships, sport, status],
  );

  const tc = useTableControls(filtered, {
    search: (c) => `${c.name} ${c.venue ?? ''} ${(c.sports ?? []).join(' ')}`,
    sorts: {
      start: (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
    },
    initialSort: 'start',
    pageSize: 12,
  });

  return (
    <div>
      <PageHeader title="Find your next game" subtitle="Championships, organizations & teams looking for players." />
      {championships.length > 0 && (
        <ListToolbar>
          <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search championships…" className="w-full sm:w-72" />
          <Select value={sport} onChange={(e) => setSport(e.target.value)} className="w-auto" aria-label="Filter by sport">
            <option value="">All sports</option>
            {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Filter by status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </Select>
        </ListToolbar>
      )}
      {isLoading ? <Spinner /> : tc.total === 0 ? (
        <EmptyState
          icon="◈"
          title={championships.length === 0 ? 'No championships yet' : 'No championships match'}
          description={championships.length === 0
            ? 'When an organiser hosts a championship it will show up here.'
            : 'Try a different sport, status or search term.'}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tc.view.map((c) => (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{c.name.slice(0, 1)}</span>
                  <StatusBadge status={c.status} />
                </div>
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{c.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}</p>
                {(c.sports ?? []).length > 0 && (
                  <p className="mt-2 truncate text-xs text-slate-400 dark:text-slate-500" title={(c.sports ?? []).join(', ')}>
                    {(c.sports ?? []).slice(0, 4).join(' · ')}{(c.sports ?? []).length > 4 ? ` +${(c.sports ?? []).length - 4}` : ''}
                  </p>
                )}
                <div className="mt-4 flex-1" />
                <Link to={`/championships/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">View details →</Link>
              </Card>
            ))}
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}
    </div>
  );
}
