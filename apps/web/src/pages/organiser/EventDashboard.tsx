import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, BarChart3, CalendarClock, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, Clock, Flag, ListChecks, Medal, Megaphone, Radio, Rocket, Trophy, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { useEvent } from './EventLayout';
import { useApi } from '../../lib/hooks';
import { EmptyState, StatusBadge, cn } from '../../components/ui';
import { SharePublicLink } from '../../components/SharePublicLink';
import { useOrganiserOnboarding } from '../../lib/onboarding';
import { LiveDot, SportsDecor, countPhases } from '../../features/schedule/ScheduleParts';

/** How each lifecycle status reads in the hero. */
const STATUS_LOOK: Record<string, { label: string; dot: string; solid: string }> = {
  draft: { label: 'Draft', dot: 'bg-amber-900/60', solid: 'bg-amber-400 text-amber-950 shadow-amber-900/20' },
  registration_open: { label: 'Registration open', dot: 'bg-sky-900/60', solid: 'bg-sky-300 text-sky-950 shadow-sky-900/20' },
  ongoing: { label: 'Live', dot: 'bg-white', solid: 'bg-rose-500 text-white shadow-rose-900/30' },
  completed: { label: 'Completed', dot: 'bg-emerald-950/60', solid: 'bg-emerald-400 text-emerald-950 shadow-emerald-900/20' },
};
const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const CARD_HEAD = 'flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800';
const PILL_LINK = 'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-brand-300';
const PILL_PRIMARY = 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-700 dark:bg-brand-500';
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function CardTitle({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Icon size={16} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>}
      </span>
    </span>
  );
}

/** One figure on the hero's scoreboard; it opens the page that holds it. */
function Figure({ to, label, value, sub, loading, alert }: { to: string; label: string; value: ReactNode; sub: string; loading?: boolean; alert?: boolean }) {
  return (
    // Each cell draws its own top and left hairline; the grid's -1px offset hides the outer ones.
    <Link to={to} className={cn('group min-w-0 border-l border-t border-white/15 px-3 py-3 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 sm:px-4',
      alert && 'bg-amber-400/15')}>
      <span className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]', alert ? 'text-amber-200' : 'text-white/65')}>
        {alert && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden />}{label}
      </span>
      {/* Not "0" while the numbers are still on their way. */}
      {loading ? (
        <span aria-label="Loading" className="mt-1.5 block space-y-1.5"><span className="block h-6 w-10 animate-pulse rounded bg-white/25" /><span className="block h-2.5 w-20 animate-pulse rounded bg-white/15" /></span>
      ) : (
        <>
          <span className="mt-0.5 block text-2xl font-black tabular-nums">{value}</span>
          <span className="block truncate text-xs text-white/70 group-hover:text-white/90">{sub}</span>
        </>
      )}
    </Link>
  );
}

