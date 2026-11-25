import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Compass, MapPin, Plus, RotateCcw, Trophy } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { archiveDaysLeft, archivePurgeDate } from '@semp/shared';
import { api } from '../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDate, fmtDateRange } from '../lib/hooks';
import { titleCase } from '../lib/format';
import { usePageTitle } from '../lib/pageTitle';
import { useWorkspace } from '../lib/useWorkspace';
import { eventStatusLook } from '../lib/eventStatus';
import { EmptyState, PillPagination, SearchInput, cn, toast } from '../components/ui';
import { InvitationsInbox } from '../components/InvitationsInbox';
import { ViewTabs } from '../features/schedule/ScheduleParts';
import { SportFilterButton, SportFilterPanel, useSportIcon, useSportOptions } from '../features/personal/SportFilter';
import { TicketSkeleton } from '../features/personal/EventSkeletons';
import { PERSONAL_NAVY, PILL_GHOST, PILL_TEAL } from '../features/personal/styles';

interface MyChampionship {
  id: string; name: string; slug: string; status: string;
  venue?: string | null; start_date: string; end_date: string;
  my_roles: string[];
  sports?: string[];
  /** Set while archived; only ever returned to the event's host. */
  archived_at?: string | null;
  /** Archived with its organisation: no clock, restored with the organisation. */
  archived_with_org?: boolean;
}

/** Role chips: hosting in teal, officiating amber, playing green. */
const ROLE_CHIP: Record<string, string> = {
  organiser: 'bg-[var(--accent)] text-slate-950', organizer: 'bg-[var(--accent)] text-slate-950', poc: 'bg-[var(--accent)] text-slate-950',
  official: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  player: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  participant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  captain: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
};
const ROLE_CHIP_DEFAULT = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

