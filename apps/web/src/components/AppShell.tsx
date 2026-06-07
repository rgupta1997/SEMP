import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { EVENT_NAV, eventNavPath, parseEventId } from '../lib/event-nav';
import { useFilterBar, FilterProvider } from '../lib/filters';
import { useApi } from '../lib/hooks';
import { useTheme } from '../lib/theme';
import { Avatar, cn } from './ui';

interface NavItem { to: string; label: string; icon: string; end?: boolean }
interface NavGroup { group: string; items: NavItem[] }

export function roleHome(role: AppRole): string {
  switch (role) {
    case 'system': return '/platform/sports'; // System admin manages master data
    case 'organiser': return '/events';
    case 'institution': return '/inst';
    case 'official': return '/official';
    case 'participant': return '/me';
  }
}

function navFor(role: AppRole, isSuperAdmin: boolean): NavGroup[] {
  switch (role) {
    case 'system':
      // System Admin: only platform master data management
      return [{
        group: 'Platform Master Data', items: [
          { to: '/platform/sports', label: 'Sports', icon: '🏅' },
          { to: '/platform/disciplines', label: 'Disciplines', icon: '▦' },
          { to: '/platform/tournament-formats', label: 'Formats', icon: '⊟' },
          { to: '/platform/institutions', label: 'Institutions', icon: '🏛' },
          { to: '/platform/roles', label: 'Roles & Permissions', icon: '⚿' },
        ],
      }, {
        group: 'Platform Overview', items: [
          { to: '/platform/overview', label: 'All Events', icon: '◆' },
          { to: '/platform/users', label: 'All Users', icon: '◍' },
        ],
      }];
    case 'organiser': {
      // Organiser: only their events (multi-tenant isolated)
      return [
        { group: 'My Events', items: [{ to: '/events', label: 'Events', icon: '◆', end: false }] },
      ];
    }
    case 'institution':
      return [{ group: 'Institution', items: [
        { to: '/inst', label: 'Overview', icon: '◎', end: true },
        { to: '/inst/events', label: 'Browse events', icon: '◆' },
        { to: '/inst/teams', label: 'Teams', icon: '⚇' },
        { to: '/inst/students', label: 'Teams and members', icon: '👥' },
        { to: '/inst/pocs', label: 'Points of contact', icon: '⚿' },
      ] }];
    case 'official':
      return [{ group: 'Match day', items: [
        { to: '/official', label: 'My matches', icon: '⚑', end: true },
      ] }];
    case 'participant':
      return [{ group: 'Me', items: [
        { to: '/me', label: 'Dashboard', icon: '◎', end: true },
        { to: '/me/matches', label: 'All matches', icon: '⚑' },
      ] }];
  }
}

function RoleSwitcher() {
  const { availableRoles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  if (availableRoles.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-xs font-semibold uppercase tracking-wide text-slate-400 sm:inline">View as</span>
      <select
        value={activeRole}
        onChange={(e) => {
          const r = e.target.value as AppRole;
          setActiveRole(r);
          navigate(roleHome(r));
        }}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {availableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
    </label>
  );
}

const HEADER_SELECT = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

// Shared Sport filter — lives in the top header. Only shows when the current
// page registers sports.
function HeaderFilters() {
  const { sportId, setSportId, config } = useFilterBar();
  if (!config.sports) return null;
  return (
    <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
      <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={HEADER_SELECT} aria-label="Filter by sport">
        <option value="">All sports</option>
        {config.sports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

// Shared Event filter — lives in the sidebar (the shell). Only shows when the
// current page registers events.
function SidebarEventFilter() {
  const { eventId, setEventId, config } = useFilterBar();
  if (!config.events) return null;
  return (
    <div className="mb-5">
      <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Event</div>
      <select
        value={eventId}
        onChange={(e) => setEventId(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
        aria-label="Filter by event"
      >
        <option value="">All events</option>
        {config.events.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

interface EventSummary { id: string; name: string }

export function AppShell() {
  const { ctx, activeRole, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const eventId = ctx && (activeRole === 'organiser' || activeRole === 'system') ? parseEventId(pathname) : null;
  const { data: event } = useApi<EventSummary>(eventId ? `/events/${eventId}` : null);

  if (!ctx) return null;

  const groups = navFor(activeRole, ctx.user.is_super_admin);
  const subtitle = event?.name
    ?? (activeRole === 'institution' && ctx.institution ? ctx.institution.name : ROLE_LABELS[activeRole]);

  return (
    <FilterProvider>
    <div className="h-screen md:grid md:grid-cols-[260px_1fr]">
      {/* Mobile scrim */}
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar — overlay drawer on mobile, static column on desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col overflow-hidden border-r border-slate-800 bg-slate-900 text-slate-300 transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-none',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-lg font-black text-white">S</span>
          <div className="min-w-0">
            <div className="text-lg font-bold leading-none text-white">Sportagon</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">SEMP Platform</div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white md:hidden" aria-label="Close menu">✕</button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarEventFilter />
          {groups.map((g) => (
            <div key={g.group} className="mb-5">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g.group}</div>
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end && !eventId}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => cn(
                    'mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive && !eventId ? 'bg-brand-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  )}
                >
                  <span className="w-5 text-center text-base">{it.icon}</span>
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {eventId && (
            <div className="mb-5">
              <div className="truncate px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500" title={event?.name}>
                {event?.name ?? 'Event'}
              </div>
              {EVENT_NAV.map((it) => (
                <NavLink
                  key={it.segment || 'overview'}
                  to={eventNavPath(eventId, it.segment)}
                  end={it.end}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) => cn(
                    'mb-0.5 flex items-center rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-brand-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  )}
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          )}
        </nav>
        <div className="border-t border-slate-800 px-3 py-3 text-[11px] text-slate-500">
          Demo logins use password <span className="font-mono text-slate-400">demo123</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex h-screen min-w-0 flex-col md:h-auto">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={() => setSidebarOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Open menu">☰</button>
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{subtitle}</div>
          </div>
          <HeaderFilters />
          <div className="flex items-center gap-2 sm:gap-4">
            <RoleSwitcher />
            <button
              onClick={toggle}
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >{theme === 'dark' ? '☀' : '☾'}</button>
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Avatar name={ctx.user.name} size={32} />
                <span className="hidden text-sm font-medium text-slate-700 sm:inline dark:text-slate-300">{ctx.user.name}</span>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="border-b border-slate-100 px-4 py-2 dark:border-slate-700">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{ctx.user.name}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.email}</div>
                    </div>
                    <button onClick={logout} className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-slate-100 p-4 sm:p-6 dark:bg-slate-950">
          <div className={cn('mx-auto', !eventId && 'max-w-6xl')}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </FilterProvider>
  );
}
