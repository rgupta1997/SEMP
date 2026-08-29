import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Trophy } from 'lucide-react';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi } from '../../lib/hooks';
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, RefreshBar, Spinner, StatCard, Table, Tabs, cn } from '../../components/ui';
import { SharePublicLink } from '../../components/SharePublicLink';
import { StandingsBreakdown } from '../../components/StandingsBreakdown';
import { StandingsMedalTable, rankMedals } from '../../components/StandingsMedalTable';

interface StandingRow {
  /**
   * The CONTINGENT this row is for - a campus or department id in a championship
   * contested inside one organisation, an organisation id in an open one. This is
   * the row's identity: in an intra event every row shares one organization_id, so
   * keying a list or an expand-state on that collapses twelve campuses into one.
   */
  entity_id: string;
  /** What to print. Resolved server-side so no two surfaces can label it differently. */
  name: string;
  short_name: string | null;
  org_unit: { id: string; name: string; code: string | null; type: string; parent: string | null } | null;
  organization_id: string;
  organization: { id: string; name: string; short_name?: string | null; logo_url?: string | null } | null;
  played: number; won: number; drawn: number; lost: number; points: number;
  detail: Record<string, number>;
  rank: number | null;
}
interface StandingsResponse { scope: string; scope_id: string | null; standings: StandingRow[]; completed_matches: number }

// A draw row (subset of GET /:id/draws) - used only to source the tournament + sport
// filter options (with their UUIDs, which the materialized scopes are keyed by).
interface DrawRow {
  tournament_sports: {
    sports: { id: string; name: string } | null;
    tournaments: { id: string; name: string } | null;
  } | null;
}

const RANK_COLORS = [
  { bg: 'var(--gold-500)', color: '#3b1f00' },
  { bg: 'var(--silver)', color: '#1e293b' },
  { bg: 'var(--bronze)', color: '#fff7ed' },
];

function RankBadge({ pos }: { pos: number }) {
  const c = RANK_COLORS[pos - 1];
  if (!c) return <span className="font-bold tabular-nums text-slate-400 dark:text-slate-500">{pos}</span>;
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold"
      style={{ background: c.bg, color: c.color }}
    >{pos}</span>
  );
}

