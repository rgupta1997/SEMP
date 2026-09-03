import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, Compass, Flag, FlaskConical, Landmark, Layers, LayoutGrid, LayoutList, Lock,
  Mail, Medal, Menu, MessageSquare, Moon, Plus, Sun, Trophy, Upload, User, Users, X,
  Zap,
} from 'lucide-react';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { ContextSwitcher } from './ContextSwitcher';
import { useWorkspace } from '../lib/useWorkspace';
import { applyTenantTheme } from '../lib/tenant-theme';
import { hrefFor, resolveNav } from '../lib/workspace';
import { BottomNav } from './BottomNav';
import { Lock as LockIcon, SlidersHorizontal } from 'lucide-react';
import { parseEventId } from '../lib/championship-nav';
import { FeedbackWidget } from './FeedbackWidget';
import { Sheet } from './primitives';
import { useFilterBar, FilterProvider } from '../lib/filters';
import { useApi } from '../lib/hooks';
import { useTheme } from '../lib/theme';
import { Avatar, Button, cn } from './ui';
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
        // Beside Organizations rather than under Platform: the queue is about an
        // organisation's identity, and the reviewer moves between the two.
        { to: '/platform/verification-requests', label: 'Verification', icon: <BadgeCheck size={16} /> },
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
      { to: '/host', label: 'Create Event', icon: <Plus size={16} /> },
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

// Hidden, not removed: everyone is granted Elite by default for now (see
// organizations.routes.ts / the users table default), so there is nothing to
// upgrade to and no reason to surface a plan picker that would only confuse
// someone who has never been asked to pay for anything. The /plans route and
// PlanPage are untouched. Flip back to true once personal plans are for sale.
const SHOW_MY_PLAN = false;

