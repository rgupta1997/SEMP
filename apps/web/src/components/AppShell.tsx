import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, Compass, FileSpreadsheet, Flag, FlaskConical, Landmark, Layers, LayoutGrid, LayoutList, Lock,
  Award, Mail, Medal, MessageSquare, Moon, Plus, Send, Sun, Trophy, Upload, User, Users, X, CreditCard, Tags,
  Zap,
} from 'lucide-react';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { ContextSwitcher } from './ContextSwitcher';
import { useWorkspace } from '../lib/useWorkspace';
import { applyTenantTheme, DEFAULT_BRAND } from '../lib/tenant-theme';
import { navIcon } from '../lib/nav-icons';
import { hrefFor, resolveNav } from '../lib/workspace';
import { BottomNav, CELL as NAV_CELL } from './BottomNav';
import { Bell, ChevronRight, Lock as LockIcon, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { parseEventId } from '../lib/championship-nav';
import { FeedbackWidget } from './FeedbackWidget';
import { Sheet } from './primitives';
import { useFilterBar, FilterProvider } from '../lib/filters';
import { useTheme } from '../lib/theme';
import { sidebarRailed } from '../lib/browserStorage';
import { Avatar, Button, cn } from './ui';
import { BrandMark } from './BrandMark';
import { NotificationBell } from './NotificationBell';
import { notificationHooks } from '../lib/notification';

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
        { to: '/platform/award-types', label: 'Award Types', icon: <Award size={16} /> },
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
        { to: '/platform/event-setup', label: 'Event Setup', icon: <FileSpreadsheet size={16} /> },
        { to: '/platform/demo-requests', label: 'Demo Requests', icon: <Mail size={16} /> },
        { to: '/platform/demos', label: 'Demo Sandboxes', icon: <FlaskConical size={16} /> },
        { to: '/platform/feedback', label: 'Feedback', icon: <MessageSquare size={16} /> },
        { to: '/platform/schedule-email', label: 'Schedule Email', icon: <Send size={16} /> },
        { to: '/platform/plans', label: 'Plans & Billing', icon: <CreditCard size={16} /> },
        { to: '/platform/pricing', label: 'Pricing & Plans', icon: <Tags size={16} /> },
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

/** An icon button in the sidebar footer, coloured from the sidebar's own tokens. */
const SIDEBAR_ICON = 'text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg-strong)]';

/** The page's filters as a plain row above its content (there is no top bar to hold them). */
function HeaderFilters() {
  const { eventId, setEventId, tournamentId, setTournamentId, sportId, setSportId, config } = useFilterBar();
  if (!config.championships && !config.tournaments && !config.sports) return null;

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

  return <div className="mb-4 flex flex-wrap items-center justify-end gap-2 max-sm:[&_select]:min-w-0 max-sm:[&_select]:flex-1">{controls}</div>;
}

/** A row in the phone account sheet. */
function AccountRow({ icon, label, onClick, right, danger = false }: { icon: ReactNode; label: string; onClick: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition',
        danger ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800')}>
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', danger ? 'bg-rose-50 dark:bg-rose-500/15' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{icon}</span>
      <span className="flex-1">{label}</span>
      {right}
    </button>
  );
}

export function AppShell() {
  const { ctx, activeRole, logout } = useAuth();
  const ws = useWorkspace();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Phone: the account sheet (bottom bar) and the notifications drawer it opens.
  const [accountOpen, setAccountOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const { data: unreadCount } = notificationHooks.useUnreadCount();
  const unread = unreadCount ?? 0;
  // The sidebar's account menu (desktop); the phone bar keeps its own.
  const [deskMenuOpen, setDeskMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop rail. Persisted because it is a workspace preference, not a per-page
  // one - collapsing it on Fixtures and finding it expanded again on Standings
  // would read as the app forgetting.
  const [railed, setRailed] = useState(sidebarRailed.get);
  const toggleRail = () => setRailed((v) => {
    const next = !v;
    sidebarRailed.set(next);
    return next;
  });

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

  /**
   * Detect an actual workspace SWITCH (My Space <-> an org <-> an event), as
   * opposed to ordinary navigation within the one you're already in - the two
   * need different weight of animation, and only the shell knows which one just
   * happened.
   *
   * Refs, mutated during render rather than in an effect: an effect fires one
   * commit late, which is fine for a side effect but wrong here - the content
   * pane's class and the wash overlay's key both have to be right in the SAME
   * render that already remounts the content (key={pathname}), or the switch
   * plays the wrong (or no) animation for that one frame.
   */
  const workspaceId = ws.active?.id ?? null;
  const prevWorkspaceIdRef = useRef<string | null>(null);
  const washGenRef = useRef(0);
  const isWorkspaceSwitch = prevWorkspaceIdRef.current !== null && workspaceId !== null && prevWorkspaceIdRef.current !== workspaceId;
  if (isWorkspaceSwitch) washGenRef.current += 1;
  prevWorkspaceIdRef.current = workspaceId;

  const eventId = ctx ? parseEventId(pathname) : null;

  if (!ctx) return null;

  // The platform console is not a context - it is the whole tenant, so it keeps its
  // flat nav. Everyone else navigates by context.
  const isPlatform = activeRole === 'system';
  const groups = isPlatform ? navFor(activeRole) : [];
  const contextNav = !isPlatform && ws.active ? resolveNav(ws.active, ws.granted, ws.navFacts) : [];

  /**
   * THE SCORING CONSOLE OWNS A PHONE'S SCREEN.
   *
   * An official scoring on a phone holds it in one hand for the whole match, and
   * every pixel above and below the deck pushes a button further off the bottom.
   * So below md the shell steps aside on /score: no header row, no tab bar, tight
   * padding. The console carries its own one-line bar with the way back out. Wider
   * screens have room for both and keep the shell.
   */
  const scoring = pathname.startsWith('/score/');

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
      <div
        className="h-screen h-dvh overflow-hidden md:grid"
        style={{ ['--rail-w' as string]: railed ? '72px' : '240px', gridTemplateColumns: 'var(--rail-w) 1fr' }}
      >
        {/* Mobile scrim */}
        {sidebarOpen && <div className="animate-backdrop fixed inset-0 z-scrim bg-slate-900/50 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <aside
          style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
          className={cn(
            'fixed inset-y-0 left-0 z-drawer flex w-[240px] flex-col overflow-hidden border-r text-[var(--sidebar-fg)] transition-transform duration-200 md:static md:z-auto md:w-auto md:translate-x-0 md:transition-none',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className={cn('flex items-center gap-2.5 border-b py-3.5', railed ? 'md:flex-col md:justify-center md:gap-2 md:px-0 px-4' : 'px-4')} style={{ borderColor: 'var(--sidebar-border)' }}>
            <BrandMark height={22} className={cn(railed && 'md:hidden')} />
            {railed && <span className="hidden md:block"><BrandMark height={22} markOnly /></span>}
            <button onClick={toggleRail} className={cn('hidden h-8 w-8 place-items-center rounded-lg md:grid', SIDEBAR_ICON, !railed && 'ml-auto')}
              aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={railed} title={railed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button onClick={() => setSidebarOpen(false)} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-[var(--sidebar-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg-strong)] active:scale-90 md:hidden" aria-label="Close menu"><X size={16} /></button>
          </div>
          {/* Keyed to the workspace, not the route: re-entering on every click
              inside the same workspace would be noise, but a genuine switch
              should read as "this whole side changed", not just its href. */}
          <div key={workspaceId ?? 'none'} className="contents animate-sidebar-switch">
          {/* The switcher sits above the nav because it changes what the nav IS. */}
          {!isPlatform && ws.contexts.length > 0 && (
            <div className={cn('px-3 pt-3', railed && 'md:hidden')}>
              <ContextSwitcher
                contexts={ws.contexts}
                active={ws.active}
                granted={ws.granted}
                navFacts={ws.navFacts}
                onSwitch={(id) => { ws.switchTo(id); setSidebarOpen(false); }}
              />
            </div>
          )}
          {/* Collapsed: no visible scrollbar (it still scrolls), or its width pushes the icons off the logo's centre line.
              .no-scrollbar, not a Tailwind class: index.css styles scrollbars unlayered, which beats any utility. */}
          <nav className={cn('flex-1 overflow-y-auto px-3 py-4', railed && 'no-scrollbar')}>
            {!isPlatform && ws.active && contextNav.map((it) => {
              const href = hrefFor(ws.active!, it);
              const Icon = navIcon(it.key);
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
                  title={it.locked ? `${it.label} - needs ${it.needs}` : it.label}
                  className={({ isActive }) => cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-[background-color,color] duration-150',
                    railed ? 'md:justify-center md:px-0 px-2.5' : 'px-2.5',
                    isActive ? 'bg-[var(--sidebar-active)] font-semibold text-[var(--sidebar-fg-strong)]' : 'text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg-strong)]',
                    it.locked && 'opacity-60',
                  )}
                >
                  <Icon size={17} className="flex-none" />
                  <span className={cn('flex-1', railed && 'md:hidden')}>{it.label}</span>
                  {it.locked && <LockIcon size={12} className={cn('flex-none opacity-80', railed && 'md:hidden')} />}
                </NavLink>
              );
            })}
            {groups.map((g) => (
              <div key={g.group} className="mb-4">
                <div className={cn('px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]', railed && 'md:hidden')}>{g.group}</div>
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    data-tour={`nav-${it.to}`}
                    end={it.end && !eventId}
                    onClick={() => setSidebarOpen(false)}
                    title={it.label}
                    className={({ isActive }) => cn(
                      'mb-0.5 flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-[background-color,color] duration-150',
                      railed ? 'md:justify-center md:px-0 px-2.5' : 'px-2.5',
                      isActive && !eventId ? 'bg-[var(--sidebar-active)] font-semibold text-[var(--sidebar-fg-strong)]' : 'text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg-strong)]',
                    )}
                  >
                    <span className="flex-none">{it.icon}</span>
                    <span className={cn(railed && 'md:hidden')}>{it.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          </div>
          {/* Desktop: the account, notifications and theme in one compact row (a phone
              keeps them in its slim top bar). Collapsed, they stack. */}
          <div className="hidden border-t p-2 md:block" style={{ borderColor: 'var(--sidebar-border)' }}>
            {railed ? (
              <div className="flex flex-col items-center gap-1">
                <NotificationBell className={SIDEBAR_ICON} />
                <button onClick={toggle} className={cn('grid h-9 w-9 place-items-center rounded-lg', SIDEBAR_ICON)}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <button onClick={() => setDeskMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={deskMenuOpen}
                  className="mt-1 rounded-full ring-2 ring-transparent transition hover:ring-[var(--sidebar-active)]" title={ctx.user.name}>
                  <Avatar name={ctx.user.name} size={30} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5 rounded-xl bg-[var(--sidebar-active)]/60 p-1">
                <button onClick={() => setDeskMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={deskMenuOpen}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-[var(--sidebar-active)]">
                  <Avatar name={ctx.user.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold leading-tight text-[var(--sidebar-fg-strong)]">{ctx.user.name}</span>
                    <span className="block truncate text-[10.5px] leading-tight text-[var(--sidebar-muted)]">{ctx.user.email}</span>
                  </span>
                </button>
                <NotificationBell className={cn('!h-8 !w-8', SIDEBAR_ICON)} />
                <button onClick={toggle} className={cn('grid h-8 w-8 flex-none place-items-center rounded-lg', SIDEBAR_ICON)}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
                  {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* The sidebar account menu opens beside the sidebar. Portalled: the sidebar clips its children. */}
        {deskMenuOpen && createPortal(
          <>
            <div className="fixed inset-0 z-scrim" onClick={() => setDeskMenuOpen(false)} />
            <div className="animate-dropdown fixed bottom-3 z-popover w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
              style={{ left: railed ? 80 : 248 }}>
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                <div className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{ctx.user.name}</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{ctx.user.email}</div>
                {ctx.user.phone && <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{ctx.user.phone}</div>}
              </div>
              {SHOW_MY_PLAN && (
                <button onClick={() => { setDeskMenuOpen(false); navigate('/plans'); }}
                  className="w-full px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">My plan</button>
              )}
              {/* empty:hidden - RoleSwitcher renders nothing for single-role users. */}
              <div className="px-3 py-2 empty:hidden"><RoleSwitcher /></div>
              <button onClick={signOut} className="w-full px-3 py-2 text-left text-[13px] font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">Sign out</button>
            </div>
          </>,
          document.body,
        )}

        {/* Main - pinned to the viewport height so only <main> scrolls; the sidebar
            stays put (md:h-auto would let the column grow and drag the whole grid). */}
        <div className="flex h-screen h-dvh min-h-0 min-w-0 flex-col">
          {/* Phone: a thin brand bar, so the screen never opens on a bare edge. The
              controls it used to carry live in the bottom bar's Account sheet. */}
          {!scoring && (
            <div className="pt-safe shrink-0 border-b border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-11 items-center gap-3 px-4">
                <BrandMark height={18} />
                {ws.active?.name && (
                  <span className="ml-auto min-w-0 truncate text-xs font-semibold text-slate-500 dark:text-slate-400" title={ws.active.name}>{ws.active.name}</span>
                )}
              </div>
            </div>
          )}
          {/* pb-24 below md clears the tab bar; the bar carries its own
              safe-area padding for the home indicator beneath it. */}
          <main className={cn('min-h-0 flex-1 overflow-auto bg-[var(--canvas)] p-4 pb-24 sm:p-6 md:pb-6 dark:bg-slate-950', scoring && 'max-md:p-2 max-md:pb-2')}>
            <div key={pathname} className={cn('mx-auto', isWorkspaceSwitch ? 'animate-workspace-enter' : 'animate-page-enter', !eventId && 'max-w-6xl')}>
              <HeaderFilters />
              <Outlet />
            </div>
          </main>
          {/* md:hidden is BottomNav's own; on /score it is also gone on a phone. */}
          {!scoring && (
            <BottomNav items={contextNav} groups={groups} ctx={ws.active} onMore={() => setSidebarOpen(true)}
              trailing={(
                <button type="button" onClick={() => setAccountOpen(true)} className={cn(NAV_CELL, 'text-slate-500 dark:text-slate-400')}
                  aria-label={unread > 0 ? `Account, ${unread} unread notifications` : 'Account'}>
                  <span className="relative">
                    <Avatar name={ctx.user.name} size={22} />
                    {/* The bell's unread badge, since the bell itself is not on a phone's screen. */}
                    {unread > 0 && (
                      <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-900" aria-hidden>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-semibold leading-none">Account</span>
                </button>
              )} />
          )}
          {accountOpen && (
            <Sheet title="Account" size="sm" onClose={() => setAccountOpen(false)}>
              <div className="space-y-1">
                <div className="mb-2 flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                  <Avatar name={ctx.user.name} size={40} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{ctx.user.name}</div>
                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.email}</div>
                    {ctx.user.phone && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{ctx.user.phone}</div>}
                  </div>
                </div>
                <AccountRow icon={<Bell size={17} />} label="Notifications" onClick={() => { setAccountOpen(false); setBellOpen(true); }}
                  right={unread > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span> : <ChevronRight size={16} className="text-slate-400" />} />
                <AccountRow icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />} label={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle} />
                {SHOW_MY_PLAN && <AccountRow icon={<CreditCard size={17} />} label="My plan" onClick={() => { setAccountOpen(false); navigate('/plans'); }} />}
                <div className="px-3 py-2 empty:hidden"><RoleSwitcher /></div>
                <AccountRow icon={<LogOut size={17} />} label="Sign out" danger onClick={signOut} />
              </div>
            </Sheet>
          )}
          {/* The drawer only; the account sheet above opens it. */}
          <NotificationBell hideTrigger open={bellOpen} onOpenChange={setBellOpen} />
        </div>
        {/* A thin top-loading-bar sweep on a real switch - never on first load
            (washGenRef starts at 0 and only moves on an actual prev-id -> new-id
            transition). Fixed Sportagon blue always, deliberately NOT the
            KIND_META tile colour - an org's own brand shows all over the
            sidebar and chrome already; this cue is the product saying "you
            switched", not another surface for the tenant's colour. Always
            mounted once unlocked so an unrelated re-render elsewhere can never
            cut its animation short; re-keyed per switch so it replays cleanly
            and settles back to invisible (animation-fill-mode both) until the
            next one. Deliberately never covers the page - the cue that this is
            a different space now, not a curtain over it. */}
        {washGenRef.current > 0 && (
          <div
            key={washGenRef.current}
            aria-hidden
            className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] animate-workspace-bar"
            style={{ background: DEFAULT_BRAND }}
          />
        )}
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
