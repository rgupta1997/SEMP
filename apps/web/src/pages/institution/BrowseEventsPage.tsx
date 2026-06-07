import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { usePermissions } from '../../lib/permissions';
import { api } from '../../lib/api';
import { useApi, useApiMutation, useTableControls, fmtDateRange } from '../../lib/hooks';
import { Badge, Button, Card, EmptyState, ListToolbar, PageHeader, Pagination, SearchInput, Spinner, StatusBadge, toast } from '../../components/ui';

export function BrowseEventsPage() {
  const { ctx } = useAuth();
  const canManage = usePermissions().can('team.manage'); // POC only
  const navigate = useNavigate();
  const institutionId = ctx?.institution?.id ?? ctx?.user.institution_id ?? null;
  const { data: events = [], isLoading } = useApi<any[]>('/events');
  const { data: enrollments = [] } = useApi<any[]>('/me/enrollments');

  const apply = useApiMutation(
    (eventId: string) => api('POST', `/events/${eventId}/enroll`, { institution_id: institutionId }),
    ['/me/enrollments'],
  );

  const statusFor = (eventId: string) => enrollments.find((e) => e.event_id === eventId)?.status as string | undefined;
  const open = events.filter((e) => e.status === 'registration_open' || statusFor(e.id));

  const tc = useTableControls(open, {
    search: (e) => `${e.name} ${e.venue ?? ''}`,
    sorts: { name: (a, b) => String(a.name).localeCompare(String(b.name)), start: (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime() },
    initialSort: 'start',
    pageSize: 12,
  });

  if (!institutionId) {
    return <EmptyState icon="🏛" title="No institution linked" description="Your account must be linked to an institution before you can apply to events." />;
  }

  return (
    <div>
      <PageHeader title="Browse events" subtitle="Apply to participate — once approved you can enter teams." />
      {open.length > 0 && (
        <ListToolbar>
          <SearchInput value={tc.query} onChange={tc.setQuery} placeholder="Search events…" className="w-full sm:w-72" />
        </ListToolbar>
      )}
      {isLoading ? <Spinner /> : open.length === 0 ? (
        <EmptyState icon="◆" title="No open events" description="Events appear here once an organiser opens registration. If you expect to see one, ask the organiser to click “Open registration” on the event." />
      ) : tc.total === 0 ? (
        <EmptyState icon="◆" title="No matching events" description="Try a different search." />
      ) : (
        <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tc.view.map((e) => {
            const status = statusFor(e.id);
            return (
              <Card key={e.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 dark:bg-brand-500/10 text-lg font-black text-brand-600 dark:text-brand-300">{e.name.slice(0, 1)}</span>
                  <StatusBadge status={e.status} />
                </div>
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{e.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{e.venue || 'Venue TBD'} · {fmtDateRange(e.start_date, e.end_date)}</p>
                <div className="mt-4 flex-1" />
                {status === 'approved' ? (
                  <Button className="w-full" onClick={() => navigate(`/inst/teams?event=${e.id}`)}>
                    Manage teams →
                  </Button>
                ) : status ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your application</span>
                    <StatusBadge status={status} />
                  </div>
                ) : e.status === 'registration_open' && canManage ? (
                  <Button className="w-full" disabled={apply.isPending}
                    onClick={() => apply.mutate(e.id, { onSuccess: () => toast.success('Application submitted', 'You can enter teams once approved.'), onError: (err: any) => toast.error(err.message) })}>
                    {apply.isPending ? 'Applying…' : 'Apply to participate'}
                  </Button>
                ) : e.status === 'registration_open' ? (
                  <Badge tone="brand">Open — your POC can apply</Badge>
                ) : (
                  <Badge tone="slate">Registration closed</Badge>
                )}
              </Card>
            );
          })}
        </div>
        <Pagination page={tc.page} pageCount={tc.pageCount} total={tc.total} pageSize={tc.pageSize} onPage={tc.setPage} />
        </>
      )}
    </div>
  );
}
