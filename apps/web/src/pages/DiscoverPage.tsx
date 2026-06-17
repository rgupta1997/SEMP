import { Link } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Spinner, StatusBadge } from '../components/ui';

interface Championship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
}

// Discover — every championship on the platform, open to any signed-in user.
export function DiscoverPage() {
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');

  const tc = useTableControls(championships, {
    search: (c) => `${c.name} ${c.venue ?? ''}`,
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
        </ListToolbar>
      )}
      {isLoading ? <Spinner /> : tc.total === 0 ? (
        <EmptyState icon="◈" title="No championships yet" description="When an organiser hosts a championship it will show up here." />
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
