import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BarChart3, CalendarDays, ChevronLeft, Clock, Layers, MapPin, Shirt, StickyNote, Users, type LucideIcon, ListOrdered } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { usePageTitle } from '../../lib/pageTitle';
import { useAuth } from '../../lib/auth';
import { EmptyState, cn } from '../../components/ui';
import type { MatchResult } from '../../components/participant/types';
import { formatPoints, KHO_RESULT_WORDS, TBD_LABEL, type MatchOutcome } from '@semp/shared';
import { LiveDot, TeamAvatar } from '../../features/schedule/ScheduleParts';
import { KitStripes, RESULT_TAG } from '../../features/personal/MatchParts';
import { useSportIcon } from '../../features/personal/SportFilter';
import { PERSONAL_NAVY, PILL_GHOST, TEAL_TILE } from '../../features/personal/styles';

interface MatchDetail {
  fixture: {
    id: string;
    round: string | null;
    status: string;
    scheduled_at: string | null;
    duration_minutes: number | null;
    notes: string | null;
    home_score: number | null;
    away_score: number | null;
    my_score: number | null;
    opp_score: number | null;
    pens?: [number, number] | null;
    settled?: 'minimum_chase' | 'innings' | null;
    result: MatchResult;
    venue: { ground: string | null; venue_name: string | null; city: string | null } | null;
    sport: string | null;
    discipline: string | null;
    tournament: string | null;
    championship: { id: string; name: string; slug: string } | null;
    my_team: { id: string; name: string; short_name?: string | null; organization: string | null };
    opponent: { id: string; name: string; short_name?: string | null; organization: string | null } | null;
    my_role: string | null;
    jersey_number: number | null;
    /** The number worn in this match, from its team sheet. */
    match_jersey_number?: number | null;
    teammates: { name: string; phone: string | null; role: string; jersey_number: number | null }[];
    former_member?: boolean;
  };
  /**
   * The player's own numbers; null if not in the match. `played: false` = named but didn't
   * take part, distinct from scoring nothing (no duck for someone who never batted).
   */
  my_stats?: {
    played: boolean;
    outcome: MatchOutcome | null;
    position: string | null;
    /** False while the result can still change - said out loud, not implied. */
    official: boolean;
    groups: { title: string; items: { label: string; value: string | number }[] }[];
    note?: string;
  } | null;
}

const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const CARD_HEAD = 'flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800';
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** The match's state on the hero: Live pulses, Completed and Scheduled are quieter. */
const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-rose-500 text-white' },
  completed: { label: 'Full time', cls: 'bg-emerald-400 text-emerald-950' },
  scheduled: { label: 'Upcoming', cls: 'bg-sky-300 text-sky-950' },
};

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

/** One fact about the match, as a small tile. */
function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', TEAL_TILE)}><Icon size={16} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100" title={typeof value === 'string' ? value : undefined}>{value || '-'}</span>
      </span>
    </div>
  );
}

/** One side on the hero: crest in a ring, name, organisation. */
function HeroSide({ team, win }: { team: { name: string; short_name?: string | null; organization: string | null } | null; win: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <span className={cn('rounded-full p-1 ring-2', win ? 'ring-[var(--accent)]' : 'ring-white/15')}>
        <span className="block scale-125 p-1"><TeamAvatar name={team?.name ?? TBD_LABEL} short={team?.short_name} /></span>
      </span>
      <span className={cn('line-clamp-2 text-sm font-black leading-tight sm:text-base', win ? 'text-white' : 'text-white/75')}>{team?.name ?? TBD_LABEL}</span>
      {team?.organization && <span className="truncate text-[11px] text-white/50">{team.organization}</span>}
    </div>
  );
}