function HeaderFilters() {
  const { eventId, setEventId, tournamentId, setTournamentId, sportId, setSportId, config } = useFilterBar();
  const [open, setOpen] = useState(false);
  if (!config.championships && !config.tournaments && !config.sports) return null;

  const active = [eventId, tournamentId, sportId].filter(Boolean).length;

  // BEHIND A BUTTON ON A PHONE.
  //
  // This was `order-last w-full` below sm - a full-width row of up to three 152px
  // selects wedged under the header, which on a 390px screen either wrapped to two
  // more rows or squeezed the title and the avatar into nothing. The controls
  // themselves are unchanged; below sm they move into a sheet behind one button
  // that says how many are set.
  const controls = (
    <>
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
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={active ? `Filters, ${active} active` : 'Filters'}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 sm:hidden dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <SlidersHorizontal size={18} />
        {active > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{active}</span>
        )}
      </button>
      <div className="hidden items-center gap-2 sm:flex">{controls}</div>
      {open && (
        <Sheet title="Filter this view" size="sm" onClose={() => setOpen(false)}
          footer={<Button className="w-full" onClick={() => setOpen(false)}>Show results</Button>}>
          <div className="flex flex-col gap-3 [&_select]:w-full [&_select]:min-w-0">{controls}</div>
        </Sheet>
      )}
    </>
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

  /**
   * PAINT THE INSTITUTION'S COLOUR ONTO THE DOCUMENT.
   *
   * HERE, AND ONLY HERE. This lived inside `useWorkspace()`, which is called by the
   * shell AND by a dozen pages - so every one of them mounted its own copy of the
   * effect against the same three global CSS variables. Navigating from
   * Administration to Teams unmounted that page's copy, its cleanup cleared the
   * variables, and the shell's copy never re-ran because its own dependencies had
   * not changed. The colour survived a full page reload and vanished on a click,
   * which is exactly the shape of "the colour I chose was there but the theme didn't
   * change".
   *
   * The shell is mounted for the whole authenticated app, so one owner, one effect,
   * one cleanup - which now only fires on sign-out, where clearing is right.
   *
   * Keyed to the active WORKSPACE rather than the route: the sidebar, tab bar and
   * switcher all follow the workspace too, so a colour keyed to the URL would flip
   * to Sportagon blue on /home while the navigation beside it named the institution.
   */
  useEffect(() => {
    applyTenantTheme(ws.active?.kind === 'org' ? ws.active.theme : null);
  }, [ws.active?.id, ws.active?.kind, ws.active?.theme?.brand]);

  useEffect(() => () => applyTenantTheme(null), []);

  const eventId = ctx ? parseEventId(pathname) : null;
  const { data: championship } = useApi<EventSummary>(eventId ? `/championships/${eventId}` : null);

  if (!ctx) return null;

  // The platform console is not a context - it is the whole tenant, so it keeps its
  // flat nav. Everyone else navigates by context.
  const isPlatform = activeRole === 'system';
  const groups = isPlatform ? navFor(activeRole) : [];
  const contextNav = !isPlatform && ws.active ? resolveNav(ws.active, ws.granted, ws.navFacts) : [];
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
      {/* h-dvh, not h-screen. `100vh` on iOS Safari and Android Chrome is the
          viewport WITHOUT the collapsible browser chrome, so the shell rendered
          60-110px taller than the window and its bottom row was unreachable until
          you scrolled the chrome away. */}
      <div className="h-screen h-dvh overflow-hidden md:grid md:grid-cols-[240px_1fr]">
        {/* Mobile scrim */}
        {sidebarOpen && <div className="animate-backdrop fixed inset-0 z-scrim bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <aside
          style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
          className={cn(
            'fixed inset-y-0 left-0 z-drawer flex w-[240px] flex-col overflow-hidden border-r text-slate-300 transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-none',
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
                navFacts={ws.navFacts}
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
        <div className="flex h-screen h-dvh min-h-0 min-w-0 flex-col">
          {/* ONE ROW ON A PHONE.
              This was `flex-wrap` carrying four groups - hamburger + subtitle, the
              filter selects, the role switcher, and bell/theme/avatar - which on a
              390px screen stacked into three rows and spent ~150px of the fold
              before any content appeared. Now it is hamburger, title, bell, avatar.
              The theme toggle and the role switcher move into the avatar menu,
              where a control used once a month belongs, and the filters move into a
              sheet behind a single button. */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:h-auto sm:flex-wrap sm:gap-x-4 sm:gap-y-2 sm:px-6 sm:py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <button onClick={() => setSidebarOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-600 transition-[background-color,transform] duration-150 hover:bg-slate-100 active:scale-90 md:hidden dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Open menu"><Menu size={20} /></button>
              <div className="truncate text-sm font-semibold text-slate-700 sm:font-medium sm:text-slate-600 dark:text-slate-300">{subtitle}</div>
            </div>
            <HeaderFilters />
            <div className="flex shrink-0 items-center gap-1 sm:gap-3">
              <div className="hidden sm:block"><RoleSwitcher /></div>
              <NotificationBell />
              <button
                onClick={toggle}
                className="hidden h-9 w-9 place-items-center rounded-lg text-slate-500 transition-[background-color,transform] duration-150 hover:bg-slate-100 hover:scale-[1.08] active:scale-90 sm:grid dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
              <div className="relative">
                <button onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" className="flex h-10 items-center gap-2 rounded-lg px-1.5 py-1 transition-[background-color,transform] duration-150 hover:bg-slate-100 active:scale-[0.97] dark:hover:bg-slate-800">
                  <Avatar name={ctx.user.name} size={30} />
                  <span className="hidden text-sm font-medium text-slate-700 sm:inline dark:text-slate-300">{ctx.user.name}</span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-scrim" onClick={() => setMenuOpen(false)} />
                    <div className="animate-dropdown absolute right-0 z-popover mt-2 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                      <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{ctx.user.name}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.email}</div>
                        {ctx.user.phone && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.phone}</div>}
                      </div>
                      {/* My plan (PG-07). The PERSONAL ladder - an institution's
                          plan lives on its own Billing & Subscription tab, where the
                          people who can buy it are. Two independent ladders, and a
                          single menu item reaching both would imply otherwise. */}
                      {SHOW_MY_PLAN && (
                        <button
                          onClick={() => { setMenuOpen(false); navigate('/plans'); }}
                          className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                        >My plan</button>
                      )}
                      {/* The two controls the header gives up below sm. They live
                          here at every width so there is ONE place to look for
                          them, rather than a control that migrates at 640px. */}
                      <button
                        onClick={toggle}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 sm:hidden dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                      </button>
                      <div className="px-4 py-2 sm:hidden"><RoleSwitcher /></div>
                      <button onClick={signOut} className="w-full px-4 py-2.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Sign out</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>
          {/* pb-24 below md clears the tab bar; the bar carries its own
              safe-area padding for the home indicator beneath it. */}
          <main className="min-h-0 flex-1 overflow-auto bg-[var(--canvas)] p-4 pb-24 sm:p-6 md:pb-6 dark:bg-slate-950">
            <div key={pathname} className={cn('mx-auto animate-page-enter', !eventId && 'max-w-6xl')}>
              <Outlet />
            </div>
          </main>
          <BottomNav items={contextNav} groups={groups} ctx={ws.active} onMore={() => setSidebarOpen(true)} />
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
