import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AtSign, BarChart3, Check, ChevronsUpDown, Compass, Flag, FlaskConical, History, Home,
  Landmark, Layers, LayoutGrid, LayoutList, Lock, Mail, Medal, Menu, MessageSquare, Moon,
  Plus, Shield, Sun, ToggleLeft, Trophy, Upload, User, Users, X,
} from 'lucide-react';
import { ROLE_LABELS, useAuth, type AppRole } from '../lib/auth';
import { useWorkspace, type Workspace } from '../lib/workspace';
import { BRAND } from '../lib/brand';
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
  return role === 'system' ? '/platform/sports' : '/profile';
}

// The institution workspace (J1-E7-S1). A different product from the participant
// shell, not the same one with extra links: Home first, the operation grouped the way
// an institution talks about itself, and Discover kept because entering somebody
// else's championship is part of running your own programme.
//
// Filtered by module access so a switched-off section is ABSENT rather than present
// and refused - the nav and the server read the same `modules` map (J6-E2-S2).
function institutionNav(orgId: string, modules: string[] | null): NavGroup[] {
  const on = (m: string) => !modules || modules.includes(m);
  const groups: NavGroup[] = [{
    group: 'Institution', items: [
      { to: `/organizations/${orgId}/home`, label: 'Home', icon: <Home size={16} />, end: true },
      ...(on('people') ? [{ to: `/organizations/${orgId}/members`, label: 'People', icon: <Users size={16} /> }] : []),
      ...(on('teams') ? [{ to: `/organizations/${orgId}/teams`, label: 'Teams', icon: <Shield size={16} /> }] : []),
      ...(on('administration') ? [{ to: `/organizations/${orgId}/structure`, label: 'Structure', icon: <Layers size={16} /> }] : []),
    ],
  }, {
    group: 'Competition', items: [
      ...(on('championships') ? [{ to: '/championships', label: 'Championships', icon: <Trophy size={16} /> }] : []),
      { to: '/discover', label: 'Discover', icon: <Compass size={16} /> },
      ...(on('championships') ? [{ to: '/host', label: 'Host', icon: <Plus size={16} /> }] : []),
    ],
  }];

  const admin: NavItem[] = [
    ...(on('records') ? [{ to: `/organizations/${orgId}/achievements`, label: 'Achievements', icon: <Medal size={16} /> }] : []),
    ...(on('reports') ? [{ to: `/organizations/${orgId}/reports`, label: 'Reports', icon: <BarChart3 size={16} /> }] : []),
    ...(on('administration') ? [
      { to: `/organizations/${orgId}/roles`, label: 'Roles', icon: <Lock size={16} /> },
      { to: `/organizations/${orgId}/modules`, label: 'Modules', icon: <ToggleLeft size={16} /> },
      { to: `/organizations/${orgId}/activity`, label: 'Activity', icon: <History size={16} /> },
    ] : []),
  ];
  if (admin.length) groups.push({ group: 'Administration', items: admin });
  groups.push({ group: '', items: [{ to: '/help', label: 'Help & guide', icon: '?' }] });
  return groups;
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
        { to: '/platform/org-domains', label: 'Email Domains', icon: <AtSign size={16} /> },
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
      { to: '/profile', label: 'My Game', icon: <User size={16} />, end: true },
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

// Whose workspace this is, at the top of the sidebar (J1-E7-S1). When the person only
// ever has one, it is an identity block and not a control - a picker with one option
// is furniture.
function WorkspaceHeader({ onNavigate }: { onNavigate: () => void }) {
  const { workspace, staffedOrganizations, canSwitch, setWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const org = workspace.kind === 'organization' ? workspace.organization : null;

  const label = org ? (org.short_name || org.name) : 'My Game';
  const options: Workspace[] = [
    { kind: 'personal' },
    ...staffedOrganizations.map((o) => ({ kind: 'organization' as const, id: o.id, organization: o })),
  ];

  const body = (
    <div className="flex min-w-0 items-center gap-2.5">
      {org?.logo_url
        ? <img src={org.logo_url} alt="" className="h-7 w-7 flex-none rounded-md object-cover" />
        : <div className="grid h-7 w-7 flex-none place-items-center rounded-md bg-[var(--sidebar-active)] text-xs font-bold text-white">
            {org ? (org.short_name || org.name).slice(0, 2).toUpperCase() : <User size={14} />}
          </div>}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-white">{label}</div>
        <div className="truncate text-[10px] uppercase tracking-[0.1em] text-slate-500">
          {org ? (org.verified ? 'Sports Org · Verified' : 'Sports Org') : 'Personal'}
        </div>
      </div>
    </div>
  );

  if (!canSwitch) {
    return <div className="border-b px-3 py-3" style={{ borderColor: 'var(--sidebar-border)' }}>{body}</div>;
  }

  return (
    <div className="relative border-b px-3 py-3" style={{ borderColor: 'var(--sidebar-border)' }}>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--sidebar-active)]"
      >
        {body}
        <ChevronsUpDown size={14} className="flex-none text-slate-500" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul role="listbox" className="animate-dropdown absolute left-3 right-3 z-20 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl">
            {options.map((o) => {
              const id = o.kind === 'personal' ? 'personal' : o.id;
              const active = o.kind === workspace.kind && (o.kind === 'personal' || o.id === (workspace as any).id);
              return (
                <li key={id}>
                  <button
                    type="button" role="option" aria-selected={active}
                    onClick={() => { setOpen(false); onNavigate(); if (!active) setWorkspace(o); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
                  >
                    <span className="flex-none">{active ? <Check size={14} /> : <span className="inline-block w-[14px]" />}</span>
                    <span className="truncate">{o.kind === 'personal' ? 'My Game' : (o.organization.short_name || o.organization.name)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
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
  const { workspace, modules } = useWorkspace();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const signOut = () => { logout(); navigate('/', { replace: true }); };

  const eventId = ctx ? parseEventId(pathname) : null;
  const { data: championship } = useApi<EventSummary>(eventId ? `/championships/${eventId}` : null);

  if (!ctx) return null;

  // The institution shell replaces the participant one entirely - a super admin in the
  // platform shell keeps theirs, since that is a third product again.
  const groups = activeRole === 'system' || workspace.kind !== 'organization'
    ? navFor(activeRole)
    : institutionNav(workspace.id, modules);
  const subtitle = championship?.name
    ?? (workspace.kind === 'organization' && activeRole !== 'system'
      ? workspace.organization.name
      : ROLE_LABELS[activeRole]);

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
          {activeRole !== 'system' && <WorkspaceHeader onNavigate={() => setSidebarOpen(false)} />}
          <nav className="flex-1 overflow-y-auto px-3 py-4">
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
