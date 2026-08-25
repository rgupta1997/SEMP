import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { Card, PageHeader, Skeleton, cn } from '../../components/ui';

// The institution's Hall of Fame (J4-E9).
//
// Two scopes, never merged. A squad medal already fanned out to a row per player, so a
// single combined list would count the same honour once for the team and again for
// every member of it - and an honours board that cannot be counted is decoration.

interface Row {
  id: string; date: string; kind: string; medal: string | null; title: string;
  recipient: string | null; sport: string | null; championship_id: string | null;
}
interface Leader { user_id: string; name: string; gold: number; silver: number; bronze: number; awards: number; total_medals: number }
interface Board { scope: string; rows: Row[]; leaderboard: Leader[]; sports: Array<{ id: string; name: string }> }

const MEDAL_STYLE: Record<string, string> = {
  gold: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  silver: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  bronze: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
};
const MEDAL_ICON: Record<string, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function OrgAchievementsPage() {
  const { orgId } = useParams();
  const [scope, setScope] = useState<'teams' | 'individuals'>('teams');
  const [sportId, setSportId] = useState('');

  const qs = new URLSearchParams({ scope, ...(sportId ? { sport_id: sportId } : {}) });
  const { data, isLoading } = useApi<Board>(orgId ? `/organizations/${orgId}/achievements?${qs}` : null);

  const chip = (active: boolean) => cn(
    'rounded-full px-3 py-1.5 text-sm font-medium transition',
    active ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
      : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  );

  return (
    <div className="grid gap-5">
      <PageHeader title="Achievements" subtitle="Track and celebrate milestones across teams and individuals.">
        <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {(['teams', 'individuals'] as const).map((s) => (
            <button
              key={s} type="button" onClick={() => setScope(s)} aria-current={scope === s}
              className={cn('rounded-md px-4 py-1.5 text-sm font-medium capitalize transition',
                scope === s ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}
            >{s}</button>
          ))}
        </div>
      </PageHeader>

      {/* Only sports this institution has actually won something in. */}
      {(data?.sports.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(!sportId)} onClick={() => setSportId('')}>All sports</button>
          {data!.sports.map((s) => (
            <button key={s.id} type="button" className={chip(sportId === s.id)} onClick={() => setSportId(s.id)}>{s.name}</button>
          ))}
        </div>
      )}

      {isLoading || !data ? <Skeleton className="h-56" /> : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {scope === 'teams' ? 'Team honours' : 'Individual honours'}
              </h2>
            </div>
            {data.rows.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Trophy size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Nothing here yet. Honours appear the moment a result is locked — they are never entered by hand.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    {r.medal
                      ? <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', MEDAL_STYLE[r.medal])}>{MEDAL_ICON[r.medal]} {r.medal}</span>
                      : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.kind}</span>}
                    <span className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200">{r.title}</span>
                    {r.recipient && <span className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">{r.recipient}</span>}
                    <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-0">
            <div className="border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Spotlight</h2>
            </div>
            {data.leaderboard.length === 0
              ? <p className="px-4 py-8 text-sm text-slate-500 dark:text-slate-400">No individual honours recorded yet.</p>
              : (
                <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.leaderboard.map((p, i) => (
                    <li key={p.user_id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-4 text-right text-sm tabular-nums text-slate-400">{i + 1}</span>
                      <Link to={`/people/${p.user_id}/record`} className="min-w-0 flex-1 truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {p.name}
                      </Link>
                      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {p.gold ? `${p.gold}🥇 ` : ''}{p.silver ? `${p.silver}🥈 ` : ''}{p.bronze ? `${p.bronze}🥉` : ''}
                        {p.awards ? ` ${p.awards}★` : ''}
                        {!p.total_medals && !p.awards ? '—' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
          </Card>
        </div>
      )}
    </div>
  );
}
