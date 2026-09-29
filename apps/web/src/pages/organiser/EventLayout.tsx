import { Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { archiveDaysLeft, archivePurgeDate } from '@semp/shared';
import { useApi, useApiMutation, fmtDate, fmtDateRange } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { useWorkspace } from '../../lib/useWorkspace';
import { mayOpenSegment, parseEventSegment } from '../../lib/championship-nav';
import { BackButton, Button, EmptyState, Spinner, StatusBadge, toast } from '../../components/ui';

export interface EventDetail {
  id: string; name: string; slug: string; status: string;
  venue?: string; description?: string; start_date: string; end_date: string;
  visibility?: string; // 'public' (default) | 'private'
  host_organization_id?: string | null;
  /** Set while archived: the event is read-only until retrieved. */
  archived_at?: string | null;
  /** Archived by its organisation's archive: no clock, and it returns with the organisation. */
  archived_with_org?: boolean;
  /**
   * What competes here, resolved by the server.
   *
   * `entrant_label` is the host organisation's OWN noun - "Campuses", "Offices",
   * "Departments" - so a screen never has to work out whether to say organisation
   * or campus. It exists precisely because getting that wrong is invisible: a
   * summary card reading "Organizations: 12" above twelve campuses of one
   * institution is wrong in a way nobody reports as a bug.
   */
  entry?: {
    level: 'organization' | 'campus' | 'department';
    intra: boolean;
    entrant_label: string;
    /** Plural of the same noun. Both are resolved server-side - see IntraEntrantsPanel. */
    entrant_label_plural: string;
    scope_unit: { id: string; name: string } | null;
  };
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
  const { data: championship, isLoading, error } = useApi<EventDetail>(`/championships/${eventId}`);
  const statusMut = useApiMutation(
    (status: string) => api('PATCH', `/championships/${eventId}/status`, { status }),
    // `/championships/mine` matters as much as the other two: it is what the SIDEBAR
    // builds its nav from, and the nav for a draft is two items where a live event's
    // is eleven. Leaving it stale meant an organiser who pressed "Start championship"
    // watched the badge flip to Ongoing while Schedule, Results, Standings and the
    // rest stayed missing until they reloaded the page by hand.
    [`/championships/${eventId}`, '/championships', '/championships/mine'],
  );
  const retrieve = useApiMutation(
    () => api('POST', `/championships/${eventId}/retrieve`),
    [`/championships/${eventId}`, `/championships/${eventId}/removal`, '/championships', '/championships/mine'],
  );

  // A private event you are not in, an archived event you do not host, or one that
  // is gone all answer 404 - said plainly rather than spinning forever.
  if (!isLoading && !championship && error) {
    return (
      <EmptyState
        icon="🔍"
        title="Event not available"
        description="This event doesn't exist, or you no longer have access to it."
        action={<Button variant="outline" onClick={() => ws.leaveTo('/championships')}>Back to my events</Button>}
      />
    );
  }
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

  // An archived event is read-only; no lifecycle step is offered until it is retrieved.
  const archivedAt = championship.archived_at ?? null;
  const next = archivedAt ? null : NEXT_STATUS[championship.status];

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
      {/* COMPACT ON A PHONE.
          This spent about 500px before any content: a full-width Back button, a
          24px two-line title, a venue-and-dates line, and a full-size lifecycle
          button on its own row. On a 390px screen that is most of the fold, on
          every page of the event, before you see a single fixture.

          The pieces are the same; the arrangement is not. Back becomes an inline
          link on the title's own row, the title scales, and the lifecycle action
          moves beside it - it is the one thing here somebody might act on, and it
          keeps its label because "Mark completed" is not a glyph anybody would
          guess. Venue and dates stay: they are what tells you which event this is
          when two have similar names. */}
      <div className="mb-4 flex items-start justify-between gap-3 sm:mb-5">
        <div className="min-w-0 flex-1">
          <BackButton onClick={() => ws.leaveTo(from)}>{backLabel}</BackButton>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="t-page-title min-w-0 text-slate-900 dark:text-slate-100">{championship.name}</h1>
            <StatusBadge status={championship.status} />
          </div>
          <p className="t-meta mt-1">{championship.venue || 'Venue TBD'} · {fmtDateRange(championship.start_date, championship.end_date)}</p>
        </div>
        {canManage && next && (
          <Button
            size="sm"
            className="mt-6 shrink-0 sm:mt-0 sm:size-auto"
            onClick={() => statusMut.mutate(next.to, { onSuccess: () => toast.success('Championship status updated'), onError: (e: any) => toast.error(e.message) })}
            disabled={statusMut.isPending}
          >
            {statusMut.isPending ? 'Updating…' : next.label}
          </Button>
        )}
      </div>

      {archivedAt && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-amber-900 dark:text-amber-200">
            <span className="font-semibold">This championship is archived.</span>{' '}
            {championship.archived_with_org
              ? 'It was archived with its organisation. Everything here is read-only, and it comes back when the organisation is retrieved.'
              : <>Everything here is read-only, and it will be permanently deleted on {fmtDate(archivePurgeDate(archivedAt))}{' '}
                ({archiveDaysLeft(archivedAt)} days left) unless it is retrieved.</>}
          </p>
          {canManage && !championship.archived_with_org && (
            <Button size="sm" disabled={retrieve.isPending} onClick={() => retrieve.mutate(undefined, {
              onSuccess: () => toast.success('Championship retrieved'),
              onError: (e: any) => toast.error(e.message),
            })}>
              {retrieve.isPending ? 'Retrieving…' : 'Retrieve'}
            </Button>
          )}
        </div>
      )}

      <Outlet context={{ championship, eventId: eventId!, canManage } satisfies EventCtx} />
    </div>
  );
}
