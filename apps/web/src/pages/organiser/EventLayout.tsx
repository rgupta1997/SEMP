import { NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateRange } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { EVENT_NAV, eventNavPath, MANAGE_SEGMENTS, parseEventSegment } from '../../lib/championship-nav';
import { BackButton, Button, cn, Spinner, StatusBadge, toast } from '../../components/ui';

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
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { canManageChampionship } = usePermissions();
  const canManage = canManageChampionship(eventId);
  const { data: championship, isLoading } = useApi<EventDetail>(`/championships/${eventId}`);
  const statusMut = useApiMutation(
    (status: string) => api('PATCH', `/championships/${eventId}/status`, { status }),
    [`/championships/${eventId}`, '/championships'],
  );

  if (isLoading || !championship) return <Spinner />;

  // Spectators / participants can view read-only tabs but not the management ones.
  const segment = parseEventSegment(pathname, eventId!);
  if (!canManage && MANAGE_SEGMENTS.has(segment)) {
    return <Navigate to={`/championships/${eventId}`} replace />;
  }

  const next = NEXT_STATUS[championship.status];

  return (
    <div>
      <BackButton onClick={() => navigate('/championships')}>All championships</BackButton>
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

      {/* Section tabs - the championship's own navigation, as horizontal pills. */}
      <nav className="mb-6 flex flex-wrap gap-2">
        {EVENT_NAV.filter((it) => canManage || !it.manage).map((it) => (
          <NavLink
            key={it.segment || 'overview'}
            to={eventNavPath(eventId!, it.segment)}
            end={it.end}
            className={({ isActive }) => cn(
              'rounded-lg border px-4 py-2 text-sm font-semibold transition-colors',
              isActive
                ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100',
            )}
          >
            {it.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ championship, eventId: eventId!, canManage } satisfies EventCtx} />
    </div>
  );
}