export function EventDashboard() {
  const { championship, eventId, canManage, organises, back, whereWhen, allWhere, lifecycle } = useEvent();
  const base = `/championships/${eventId}`;
  const { data: tournaments = [], isLoading: tournamentsLoading } = useApi<any[]>(`/tournaments?championship_id=${eventId}`);
  const { data: teams = [], isLoading: teamsLoading } = useApi<any[]>(`/teams?championship_id=${eventId}`);
  const { data: enrollments = [], isLoading: enrollmentsLoading } = useApi<any[]>(`/championships/${eventId}/enrollments`);
  const { data: draws = [], isLoading: drawsLoading } = useApi<any[]>(`/championships/${eventId}/draws`);
  const { data: fixtures = [], isLoading: fixturesLoading } = useApi<any[]>(`/championships/${eventId}/fixtures`);
  const { data: officials = [], isLoading: officialsLoading } = useApi<any[]>(organises ? `/championships/${eventId}/officials` : null);
  const { data: venues = [], isLoading: venuesLoading } = useApi<any[]>(`/venues?championship_id=${eventId}`);
  const { data: grounds = [] } = useApi<any[]>(organises ? `/championships/${eventId}/grounds` : null);
  // Live "getting started" progress (organisers only).
  const onboarding = useOrganiserOnboarding(eventId, championship.status, canManage, championship.entry);
  const setupKey = `overview-setup-open-${eventId}`;
  const [setupOpen, setSetupOpen] = useState(() => { try { return localStorage.getItem(setupKey) !== '0'; } catch { return true; } });
  const toggleSetup = () => setSetupOpen((v) => { try { localStorage.setItem(setupKey, v ? '0' : '1'); } catch { /* storage off */ } return !v; });
  const showSetup = canManage && !onboarding.loading && !onboarding.complete;
  // An open setup card makes the main column tall, so Jump to moves beside it to keep both columns even.
  const jumpAside = showSetup && setupOpen;
  const jump = (
    <JumpTo base={base} wide={!jumpAside} links={([
      [CalendarClock, 'Schedule', 'schedule', true],
      [ListChecks, 'Results', 'results', true],
      [BarChart3, 'Standings', 'standings', true],
      [Users, 'Participants', 'participants', organises],
      [UserCog, 'Organising team', 'organisers', canManage],
      [Megaphone, 'Communications', 'communications', canManage],
    ] as Array<[LucideIcon, string, string, boolean]>).filter(([, , , ok]) => ok)} />
  );

  const pending = enrollments.filter((e) => e.status === 'pending').length;
  const approved = enrollments.filter((e) => e.status === 'approved').length;
  const sportsCount = new Set(draws.map((d) => d.tournament_sports?.sport_id).filter(Boolean)).size;
  const phases = countPhases(fixtures);
  const total = phases.live + phases.upcoming + phases.unscheduled + phases.done;
  const entrants = (championship.entry?.entrant_label_plural ?? 'Organisations').toLowerCase();
  const look = STATUS_LOOK[championship.status] ?? { label: championship.status, dot: 'bg-slate-500', solid: 'bg-white text-slate-800' };

  // What wants a decision now, most urgent first.
  const attention: Array<{ icon: LucideIcon; tone: 'rose' | 'amber' | 'brand'; label: string; to?: string; onClick?: () => void; cta: string }> = [];
  if (phases.live) attention.push({ icon: Radio, tone: 'rose', label: `${n(phases.live, 'match', 'matches')} live now`, to: `${base}/results`, cta: 'Follow' });
  if (canManage && pending) attention.push({ icon: Users, tone: 'amber', label: `${n(pending, entrants.replace(/s$/, ''), entrants)} waiting for approval`, to: `${base}/setup?tab=invite`, cta: 'Review' });
  if (organises && phases.unscheduled) attention.push({ icon: Clock, tone: 'amber', label: `${n(phases.unscheduled, 'match', 'matches')} still need a time`, to: `${base}/schedule?show=unscheduled`, cta: 'Schedule' });
  if (lifecycle && championship.status === 'draft') attention.push({ icon: Rocket, tone: 'brand', label: 'In draft - open registration when setup is ready', onClick: lifecycle.advance, cta: lifecycle.label });

  return (
    <div className="space-y-5">
      {/* Hero: which event, where it stands, and the one thing to do next. */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white shadow-sm">
        <SportsDecor />
        <div className="relative p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <button type="button" onClick={back.go} className="inline-flex items-center gap-1 rounded-full text-xs font-semibold text-white/70 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                <ChevronLeft size={14} aria-hidden />{back.label}
              </button>
              {/* The status rides on the title's line, solid in its own colour, so it is read with the name. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-2xl font-black leading-tight sm:text-3xl">{championship.name}</h1>
                <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] shadow-md', look.solid)}>
                  {championship.status === 'ongoing'
                    ? <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" /><span className="relative inline-flex h-2 w-2 rounded-full bg-white" /></span>
                    : <span className={cn('h-2 w-2 rounded-full', look.dot)} aria-hidden />}
                  {look.label}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-white/80" title={allWhere}>{whereWhen}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManage && <SharePublicLink eventId={eventId} />}
              {lifecycle && (
                <button type="button" onClick={lifecycle.advance} disabled={lifecycle.pending}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-brand-700 shadow-lg transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60">
                  {lifecycle.pending ? 'Updating…' : lifecycle.label}<ArrowRight size={14} aria-hidden />
                </button>
              )}
            </div>
          </div>

          {/* Scoreboard: how big the event is, how far along, and what is waiting. */}
          <div className="mt-5 overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15">
            <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
              <Figure to={`${base}/setup?tab=sports`} loading={drawsLoading || tournamentsLoading} label="Sports" value={sportsCount}
                sub={`${n(draws.length, 'discipline')} · ${n(tournaments.length, 'season')}`} />
              <Figure to={`${base}/participants`} loading={teamsLoading} label="Squads" value={teams.length} sub={`${approved} ${entrants} approved`} />
              <Figure to={`${base}/schedule`} loading={fixturesLoading} label="Matches" value={<>{phases.done}<span className="text-base text-white/60">/{total}</span></>} sub={total ? `${Math.round((phases.done / total) * 100)}% played` : 'None yet'} />
              <Figure to={`${base}/organisers?tab=officials`} loading={organises && officialsLoading} label="Officials" value={officials.length} sub={officials.length ? 'Ready to score' : 'None assigned'} />
              {canManage && (
                <Figure to={`${base}/setup?tab=invite`} loading={enrollmentsLoading} label="Pending approvals" value={pending} alert={pending > 0}
                  sub={pending ? 'Needs review' : 'All reviewed'} />
              )}
              <Figure to={`${base}/setup?tab=venues`} loading={venuesLoading} label="Venues" value={venues.length}
                sub={organises ? n(grounds.length, 'ground') : venues.length ? 'Set' : 'None yet'} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          {showSetup && <SetupCard state={onboarding} open={setupOpen} onToggle={toggleSetup} />}
          <MatchesCard base={base} phases={phases} total={total} organises={organises} loading={fixturesLoading} />
          {!jumpAside && jump}
        </div>

        <aside className="min-w-0 space-y-5">
          {organises && (
            <section className={CARD}>
              <div className={CARD_HEAD}><CardTitle icon={AlertCircle} title="Needs your attention" sub={attention.length ? n(attention.length, 'item') : 'Nothing waiting'} /></div>
              {attention.length === 0 ? (
                <p className="flex items-center gap-2.5 px-4 py-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={18} aria-hidden />All clear - nothing needs you right now.
                </p>
              ) : (
                <ul>
                  {attention.map((a, i) => {
                    const Icon = a.icon;
                    const tone = a.tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
                      : a.tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
                        : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300';
                    const body = (
                      <>
                        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', tone)}><Icon size={15} aria-hidden /></span>
                        <span className="min-w-0 flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{a.label}</span>
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-brand-600 dark:text-brand-300">{a.cta}<ChevronRight size={14} aria-hidden /></span>
                      </>
                    );
                    const row = 'flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/30';
                    return (
                      <li key={i}>
                        {a.to ? <Link to={a.to} className={row}>{body}</Link> : <button type="button" onClick={a.onClick} className={row}>{body}</button>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}


          <section className={CARD}>
            <div className={CARD_HEAD}>
              <CardTitle icon={CalendarRange} title="Seasons" sub={n(tournaments.length, 'season')} />
              {canManage && <Link to={`${base}/setup?tab=tournaments`} className={PILL_LINK}>Manage</Link>}
            </div>
            {tournaments.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-400">No seasons yet.</p>
            ) : (
              <ul>
                {tournaments.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 dark:border-slate-800">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{t.name}</span>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {jumpAside && jump}
        </aside>
      </div>
    </div>
  );
}

/** Shortcuts to the event's main pages: 3 across under Matches, 2 across in the side column. */
function JumpTo({ base, links, wide }: { base: string; links: Array<[LucideIcon, string, string, boolean]>; wide: boolean }) {
  return (
    <section className={CARD}>
      <div className={CARD_HEAD}><CardTitle icon={ArrowRight} title="Jump to" /></div>
      <div className={cn('grid grid-cols-2 gap-2 p-3', wide && 'sm:grid-cols-3')}>
        {links.map(([Icon, label, path]) => (
          <Link key={path} to={`${base}/${path}`}
            className="group flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-brand-500/10 dark:hover:text-brand-300">
            <Icon size={15} className="shrink-0 text-slate-400 group-hover:text-brand-600 dark:group-hover:text-brand-300" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Setup progress: what's done in one line, what's left as clear next steps. */
function SetupCard({ state, open, onToggle: toggle }: { state: ReturnType<typeof useOrganiserOnboarding>; open: boolean; onToggle: () => void }) {
  const next = state.steps.find((s) => !s.done);
  const left = state.total - state.doneCount;
  const pct = Math.round((state.doneCount / state.total) * 100);
  return (
    <section className={CARD}>
      <button type="button" onClick={toggle} aria-expanded={open} className={cn(CARD_HEAD, 'w-full text-left', !open && 'border-b-0')}>
        <CardTitle icon={Rocket} title="Get ready to go live"
          sub={`${state.doneCount} of ${state.total} done · ${left} ${left === 1 ? 'step' : 'steps'} to go`} />
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="h-2 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
              <span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-xs font-black tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
          </span>
          <ChevronDown size={16} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
        </span>
      </button>
      {open && (
        // Every step is a tile that opens its page: done ones to change, the rest to do.
        <ol className="grid gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {state.steps.map((s, i) => {
            const isNext = s === next;
            return (
              <li key={s.id} className="min-w-0">
                <Link to={s.cta.to}
                  className={cn('group relative flex h-full flex-col gap-2 rounded-xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                    isNext ? 'border-brand-300 bg-brand-50/70 shadow-sm dark:border-brand-500/50 dark:bg-brand-500/10'
                      : s.done ? 'border-emerald-200/70 bg-emerald-50/40 hover:border-emerald-300 dark:border-emerald-500/20 dark:bg-emerald-500/5'
                        : 'border-slate-200 bg-white hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black',
                      s.done ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30'
                        : isNext ? 'bg-brand-600 text-white' : 'border border-dashed border-slate-300 text-slate-400 dark:border-slate-600')}>
                      {s.done ? <Check size={13} strokeWidth={2.5} aria-hidden /> : i + 1}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide',
                      s.done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : isNext ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
                      {s.done ? 'Done' : isNext ? 'Next up' : 'To do'}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-slate-900 dark:text-slate-100">{s.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-slate-400">{s.description}</span>
                  </span>
                  <span className={cn('inline-flex items-center gap-1 text-xs font-bold',
                    s.done ? 'text-emerald-700 dark:text-emerald-300' : 'text-brand-600 dark:text-brand-300')}>
                    {s.done ? 'Review' : s.cta.label}
                    <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Match progress, split by state; each tile opens Schedule on that state. */
function MatchesCard({ base, phases, total, organises, loading }: { base: string; phases: ReturnType<typeof countPhases>; total: number; organises: boolean; loading: boolean }) {
  const pct = total ? Math.round((phases.done / total) * 100) : 0;
  const tiles: Array<{ key: string; label: string; icon: LucideIcon; count: number; tone: string }> = [
    { key: 'live', label: 'Live now', icon: Radio, count: phases.live, tone: 'text-rose-600 dark:text-rose-300' },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarClock, count: phases.upcoming, tone: 'text-sky-600 dark:text-sky-300' },
    { key: 'unscheduled', label: 'Need a time', icon: Clock, count: phases.unscheduled, tone: 'text-amber-600 dark:text-amber-300' },
    { key: 'done', label: 'Completed', icon: CheckCircle2, count: phases.done, tone: 'text-emerald-600 dark:text-emerald-300' },
  ];
  return (
    <section className={CARD}>
      <div className={CARD_HEAD}>
        <CardTitle icon={Trophy} title="Matches" sub={loading ? 'Loading…' : total ? `${phases.done} of ${total} played` : 'No matches yet'} />
        <Link to={`${base}/schedule`} className={PILL_LINK}>Open schedule<ChevronRight size={14} aria-hidden /></Link>
      </div>
      {loading ? (
        <div aria-label="Loading" className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <span key={i} className="block h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      ) : total === 0 ? (
        <EmptyState bare compact icon={<Flag size={22} />} title="No matches yet"
          description="Matches appear here once draws are made on the Schedule page."
          action={organises ? <Link to={`${base}/schedule`} className={PILL_PRIMARY}><Medal size={14} aria-hidden />Make draws</Link> : undefined} />
      ) : (
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Event progress</span><span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.key} to={`${base}/schedule?show=${t.key}`}
                  className="rounded-xl border border-slate-100 px-3 py-2.5 transition hover:border-brand-200 hover:bg-brand-50/50 dark:border-slate-800 dark:hover:bg-brand-500/10">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t.key === 'live' && t.count > 0 ? <LiveDot className="h-2 w-2" /> : <Icon size={13} className={t.tone} aria-hidden />}{t.label}
                  </span>
                  <span className="mt-0.5 block text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{t.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
