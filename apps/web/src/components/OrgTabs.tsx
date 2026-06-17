import { NavLink } from 'react-router-dom';
import { cn } from './ui';

// Sub-navigation for an organization's management pages.
export function OrgTabs({ orgId }: { orgId: string }) {
  const tabs = [
    { to: `/organizations/${orgId}/teams`, label: 'Teams' },
    { to: `/organizations/${orgId}/members`, label: 'Members' },
  ];
  return (
    <div className="mb-5 flex gap-2">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => cn(
            'rounded-lg px-3 py-1.5 text-sm font-semibold',
            isActive
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
          )}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
