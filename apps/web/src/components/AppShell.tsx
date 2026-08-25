import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Compass, Flag, FlaskConical, Landmark, Layers, LayoutGrid, LayoutList, Lock,
  Mail, Medal, Menu, MessageSquare, Moon, Plus, Sun, Trophy, Upload, User, Users, X,
  Zap,
} from 'lucide-react';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { ContextSwitcher } from './ContextSwitcher';
import { useWorkspace } from '../lib/useWorkspace';
import { hrefFor, resolveNav } from '../lib/workspace';
import { Lock as LockIcon } from 'lucide-react';
import { parseEventId } from '../lib/championship-nav';
import { FeedbackWidget } from './FeedbackWidget';
import { useFilterBar, FilterProvider } from '../lib/filters';
import { useApi } from '../lib/hooks';
import { useTheme } from '../lib/theme';
import { Avatar, cn } from './ui';
import { BrandMark } from './BrandMark';
import { NotificationBell } from './NotificationBell';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }
interface NavGroup { group: string; items: NavItem[] }

export function roleHome(role: AppRole): string {
  // The personal context lands on My Game, per the prototype - not the profile.
  // The profile is a record of what you have done; My Game is what you do next.
  return role === 'system' ? '/platform/sports' : '/home';
}

function navFor(role: AppRole): NavGroup[] {
  if (role === 'system') {
    return [{
      group: 'Championships', items: [
        { to: '/discover', label: 'All championships', icon: <LayoutGrid size={16} /> },
      ],
    }, {
      group: 'Platform Master Data', items: [
        { to: '/platform/sports', label: 'Sports', icon: <Medal size={16} /> },
        { to: '/platform/disciplines', label: 'Disciplines', icon: <Layers size={16} /> },
        { to: '/platform/tournament-formats', label: 'Formats', icon: <LayoutList size={16} /> },
        { to: '/platform/organizations', label: 'Organizations', icon: <Landmark size={16} /> },
        { to: '/platform/roles', label: 'Roles & Permissions', icon: <Lock size={16} /> },
      ],
    }, {
      group: 'Platform', items: [
        { to: '/platform/users', label: 'All Users', icon: <Users size={16} /> },
        { to: '/platform/import-setup', label: 'Import Setup', icon: <Upload size={16} /> },
        { to: '/platform/demo-requests', label: 'Demo Requests', icon: <Mail size={16} /> },
        { to: '/platform/demos', label: 'Demo Sandboxes', icon: <FlaskConical size={16} /> },
        { to: '/platform/feedback', label: 'Feedback', icon: <MessageSquare size={16} /> },
      ],
    }];
  }
  return [{
    group: BRAND.name, items: [
      { to: '/home', label: 'My Game', icon: <Zap size={16} />, end: true },
      { to: '/profile', label: 'My Sports Profile', icon: <User size={16} /> },
      // Officials reach their assigned matches here. Always shown so a freshly-assigned
      // official finds it without re-logging in (the page itself is empty until assigned).
      { to: '/officiating', label: 'Officiating', icon: <Flag size={16} /> },
      { to: '/organizations', label: 'Organizations', icon: <Landmark size={16} /> },
      { to: '/discover', label: 'Discover', icon: <Compass size={16} /> },
      { to: '/championships', label: 'Championships', icon: <Trophy size={16} /> },
      { to: '/host', label: 'Host', icon: <Plus size={16} /> },
      { to: '/help', label: 'Help & guide', icon: '?' },
    ],
  }];
}

