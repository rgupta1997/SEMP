import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useTableControls, fmtDateTime } from '../../lib/hooks';
import { Button, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { awayTeam, disciplineLabel, eventInfo, eventLabel, homeTeam, sportName, teamLabel, venueLabel } from './fixtureHelpers';

export function OfficialFixturesPage() {
  const navigate = useNavigate();
  const { data: fixtures = [], isLoading } = useApi<any[]>('/me/officiating');
  const [status, setStatus] = useState('all');

  // Championship + Sport come from the shared header filter; sport cascades on championship.
  const { eventId } = useFilterBar();

  const live = fixtures.filter((f) => f.status === 'live').length;
  const upcoming = fixtures.filter((f) => f.status === 'scheduled').length;
  const done = fixtures.filter((f) => f.status === 'completed').length;

  const statusOptions = useMemo(() => ['all', ...new Set(fixtures.map((f) => f.status).filter(Boolean))], [fixtures]);
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
      (status === 'all' || f.status === status) &&
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
      <PageHeader title="My matches" subtitle="Fixtures assigned to you to officiate." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Live now" value={live} accent={live > 0} />
        <StatCard label="Upcoming" value={upcoming} />
        <StatCard label="Completed" value={done} />
      </div>

      {isLoading ? <Spinner /> : fixtures.length === 0 ? (
        <EmptyState icon="⚑" title="No matches assigned" description="When an organiser assigns you to a fixture, it shows up here." />
      ) : (
        <>
          <ListToolbar>
            <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search teams, championship, venue…" className="w-full sm:w-72" />
            {statusOptions.length > 2 && (
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                {statusOptions.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : String(s).replace(/_/g, ' ')}</option>)}
              </Select>
            )}
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
                      <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                        {teamLabel(homeTeam(f))} <span className="text-slate-300 dark:text-slate-600">vs</span> {teamLabel(awayTeam(f))}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{eventLabel(f)} · {venueLabel(f)} · {fmtDateTime(f.scheduled_at)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={f.status} />
                      <Button onClick={() => navigate(`/score/${f.id}`)}>Open console →</Button>
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
