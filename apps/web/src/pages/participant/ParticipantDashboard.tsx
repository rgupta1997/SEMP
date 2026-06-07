import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Card, CardBody, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { CareerStats } from '../../components/participant/CareerStats';
import { EventCard } from '../../components/participant/EventCard';
import { MatchRow } from '../../components/participant/MatchRow';
import type { DashboardData } from '../../components/participant/types';

export function ParticipantDashboard() {
  const { ctx } = useAuth();
  const user = ctx!.user;
  const { data, isLoading } = useApi<DashboardData>('/me/dashboard');

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Your matches and events across the platform." />

      {isLoading || !data ? (
        <Spinner />
      ) : data.stats.total_events === 0 ? (
        <EmptyState
          icon="◎"
          title="You haven't participated in any events yet"
          description="Join a team via an invite link from your captain — your events and matches will show up here."
        />
      ) : (
        <>
          <CareerStats stats={data.stats} />

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">My events</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.events.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Recent matches</h2>
              <Link to="/me/matches" className="text-sm font-semibold text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200">All matches →</Link>
            </div>
            {data.recent_matches.length === 0 ? (
              <Card><CardBody className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">No matches scheduled yet.</CardBody></Card>
            ) : (
              <div className="space-y-2">
                {data.recent_matches.map((m) => <MatchRow key={m.id} match={m} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
