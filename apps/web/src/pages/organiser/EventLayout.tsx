import { Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateRange } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { useWorkspace } from '../../lib/useWorkspace';
import { mayOpenSegment, parseEventSegment } from '../../lib/championship-nav';
import { BackButton, Button, Spinner, StatusBadge, toast } from '../../components/ui';

export interface EventDetail {
  id: string; name: string; slug: string; status: string;
  venue?: string; description?: string; start_date: string; end_date: string;
  visibility?: string; // 'public' (default) | 'private'
}
interface EventCtx { championship: EventDetail; eventId: string; canManage: boolean }
export const useEvent = () => useOutletContext<EventCtx>();

// The legal "next" status + button label for the go-live flow.
const NEXT_STATUS: Record<string, { to: string; label: string } | null> = {
  draft: { to: 'registration_open', label: 'Open registration' },
  registration_open: { to: 'ongoing', label: 'Start championship' },
  ongoing: { to: 'completed', label: 'Mark completed' },
  completed: null,
};

export function EventLayout() {
  const { eventId } = useParams();
  const { pathname, state } = useLocation();
  const { canManageChampionship } = usePermissions();
  const canManage = canManageChampionship(eventId);
  const ws = useWorkspace();
  const roleCodes = ws.contexts.find((c) => c.id === eventId)?.roleCodes ?? [];
  const { data: championship, isLoading } = useApi<EventDetail>(`/championships/${eventId}`);
  const statusMut = useApiMutation(
    (status: string) => api('PATCH', `/championships/${eventId}/status`, { status }),
    [`/championships/${eventId}`, '/championships'],
  );

  if (isLoading || !championship) return <Spinner />;

  // A section reachable by URL that the sidebar does not offer is an access bug
  // waiting to happen, so both are answered from the same list. The server still
  // guards every write; this only stops somebody landing on a page built for a
  // role they do not hold.
  //
  // Only a SECTION is ever refused. The overview is the redirect target, so
  // refusing it would bounce somebody to the page that refused them and render
  // nothing at all - a guard must never send anyone somewhere it would itself
  // turn away.
  const segment = parseEventSegment(pathname, eventId!);
  if (segment && !canManage && !mayOpenSegment(roleCodes, segment)) {
    return <Navigate to={`/championships/${eventId}`} replace />;
  }

  const next = NEXT_STATUS[championship.status];

  // Back goes where they came from - workspace and all. Entering an event moves
  // the whole workspace, so leaving it has to move the workspace back, otherwise
  // somebody who opened an event from their institution lands on My Events with
  // the event's own sidebar still showing.
  //
  // The fallback is My Events, which is where an event opened from a notification
  // or a pasted URL sensibly ends.
  const from = (state as { from?: string } | null)?.from ?? '/championships';
  const fromCtx = ws.contexts.find((c) => c.id === (/^\/organizations\/([0-9a-fA-F-]{36})/.exec(from)?.[1] ?? ''));
  const backLabel = fromCtx ? fromCtx.name : 'All events';

  return (
    <div>
      <BackButton onClick={() => ws.leaveTo(from)}>{backLabel}</BackButton>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{championship.name}</h1>
            <StatusBadge status={championship.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{championship.venue || 'Venue TBD'} · {fmtDateRange(championship.start_date, championship.end_date)}</p>
        </div>
        {canManage && next && (
          <Button
            onClick={() => statusMut.mutate(next.to, { onSuccess: () => toast.success('Championship status updated'), onError: (e: any) => toast.error(e.message) })}
            disabled={statusMut.isPending}
          >
            {statusMut.isPending ? 'Updating…' : next.label} →
          </Button>
        )}
      </div>

      <Outlet context={{ championship, eventId: eventId!, canManage } satisfies EventCtx} />
    </div>
  );
}
