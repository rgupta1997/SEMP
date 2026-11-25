import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ChevronLeft, X } from 'lucide-react';
import { useApi, useTableControls } from '../../lib/hooks';
import { usePageTitle } from '../../lib/pageTitle';
import { EmptyState, PILL_PICK, PillPagination, SearchInput, cn } from '../../components/ui';
import { PickList } from '../../components/PickList';
import { ViewTabs } from '../../features/schedule/ScheduleParts';
import { MatchDayList } from '../../features/personal/MatchParts';
import { SportFilterButton, SportFilterPanel, useSportIcon, useSportOptions } from '../../features/personal/SportFilter';
import { PILL_GHOST } from '../../features/personal/styles';
import type { MatchSummary } from '../../components/participant/types';

interface MatchesResponse { matches: MatchSummary[]; total: number; organization?: { id: string; name: string } | null }

type View = 'all' | 'live' | 'upcoming' | 'played';
const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'played', label: 'Played' },
];
const inView = (m: MatchSummary, v: View) =>
  v === 'all' || (v === 'live' ? m.status === 'live' : v === 'played' ? m.status === 'completed' : m.status !== 'live' && m.status !== 'completed');

function ListSkeleton() {
  const bar = 'block animate-pulse rounded-full bg-slate-200 dark:bg-slate-800';
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {[3, 2].map((rows, g) => (
        <section key={g} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800"><span className={cn(bar, 'h-3 w-32')} /></div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first-of-type:border-t-0 dark:border-slate-800">
              <span className={cn(bar, 'h-3 w-12')} />
              <span className="min-w-0 flex-1 space-y-2">
                {[0, 1].map((r) => <span key={r} className="flex items-center gap-2.5"><span className="h-7 w-7 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" /><span className={cn(bar, 'h-3 flex-1')} /><span className={cn(bar, 'h-3 w-6')} /></span>)}
                <span className={cn(bar, 'h-2.5 w-44')} />
              </span>
              <span className={cn(bar, 'h-5 w-16')} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function ParticipantMatchesPage() {
  usePageTitle('All matches');
  const iconOf = useSportIcon();
  // ?org= narrows to one organisation's squads - the link from a past organisation's card.
  const [params, setParams] = useSearchParams();
  const orgId = params.get('org');
  const clearOrg = () => setParams((p) => { p.delete('org'); return p; }, { replace: true });

  // One fetch; event, sport and status narrow it here, so every count agrees with the list.
  const { data, isLoading } = useApi<MatchesResponse>(`/me/matches${orgId ? `?organization_id=${orgId}` : ''}`);
  const all = useMemo(() => data?.matches ?? [], [data]);
  const [view, setView] = useState<View>('all');
  const [eventId, setEventId] = useState('');
  const [sports, setSports] = useState<string[]>([]);
  const [sportsOpen, setSportsOpen] = useState(false);

  const events = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of all) if (m.championship) map.set(m.championship.id, m.championship.name);
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);
  const inEvent = useMemo(() => all.filter((m) => !eventId || m.championship?.id === eventId), [all, eventId]);
  const sportOptions = useSportOptions(useMemo(() => inEvent.map((m) => (m.sport ? [m.sport] : [])), [inEvent]), iconOf);
  const scoped = useMemo(() => inEvent.filter((m) => !sports.length || (m.sport != null && sports.includes(m.sport))), [inEvent, sports]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.value, scoped.filter((m) => inView(m, v.value)).length])) as Record<View, number>, [scoped]);
  // Your record across what the filters show.
  const record = useMemo(() => ({
    won: scoped.filter((m) => m.result === 'won').length,
    draw: scoped.filter((m) => m.result === 'draw').length,
    lost: scoped.filter((m) => m.result === 'lost').length,
  }), [scoped]);
  const shown = useMemo(() => scoped.filter((m) => inView(m, view)), [scoped, view]);

  const t = useTableControls(shown, {
    search: (m) => `${m.opponent?.name ?? ''} ${m.opponent?.organization ?? ''} ${m.my_team?.name ?? ''} ${m.sport ?? ''} ${m.championship?.name ?? ''} ${m.round ?? ''}`,
    sorts: { date: (a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime() },
    initialSort: 'date',
    initialDir: 'desc',
    pageSize: 12,
  });

  const filtered = !!eventId || sports.length > 0 || view !== 'all' || !!t.query;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">Every match across your championships.</p>
        <Link to="/home" className={PILL_GHOST}><ChevronLeft size={14} aria-hidden />My Game</Link>
      </div>

      {/* Your record, at a glance: played, then W / D / L. */}
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="rounded-full bg-[#0a1630] px-3 py-1 text-white">{scoped.length} match{scoped.length === 1 ? '' : 'es'}</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">{record.won} won</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">{record.draw} drawn</span>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30">{record.lost} lost</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto">
          <ViewTabs value={view} onChange={setView}
            options={VIEWS.map((v) => ({ value: v.value, label: v.label, badge: isLoading ? undefined : <span className="tabular-nums opacity-70">{counts[v.value]}</span> }))} />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {/* SearchInput will not shrink on its own; this wrapper lets it give way to the buttons. */}
          <div className="min-w-0 flex-1 sm:w-60 sm:flex-none"><SearchInput pill value={t.query} onChange={t.setQuery} placeholder="Search team, sport, event" className="w-full" /></div>
          {sportOptions.length > 1 && <SportFilterButton open={sportsOpen} picked={sports.length} onToggle={() => setSportsOpen((o) => !o)} controls="matches-sports" />}
          <button type="button" onClick={() => t.setDir(t.dir === 'desc' ? 'asc' : 'desc')} title="Change the order"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <ArrowDownUp size={14} aria-hidden />{t.dir === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
        </div>
      </div>

      {(events.length > 1 || orgId) && (
        <div className="flex flex-wrap items-center gap-2">
          {events.length > 1 && (
            <div className="w-full sm:w-72">
              <PickList value={eventId} onChange={setEventId} ariaLabel="Filter by event" className={PILL_PICK}
                options={[{ value: '', label: 'All events' }, ...events]} />
            </div>
          )}
          {orgId && (
            <button type="button" onClick={clearOrg} title="Show all your matches"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--accent)]/15 px-3 py-1.5 text-[13px] font-semibold text-[var(--accent-deep)] ring-1 ring-[var(--accent-deep)]/30 dark:text-[var(--accent)]">
              <span className="truncate">Matches with {data?.organization?.name ?? 'this organisation'}</span><X size={14} aria-hidden className="flex-none" />
            </button>
          )}
        </div>
      )}
      {sportsOpen && sportOptions.length > 1 && (
        <SportFilterPanel id="matches-sports" sports={sportOptions} value={sports} onChange={setSports} allTotal={inEvent.length} />
      )}

      {isLoading ? <ListSkeleton /> : t.total === 0 ? (
        <EmptyState
          icon={<span aria-hidden>⚽</span>}
          title={all.length === 0 ? 'No matches yet' : 'No matches match'}
          description={all.length === 0 ? 'Your matches show up here once your squad has fixtures.' : 'Try another tab, event, sport or search.'}
          action={filtered ? <button type="button" onClick={() => { setView('all'); setEventId(''); setSports([]); t.setQuery(''); }}><X size={14} aria-hidden />Clear filters</button> : undefined}
        />
      ) : (
        <>
          <MatchDayList matches={t.view} iconOf={iconOf} />
          <PillPagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} noun="match" plural="matches" />
        </>
      )}
    </div>
  );
}
