import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi } from '../../lib/hooks';
import { Badge, Card, EmptyState, Spinner, StatusBadge, cn } from '../../components/ui';

// A flattened fixture row from GET /championships/:id/fixtures.
interface ResultRow {
  id: string;
  status: string;
  round: string | null;
  entry_type: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  sport: string | null;
  sport_icon: string | null;
  tournament: { id: string; name: string } | null;
  discipline: string | null;
  home: { id: string; name: string; organizations?: { short_name?: string | null; name?: string | null } | null } | null;
  away: { id: string; name: string; organizations?: { short_name?: string | null; name?: string | null } | null } | null;
}

const teamCode = (t: ResultRow['home']) =>
  (t?.organizations?.short_name || t?.name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '··';

// The dark square chip used for each side of a match (e.g. "INF", "WIP"). When the
// side isn't decided yet (knockout placeholder / bye), show a clear "TBD" chip so
// the match still reads as a listed fixture instead of an empty row.
function TeamChip({ team, winner }: { team: ResultRow['home']; winner?: boolean }) {
  if (!team) {
    return (
      <span
        className="grid h-9 min-w-9 place-items-center rounded-lg border border-dashed border-slate-300 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500"
        title="To be decided"
      >
        TBD
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg text-[11px] font-bold tracking-tight',
        winner ? 'bg-brand-500 text-white' : 'bg-slate-900 text-slate-100 dark:bg-slate-800',
      )}
      title={team.name}
    >
      {teamCode(team)}
    </span>
  );
}

export function ResultsPage() {
  const { eventId, canManage } = useEvent();
  const navigate = useNavigate();
  const { data: fixtures = [], isLoading, isFetching } = useApi<ResultRow[]>(`/championships/${eventId}/fixtures`);

  // Tournament + Sport filters live in the shared header; options come from the
  // fixtures present. Tournament sits first, defaulting to "All tournaments".
  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    fixtures.forEach((f) => { if (f.tournament) map.set(f.tournament.id, f.tournament.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [fixtures]);
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    fixtures.forEach((f) => { if (f.sport) set.add(f.sport); });
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [fixtures]);
  const { tournamentId, sportId } = usePageFilters({
    tournaments: tournamentOptions.length ? tournamentOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const rows = useMemo(
    () => fixtures.filter((f) =>
      (!tournamentId || f.tournament?.id === tournamentId) &&
      (!sportId || f.sport === sportId)),
    [fixtures, tournamentId, sportId],
  );

  // Group matches by their draw (sport + discipline) so the list reads as sections
  // instead of one long flat run. Groups keep first-appearance order; rows keep the
  // scheduled order from the API.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; sport: string | null; discipline: string | null; icon: string | null; rows: ResultRow[] }>();
    for (const f of rows) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [rows]);

  const open = (f: ResultRow) => {
    if (!canManage) return;
    navigate(`/score/${f.id}`, { state: { from: `/championships/${eventId}/results` } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canManage
            ? 'Tap a match to enter its result. Standings recalculate instantly.'
            : 'Live scores and final results across the championship.'}
        </p>
        {/* Background refresh (e.g. returning here right after a sign-off) keeps the
            list visible but signals that the latest scores are being pulled. */}
        {isFetching && !isLoading && <Spinner label="Refreshing…" />}
      </div>

      {isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState
          icon="🏁"
          title={fixtures.length === 0 ? 'No fixtures yet' : 'No matches for this sport'}
          description={fixtures.length === 0
            ? (canManage ? 'Generate draws on the Schedule tab — matches appear here for scoring.' : 'Results will appear here once matches are scheduled and played.')
            : 'Clear the sport filter or pick another sport.'}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-base">{g.icon ?? '◇'}</span>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {g.sport ?? 'Sport'}
                  {g.discipline && <span className="font-medium text-slate-400 dark:text-slate-500"> · {g.discipline}</span>}
                </h3>
                <Badge tone="slate">{g.rows.length}</Badge>
              </div>

              {g.rows.map((f) => {
                const individual = f.entry_type === 'individual';
                const completed = f.status === 'completed' || f.status === 'confirmed';
                const scored = !individual && f.home_score != null && f.away_score != null;
                return (
                  <Card key={f.id} interactive={canManage} onClick={() => open(f)} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:p-4">
                    <div className="w-24 shrink-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" title={f.round ?? undefined}>
                      {f.round || '—'}
                    </div>

                    {individual ? (
                      <div className="flex flex-1 items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-slate-500 dark:bg-slate-800">··</span>
                        <span className="text-slate-300 dark:text-slate-600">··</span>
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-slate-500 dark:bg-slate-800">··</span>
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center gap-3">
                        <TeamChip team={f.home} winner={f.winner_team_id != null && f.winner_team_id === f.home?.id} />
                        <span className="min-w-[3ch] text-center text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
                          {scored ? `${f.home_score}–${f.away_score}` : <span className="text-slate-300 dark:text-slate-600">··</span>}
                        </span>
                        <TeamChip team={f.away} winner={f.winner_team_id != null && f.winner_team_id === f.away?.id} />
                      </div>
                    )}

                    <div className="ml-auto flex items-center gap-3">
                      {individual ? (
                        <StatusBadge status="" label="Individual" />
                      ) : (
                        <StatusBadge status={f.status} />
                      )}
                      {canManage && (
                        <span className="text-sm font-semibold text-brand-600 dark:text-brand-300">
                          {completed ? 'Edit' : 'Record →'}
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