// The breakdown splits My Events by RELATIONSHIP, not by status: Playing, Hosting,
// Completed. An event can sit under both Playing and Completed; "All" is every event.
type TabKey = 'all' | 'playing' | 'hosting' | 'completed' | 'archived';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'playing', label: 'Playing' },
  { key: 'hosting', label: 'Hosting' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const HOSTING_ROLES = ['organiser', 'organizer', 'poc'];

function inTab(c: MyChampionship, tab: TabKey): boolean {
  // Archived events live only in their own tab; retrieving one returns it to the rest.
  if (tab === 'archived') return !!c.archived_at;
  if (c.archived_at) return false;
  if (tab === 'all') return true;
  if (tab === 'completed') return c.status === 'completed';
  const hosting = c.my_roles.some((r) => HOSTING_ROLES.includes(r));
  // An organiser who also plays belongs in both Hosting and Playing.
  return tab === 'hosting' ? hosting : c.my_roles.some((r) => !HOSTING_ROLES.includes(r));
}

// "View details" opens the EVENT WORKSPACE, whoever you are; your own record stays in My Game.
const detailHref = (c: MyChampionship) => `/championships/${c.id}`;

/** The ticket stub: the event's window on navy, like a match ticket's tear-off. */
function DateStub({ start, end }: { start: string; end: string }) {
  const s = new Date(start); const e = new Date(end);
  const oneDay = s.toDateString() === e.toDateString();
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return (
    <div className={cn('relative flex w-20 shrink-0 flex-col items-center justify-center px-2 py-4 text-center text-white sm:w-24', PERSONAL_NAVY)}>
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">{month(s)}</span>
      <span className="text-3xl font-black leading-none tabular-nums">{s.getDate()}</span>
      {/* The end, so the stub reads as the whole window: "to 30 Nov", or "1 day". */}
      <span className="mt-1.5 text-[11px] font-bold text-white/80">{oneDay ? '1 day' : `to ${e.getDate()} ${month(e)}`}</span>
      <span className="text-[10px] font-semibold text-white/45">{e.getFullYear()}</span>
      {/* Perforation along the tear line. */}
      <span aria-hidden className="absolute inset-y-3 right-0 border-r-2 border-dashed border-white/15" />
    </div>
  );
}

function EventTicket({ c, iconOf, onOpen, onRetrieve, retrieving }: {
  c: MyChampionship; iconOf: (s: string) => string; onOpen: () => void; onRetrieve: () => void; retrieving: boolean;
}) {
  const look = eventStatusLook(c.status);
  const sports = c.sports ?? [];
  return (
    <article className="group flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent-deep)]/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <DateStub start={c.start_date} end={c.end_date} />
      <div className="flex min-w-0 flex-1 flex-col">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 space-y-2 p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 text-base font-black leading-snug text-slate-900 dark:text-slate-100">{c.name}</h3>
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-sm', look.solid)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', look.dot, c.status === 'ongoing' && 'animate-pulse')} aria-hidden />{look.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden />{fmtDateRange(c.start_date, c.end_date)}</span>
            <span className="inline-flex min-w-0 items-center gap-1"><MapPin size={13} aria-hidden /><span className="truncate">{c.venue || 'Venue to be confirmed'}</span></span>
          </div>
          {sports.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sports.slice(0, 4).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
                  <span aria-hidden>{iconOf(s)}</span>{s}
                </span>
              ))}
              {sports.length > 4 && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-400" title={sports.slice(4).join(', ')}>+{sports.length - 4} more</span>}
            </div>
          )}
        </button>
        {c.archived_at && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span>{c.archived_with_org
              ? 'Archived with its organisation - retrieve the organisation to bring it back'
              : `Deleted permanently on ${fmtDate(archivePurgeDate(c.archived_at))} (${archiveDaysLeft(c.archived_at)} days left) unless retrieved`}</span>
            {!c.archived_with_org && (
              <button type="button" onClick={onRetrieve} disabled={retrieving}
                className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-xs font-black text-amber-950 transition hover:bg-amber-300 disabled:opacity-60">
                <RotateCcw size={12} aria-hidden />Retrieve
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <div className="flex flex-wrap gap-1.5">
            {c.my_roles.map((r) => (
              <span key={r} className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', ROLE_CHIP[r] ?? ROLE_CHIP_DEFAULT)}>{titleCase(r)}</span>
            ))}
          </div>
          {/* A real link so it opens in a new tab; a plain click switches workspace instead. */}
          <Link to={detailHref(c)} onClick={(e) => { e.preventDefault(); onOpen(); }}
            className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--accent-deep)] transition hover:gap-1.5 dark:text-[var(--accent)]">
            Open event<ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function MyChampionshipsPage() {
  usePageTitle('My Events');
  const { pathname } = useLocation();
  const ws = useWorkspace();
  const { data: rows = [], isLoading } = useApi<MyChampionship[]>('/championships/mine');
  // Where the event should send people back to when they are done with it.
  const open = (c: MyChampionship) => ws.enter(c.id, detailHref(c), pathname);
  // ?tab=archived lets Settings land the host here right after archiving.
  const [params] = useSearchParams();
  const initialTab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') as TabKey : 'all';
  const [tab, setTab] = useState<TabKey>(initialTab);
  const retrieve = useApiMutation(
    (id: string) => api('POST', `/championships/${id}/retrieve`),
    ['/championships/mine', '/championships'],
  );
  const [sports, setSports] = useState<string[]>([]);
  const [sportsOpen, setSportsOpen] = useState(false);

  const iconOf = useSportIcon();
  const sportOptions = useSportOptions(useMemo(() => rows.map((c) => c.sports), [rows]), iconOf);

  const filtered = useMemo(
    () => rows.filter((c) => inTab(c, tab) && (!sports.length || (c.sports ?? []).some((s) => sports.includes(s)))),
    [rows, tab, sports],
  );

  // Counts come from the unfiltered list, so a sport filter doesn't make other tabs look empty.
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter((c) => inTab(c, t.key)).length])) as Record<TabKey, number>, [rows]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Everything you are playing in, hosting, or have finished.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/host" className={PILL_TEAL}><Plus size={14} aria-hidden />Create event</Link>
          <Link to="/discover" className={PILL_GHOST}><Compass size={14} aria-hidden />Find events</Link>
        </div>
      </div>

      <InvitationsInbox />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto">
          <ViewTabs value={tab} onChange={setTab}
            options={TABS.map((t) => ({ value: t.key, label: t.label, badge: isLoading ? undefined : <span className="tabular-nums opacity-70">{counts[t.key]}</span> }))} />
        </div>
        {rows.length > 0 && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* SearchInput will not shrink on its own; this wrapper lets it give way to the Sports button. */}
            <div className="min-w-0 flex-1 sm:w-64 sm:flex-none"><SearchInput pill value={tc.query} onChange={tc.setQuery} placeholder="Search your events" className="w-full" /></div>
            {sportOptions.length > 1 && (
              <SportFilterButton open={sportsOpen} picked={sports.length} onToggle={() => setSportsOpen((o) => !o)} controls="my-events-sports" />
            )}
          </div>
        )}
      </div>
      {/* Sports fold away behind the button; open, they wrap instead of scrolling sideways. */}
      {sportsOpen && sportOptions.length > 1 && (
        <SportFilterPanel id="my-events-sports" sports={sportOptions} value={sports} onChange={setSports} allTotal={counts.all} />
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => <TicketSkeleton key={i} />)}
        </div>
      ) : tc.total === 0 ? (
        <EmptyState
          icon={<Trophy size={22} />}
          title={rows.length === 0 ? 'No events yet' : 'No events match'}
          description={rows.length === 0
            ? 'Join a team, get assigned as an official, or host your own. Your events show up here.'
            : 'Try another tab, sport or search.'}
          action={rows.length === 0 ? <Link to="/discover" className="!bg-[var(--accent)] !text-slate-950"><Compass size={14} aria-hidden />Find an event</Link> : undefined}
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {tc.view.map((c) => (
              <EventTicket key={c.id} c={c} iconOf={iconOf} onOpen={() => open(c)} retrieving={retrieve.isPending}
                onRetrieve={() => retrieve.mutate(c.id, {
                  onSuccess: () => toast.success(`${c.name} retrieved`),
                  onError: (err: any) => toast.error(err.message),
                })} />
            ))}
          </div>
          <PillPagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} noun="event" />
        </>
      )}
    </div>
  );
}
