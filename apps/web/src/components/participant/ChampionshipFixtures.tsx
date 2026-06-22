import { useMemo, useState } from 'react';
import { Calendar, Flag } from 'lucide-react';
import { useApi, fmtDateTime } from '../../lib/hooks';
import { Badge, Card, EmptyState, ListToolbar, Select, Spinner, StatusBadge, cn } from '../../components/ui';

// A flattened fixture from GET /championships/:id/fixtures.
interface FixtureRow {
  id: string; status: string; round: string | null; scheduled_at: string | null;
  entry_type: string | null; home_score: number | null; away_score: number | null; winner_team_id: string | null;
  ground: { id: string; name: string; venue: string | null } | null;
  sport: string | null; sport_icon: string | null;
  tournament: { id: string; name: string } | null; discipline: string | null;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
}

const RESULT_STATUSES = new Set(['completed', 'walkover', 'bye', 'cancelled']);

function teamLabel(t: FixtureRow['home']) { return t?.name ?? 'TBD'; }

// Read-only, whole-championship fixtures for the participant view — the same
// schedule / results a spectator sees from Discover, so players can follow every
// match (not just their own). `schedule` is the full fixture list (upcoming +
// concluded); `results` narrows to matches that have concluded.
export function ChampionshipFixtures({ championshipId, mode }: { championshipId: string; mode: 'schedule' | 'results' }) {
  const { data: all = [], isLoading } = useApi<FixtureRow[]>(`/championships/${championshipId}/fixtures`);
  const [sport, setSport] = useState('');

  // Schedule shows every fixture (the championship calendar); Results only those
  // that have concluded.
  const inMode = useMemo(
    () => (mode === 'schedule' ? all : all.filter((f) => RESULT_STATUSES.has(f.status))),
    [all, mode],
  );
  const sportOptions = useMemo(
    () => [...new Set(inMode.map((f) => f.sport).filter(Boolean))].sort() as string[],
    [inMode],
  );
  const rows = useMemo(
    () => inMode.filter((f) => !sport || f.sport === sport),
    [inMode, sport],
  );

  // Group by sport + discipline so the list reads as sections.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; sport: string | null; discipline: string | null; icon: string | null; rows: FixtureRow[] }>();
    for (const f of rows) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [rows]);

  if (isLoading) return <Spinner />;
  if (inMode.length === 0) {
    return (
      <EmptyState
        icon={mode === 'schedule' ? <Calendar size={24} /> : <Flag size={24} />}
        title={mode === 'schedule' ? 'Nothing scheduled' : 'No results yet'}
        description={mode === 'schedule' ? 'Upcoming matches will appear here once they are scheduled.' : 'Results appear here as matches are played.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      {sportOptions.length > 1 && (
        <ListToolbar>
          <Select value={sport} onChange={(e) => setSport(e.target.value)} className="w-auto" aria-label="Filter by sport">
            <option value="">All sports</option>
            {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </ListToolbar>
      )}

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
            const scored = f.home_score != null && f.away_score != null;
            const homeWon = f.winner_team_id != null && f.winner_team_id === f.home?.id;
            const awayWon = f.winner_team_id != null && f.winner_team_id === f.away?.id;
            return (
              <Card key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:p-4">
                <div className="w-24 shrink-0 truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" title={f.round ?? undefined}>
                  {f.round || '—'}
                </div>

                <div className="flex flex-1 items-center justify-center gap-3 text-sm">
                  <span className={cn('min-w-[6rem] text-right', homeWon ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>{teamLabel(f.home)}</span>
                  <span className="min-w-[3.5ch] text-center font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {scored
                      ? `${f.home_score}–${f.away_score}`
                      : <span className="text-slate-300 dark:text-slate-600">v</span>}
                  </span>
                  <span className={cn('min-w-[6rem] text-left', awayWon ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>{teamLabel(f.away)}</span>
                </div>

                <div className="ml-auto flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {mode === 'schedule' && f.scheduled_at && <span>{fmtDateTime(f.scheduled_at)}</span>}
                  {mode === 'schedule' && f.ground && <span className="hidden sm:inline">{f.ground.name}</span>}
                  <StatusBadge status={f.status} />
                </div>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
