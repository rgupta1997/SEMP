import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateRange } from '../../lib/hooks';
import { BackButton, Button, Spinner, StatusBadge } from '../../components/ui';

export interface EventDetail {
  id: string; name: string; slug: string; status: string;
  venue?: string; description?: string; start_date: string; end_date: string;
}
interface EventCtx { event: EventDetail; eventId: string }
export const useEvent = () => useOutletContext<EventCtx>();

// The legal "next" status + button label for the go-live flow.
const NEXT_STATUS: Record<string, { to: string; label: string } | null> = {
  draft: { to: 'registration_open', label: 'Open registration' },
  registration_open: { to: 'ongoing', label: 'Start event' },
  ongoing: { to: 'completed', label: 'Mark completed' },
  completed: null,
};

export function EventLayout() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data: event, isLoading } = useApi<EventDetail>(`/events/${eventId}`);
  const statusMut = useApiMutation(
    (status: string) => api('PATCH', `/events/${eventId}/status`, { status }),
    [`/events/${eventId}`, '/events'],
  );

  if (isLoading || !event) return <Spinner />;
  const next = NEXT_STATUS[event.status];

  return (
    <div>
      <BackButton onClick={() => navigate('/events')}>All events</BackButton>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{event.venue || 'Venue TBD'} · {fmtDateRange(event.start_date, event.end_date)}</p>
        </div>
        {next && (
          <Button
            onClick={() => statusMut.mutate(next.to, { onError: (e: any) => alert(e.message) })}
            disabled={statusMut.isPending}
          >
            {statusMut.isPending ? 'Updating…' : next.label} →
          </Button>
        )}
      </div>

      <Outlet context={{ event, eventId: eventId! } satisfies EventCtx} />
    </div>
  );
}
