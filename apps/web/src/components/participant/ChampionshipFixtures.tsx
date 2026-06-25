import { useMemo, useState } from 'react';
import { Calendar, Flag } from 'lucide-react';
import { useApi, fmtDateTime } from '../../lib/hooks';
import { Badge, Card, EmptyState, ListToolbar, Select, Spinner, StatusBadge, StatusLegend, cn } from '../../components/ui';

// A flattened fixture from GET /championships/:id/fixtures.
interface TeamRef { id: string; name: string; organizations?: { short_name: string | null; name: string } | null }
interface FixtureRow {
  id: string; status: string; round: string | null; scheduled_at: string | null;
  entry_type: string | null; home_score: number | null; away_score: number | null; winner_team_id: string | null;
  ground: { id: string; name: string; venue: string | null } | null;
  sport: string | null; sport_icon: string | null;
  tournament: { id: string; name: string } | null; discipline: string | null;
  scorecard_url: string | null;
  home: TeamRef | null;
  away: TeamRef | null;
}

// Results shows concluded matches AND in-progress ones (live), so a live match with
// a running score appears here (marked LIVE) instead of only on the Schedule.
const RESULT_STATUSES = new Set(['live', 'completed', 'walkover', 'bye', 'cancelled']);

function teamLabel(t: TeamRef | null) { return t?.name ?? 'TBD'; }
function orgLabel(t: TeamRef | null) { return t?.organizations?.short_name || t?.organizations?.name || ''; }

// Ranking events (powerlifting/swimming/athletics) have no head-to-head matchup -
// everyone competes for a single ranking - so the generator emits one team-less
// fixture with round 'Event'. Showing "TBD v TBD" there is wrong: there's no
// opponent to decide. We show the discipline name + a Ranking event tag instead.
function isRankingEvent(f: FixtureRow) { return f.round === 'Event' && !f.home && !f.away; }

// Team name with its organization as a sub-heading underneath, so teams are
// distinguishable across orgs on the schedule/results.
function TeamName({ team, align, won }: { team: TeamRef | null; align: 'left' | 'right'; won: boolean }) {
  return (
    <div className={cn('min-w-[7rem]', align === 'right' ? 'text-right' : 'text-left', won ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300')}>
      <div className="truncate">{teamLabel(team)}</div>
      {orgLabel(team) && <div className="truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{orgLabel(team)}</div>}
    </div>
  );
}

// Read-only, whole-championship fixtures for the participant view - the same
// schedule / results a spectator sees from Discover, so players can follow every
// match (not just their own). `schedule` is the full fixture list (upcoming +
// concluded); `results` narrows to matches that have concluded.
export function ChampionshipFixtures({ championshipId, mode, apiBase }: { championshipId: string; mode: 'schedule' | 'results'; apiBase?: string }) {
  const base = apiBase ?? `/championships/${championshipId}`;
  const { data: all = [], isLoading } = useApi<FixtureRow[]>(`${base}/fixtures`);
  const [sport, setSport] = useState('');
  // Status filter is driven by clicking the colour legend (empty = show all).
  const [legendStatus, setLegendStatus] = useState('');

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
    () => inMode.filter((f) => (!sport || f.sport === sport) && (!legendStatus || f.status === legendStatus)),
    [inMode, sport, legendStatus],
  );

  // Only offer legend statuses that actually occur in this tab's data, in canonical
  // order - so Results never shows a "Live" filter (it only holds concluded matches).
  const legendStatuses = useMemo(() => {
    const order = ['scheduled', 'live', 'completed', 'walkover', 'bye', 'postponed', 'cancelled'];
    const present = new Set(inMode.map((f) => f.status));
    return order.filter((s) => present.has(s));
  }, [inMode]);

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

      {/* Click a status to filter the list (click again / Clear to reset). Only the
          statuses present in this tab are offered. */}
      {legendStatuses.length > 0 && (
        <StatusLegend className="px-1" statuses={legendStatuses} value={legendStatus} onSelect={setLegendStatus} />
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
                  {f.round || '-'}
                </div>

                <div className="flex flex-1 items-center justify-center gap-3 text-sm">
                  {isRankingEvent(f) ? (
                    <div className="flex items-center justify-center gap-2 text-center">
                      <span className="truncate font-semibold text-slate-700 dark:text-slate-200" title={f.discipline ?? f.sport ?? undefined}>
                        {f.discipline ?? f.sport ?? 'Event'}
                      </span>
                      <Badge tone="violet">Ranking event</Badge>
                    </div>
                  ) : (
                    <>
                      <TeamName team={f.home} align="right" won={homeWon} />
                      <span className="min-w-[3.5ch] self-start pt-0.5 text-center font-bold tabular-nums text-slate-800 dark:text-slate-100">
                        {scored
                          ? `${f.home_score}–${f.away_score}`
                          : <span className="text-slate-300 dark:text-slate-600">v</span>}
                      </span>
                      <TeamName team={f.away} align="left" won={awayWon} />
                    </>
                  )}
                </div>

                <div className="ml-auto flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  {f.scorecard_url && (
                    <a href={f.scorecard_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline dark:text-brand-400" onClick={(e) => e.stopPropagation()}>
                      Scorecard ↗
                    </a>
                  )}
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
