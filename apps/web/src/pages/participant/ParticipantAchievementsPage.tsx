import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi, fmtDate } from '../../lib/hooks';
import { Badge, BackButton, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, cn } from '../../components/ui';
import type { Achievement } from '../../components/participant/types';

interface AchievementsResponse { achievements: Achievement[] }

const RESULT_STYLE: Record<string, string> = {
  won: 'text-emerald-600 dark:text-emerald-400',
  lost: 'text-rose-500 dark:text-rose-400',
  draw: 'text-slate-500 dark:text-slate-400',
  pending: 'text-slate-400 dark:text-slate-500',
};

// Full, drilled-down view of every award the participant has earned — grouped by
// award name, each occurrence linking to its match. Reached from the dashboard's
// "All achievements →" link.
export function ParticipantAchievementsPage() {
  const { data, isLoading } = useApi<AchievementsResponse>('/me/achievements');

  const groups = useMemo(() => {
    const map = new Map<string, Achievement[]>();
    for (const a of data?.achievements ?? []) {
      const list = map.get(a.award_name) ?? [];
      list.push(a);
      map.set(a.award_name, list);
    }
    return [...map.entries()]
      .map(([award_name, items]) => ({ award_name, items }))
      .sort((a, b) => b.items.length - a.items.length || a.award_name.localeCompare(b.award_name));
  }, [data?.achievements]);

  return (
    <div className="space-y-5">
      <PageHeader title="Achievements" subtitle="Every award you've earned across your championships.">
        <BackButton to="/profile" className="mb-0">Dashboard</BackButton>
      </PageHeader>

      {isLoading ? <Spinner /> : groups.length === 0 ? (
        <EmptyState icon={<Trophy size={24} />} title="No achievements yet" description="Awards you receive from match officials will appear here." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.award_name}>
              <CardHeader
                title={<span className="flex items-center gap-2"><Trophy size={16} className="text-amber-500" aria-hidden />{g.award_name}</span>}
                action={<Badge tone="amber">{g.items.length}×</Badge>}
              />
              <CardBody className="pt-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {g.items.map((a) => {
                    const meta = [
                      a.championship?.name,
                      a.tournament?.name,
                      [a.sport, a.discipline].filter(Boolean).join(' ') || null,
                      a.round,
                    ].filter(Boolean).join(' · ');
                    const row = (
                      <div className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{meta || '—'}</div>
                          {a.opponent_team_name && (
                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {a.my_team_name ? `${a.my_team_name} ` : ''}vs {a.opponent_team_name}
                              {a.result && a.result !== 'pending' && (
                                <span className={cn('ml-2 font-semibold capitalize', RESULT_STYLE[a.result])}>{a.result}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {a.date && <span className="flex-none text-xs text-slate-400 dark:text-slate-500">{fmtDate(a.date)}</span>}
                      </div>
                    );
                    return (
                      <li key={a.id}>
                        {a.fixture_id ? (
                          <Link to={`/profile/matches/${a.fixture_id}`} className="block rounded-lg px-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                            {row}
                          </Link>
                        ) : row}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
