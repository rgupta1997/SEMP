import { useApi, useTableControls } from '../../lib/hooks';
import { Card, ListToolbar, Spinner, Badge, Pagination, SearchInput, cn } from '../../components/ui';

const STATUS_VARIANTS: Record<string, string> = {
  draft: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
  registration_open: 'bg-amber-100 text-amber-700 dark:text-amber-300',
  ongoing: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-sky-100 text-sky-700',
};

export function PlatformOverview() {
  const { data: championships, isLoading } = useApi<any[]>('/championships');
  const list = championships ?? [];
  const t = useTableControls(list, {
    search: (e) => `${e.name ?? ''} ${e.city ?? ''} ${e.status ?? ''}`,
    sorts: {
      name: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
      status: (a, b) => String(a.status ?? '').localeCompare(String(b.status ?? '')),
      start: (a, b) => new Date(a.start_date ?? 0).getTime() - new Date(b.start_date ?? 0).getTime(),
    },
    initialSort: 'start',
    initialDir: 'desc',
    pageSize: 15,
  });

  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const sortIc = (k: string) => (t.sortKey === k ? (t.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Platform Overview</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">Read-only view of all championships across the platform</p>
      </div>
      {list.length > 0 && (
        <ListToolbar>
          <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search championships…" className="w-full sm:w-72" />
        </ListToolbar>
      )}

      {list.length > 0 ? (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300"><button type="button" onClick={() => t.toggleSort('name')} className="hover:text-slate-900">Championship{sortIc('name')}</button></th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300"><button type="button" onClick={() => t.toggleSort('status')} className="hover:text-slate-900">Status{sortIc('status')}</button></th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Location</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300"><button type="button" onClick={() => t.toggleSort('start')} className="hover:text-slate-900">Dates{sortIc('start')}</button></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {t.view.map((ev: any) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{ev.name}</div>
                    {ev.tagline && <div className="text-xs text-slate-500 dark:text-slate-400">{ev.tagline}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={cn('capitalize', STATUS_VARIANTS[ev.status] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300')}>
                      {ev.status?.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{ev.city || '-'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {ev.start_date ? new Date(ev.start_date).toLocaleDateString() : '-'}
                    {ev.end_date ? ` – ${new Date(ev.end_date).toLocaleDateString()}` : ''}
                  </td>
                </tr>
              ))}
              {t.total === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">No championships match your search.</td></tr>
              )}
            </tbody>
          </table>
          <div className="px-4 pb-3"><Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} /></div>
        </Card>
      ) : (
        <Card className="p-8 text-center text-slate-500 dark:text-slate-400">
          No championships have been created yet.
        </Card>
      )}

      <Card className="bg-slate-50 dark:bg-slate-800/60 p-4">
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-lg">ℹ️</span>
          <span>
            System Admin manages platform master data (Sports, Disciplines, Formats, Organizations, Roles). 
            Championship management is delegated to Organiser accounts who can only access their own championships.
          </span>
        </div>
      </Card>
    </div>
  );
}
