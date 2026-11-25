import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, Info, MapPin, Medal, Timer, Users, type LucideIcon, ListOrdered } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, fmtDateRange } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { usePageTitle } from '../../lib/pageTitle';
import { eventStatusLook } from '../../lib/eventStatus';
import { EmptyState, cn } from '../../components/ui';
import { ViewTabs } from '../../features/schedule/ScheduleParts';
import { ChampionshipFixtures } from '../../components/participant/ChampionshipFixtures';
import { ChampionshipParticipants } from '../../components/participant/ChampionshipParticipants';
import { ChampionshipStandings } from '../../components/participant/ChampionshipStandings';
import { KitStripes, MatchDayList, MatchMeta, MatchTag, Scoreline } from '../../features/personal/MatchParts';
import { useSportIcon } from '../../features/personal/SportFilter';
import { PERSONAL_NAVY, PILL_GHOST, TEAL_TILE } from '../../features/personal/styles';
import type { MatchSummary } from '../../components/participant/types';

interface EventDetail {
  championship: {
    id: string; name: string; slug: string; status: string;
    start_date: string | null; end_date: string | null; venue: string | null; description: string | null;
  };
  stats: { matches: number; wins: number; losses: number; draws: number };
  teams: {
    id: string; name: string; sport: string | null; discipline: string | null;
    entry_type: string | null; squad_min: number | null; squad_max: number | null; format: string | null;
    role: string; jersey_number: number | null; status: string;
    roster: { name: string; role: string; jersey_number: number | null }[];
  }[];
  matches: MatchSummary[];
  standings: {
    organization_id: string; organization: any;
    played: number; won: number; drawn: number; lost: number; points: number;
  }[];
  /** Off every squad they had here - their own record only. */
  former_member?: boolean;
}

const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const CARD_HEAD = 'flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800';
const CHIP = 'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider';
const CHIP_SLATE = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

function CardTitle({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl', TEAL_TILE)}><Icon size={16} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>}
      </span>
    </span>
  );
}

/** One match as a tappable scoreline, for the overview's short lists. */
function MiniMatch({ m, iconOf }: { m: MatchSummary; iconOf: (s: string | null) => string }) {
  const nav = useNavigate();
  return (
    <button type="button" onClick={() => nav(`/profile/matches/${m.id}`)}
      className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/30">
      <span className="min-w-0 flex-1 space-y-2"><Scoreline m={m} live={m.status === 'live'} kicks={m.pens} /><MatchMeta m={m} iconOf={iconOf} event={false} /></span>
      <MatchTag m={m} />
    </button>
  );
}

