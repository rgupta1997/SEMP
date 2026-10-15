import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { Button, EmptyState, FilterChips, PageHeader, StatCard } from '../../components/ui';
import { DataList, QueryState, Section, SkeletonList } from '../../components/primitives';
import { fmtDateTime } from '../../lib/hooks';
import { useEventSetups } from '../../features/event-setup/api';
import { NewSetupModal } from '../../features/event-setup/components/NewSetupModal';
import { TemplateStrip } from '../../features/event-setup/components/TemplateDownloads';
import { FOCUS_RING, IssueBadges, StatusPill, TypeChip } from '../../features/event-setup/components/pills';
import { needsAttention } from '../../features/event-setup/status';
import type { EventSetupListItem, EventSetupStatus } from '../../features/event-setup/types';

// The super-admin Event Setup dashboard: hand the client a standard workbook, take
// it back, check how well it was filled in, and build the event from it.

type ListFilter = 'all' | 'progress' | 'attention' | 'applied' | 'undone';

const FILTERS: Record<ListFilter, (s: EventSetupStatus) => boolean> = {
  all: () => true,
  progress: (s) => s === 'draft' || s === 'validated' || s === 'applying',
  attention: needsAttention,
  applied: (s) => s === 'applied',
  undone: (s) => s === 'undone',
};

function SizeLine({ s }: { s: EventSetupListItem }) {
  if (!s.summary) return <span className="text-slate-400 dark:text-slate-500">-</span>;
  const { squads, people, matches } = s.summary;
  return (
    <span className="t-num text-slate-600 dark:text-slate-300">
      {(squads ?? 0).toLocaleString()} squads · {(people ?? 0).toLocaleString()} people · {(matches ?? 0).toLocaleString()} matches
    </span>
  );
}

export function EventSetupListPage() {
  const navigate = useNavigate();
  const query = useEventSetups();
  const setups = useMemo(() => query.data ?? [], [query.data]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<ListFilter>('all');

  const kpis = useMemo(() => ({
    total: setups.length,
    applied: setups.filter((s) => s.status === 'applied').length,
    attention: setups.filter((s) => needsAttention(s.status)).length,
  }), [setups]);

  const rows = useMemo(
    () => [...setups]
      .filter((s) => FILTERS[filter](s.status))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    [setups, filter],
  );

  const count = (f: ListFilter) => setups.filter((s) => FILTERS[f](s.status)).length;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <PageHeader
        title="Event Setup"
        subtitle="Send a client the standard workbook, check how well they filled it in, then build the whole event from it: organisation, people, squads, draws, venue, fixtures and roles."
      >
        <Button className={FOCUS_RING} onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden /> New setup
        </Button>
      </PageHeader>

      {setups.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Setups" value={kpis.total} />
          <StatCard label="Applied" value={kpis.applied} />
          <StatCard
            label="Need attention"
            value={kpis.attention}
            hint={kpis.attention ? 'Errors to fix or a failed run' : 'Nothing waiting on you'}
          />
        </div>
      )}

      <TemplateStrip />

      <Section title="Setups" count={query.isSuccess ? setups.length : undefined}>
        <QueryState
          query={query}
          skeleton={<SkeletonList rows={4} variant="card" />}
          isEmpty={setups.length === 0}
          errorTitle="Could not load the setups"
          empty={(
            <EmptyState
              icon={<FileSpreadsheet size={32} />}
              title="No event setups yet"
              description="Download a template above and send it to the client, then start a new setup and upload what they send back."
              action={(
                <Button className={FOCUS_RING} onClick={() => setCreating(true)}>
                  <Plus size={15} aria-hidden /> New setup
                </Button>
              )}
            />
          )}
        >
          <FilterChips
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { key: 'all', label: 'All', count: setups.length },
              { key: 'progress', label: 'In progress', count: count('progress') },
              { key: 'attention', label: 'Need attention', count: count('attention') },
              { key: 'applied', label: 'Applied', count: count('applied') },
              ...(count('undone') ? [{ key: 'undone' as const, label: 'Undone', count: count('undone') }] : []),
            ]}
          />
          <DataList
            caption="Event setups"
            rows={rows}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/platform/event-setup/${s.id}`)}
            empty={<p className="t-meta py-6 text-center">No setups match this filter.</p>}
            columns={[
              {
                key: 'label', header: 'Setup', primary: true,
                render: (s) => (
                  <div className="min-w-0">
                    {/* A real link, so the row is reachable by keyboard and opens in a new tab. */}
                    <Link
                      to={`/platform/event-setup/${s.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate font-semibold text-slate-900 hover:text-brand-700 focus-visible:underline focus-visible:outline-none dark:text-slate-100 dark:hover:text-brand-300"
                    >
                      {s.label}
                    </Link>
                    <div className="t-meta truncate font-normal">{s.file_name ?? 'No workbook yet'}</div>
                  </div>
                ),
              },
              { key: 'type', header: 'Type', render: (s) => <TypeChip type={s.event_type} /> },
              { key: 'status', header: 'Status', render: (s) => <StatusPill status={s.status} /> },
              {
                key: 'event', header: 'Event',
                render: (s) => (
                  <div className="min-w-0">
                    <div className="truncate text-slate-800 dark:text-slate-200">{s.championship_name ?? '-'}</div>
                    {s.org_name && <div className="t-meta truncate">{s.org_name}</div>}
                  </div>
                ),
              },
              { key: 'size', header: 'Size', render: (s) => <SizeLine s={s} /> },
              { key: 'issues', header: 'Issues', render: (s) => <IssueBadges counts={s.issue_counts} validated={!!s.summary} /> },
              {
                key: 'updated', header: 'Updated',
                render: (s) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{fmtDateTime(s.updated_at)}</span>,
              },
            ]}
          />
        </QueryState>
      </Section>

      {creating && <NewSetupModal onClose={() => setCreating(false)} />}
    </div>
  );
}
