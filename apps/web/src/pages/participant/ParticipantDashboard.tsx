import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { CareerStats } from '../../components/participant/CareerStats';
import { EventCard } from '../../components/participant/EventCard';
import { MatchRow } from '../../components/participant/MatchRow';
import { AchievementRow } from '../../components/participant/AchievementRow';
import type { DashboardData } from '../../components/participant/types';

// Initial counts per section — the rest reveal inline via "Show more" so the
// dashboard stays scannable instead of rendering everything at once.
const CHAMP_INITIAL = 6;
const MATCH_INITIAL = 4;
const ACH_INITIAL = 4;

// Reveals the remaining items in a section on click (reveal-all).
function ShowMore({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <div className="mt-3 text-center">
      <Button variant="ghost" size="sm" onClick={onClick}>Show {hidden} more</Button>
    </div>
  );
}

export function ParticipantDashboard() {
  const { ctx } = useAuth();
  const user = ctx!.user;
  const { data, isLoading } = useApi<DashboardData>('/me/dashboard');

  const [champShown, setChampShown] = useState(CHAMP_INITIAL);
  const [matchShown, setMatchShown] = useState(MATCH_INITIAL);
  const [achShown, setAchShown] = useState(ACH_INITIAL);

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Your matches and championships across the platform." />

      {isLoading || !data ? (
        <Spinner />
      ) : data.stats.total_events === 0 ? (
        <EmptyState
          icon="◎"
          title="You haven't participated in any championships yet"
          description="Join a team via an invite link from your captain — your championships and matches will show up here."
        />
      ) : (
        <>
          <CareerStats stats={data.stats} />

          {data.achievements.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Achievements</h2>
              <div className="space-y-2">
                {data.achievements.slice(0, achShown).map((a) => <AchievementRow key={a.id} achievement={a} />)}
              </div>
              <ShowMore hidden={data.achievements.length - achShown} onClick={() => setAchShown(data.achievements.length)} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">My championships</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.championships.slice(0, champShown).map((e) => <EventCard key={e.id} championship={e} />)}
            </div>
            <ShowMore hidden={data.championships.length - champShown} onClick={() => setChampShown(data.championships.length)} />
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Recent matches</h2>
              <Link to="/profile/matches" className="text-sm font-semibold text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200">All matches →</Link>
            </div>
            {data.recent_matches.length === 0 ? (
              <Card><CardBody className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches scheduled yet.</CardBody></Card>
            ) : (
              <>
                <div className="space-y-2">
                  {data.recent_matches.slice(0, matchShown).map((m) => <MatchRow key={m.id} match={m} />)}
                </div>
                <ShowMore hidden={data.recent_matches.length - matchShown} onClick={() => setMatchShown(data.recent_matches.length)} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
