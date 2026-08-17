import { Link, NavLink, Outlet } from 'react-router-dom';
import { useApi } from '../../lib/hooks';
import { usePermissions } from '../../lib/permissions';
import { useWorkspace } from '../../lib/workspace';
import { AchievementTimelineView } from '../../components/AchievementTimelineView';
import { BackButton, cn } from '../../components/ui';

// A person's Achievements area - the same three views the institution has, asked
// about one person:
//
//   Timeline      what happened, in order
//   Awards        what they have won, counted
//   Claims        what they have asked an institution to vouch for
//
// Deliberately the same shape, the same order and the same words as the institution's
// area (AchievementsLayout). Somebody who plays for their college and also runs its
// sports office moves between the two several times a day; two different structures
// for the same idea would make them relearn the screen every time they switched.
// What differs is the SCOPE, and each view says whose record it is in its subtitle.

export function ParticipantAchievementsLayout() {
  // Only for the badge - the tab itself is always here, because these are the
  // person's own claims and there is nobody else to send them to.
  const claims = useApi<{ rows: Array<{ status: string }> }>('/me/claims');
  const pending = (claims.data?.rows ?? []).filter((c) => c.status === 'pending').length;

  // The way back to the institution's history, for anyone who has one and whose
  // institution has left records switched on for their audience (J6-E2-S2).
  const { workspace } = useWorkspace();
  const { canOpenModule } = usePermissions();
  const orgId = workspace.kind === 'organization' ? workspace.id : null;
  const orgTimeline = orgId && canOpenModule('records', orgId)
    ? `/organizations/${orgId}/achievements`
    : null;
  const orgName = workspace.kind === 'organization'
    ? (workspace.organization.short_name || workspace.organization.name)
    : null;

  const tabs = [
    { to: '', label: 'Timeline', end: true },
    { to: 'awards', label: 'Awards' },
    { to: 'claims', label: 'Claims', badge: pending },
  ];

  return (
    <div className="grid gap-5">
      <BackButton to="/profile" className="mb-0 self-start">Dashboard</BackButton>
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
            {(t.badge ?? 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                {t.badge}
              </span>
            )}
          </NavLink>
        ))}
        {orgTimeline && (
          <Link
            to={orgTimeline}
            className="ml-auto px-3 py-2 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {orgName}’s record →
          </Link>
        )}
      </nav>
      <Outlet />
    </div>
  );
}

/** The person's own history, in the institution's design, from their own scope. */
export function ParticipantTimelinePage() {
  return (
    <AchievementTimelineView
      path="/me/achievements/timeline"
      title="Achievement timeline"
      subtitle="Your record · every milestone and accolade you hold, in order."
      emptyDescription="Milestones appear here the moment an official locks a result you were part of, or when an institution validates something you claimed."
      // Every row on your own timeline was awarded to you; naming you on each card is
      // a sentence the reader already knows the answer to.
      showRecipient={false}
    />
  );
}
