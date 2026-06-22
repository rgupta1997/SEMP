import { Link } from 'react-router-dom';
import { useEvent } from './EventLayout';
import { useApi } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, StatCard, StatusBadge } from '../../components/ui';
import { GettingStarted } from '../../components/onboarding/GettingStarted';
import { useOrganiserOnboarding } from '../../lib/onboarding';

export function EventDashboard() {
  const { championship, eventId, canManage } = useEvent();
  const { data: tournaments = [] } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  const { data: teams = [] } = useApi<any[]>(`/teams?championship_id=${eventId}`);
  const { data: venues = [] } = useApi<any[]>(`/venues?championship_id=${eventId}`);
  const { data: enrollments = [] } = useApi<any[]>(`/championships/${eventId}/enrollments`);

  const pending = enrollments.filter((e) => e.status === 'pending');
  const approved = enrollments.filter((e) => e.status === 'approved');

  // Live "getting started" progress for this championship (organisers only).
  const onboarding = useOrganiserOnboarding(eventId, championship.status, canManage);

  const tasks: { label: string; to: string; tone: 'amber' | 'brand' }[] = [];
  if (pending.length) tasks.push({ label: `${pending.length} organization${pending.length > 1 ? 's' : ''} awaiting approval`, to: `/championships/${eventId}/approvals`, tone: 'amber' });
  if (tournaments.length === 0) tasks.push({ label: 'No tournament yet - add one to start configuring sports', to: `/championships/${eventId}/setup`, tone: 'brand' });
  if (venues.length === 0) tasks.push({ label: 'No venues added yet', to: `/championships/${eventId}/setup`, tone: 'brand' });
  if (championship.status === 'draft') tasks.push({ label: 'Championship is in draft - open registration when setup is ready', to: `/championships/${eventId}`, tone: 'brand' });

  return (
    <div className="space-y-6">
      {canManage && (
        <GettingStarted
          title="Set up your championship"
          subtitle="Work through these to take it from draft to open for registration."
          state={onboarding}
          storageKey={`onboarding-organiser-${eventId}`}
          completeNote="That set up one season. If you want to run multiple tournaments (seasons), repeat these steps for each - add the season, then its sports, disciplines and venues."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Seasons" value={tournaments.length} />
        <StatCard label="Teams" value={teams.length} hint={`${approved.length} organizations approved`} />
        <StatCard label="Pending approvals" value={pending.length} accent={pending.length > 0} hint="needs review" />
        <StatCard label="Venues" value={venues.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {canManage && (
        <Card>
          <CardHeader title="Needs your attention" subtitle="Open items blocking progress" />
          <CardBody>
            {tasks.length === 0 ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm font-medium text-emerald-700">All clear - everything is running smoothly.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <Link key={i} to={t.to} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 hover:border-brand-300 dark:hover:border-brand-500/50 hover:bg-brand-50">
                    <span className="flex items-center gap-3">
                      <span className={`h-2 w-2 rounded-full ${t.tone === 'amber' ? 'bg-amber-500' : 'bg-brand-500'}`} />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t.label}</span>
                    </span>
                    <span className="text-sm text-slate-400 dark:text-slate-500">→</span>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
        )}

        <Card>
          <CardHeader title="Seasons" action={canManage ? <Link to={`/championships/${eventId}/setup`}><Button size="sm" variant="subtle">Manage</Button></Link> : undefined} />
          <CardBody>
            {tournaments.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No seasons yet.</p>
            ) : (
              <div className="space-y-2">
                {tournaments.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{t.name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
