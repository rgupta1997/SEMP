import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { Button, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Skeleton, SortDirButton, StatusBadge } from '../../components/ui';

// Placeholder grid shown while championships load.
function EventGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="h-24 w-full" rounded="rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}

interface Championship { id: string; name: string; slug: string; status: string; venue?: string; start_date: string; end_date: string; description?: string }

const STATUS_FILTERS = ['all', 'draft', 'registration_open', 'ongoing', 'completed', 'cancelled'];

export function EventsListPage() {
  const navigate = useNavigate();
  const { data: championships = [], isLoading } = useApi<Championship[]>('/championships');
  const [status, setStatus] = useState('all');

  const filtered = useMemo(
    () => (status === 'all' ? championships : championships.filter((e) => e.status === status)),
    [championships, status],
  );

  const t = useTableControls(filtered, {
    search: (e) => `${e.name} ${e.venue ?? ''} ${e.description ?? ''}`,
    sorts: {
      name: (a, b) => a.name.localeCompare(b.name),
      start: (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
      status: (a, b) => a.status.localeCompare(b.status),
    },
    initialSort: 'start',
    initialDir: 'desc',
    pageSize: 9,
  });

  return (
    <div>
      <PageHeader title="Championships" subtitle="Every championship you organise, from draft to wrapped up.">
        <Button onClick={() => navigate('/championships/new')}>+ Create Event</Button>
      </PageHeader>

      {isLoading ? <EventGridSkeleton /> : championships.length === 0 ? (
        <EmptyState icon="◆" title="No championships yet" description="Create your first championship to build tournaments, open registration and run match day."
          action={<Button onClick={() => navigate('/championships/new')}>+ Create Event</Button>} />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search championships…" className="w-full sm:w-72" />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : titleCase(s)}</option>)}
            </Select>
            <Select value={t.sortKey} onChange={(e) => t.setSortKey(e.target.value)} className="w-auto">
              <option value="start">Sort: Date</option>
              <option value="name">Sort: Name</option>
              <option value="status">Sort: Status</option>
            </Select>
            <SortDirButton dir={t.dir} onToggle={() => t.setDir(t.dir === 'asc' ? 'desc' : 'asc')} />
          </ListToolbar>

          {t.total === 0 ? (
            <EmptyState icon="◆" title="No matching championships" description="Try a different search or status filter." />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {t.view.map((e) => (
                  <Card key={e.id} className="cursor-pointer transition hover:border-brand-300 dark:hover:border-brand-500/50 hover:shadow-md" onClick={() => navigate(`/championships/${e.id}`)}>
                    <div className="flex h-24 items-end justify-between rounded-t-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4">
                      <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20 text-xl font-black text-white">
                        {e.name.slice(0, 1)}
                      </span>
                      <StatusBadge status={e.status} />
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">{e.name}</h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{e.venue || 'Venue TBD'} · {fmtDateRange(e.start_date, e.end_date)}</p>
                      {e.description && <p className="mt-2 line-clamp-2 text-sm text-slate-400 dark:text-slate-500">{e.description}</p>}
                    </div>
                  </Card>
                ))}
              </div>
              <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}
