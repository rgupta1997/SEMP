import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useTableControls, fmtDateTime } from '../../lib/hooks';
import { Button, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Spinner, StatusBadge, FilterChips } from '../../components/ui';
import { awayTeam, disciplineLabel, eventInfo, eventLabel, homeTeam, isRankingEvent, orgLabel, sportName, teamLabel, venueLabel } from './fixtureHelpers';

export function OfficialFixturesPage() {
  const navigate = useNavigate();
  const { data: fixtures = [], isLoading } = useApi<any[]>('/me/officiating');
  // Upcoming / Live / Completed (F-053). Tabs rather than a dropdown, because these
  // are three different jobs - one to prepare for, one to do now, one to look back
  // at - and a dropdown hides two of them behind the third.
  const [status, setStatus] = useState<'scheduled' | 'live' | 'completed'>('live');

  // Championship + Sport come from the shared header filter; sport cascades on championship.
  const { eventId } = useFilterBar();

  const live = fixtures.filter((f) => f.status === 'live').length;
  const upcoming = fixtures.filter((f) => f.status === 'scheduled').length;
  const done = fixtures.filter((f) => f.status === 'completed').length;

  const TABS = [
    { key: 'live' as const, label: 'Live', count: live },
    { key: 'scheduled' as const, label: 'Upcoming', count: upcoming },
    { key: 'completed' as const, label: 'Completed', count: done },
  ];

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    fixtures.forEach((f) => { const e = eventInfo(f); if (e) map.set(e.id, e.name); });
    return [...map].map(([id, name]) => ({ id, name }));
  }, [fixtures]);
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    fixtures.forEach((f) => {
      if (eventId && eventInfo(f)?.id !== eventId) return;
      const s = sportName(f); if (s) set.add(s);
    });
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [fixtures, eventId]);
  const { sportId } = usePageFilters({
    championships: eventOptions.length ? eventOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const filtered = useMemo(
    () => fixtures.filter((f) =>
      f.status === status &&
      (!sportId || sportName(f) === sportId) &&
      (!eventId || eventInfo(f)?.id === eventId)),
    [fixtures, status, sportId, eventId],
  );
  const t = useTableControls(filtered, {
    search: (f) => `${teamLabel(homeTeam(f))} ${teamLabel(awayTeam(f))} ${eventLabel(f)} ${venueLabel(f)} ${disciplineLabel(f)}`,
    sorts: {
      time: (a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
    },
    initialSort: 'time',
    pageSize: 12,
  });

  return (
    <div>
      <PageHeader title="Officiating" subtitle="Matches assigned to you, and the console for the one you are on." />
      <FilterChips
        value={status}
        onChange={setStatus}
        options={TABS.map((t2) => ({
          key: t2.key,
          label: t2.key === 'live' && t2.count > 0
            ? <span className="flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-rose-500" />{t2.label}</span>
            : t2.label,
          count: t2.count,
        }))}
      />

      {isLoading ? <Spinner /> : fixtures.length === 0 ? (
        <EmptyState icon="⚑" title="No matches assigned" description="When an organiser assigns you to a fixture, it shows up here." />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search teams, championship, venue…" className="w-full sm:w-72" />

          </ListToolbar>
          {t.total === 0 ? (
            <EmptyState icon="⚑" title="No matching fixtures" description="Try a different search or status filter." />
          ) : (
            <>
              <div className="space-y-3">
                {t.view.map((f) => (
                  <Card key={f.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        <span>{disciplineLabel(f)}</span>
                        {f.round && <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-slate-500 dark:text-slate-400">{f.round}</span>}
                      </div>
                      {isRankingEvent(f) ? (
                        <div className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                          <span className="leading-tight">{disciplineLabel(f)}</span>
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Ranking event</span>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                          <span className="flex flex-col">
                            <span className="leading-tight">{teamLabel(homeTeam(f))}</span>
                            {orgLabel(homeTeam(f)) && <span className="text-xs font-normal leading-tight text-slate-400 dark:text-slate-500">{orgLabel(homeTeam(f))}</span>}
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">vs</span>
                          <span className="flex flex-col">
                            <span className="leading-tight">{teamLabel(awayTeam(f))}</span>
                            {orgLabel(awayTeam(f)) && <span className="text-xs font-normal leading-tight text-slate-400 dark:text-slate-500">{orgLabel(awayTeam(f))}</span>}
                          </span>
                        </div>
                      )}
                      <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{eventLabel(f)} · {venueLabel(f)} · {fmtDateTime(f.scheduled_at)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {f.scorecard_status === 'locked' ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          Locked
                        </span>
                      ) : <StatusBadge status={f.status} />}
                      <Button variant={f.status === 'completed' ? 'ghost' : 'primary'} onClick={() => navigate(`/score/${f.id}`)}>
                        {f.status === 'completed' ? 'View scorecard' : 'Open console →'}
                      </Button>
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