export function StandingsPage() {
  const { eventId, championship } = useEvent();
  // "Organizations" is only the right word for an inter-organisation event. The
  // server resolves the host's own noun so this cannot disagree with the entry form
  // or the approvals queue.
  const entrants = championship.entry?.entrant_label ?? 'Organizations';
  const { data: draws = [] } = useApi<DrawRow[]>(`/championships/${eventId}/draws`);
  // Which org's row is expanded to show its per-event points breakdown.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Olympic-style medal tally (primary) vs the P/W/D/L points table - same rows, two views.
  const [view, setView] = useState<'points' | 'medals'>('medals');

  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const t = d.tournament_sports?.tournaments; if (t) map.set(t.id, t.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const s = d.tournament_sports?.sports; if (s) map.set(s.id, s.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);

  const { tournamentId, sportId } = usePageFilters({
    tournaments: tournamentOptions.length ? tournamentOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  // Standings are materialized one scope at a time, so the header filters select a
  // single scope (most specific wins): sport → tournament → whole championship.
  const { scope, scopeId, scopeLabel } = useMemo(() => {
    if (sportId) return { scope: 'sport', scopeId: sportId, scopeLabel: `Sport · ${sportOptions.find((s) => s.id === sportId)?.name ?? ''}` };
    if (tournamentId) return { scope: 'tournament', scopeId: tournamentId, scopeLabel: `Tournament · ${tournamentOptions.find((t) => t.id === tournamentId)?.name ?? ''}` };
    return { scope: 'championship', scopeId: null as string | null, scopeLabel: 'Whole championship' };
  }, [sportId, tournamentId, sportOptions, tournamentOptions]);

  const query = scopeId ? `?scope=${scope}&scopeId=${scopeId}` : `?scope=${scope}`;
  const { data, isLoading, refetch, dataUpdatedAt, isFetching } = useApi<StandingsResponse>(`/championships/${eventId}/standings${query}`);
  const rows = data?.standings ?? [];

  // Live-ish standings: re-pull every 10s so completed matches show without a reload.
  useEffect(() => {
    const t = setInterval(() => refetch(), 10000);
    return () => clearInterval(t);
  }, [refetch]);

  // Show a medals column only when some discipline used the medal scheme.
  const showMedals = rows.some((r) => r.detail && (r.detail.gold || r.detail.silver || r.detail.bronze));

  // Medal leader = top of the medal tally (gold, then silver/bronze); points leader = rank 1.
  const medalLeader = rankMedals(rows)[0]?.row;
  const pointsLeader = rows[0];

  return (
    <div className="space-y-4">
      {/* Two up on a phone, three across at sm+. Stacked full-width they were a
          column of three near-square tiles introducing a table nobody had reached
          yet; side by side they read as a summary, which is what they are. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4">
        {view === 'medals' ? (
          <>
            <StatCard label="Sports & disciplines" value={draws.length} />
            <StatCard label={entrants} value={rows.length} />
            <div className="col-span-2 sm:col-span-1">
              <StatCard label="Medal leader" value={medalLeader?.short_name ?? medalLeader?.name ?? '-'} accent />
            </div>
          </>
        ) : (
          <>
            <StatCard label="Completed matches" value={data?.completed_matches ?? 0} />
            <StatCard label={`${entrants} scoring`} value={rows.length} />
            <StatCard label="Leader" value={pointsLeader?.short_name ?? pointsLeader?.name ?? '-'} accent />
          </>
        )}
      </div>

      <Card>
        <CardHeader
          title="Championship table"
          subtitle={`${scopeLabel} · computed from completed fixtures, scored by each discipline's rule`}
          action={
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <RefreshBar updatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} />
              <SharePublicLink eventId={eventId} />
            </div>
          }
        />
        <CardBody className="space-y-4">
          {!isLoading && rows.length > 0 && (
            <Tabs active={view} onChange={(v) => setView(v as 'points' | 'medals')}
              tabs={[{ id: 'medals', label: 'Medal tally' }, { id: 'points', label: 'Points table' }]} />
          )}
          {isLoading ? <Spinner /> : rows.length === 0 ? (
            <EmptyState icon={<Trophy size={24} />} title="No results yet" description="Standings populate as officials complete matches with scores." />
          ) : view === 'medals' ? (
            <StandingsMedalTable rows={rows} base={`/championships/${eventId}`} scope={scope} scopeId={scopeId} />
          ) : (
            <>
            {/* ---------------- phone: a league table that fits ----------------
                Eight columns - #, name, P, W, D, L, Medals, Pts - is a horizontal
                scroll on a 390px screen, and the two that matter (who, and how many
                points) sit at opposite ends of the drag. Two lines instead: the
                position, the squad's short name and its points on the first, the
                record and any medals on the second. Same rows, same expansion, no
                sideways movement. */}
            <div className="sm:hidden">
              {rows.map((r, i) => {
                const isOpen = expanded === r.entity_id;
                return (
                  <div key={r.entity_id} className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : r.entity_id)}
                      aria-expanded={isOpen}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-1 py-2.5 text-left transition-colors',
                        isOpen && 'bg-slate-50 dark:bg-slate-800/40',
                      )}
                    >
                      <RankBadge pos={r.rank ?? i + 1} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                          {r.name || r.short_name}
                        </span>
                        {/* The record, as one muted run. Colour still carries won
                            and lost, and the letters carry them for anybody who
                            cannot see the colour. */}
                        <span className="t-meta mt-0.5 flex items-center gap-2 tabular-nums">
                          <span>P{r.played}</span>
                          <span className="text-emerald-600 dark:text-emerald-400">W{r.won}</span>
                          <span>D{r.drawn}</span>
                          <span className="text-rose-500 dark:text-rose-400">L{r.lost}</span>
                          {showMedals && (['gold', 'silver', 'bronze'] as const).map((m) => (
                            r.detail?.[m] ? (
                              <span key={m} className="inline-flex items-center gap-0.5">
                                <span className={`medal-pip medal-pip--${m}`} />{r.detail[m]}
                              </span>
                            ) : null
                          ))}
                        </span>
                      </span>
                      <Badge tone="brand">{r.points}</Badge>
                      <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    {isOpen && (
                      <div className="pb-3">
                        <StandingsBreakdown base={`/championships/${eventId}`} scope={scope} scopeId={scopeId} entityId={r.entity_id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hidden sm:block">
            <Table>
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-3 py-3 text-center">P</th>
                  <th className="px-3 py-3 text-center">W</th>
                  <th className="px-3 py-3 text-center">D</th>
                  <th className="px-3 py-3 text-center">L</th>
                  {showMedals && <th className="px-3 py-3 text-center">Medals</th>}
                  <th className="px-4 py-3 text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isOpen = expanded === r.entity_id;
                  const colSpan = 7 + (showMedals ? 1 : 0);
                  return (
                  <Fragment key={r.entity_id}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : r.entity_id)}
                    className={cn('cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40', isOpen && 'bg-slate-50 dark:bg-slate-800/40')}
                    title="Show how these points were earned"
                  >
                    <td className="px-4 py-3"><RankBadge pos={r.rank ?? i + 1} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform dark:text-slate-500', isOpen && 'rotate-180')} />
                        <Avatar name={r.name} size={30} />
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800 dark:text-slate-200">{r.name}</span>
                          {r.org_unit?.parent && (
                            <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">{r.org_unit.parent}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600 dark:text-slate-300">{r.played}</td>
                    <td className="px-3 py-3 text-center font-semibold text-emerald-600">{r.won}</td>
                    <td className="px-3 py-3 text-center text-slate-500 dark:text-slate-400">{r.drawn}</td>
                    <td className="px-3 py-3 text-center text-rose-500">{r.lost}</td>
                    {showMedals && (
                      <td className="px-3 py-3 text-center text-sm tabular-nums">
                        {(['gold', 'silver', 'bronze'] as const).map((m, mi) =>
                          r.detail?.[m] ? (
                            <span key={m} className="mr-1.5 inline-flex items-center gap-0.5 whitespace-nowrap">
                              <span className={`medal-pip medal-pip--${m}`} />
                              <span>{r.detail[m]}</span>
                            </span>
                          ) : null,
                        )}
                        {!r.detail?.gold && !r.detail?.silver && !r.detail?.bronze && <span className="text-slate-300 dark:text-slate-600">-</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center"><Badge tone="brand">{r.points}</Badge></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60 dark:bg-slate-800/20">
                      <td colSpan={colSpan} className="px-4 pb-4 pt-0">
                        <StandingsBreakdown base={`/championships/${eventId}`} scope={scope} scopeId={scopeId} entityId={r.entity_id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </Table>
            </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