function PageSkeleton() {
  const bar = 'block animate-pulse rounded-full';
  return (
    <div className="space-y-5 pb-16" role="status" aria-label="Loading">
      <span className={cn(bar, 'h-9 w-44 bg-slate-200 dark:bg-slate-800')} />
      <div className={cn('space-y-5 rounded-2xl p-6', PERSONAL_NAVY)}>
        <span className={cn(bar, 'mx-auto h-3 w-64 bg-white/10')} />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {[0, 1, 2].map((i) => i === 1
            ? <span key={i} className={cn(bar, 'h-12 w-28 bg-white/10')} />
            : <span key={i} className="flex flex-col items-center gap-2"><span className="h-14 w-14 animate-pulse rounded-full bg-white/10" /><span className={cn(bar, 'h-3 w-24 bg-white/10')} /></span>)}
        </div>
        <span className={cn(bar, 'mx-auto h-6 w-24 bg-white/10')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <span key={i} className="h-16 animate-pulse rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2">{[0, 1].map((i) => <span key={i} className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
    </div>
  );
}

export function ParticipantMatchPage() {
  usePageTitle('Match');
  const { fixtureId } = useParams();
  const { ctx } = useAuth();
  const iconOf = useSportIcon();
  const { data, isLoading, error } = useApi<MatchDetail>(`/me/matches/${fixtureId}`);

  if (isLoading) return <PageSkeleton />;
  if (error || !data) {
    return <EmptyState icon="⚑" title="Match not available" description="This match doesn't exist or you're not part of it." />;
  }

  const f = data.fixture;
  const at = f.scheduled_at ? new Date(f.scheduled_at) : null;
  const venue = f.venue ? [f.venue.ground, f.venue.venue_name, f.venue.city].filter(Boolean).join(', ') : null;
  const status = STATUS_PILL[f.status] ?? { label: titleCase(f.status), cls: 'bg-white text-slate-800' };
  const live = f.status === 'live';
  const won = f.result === 'won'; const lost = f.result === 'lost';
  const shirt = f.match_jersey_number ?? f.jersey_number;
  const me = ctx?.user?.name;
  // The championship page stays closed to someone who has left the squad - their match list is where they go back to.
  const back = f.former_member || !f.championship
    ? { to: '/profile/matches', label: 'All matches' }
    : { to: `/profile/championships/${f.championship.id}`, label: 'Event details' };

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={back.to} className={PILL_GHOST}><ChevronLeft size={14} aria-hidden />{back.label}</Link>
        <Link to="/profile/matches" className={PILL_GHOST}><ListOrdered size={14} aria-hidden />All matches</Link>
      </div>

      {/* Match centre: both sides, the score, and how it ended. */}
      <section className={cn('relative overflow-hidden rounded-2xl text-white shadow-lg', PERSONAL_NAVY)}>
        <KitStripes />
        <div className="relative space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-center gap-2 text-center">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.1em]', status.cls)}>
              {live && <LiveDot className="h-1.5 w-1.5" />}{status.label}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
              <span aria-hidden>{iconOf(f.sport)} </span>{[f.championship?.name, f.sport, f.discipline, f.round].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
            <HeroSide team={f.my_team} win={won} />
            <div className="text-center">
              <div className={cn('flex items-center gap-2 text-4xl font-black tabular-nums sm:text-5xl', live && 'text-rose-300')}>
                <span>{f.my_score != null ? formatPoints(f.my_score) : '-'}</span>
                <span className="text-white/25">:</span>
                <span>{f.opp_score != null ? formatPoints(f.opp_score) : '-'}</span>
              </div>
              <div className="mt-1 text-[11px] font-semibold text-white/60">{at ? `${at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${clock(at)}` : 'Time to be confirmed'}</div>
            </div>
            <HeroSide team={f.opponent} win={lost} />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            {(won || lost || f.result === 'draw') && (
              <span className={cn('rounded-md px-3 py-1 text-xs font-black uppercase tracking-wider ring-1', RESULT_TAG[f.result])}>
                {won ? 'You won' : lost ? 'You lost' : 'Drawn'}
              </span>
            )}
            {f.pens && <span className="text-xs font-semibold text-white/70">{won ? 'Won' : 'Lost'} {f.pens[0]}-{f.pens[1]} on penalties</span>}
            {f.settled && (won || lost) && <span className="text-xs font-semibold text-white/70">{won ? 'Won' : 'Lost'} {KHO_RESULT_WORDS[f.settled]}</span>}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={CalendarDays} label="When" value={at ? `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${clock(at)}` : null} />
        <Fact icon={MapPin} label="Venue" value={venue} />
        <Fact icon={Clock} label="Duration" value={f.duration_minutes ? `${f.duration_minutes} min` : null} />
        <Fact icon={Layers} label="Season" value={f.tournament} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* You in this match, then the squad you played with. */}
        <section className={CARD}>
          <div className={CARD_HEAD}><CardTitle icon={Users} title="Your squad" sub={f.my_team.name} /></div>
          <div className="flex items-center gap-3 border-b border-slate-100 bg-[var(--accent)]/10 px-4 py-3 dark:border-slate-800">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0a1630] text-white" aria-hidden><Shirt size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-deep)] dark:text-[var(--accent)]">You in this match</span>
              <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{titleCase(f.my_role) || 'Player'}{shirt != null ? ` · shirt #${shirt}` : ''}</span>
            </span>
          </div>
          {f.teammates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">{f.former_member ? "You're no longer on this squad." : 'No roster recorded.'}</p>
          ) : (
            <ul>
              {f.teammates.map((t, i) => {
                const self = !!me && t.name === me;
                const captain = t.role === 'captain';
                return (
                  <li key={i} className={cn('flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 dark:border-slate-800', self && 'bg-[var(--accent)]/5')}>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300" aria-hidden>
                      {t.jersey_number ?? t.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {t.name}{self && <span className="ml-1.5 text-xs font-bold text-[var(--accent-deep)] dark:text-[var(--accent)]">(you)</span>}
                    </span>
                    {/* Teammates' phone numbers stay hidden here; the API still returns them. */}
                    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
                      captain ? 'bg-[var(--accent)] text-slate-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
                      {captain && <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-slate-950 text-[8px] text-[var(--accent)]" aria-hidden>C</span>}
                      {titleCase(t.role)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {f.notes && (
            <div className="flex items-start gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <StickyNote size={14} className="mt-0.5 shrink-0" aria-hidden /><span><span className="font-bold text-slate-600 dark:text-slate-300">Match notes: </span>{f.notes}</span>
            </div>
          )}
        </section>

        <MyStatsCard stats={data.my_stats} />
      </div>
    </div>
  );
}

/**
 * Rendered from the API's groups, not a per-sport layout, so one shape fits every sport.
 * Absent when the sport records no individual detail - an empty card would read as broken.
 */
function MyStatsCard({ stats }: { stats?: MatchDetail['my_stats'] }) {
  if (!stats) return null;
  return (
    <section className={CARD}>
      <div className={CARD_HEAD}>
        <CardTitle icon={BarChart3} title="Your statistics" sub={stats.official ? 'From the official result' : 'Provisional - this result is not official yet'} />
        {!stats.official && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Provisional</span>}
      </div>
      <div className="space-y-4 p-4">
        {stats.note && <p className="text-sm text-slate-500 dark:text-slate-400">{stats.note}</p>}
        {stats.groups.map((g) => (
          <div key={g.title}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{g.title}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.items.map((it) => (
                <div key={it.label} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                  <div className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{String(it.value)}</div>
                  <div className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{it.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
