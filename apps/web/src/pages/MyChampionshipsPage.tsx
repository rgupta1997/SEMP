import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { Badge, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge } from '../components/ui';
import { InvitationsInbox } from '../components/InvitationsInbox';

interface MyChampionship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  my_roles: string[];
  sports?: string[];
}

const ROLE_TONE: Record<string, 'brand' | 'green' | 'amber' | 'slate'> = {
  organiser: 'brand', official: 'amber', player: 'green', member: 'slate',
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'registration_open', label: 'Upcoming' },
  { key: 'ongoing', label: 'Live' },
  { key: 'completed', label: 'Completed' },
] as const;

// Championships the user is involved in — in any capacity (organiser / official /
// player / org member). Filterable by status (tabs), sport and free-text search.
// Where "View details" leads for a championship, based on the viewer's roles.
function detailHref(c: MyChampionship): string {
  if (c.my_roles.includes('organiser')) return `/championships/${c.id}`;
  // Players get their personal participation view (teams / matches / stats).
  if (c.my_roles.includes('player')) return `/profile/championships/${c.id}`;
  // Everyone else (org members, officials) gets the read-only spectator view.
  return `/championships/${c.id}`;
}

export function MyChampionshipsPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useApi<MyChampionship[]>('/championships/mine');
  const [tab, setTab] = useState<string>('all');
  const [sport, setSport] = useState('');

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of rows) for (const s of c.sports ?? []) set.add(s);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((c) =>
      (tab === 'all' || c.status === tab) &&
      (!sport || (c.sports ?? []).includes(sport))),
    [rows, tab, sport],
  );

  const tc = useTableControls(filtered, {
    search: (c) => `${c.name} ${c.venue ?? ''} ${(c.sports ?? []).join(' ')} ${c.my_roles.join(' ')}`,
    sorts: {
      start: (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
    },
    initialSort: 'start',
    pageSize: 10,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Where you're competing" subtitle="Every championship you're part of — across all your organizations." />

      <InvitationsInbox />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rows.length > 0 && (
        <ListToolbar>
          <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search championships…" className="w-full sm:w-72" />
          <Select value={sport} onChange={(e) => setSport(e.target.value)} className="w-auto" aria-label="Filter by sport">
            <option value="">All sports</option>
            {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </ListToolbar>
      )}

      {isLoading ? <Spinner /> : tc.total === 0 ? (
        <EmptyState
          icon="🏆"
          title={rows.length === 0 ? 'Nothing here yet' : 'No championships match'}
          description={rows.length === 0
            ? 'Join a team, get assigned as an official, or host your own — your championships will show up here.'
            : 'Try a different status, sport or search term.'}
        />
      ) : (
        <>
          <div className="space-y-3">
            {tc.view.map((c) => (
              <Card
                key={c.id}
                interactive
                onClick={() => navigate(detailHref(c))}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-base font-black text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">{c.name.slice(0, 1)}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{c.venue || 'Venue TBD'} · {fmtDateRange(c.start_date, c.end_date)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.my_roles.map((r) => <Badge key={r} tone={ROLE_TONE[r] ?? 'slate'}>{r}</Badge>)}
                  <Link
                    to={detailHref(c)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                  >
                    View details →
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}
    </div>
  );
}