function RoleSwitcher() {
  const { availableRoles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  if (availableRoles.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-xs font-medium text-slate-400 sm:inline">View as</span>
      <select
        value={activeRole}
        onChange={(e) => {
          const r = e.target.value as AppRole;
          setActiveRole(r);
          navigate(roleHome(r));
        }}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {availableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
    </label>
  );
}

const HEADER_SELECT = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

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
  const ws = useWorkspace();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const signOut = () => { logout(); navigate('/', { replace: true }); };

  const eventId = ctx ? parseEventId(pathname) : null;
  const { data: championship } = useApi<EventSummary>(eventId ? `/championships/${eventId}` : null);

  if (!ctx) return null;

  // The platform console is not a context - it is the whole tenant, so it keeps its
  // flat nav. Everyone else navigates by context.
  const isPlatform = activeRole === 'system';
  const groups = isPlatform ? navFor(activeRole) : [];
  const contextNav = !isPlatform && ws.active ? resolveNav(ws.active, ws.granted) : [];
  const subtitle = championship?.name ?? (isPlatform ? ROLE_LABELS[activeRole] : ws.active?.name ?? '');

  // Feedback button: only on overview/landing surfaces (My Game, Discover, My
  // Championships, an org's overview, a championship's overview) - not deep inner
  // pages. It's rendered OUTSIDE the scroll/animated container below so that
  // `position: fixed` pins it to the viewport (a transformed ancestor would make it
  // scroll with the page instead).
  const fbPath = pathname.replace(/\/+$/, '') || '/';
  const fbSegs = fbPath.split('/').filter(Boolean);
  const isChampionshipOverview = fbSegs.length === 2 && fbSegs[0] === 'championships' && fbSegs[1] !== 'new';
  const showFeedback =
    fbPath === '/profile' ||
    fbPath === '/discover' ||
    fbPath === '/championships' ||
    isChampionshipOverview ||
    (fbSegs.length === 3 && fbSegs[0] === 'organizations' && fbSegs[2] === 'overview');

  return (
    <FilterProvider>
      <div className="h-screen overflow-hidden md:grid md:grid-cols-[240px_1fr]">
        {/* Mobile scrim */}
        {sidebarOpen && <div className="fixed inset-0 z-40 bg-slate-900/50 md:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <aside
          style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col overflow-hidden border-r text-slate-300 transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-none',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-2.5 border-b px-4 py-3.5" style={{ borderColor: 'var(--sidebar-border)' }}>
            <BrandMark variant="white" height={22} />
            <button onClick={() => setSidebarOpen(false)} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-active)] hover:text-white active:scale-90 md:hidden" aria-label="Close menu"><X size={16} /></button>
          </div>
          {/* The switcher sits above the nav because it changes what the nav IS. */}
          {!isPlatform && ws.contexts.length > 0 && (
            <div className="px-3 pt-3">
              <ContextSwitcher
                contexts={ws.contexts}
                active={ws.active}
                granted={ws.granted}
                onSwitch={(id) => { ws.switchTo(id); setSidebarOpen(false); }}
              />
            </div>
          )}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {!isPlatform && ws.active && contextNav.map((it) => {
              const href = hrefFor(ws.active!, it);
              // A locked item is shown, not hidden. Hiding it would leave someone
              // unable to discover the product does the thing at all - which loses
              // an upgrade rather than earning one. The page it opens names the
              // missing capability, never the price.
              return (
                <NavLink
                  key={it.key}
                  to={href}
                  // `it.end` alone: suppressing it inside an event left the event
                  // root matching every section under it, so Overview stayed lit
                  // wherever you were.
                  end={it.end}
                  onClick={() => setSidebarOpen(false)}
                  title={it.locked ? `Needs ${it.needs}` : undefined}
                  className={({ isActive }) => cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-[background-color,color] duration-150',
                    isActive ? 'bg-[var(--sidebar-active)] text-white' : 'text-slate-400 hover:bg-[var(--sidebar-active)] hover:text-white',
                    it.locked && 'opacity-60',
                  )}
                >
                  <span className="flex-1">{it.label}</span>
                  {it.locked && <LockIcon size={12} className="flex-none opacity-80" />}
                </NavLink>
              );
            })}
            {groups.map((g) => (
              <div key={g.group} className="mb-4">
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{g.group}</div>
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    data-tour={`nav-${it.to}`}
                    end={it.end && !eventId}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) => cn(
                      'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-[background-color,color] duration-150',
                      isActive && !eventId ? 'bg-[var(--sidebar-active)] text-white' : 'text-slate-400 hover:bg-[var(--sidebar-active)] hover:text-white',
                    )}
                  >
                    <span className="flex-none">{it.icon}</span>
                    <span>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main - pinned to the viewport height so only <main> scrolls; the sidebar
            stays put (md:h-auto would let the column grow and drag the whole grid). */}
        <div className="flex h-screen min-h-0 min-w-0 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-2">
              <button onClick={() => setSidebarOpen(true)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition-[background-color,transform] duration-150 hover:bg-slate-100 active:scale-90 md:hidden dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Open menu"><Menu size={18} /></button>
              <div className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">{subtitle}</div>
            </div>
            <HeaderFilters />
            <div className="flex items-center gap-2 sm:gap-3">
              <RoleSwitcher />
              <NotificationBell />
              <button
                onClick={toggle}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-[background-color,transform] duration-150 hover:bg-slate-100 hover:scale-[1.08] active:scale-90 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
              <div className="relative">
                <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-[background-color,transform] duration-150 hover:bg-slate-100 active:scale-[0.97] dark:hover:bg-slate-800">
                  <Avatar name={ctx.user.name} size={30} />
                  <span className="hidden text-sm font-medium text-slate-700 sm:inline dark:text-slate-300">{ctx.user.name}</span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="animate-dropdown absolute right-0 z-20 mt-2 w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{ctx.user.name}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.email}</div>
                        {ctx.user.phone && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.phone}</div>}
                      </div>
                      <button onClick={signOut} className="w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Sign out</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto bg-[var(--canvas)] p-4 sm:p-6 dark:bg-slate-950">
            <div key={pathname} className={cn('mx-auto animate-page-enter', !eventId && 'max-w-6xl')}>
              <Outlet />
            </div>
          </main>
        </div>
        {showFeedback && (
          <FeedbackWidget
            championshipId={isChampionshipOverview ? fbSegs[1] : undefined}
            context={pathname}
          />
        )}
      </div>
    </FilterProvider>
  );
}
