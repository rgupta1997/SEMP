import { useApi } from '../lib/hooks';
import { Badge, Spinner, cn } from './ui';

// Mirrors BreakdownMatch / BreakdownEvent from the standings service.
interface BreakdownMatch {
  round: string | null;
  opponent: string;
  result: 'won' | 'lost' | 'drawn' | 'bye';
  score: string | null;
  points: number | null;
}
interface BreakdownEvent {
  draw_id: string;
  sport: string;
  discipline: string | null;
  scheme: string;
  points: number;
  won: number;
  drawn: number;
  lost: number;
  detail: Record<string, number>;
  matches: BreakdownMatch[];
}

// Friendly labels for the placement/medal/participation keys the schemes emit.
const DETAIL_LABELS: Record<string, string> = {
  winner: 'Winner', runner_up: 'Runner-up', third_place: '3rd place', fourth_place: '4th place',
  semi_finalist: 'Semi-finalist', quarter_finalist: 'Quarter-finalist',
  gold: 'Gold', silver: 'Silver', bronze: 'Bronze', participation: 'Participation',
};

const RESULT_STYLE: Record<BreakdownMatch['result'], { label: string; cls: string }> = {
  won: { label: 'W', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  lost: { label: 'L', cls: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  drawn: { label: 'D', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  bye: { label: 'Bye', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-300' },
};

// Expanded standings-row content: how an org's points were earned, grouped by event
// (sport · discipline). `base` is the championship API path (authed or public token).
export function StandingsBreakdown({ base, scope, scopeId, entityId }: { base: string; scope: string; scopeId: string | null; entityId: string }) {
  const q = `?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}&entityId=${entityId}`;
  const { data, isLoading } = useApi<{ events: BreakdownEvent[] }>(`${base}/standings/breakdown${q}`);
  const events = data?.events ?? [];

  if (isLoading) return <div className="py-4"><Spinner /></div>;
  if (events.length === 0) {
    return <p className="px-1 py-3 text-sm text-slate-400 dark:text-slate-500">No completed matches behind this total yet.</p>;
  }

  return (
    <div className="space-y-3 py-1">
      {events.map((e) => (
        <div key={e.draw_id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {e.sport}
              {e.discipline && <span className="font-medium text-slate-400 dark:text-slate-500"> · {e.discipline}</span>}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{e.won}W</span>
              <span>{e.drawn}D</span>
              <span className="text-rose-500">{e.lost}L</span>
              <Badge tone="brand">+{e.points} pts</Badge>
            </div>
          </div>

          {/* Placement / medal / participation contributions (draw-level, not per match). */}
          {Object.keys(e.detail).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(e.detail).map(([k, v]) => (
                <Badge key={k} tone="violet">{DETAIL_LABELS[k] ?? k}{v > 1 ? ` ×${v}` : ''}</Badge>
              ))}
            </div>
          )}

          {e.matches.length > 0 && (
            <ul className="mt-2 space-y-1">
              {e.matches.map((m, i) => {
                const rs = RESULT_STYLE[m.result];
                return (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className={cn('grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 text-[11px] font-bold', rs.cls)}>{rs.label}</span>
                    {m.round && <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{m.round}</span>}
                    <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">vs {m.opponent}</span>
                    {m.score && <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{m.score}</span>}
                    {m.points != null && <span className="shrink-0 font-semibold tabular-nums text-brand-600 dark:text-brand-400">+{m.points}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
