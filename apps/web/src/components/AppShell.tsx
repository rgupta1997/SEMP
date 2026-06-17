import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { parseEventId } from '../lib/championship-nav';
import { useFilterBar, FilterProvider } from '../lib/filters';
import { useApi } from '../lib/hooks';
import { useTheme } from '../lib/theme';
import { Avatar, cn } from './ui';
import { NotificationBell } from './NotificationBell';

interface NavItem { to: string; label: string; icon: string; end?: boolean }
interface NavGroup { group: string; items: NavItem[] }

export function roleHome(role: AppRole): string {
  return role === 'system' ? '/platform/sports' : '/profile';
}

function navFor(role: AppRole): NavGroup[] {
  if (role === 'system') {
    // System Admin: every championship, plus platform master data.
    return [{
      group: 'Championships', items: [
        { to: '/discover', label: 'All championships', icon: '◆' },
      ],
    }, {
      group: 'Platform Master Data', items: [
        { to: '/platform/sports', label: 'Sports', icon: '🏅' },
        { to: '/platform/disciplines', label: 'Disciplines', icon: '▦' },
        { to: '/platform/tournament-formats', label: 'Formats', icon: '⊟' },
        { to: '/platform/organizations', label: 'Organizations', icon: '🏛' },
        { to: '/platform/roles', label: 'Roles & Permissions', icon: '⚿' },
      ],
    }, {
      group: 'Platform', items: [
        { to: '/platform/users', label: 'All Users', icon: '◍' },
      ],
    }];
  }
  // Unified user shell — the same nav for everyone; what they can DO is derived
  // per championship / per organization.
  return [{
    group: 'Sportagon', items: [
      { to: '/profile', label: 'My Game', icon: '◎', end: true },
      { to: '/organizations', label: 'Organizations', icon: '🏛' },
      { to: '/discover', label: 'Discover', icon: '◈' },
      { to: '/championships', label: 'Championships', icon: '🏆' },
      { to: '/host', label: 'Host', icon: '＋' },
    ],
  }];
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

// Shared Championship + Tournament + Sport filters — all live in the top header.
// Each only shows when the current page registers options for that axis.
function HeaderFilters() {
  const { eventId, setEventId, tournamentId, setTournamentId, sportId, setSportId, config } = useFilterBar();
  if (!config.championships && !config.tournaments && !config.sports) return null;
  return (
    <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
      {config.championships && (
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={HEADER_SELECT} aria-label="Filter by championship">
          <option value="">All championships</option>
          {config.championships.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {config.tournaments && (
        <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)} className={HEADER_SELECT} aria-label="Filter by tournament">
          {!config.tournamentRequired && <option value="">All tournaments</option>}
          {config.tournaments.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {config.sports && (
        <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={HEADER_SELECT} aria-label="Filter by sport">
          <option value="">All sports</option>
          {config.sports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </div>
  );
}

interface EventSummary { id: string; name: string }

export function AppShell() {
  const { ctx, activeRole, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Drop the current URL on sign-out so a stale deep link doesn't linger behind
  // the login screen (and isn't restored on the next login).
  const signOut = () => { logout(); navigate('/', { replace: true }); };

  const eventId = ctx ? parseEventId(pathname) : null;
  const { data: championship } = useApi<EventSummary>(eventId ? `/championships/${eventId}` : null);

  if (!ctx) return null;

  const groups = navFor(activeRole);
  const subtitle = championship?.name ?? ROLE_LABELS[activeRole];

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
            <NotificationBell />
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
                    <button onClick={signOut} className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Sign out</button>
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