/** A roster player: shirt number (or initials), name, and the captain's armband. */
function RosterChip({ r }: { r: { name: string; role: string; jersey_number: number | null } }) {
  const captain = r.role === 'captain';
  return (
    <li className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[11px] font-black text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700" aria-hidden>
        {r.jersey_number ?? r.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{r.name}</span>
      {captain
        ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-black text-slate-950" title="Captain">C</span>
        : r.role !== 'player' && <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">{titleCase(r.role)}</span>}
    </li>
  );
}

function PageSkeleton() {
  const bar = 'block animate-pulse rounded-full';
  return (
    <div className="space-y-5 pb-16" role="status" aria-label="Loading">
      <span className={cn(bar, 'h-9 w-32 bg-slate-200 dark:bg-slate-800')} />
      <div className={cn('overflow-hidden rounded-2xl', PERSONAL_NAVY)}>
        <div className="space-y-3 p-6"><span className={cn(bar, 'h-5 w-20 bg-white/10')} /><span className={cn(bar, 'h-8 w-72 max-w-full bg-white/10')} /><span className={cn(bar, 'h-3 w-52 bg-white/10')} /></div>
        <div className="grid grid-cols-5 border-t border-white/10 bg-black/25">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="space-y-2 border-r border-white/10 px-4 py-3"><span className={cn(bar, 'h-5 w-8 bg-white/10')} /><span className={cn(bar, 'h-2 w-12 bg-white/10')} /></div>)}</div>
      </div>
      <span className={cn(bar, 'h-10 w-96 max-w-full bg-slate-200 dark:bg-slate-800')} />
      <div className="grid gap-5 lg:grid-cols-2">{[0, 1].map((i) => <span key={i} className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
    </div>
  );
}

export function ParticipantEventPage() {
  // Route is /profile/championships/:championshipId - must match the param name,
  // otherwise this is undefined and the fetch 404s ("Championship not available").
  const { championshipId } = useParams();
  const [tab, setTab] = useState('overview');
  const iconOf = useSportIcon();
  const { data, isLoading, error } = useApi<EventDetail>(`/me/championships/${championshipId}`);
  usePageTitle(data?.championship.name ?? 'Event');

  if (isLoading) return <PageSkeleton />;
  if (error || !data) {
    return <EmptyState icon="◆" title="Championship not available" description="This championship doesn't exist or you didn't participate in it." />;
  }

  const { championship, stats, teams, matches } = data;
  // Someone who left the squad sees what they played here, not the event around it.
  const former = !!data.former_member;
  const count = (n: number) => <span className="tabular-nums opacity-70">{n}</span>;
  const tabs: Array<{ value: string; label: string; badge?: ReactNode }> = former
    ? [{ value: 'overview', label: 'Overview' }, { value: 'matches', label: 'My matches', badge: count(matches.length) }]
    : [
      { value: 'overview', label: 'Overview' },
      { value: 'teams', label: 'My teams', badge: count(teams.length) },
      { value: 'matches', label: 'My matches', badge: count(matches.length) },
      { value: 'participants', label: 'Participants' },
      { value: 'schedule', label: 'Schedule' },
      { value: 'results', label: 'Results' },
      { value: 'standings', label: 'Standings' },
    ];
  const shown = tabs.some((t) => t.value === tab) ? tab : 'overview';

  const look = eventStatusLook(championship.status);
  const sports = [...new Set(teams.map((t) => t.sport).filter((s): s is string => !!s))];
  const winRate = stats.matches ? Math.round((stats.wins / stats.matches) * 100) : null;
  const now = Date.now();
  const live = matches.filter((m) => m.status === 'live');
  const next = matches.filter((m) => m.status === 'scheduled' && m.scheduled_at && new Date(m.scheduled_at).getTime() >= now)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0];
  const recent = matches.filter((m) => m.status === 'completed')
    .sort((a, b) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime()).slice(0, 3);
  const upNow = [...live, ...(next ? [next] : [])];
  const figures: Array<[string, ReactNode]> = [['Matches', stats.matches], ['Wins', stats.wins], ['Draws', stats.draws], ['Losses', stats.losses], ['Win rate', winRate == null ? '-' : `${winRate}%`]];

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/championships" className={PILL_GHOST}><ChevronLeft size={14} aria-hidden />My events</Link>
        <Link to="/profile/matches" className={PILL_GHOST}><ListOrdered size={14} aria-hidden />All matches</Link>
      </div>

      {/* The event, and your record in it along the foot. */}
      <section className={cn('relative overflow-hidden rounded-2xl text-white shadow-lg', PERSONAL_NAVY)}>
        <KitStripes />
        <div className="relative space-y-2 p-4 sm:p-6">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-sm', look.solid)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', look.dot, championship.status === 'ongoing' && 'animate-pulse')} aria-hidden />{look.label}
          </span>
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">{championship.name}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/70">
            <span className="inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden />{fmtDateRange(championship.start_date, championship.end_date)}</span>
            <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden />{championship.venue || 'Venue to be confirmed'}</span>
          </div>
          {sports.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {sports.map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/15"><span aria-hidden>{iconOf(s)}</span>{s}</span>)}
            </div>
          )}
        </div>
        <div className="relative grid grid-cols-5 border-t border-white/10 bg-black/25">
          {figures.map(([k, v]) => (
            <div key={k} className="min-w-0 border-r border-white/10 px-2 py-3 last:border-r-0 sm:px-5">
              <div className="text-lg font-black tabular-nums sm:text-2xl">{v}</div>
              <div className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-white/55 sm:text-[10px]">{k}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-full overflow-x-auto"><ViewTabs value={shown} onChange={setTab} options={tabs} /></div>

      {shown === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={CARD}>
            <div className={CARD_HEAD}><CardTitle icon={Timer} title={live.length ? 'Playing now' : 'Up next'} sub={upNow.length ? undefined : 'Nothing scheduled'} /></div>
            {upNow.length ? upNow.map((m) => <MiniMatch key={m.id} m={m} iconOf={iconOf} />)
              : <EmptyState bare compact icon={<Timer size={20} />} title="No match coming up" description="Your next fixture here shows up once it is scheduled." />}
          </section>
          <section className={CARD}>
            <div className={CARD_HEAD}>
              <CardTitle icon={Medal} title="Recent results" sub={recent.length ? `Your last ${recent.length}` : 'Nothing played yet'} />
              {matches.length > 0 && <button type="button" onClick={() => setTab('matches')} className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--accent-deep)] dark:text-[var(--accent)]">All<ArrowRight size={14} aria-hidden /></button>}
            </div>
            {recent.length ? recent.map((m) => <MiniMatch key={m.id} m={m} iconOf={iconOf} />)
              : <EmptyState bare compact icon={<Medal size={20} />} title="No results yet" description="Your results here show up once you have played." />}
          </section>
          {championship.description && (
            <section className={cn(CARD, 'lg:col-span-2')}>
              <div className={CARD_HEAD}><CardTitle icon={Info} title="About this event" /></div>
              <p className="whitespace-pre-line px-4 py-3 text-sm text-slate-600 dark:text-slate-300">{championship.description}</p>
            </section>
          )}
        </div>
      )}

      {shown === 'teams' && (
        teams.length === 0 ? <EmptyState icon={<Users size={22} />} title="No teams" description="The squads you play for here show up once you are on one." /> : (
          <div className="grid gap-5 lg:grid-cols-2">
            {teams.map((t) => (
              <section key={t.id} className={CARD}>
                <div className={CARD_HEAD}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-lg dark:bg-slate-800/60" aria-hidden>{iconOf(t.sport)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{t.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[t.sport, t.discipline].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span className={cn(CHIP, CHIP_SLATE)}>{titleCase(t.status)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-[var(--accent)]/10 px-4 py-2.5 dark:border-slate-800">
                  <span className="mr-1 text-xs font-bold text-slate-700 dark:text-slate-200">You: {titleCase(t.role)}{t.jersey_number != null ? ` · #${t.jersey_number}` : ''}</span>
                  {t.entry_type && <span className={cn(CHIP, CHIP_SLATE)}>{titleCase(t.entry_type)}</span>}
                  {t.squad_min != null && t.squad_max != null && <span className={cn(CHIP, CHIP_SLATE)}>Squad {t.squad_min}-{t.squad_max}</span>}
                  {t.format && <span className={cn(CHIP, CHIP_SLATE)}>{t.format}</span>}
                </div>
                {t.roster.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-400">No roster recorded.</p> : (
                  <ul className="grid gap-1.5 p-3 sm:grid-cols-2">{t.roster.map((r, i) => <RosterChip key={i} r={r} />)}</ul>
                )}
              </section>
            ))}
          </div>
        )
      )}

      {shown === 'matches' && (
        matches.length === 0
          ? <EmptyState icon={<CalendarDays size={22} />} title="No matches yet" description="Fixtures appear here once your teams are drawn." />
          : <MatchDayList matches={[...matches].sort((a, b) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime())} iconOf={iconOf} />
      )}

      {shown === 'participants' && championshipId && <ChampionshipParticipants championshipId={championshipId} />}

      {shown === 'schedule' && championshipId && <ChampionshipFixtures championshipId={championshipId} mode="schedule" />}

      {shown === 'results' && championshipId && <ChampionshipFixtures championshipId={championshipId} mode="results" />}

      {shown === 'standings' && championshipId && <ChampionshipStandings championshipId={championshipId} />}
    </div>
  );
}
