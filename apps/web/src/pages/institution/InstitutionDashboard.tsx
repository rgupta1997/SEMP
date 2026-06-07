import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, StatusBadge } from '../../components/ui';

function tournamentName(team: any): string | null {
  return team.tournament_disciplines?.tournament_sports?.tournaments?.name ?? null;
}

export function InstitutionDashboard() {
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const institutionId = ctx?.institution?.id ?? ctx?.user.institution_id ?? '';
  const { data: teams = [] } = useApi<any[]>(institutionId ? `/teams?institution_id=${institutionId}` : null);
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments');

  const sports = new Set(teams.map((t) => t.sport_id));
  const approved = enrollments.filter((e) => e.status === 'approved');
  const pending = enrollments.filter((e) => e.status === 'pending');

  return (
    <div className="space-y-6">
      <PageHeader title={ctx?.institution?.name ?? 'My institution'} subtitle="Your contingent across every event you participate in.">
        <Button variant="outline" onClick={() => navigate('/inst/events')}>Browse events</Button>
        <Button onClick={() => navigate('/inst/teams')}>Manage teams</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Teams" value={teams.length} />
        <StatCard label="Sports" value={sports.size} />
        <StatCard label="Approved events" value={approved.length} accent={approved.length > 0} />
        <StatCard label="Pending applications" value={pending.length} hint="awaiting organiser" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="My teams" action={<Link to="/inst/teams"><Button size="sm" variant="subtle">All teams</Button></Link>} />
          <CardBody>
            {teams.length === 0 ? (
              <EmptyState icon="⚇" title="No teams yet" description="Once your institution is approved for an event, enter teams here."
                action={<Button size="sm" onClick={() => navigate('/inst/teams')}>Enter a team</Button>} />
            ) : (
              <div className="space-y-2">
                {teams.map((t) => (
                  <Link key={t.id} to={`/inst/teams/${t.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3 hover:border-brand-300 dark:hover:border-brand-500/50 hover:bg-brand-50">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-50 dark:bg-brand-500/10 text-base">{t.sports?.icon ?? '◇'}</span>
                      <div>
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{[tournamentName(t), t.sports?.name, t.events?.name].filter(Boolean).join(' · ')}</div>
                      </div>
                    </div>
                    <StatusBadge status={t.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Event applications" action={<Link to="/inst/events"><Button size="sm" variant="subtle">Browse</Button></Link>} />
          <CardBody>
            {enrollments.length === 0 ? (
              <EmptyState icon="◆" title="Not enrolled anywhere" description="Browse open events and apply to participate."
                action={<Button size="sm" onClick={() => navigate('/inst/events')}>Browse events</Button>} />
            ) : (
              <div className="space-y-2">
                {enrollments.map((e) => {
                  const row = (
                    <>
                      <div>
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{e.events?.name}</div>
                        {e.status === 'rejected' && e.rejection_note && <div className="text-xs text-rose-600 dark:text-rose-400">{e.rejection_note}</div>}
                        {e.status === 'approved' && (
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Manage teams for this event →</div>
                        )}
                      </div>
                      <StatusBadge status={e.status} />
                    </>
                  );
                  if (e.status === 'approved') {
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => navigate(`/inst/teams?event=${e.event_id}`)}
                        className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50 dark:bg-slate-800/60 dark:hover:border-brand-500/50 dark:hover:bg-brand-950/30"
                      >
                        {row}
                      </button>
                    );
                  }
                  return (
                    <div key={e.id} className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
                      {row}
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {!ctx?.institution && <Badge tone="amber">Your account is not linked to an institution yet — contact an organiser to be added.</Badge>}
    </div>
  );
}
