import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useApi, useTableControls, fmtDateRange } from '../lib/hooks';
import { titleCase } from '../lib/format';
import { useWorkspace } from '../lib/useWorkspace';
import { Badge, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, FilterChips } from '../components/ui';
import { InvitationsInbox } from '../components/InvitationsInbox';

interface MyChampionship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  my_roles: string[];
  sports?: string[];
}

const ROLE_TONE: Record<string, 'brand' | 'green' | 'amber' | 'slate'> = {
  organiser: 'brand', poc: 'brand', official: 'amber',
  player: 'green', participant: 'green', captain: 'green', member: 'slate',
};

// The breakdown splits My Events by RELATIONSHIP, not by status: Playing, Hosting,
// Completed. That is the question a person actually arrives with - "what am I in?"
// rather than "what is currently running?" - and it is why an event can appear under
// both Playing and Completed without the tabs contradicting each other.
type TabKey = 'playing' | 'hosting' | 'completed';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'playing', label: 'Playing' },
  { key: 'hosting', label: 'Hosting' },
  { key: 'completed', label: 'Completed' },
];

const HOSTING_ROLES = ['organiser', 'organizer', 'poc'];

function inTab(c: MyChampionship, tab: TabKey): boolean {
  if (tab === 'completed') return c.status === 'completed';
  const hosting = c.my_roles.some((r) => HOSTING_ROLES.includes(r));
  // Hosting and playing are not exclusive - an organiser who also turns out for a
  // team belongs in both, and hiding one of them would lose them a fixture.
  return tab === 'hosting' ? hosting : c.my_roles.some((r) => !HOSTING_ROLES.includes(r));
}

// Championships the user is involved in - in any capacity (organiser / official /
// player / org member). Filterable by status (tabs), sport and free-text search.
//
// "View details" opens the EVENT WORKSPACE, whoever you are: the same event, with
// each role shown the sections it offers. It is an event, not a page about an
// event, so opening it moves the whole workspace rather than following a link out
// of personal space and leaving the sidebar behind. Your own participation - your
// teams, your matches, your record - stays in My Game, where it belongs.
const detailHref = (c: MyChampionship) => `/championships/${c.id}`;

export function MyChampionshipsPage() {
  const { pathname } = useLocation();
  const ws = useWorkspace();
  const { data: rows = [], isLoading } = useApi<MyChampionship[]>('/championships/mine');
  // Where the event should send people back to when they are done with it.
  const open = (c: MyChampionship) => ws.enter(c.id, detailHref(c), pathname);
  const [tab, setTab] = useState<TabKey>('playing');
  const [sport, setSport] = useState('');

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of rows) for (const s of c.sports ?? []) set.add(s);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((c) => inTab(c, tab) && (!sport || (c.sports ?? []).includes(sport))),
    [rows, tab, sport],
  );

  // Counts come from the unfiltered list, so a sport filter narrows what you see
  // without making the other tabs look empty.
  const counts = useMemo(() => ({
    playing: rows.filter((c) => inTab(c, 'playing')).length,
    hosting: rows.filter((c) => inTab(c, 'hosting')).length,
    completed: rows.filter((c) => inTab(c, 'completed')).length,
  }), [rows]);

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
    // pb-20 keeps the bottom pagination clear of the floating Feedback button.
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="My events" subtitle="Everything you are playing in, hosting, or have finished." />
        <div className="flex flex-wrap gap-2">
          <Link to="/host" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Create Event
          </Link>
          <Link to="/discover" className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-brand-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:ring-slate-700">
            Find events
          </Link>
        </div>
      </div>

      <InvitationsInbox />

      <FilterChips
        value={tab}
        onChange={setTab}
        options={TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))}
      />

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
          icon={<Trophy size={24} />}
          title={rows.length === 0 ? 'Nothing here yet' : 'No championships match'}
          description={rows.length === 0
            ? 'Join a team, get assigned as an official, or host your own - your championships will show up here.'
            : 'Try a different status, sport or search term.'}
        />
      ) : (
        <>
          <div className="space-y-3">
            {tc.view.map((c) => (
              <Card
                key={c.id}
                interactive
                onClick={() => open(c)}
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
                  {c.my_roles.map((r) => <Badge key={r} tone={ROLE_TONE[r] ?? 'slate'}>{titleCase(r)}</Badge>)}
                  {/* Kept as a link so it can be opened in a new tab, but handled
                      here so the click switches workspace rather than just navigating. */}
                  <Link
                    to={detailHref(c)}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(c); }}
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
