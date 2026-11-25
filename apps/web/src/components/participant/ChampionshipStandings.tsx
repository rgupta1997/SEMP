import { Fragment, useEffect, useMemo, useState } from 'react';
import { useApi } from '../../lib/hooks';
import { ChevronDown, Trophy } from 'lucide-react';
import { EmptyState, PILL_PICK, RefreshBar, cn } from '../../components/ui';
import { PickList } from '../PickList';
import { TeamAvatar, ViewTabs } from '../../features/schedule/ScheduleParts';
import { StandingsBreakdown } from '../StandingsBreakdown';
import { RankBadge } from '../RankBadge';
import { StandingsMedalTable } from '../StandingsMedalTable';

// A draw row (subset of GET /:id/draws) - used only to source the tournament + sport
// filter options (with their UUIDs, which the materialized scopes are keyed by).
interface DrawRow {
  tournament_sports: {
    sports: { id: string; name: string } | null;
    tournaments: { id: string; name: string } | null;
  } | null;
}

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

const TH = 'px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400';

// Read-only standings for the participant view - the same per-scope tables the
// organiser sees. Standings are materialized one scope at a time, so the tournament
// + sport filters select a single scope (most specific wins): sport → tournament →
// whole championship.
// `apiBase` lets the public share page reuse this table against the unauthenticated
// /public/championships/:token endpoints (defaults to the authed championship path).
export function ChampionshipStandings({ championshipId, apiBase }: { championshipId: string; apiBase?: string }) {
  const base = apiBase ?? `/championships/${championshipId}`;
  const { data: draws = [] } = useApi<DrawRow[]>(`${base}/draws`);
  const [tournamentId, setTournamentId] = useState('');
  const [sportId, setSportId] = useState('');
  // Which row is expanded to show its per-event points breakdown.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Points lead: the championship is DECIDED on points; the medal tally is a second reading.
  const [view, setView] = useState<'points' | 'medals'>('points');

  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const t = d.tournament_sports?.tournaments; if (t) map.set(t.id, t.name); });
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [draws]);
  const sportOptions = useMemo(() => {
    const map = new Map<string, string>();
    draws.forEach((d) => { const s = d.tournament_sports?.sports; if (s) map.set(s.id, s.name); });
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [draws]);

  const { scope, scopeId } = useMemo(() => {
    if (sportId) return { scope: 'sport', scopeId: sportId };
    if (tournamentId) return { scope: 'tournament', scopeId: tournamentId };
    return { scope: 'championship', scopeId: null as string | null };
  }, [sportId, tournamentId]);

  const query = scopeId ? `?scope=${scope}&scopeId=${scopeId}` : `?scope=${scope}`;
  const { data, isLoading, refetch, dataUpdatedAt, isFetching } = useApi<StandingsResponse>(`${base}/standings${query}`);
  const rows = data?.standings ?? [];

  // Re-pull every 10s so spectators see standings update as matches complete.
  useEffect(() => {
    const t = setInterval(() => refetch(), 10000);
    return () => clearInterval(t);
  }, [refetch]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isLoading && rows.length > 0 && (
            <ViewTabs value={view} onChange={setView} options={[{ value: 'points', label: 'Points table' }, { value: 'medals', label: 'Medal tally' }]} />
          )}
          {tournamentOptions.length > 1 && (
            <div className="w-48"><PickList value={tournamentId} onChange={(v) => { setTournamentId(v); setSportId(''); }} ariaLabel="Filter by tournament" className={PILL_PICK}
              options={[{ value: '', label: 'All tournaments' }, ...tournamentOptions]} /></div>
          )}
          {sportOptions.length > 1 && (
            <div className="w-44"><PickList value={sportId} onChange={(v) => { setSportId(v); setTournamentId(''); }} ariaLabel="Filter by sport" className={PILL_PICK}
              options={[{ value: '', label: 'All sports' }, ...sportOptions]} /></div>
          )}
        </div>
        <RefreshBar updatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} />
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" role="status" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800">
              <span className="h-6 w-6 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" /><span className="h-8 w-8 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
              <span className="h-3 flex-1 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" /><span className="h-6 w-10 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Trophy size={22} />} title="No results yet" description="Standings populate as matches are completed." />
      ) : view === 'medals' ? (
        <StandingsMedalTable rows={rows} base={base} scope={scope} scopeId={scopeId} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/70 text-left dark:border-slate-800 dark:bg-slate-800/30">
              <tr>
                <th className={cn(TH, 'w-12 pl-4')}>#</th>
                <th className={TH}>Organization</th>
                <th className={cn(TH, 'text-center')}>P</th>
                <th className={cn(TH, 'text-center')}>W</th>
                <th className={cn(TH, 'text-center')}>D</th>
                <th className={cn(TH, 'text-center')}>L</th>
                <th className={cn(TH, 'pr-4 text-center')}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isOpen = expanded === r.entity_id;
                const pos = r.rank ?? i + 1;
                return (
                  <Fragment key={r.entity_id}>
                    <tr onClick={() => setExpanded(isOpen ? null : r.entity_id)} title="Show how these points were earned"
                      className={cn('cursor-pointer border-t border-slate-100 transition-colors first:border-t-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/30',
                        isOpen && 'bg-slate-50 dark:bg-slate-800/40', pos === 1 && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                      <td className="py-3 pl-4 pr-2"><RankBadge pos={pos} /></td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <TeamAvatar name={r.name} short={r.short_name ?? r.organization?.short_name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-slate-800 dark:text-slate-100">{r.name}</span>
                            {r.org_unit?.parent && <span className="block truncate text-[11.5px] text-slate-500 dark:text-slate-400">{r.org_unit.parent}</span>}
                          </span>
                          <ChevronDown size={15} className={cn('ml-auto shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{r.played}</td>
                      <td className="px-3 py-3 text-center font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{r.won}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-500 dark:text-slate-400">{r.drawn}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-rose-500">{r.lost}</td>
                      <td className="py-3 pl-3 pr-4 text-center">
                        <span className="inline-block min-w-[2.5rem] rounded-lg bg-[#0a1630] px-2 py-1 text-sm font-black tabular-nums text-white">{r.points}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60 dark:bg-slate-800/20">
                        <td colSpan={7} className="px-4 pb-4 pt-0">
                          <StandingsBreakdown base={base} scope={scope} scopeId={scopeId} entityId={r.entity_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
