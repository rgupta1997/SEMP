import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { cn } from '../../components/ui';

// One Achievements area, three views of the same record:
//
//   Timeline      what happened, in order
//   Hall of Fame  what we have won, counted
//   Claims        what people are asking us to vouch for
//
// The claims tab only exists for the people who can actually decide - a queue you can
// read but not action is an invitation to ask somebody else to do it.
//
// The person reading this may also be IN it. A sports secretary who still competes has
// two histories - the institution's and their own - and they are different records,
// not two renderings of one. So the scope is named in every subtitle, and the other
// scope is one link away rather than something to go hunting for in the sidebar.

export function AchievementsLayout() {
  const { orgId } = useParams();
  const { ctx } = useAuth();

  const membership = (ctx?.organizations ?? []).find((o: any) => (o.organization_id ?? o.id) === orgId) as any;
  const canValidate = ctx?.user?.is_super_admin || ['owner', 'admin'].includes(membership?.role ?? '');

  // Only fetched when the tab is going to be shown, so a member never triggers a 403.
  const claims = useApi<{ pending: number }>(canValidate && orgId ? `/organizations/${orgId}/claims?status=pending` : null);
  const pending = claims.data?.pending ?? 0;

  const tabs = [
    { to: '', label: 'Timeline', end: true },
    { to: 'hall-of-fame', label: 'Hall of fame' },
    ...(canValidate ? [{ to: 'claims', label: 'Claims', badge: pending }] : []),
  ];

  return (
    <div className="grid gap-5">
      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800" aria-label="Achievements views">
        {tabs.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) => cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {t.label}
            {'badge' in t && (t.badge ?? 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                {t.badge}
              </span>
            )}
          </NavLink>
        ))}
        {/* Whoever is reading this has a record of their own, whether or not it has
            anything in it yet. Explicitly labelled "your own" so it can never be
            mistaken for another view of the institution's. */}
        <Link
          to="/profile/achievements"
          className="ml-auto px-3 py-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          Your own record →
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
