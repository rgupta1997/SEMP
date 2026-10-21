import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useFilterBar, usePageFilters } from '../../lib/filters';
import { useApi, useTableControls } from '../../lib/hooks';
import { BackButton, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Select, Spinner } from '../../components/ui';
import { MatchRow } from '../../components/participant/MatchRow';
import type { MatchSummary } from '../../components/participant/types';

interface MatchesResponse { matches: MatchSummary[]; total: number; organization?: { id: string; name: string } | null }

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
];

export function ParticipantMatchesPage() {
  const [status, setStatus] = useState('');

  // Championship + Sport come from the shared header filter; peek championship for the query + cascade.
  const { eventId } = useFilterBar();

  // ?org= narrows to one organisation's squads - the link from a past organisation's card.
  const [params, setParams] = useSearchParams();
  const orgId = params.get('org');
  const clearOrg = () => setParams((p) => { p.delete('org'); return p; }, { replace: true });

  const qs = new URLSearchParams();
  if (orgId) qs.set('organization_id', orgId);
  if (eventId) qs.set('championship_id', eventId);
  if (status) qs.set('status', status);
  const path = `/me/matches${qs.toString() ? `?${qs}` : ''}`;
  const { data, isLoading } = useApi<MatchesResponse>(path);

  // Build the championship + sport options from the set without event/status filters (sport cascades on championship).
  const allMatches = useApi<MatchesResponse>(`/me/matches${orgId ? `?organization_id=${orgId}` : ''}`).data?.matches ?? [];
  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of allMatches) if (m.championship) map.set(m.championship.id, m.championship.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [allMatches]);
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of allMatches) {
      if (eventId && m.championship?.id !== eventId) continue;
      if (m.sport) set.add(m.sport);
    }
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [allMatches, eventId]);
  const { sportId } = usePageFilters({
    championships: eventOptions.length ? eventOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const matches = useMemo(
    () => (sportId ? (data?.matches ?? []).filter((m) => m.sport === sportId) : data?.matches ?? []),
    [data, sportId],
  );

  const t = useTableControls(matches, {
    search: (m) => `${m.opponent?.name ?? ''} ${m.opponent?.organization ?? ''} ${m.sport ?? ''} ${m.championship?.name ?? ''} ${m.round ?? ''}`,
    sorts: {
      date: (a, b) => new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime(),
      opponent: (a, b) => (a.opponent?.name ?? '').localeCompare(b.opponent?.name ?? ''),
    },
    initialSort: 'date',
    initialDir: 'desc',
    pageSize: 12,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="All matches" subtitle="Every match across your championships.">
        <BackButton to="/profile" className="mb-0">Dashboard</BackButton>
      </PageHeader>

      <ListToolbar>
        {orgId && (
          <button
            type="button"
            onClick={clearOrg}
            title="Show all your matches"
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/30"
          >
            <span className="truncate">Matches with {data?.organization?.name ?? 'this organisation'}</span>
            <X size={14} aria-hidden className="flex-none" />
          </button>
        )}
        <SearchInput value={t.query} onChange={t.setQuery} placeholder="Search opponent, sport…" className="w-full sm:w-64" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select value={`${t.sortKey}:${t.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); t.setSortKey(k); t.setDir(d as 'asc' | 'desc'); }} className="w-auto">
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="opponent:asc">Opponent A–Z</option>
        </Select>
      </ListToolbar>

      {isLoading ? <Spinner /> : t.total === 0 ? (
        <EmptyState icon="⚑" title="No matches found" description="Try clearing the filters above." />
      ) : (
        <>
          <div className="space-y-2">
            {t.view.map((m) => <MatchRow key={m.id} match={m} />)}
          </div>
          <Pagination page={t.page} pageCount={t.pageCount} total={t.total} pageSize={t.pageSize} onPage={t.setPage} />
        </>
      )}
    </div>
  );
}
