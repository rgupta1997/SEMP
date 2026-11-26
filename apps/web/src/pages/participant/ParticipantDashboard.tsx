import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Compass, Route, Sparkles, Trophy } from 'lucide-react';
import { formatPoints } from '@semp/shared';
import { useApi, fmtDate, fmtDateRange } from '../../lib/hooks';
import { eventStatusLook } from '../../lib/eventStatus';
import { EmptyState, cn } from '../../components/ui';
import { useSportIcon } from '../../features/personal/SportFilter';
import { KitStripes } from '../../features/personal/MatchParts';
import { PERSONAL_NAVY } from '../../features/personal/styles';
import type { AchievementGroup, DashboardData, EventCardData, MatchSummary } from '../../components/participant/types';

// The profile's Overview, read the way a player page reads: the trophy cabinet,
// latest form, and the career as a journey through events. The career numbers
// live in the profile's stats ribbon above, so they are not repeated here.

const JOURNEY_INITIAL = 5;
const LINK = 'inline-flex items-center gap-1 text-[13px] font-bold text-[var(--accent-deep)] transition hover:gap-1.5 dark:text-[var(--accent)]';

function SectionTitle({ icon: Icon, title, action }: { icon: typeof Trophy; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-slate-700 dark:text-slate-200">
        <Icon size={15} className="text-[var(--accent-deep)] dark:text-[var(--accent)]" aria-hidden />{title}
      </h3>
      {action}
    </div>
  );
}

// Where an honour was won, deduped ("X · X" when a tournament shares the event's name).
const where = (g: AchievementGroup) => g.instances
  .map((it) => [it.championship, it.tournament, it.sport].filter((p, i, all) => p && all.indexOf(p) === i).join(' · '))
  .join('\n');

/** The trophy cabinet: a slim navy shelf of gold medal chips, the count on each disc. */
function TrophyCabinet({ groups }: { groups: AchievementGroup[] }) {
  return (
    <section className={cn('relative overflow-hidden rounded-2xl border-b-2 border-amber-400/60 text-white', PERSONAL_NAVY)}>
      <KitStripes />
      <div className="relative flex items-center gap-3 px-4 py-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em]"><Trophy size={14} className="text-amber-300" aria-hidden /><span className="max-sm:hidden">Trophy cabinet</span></span>
        {/* One line, no scroll: chips that would not fit wrap onto a hidden second line, so only whole ones show. "All" lists the rest. */}
        <span className="flex h-[42px] min-w-0 flex-1 flex-wrap content-start gap-x-2 gap-y-4 overflow-hidden pt-1">
          {groups.length === 0 ? (
            <span className="truncate text-xs text-white/55">Your first honour lands here - player of the match, a medal, a title.</span>
          ) : groups.map((g) => (
            <span key={g.award_name} title={`${g.award_name}\n${where(g)}`}
              className="flex shrink-0 cursor-help items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-1 pr-3 ring-1 ring-amber-300/25">
              <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 text-amber-950 shadow shadow-amber-500/40">
                <Trophy size={13} aria-hidden />
                {g.count > 1 && <span className="absolute -right-1.5 -top-1 rounded-full bg-white px-1 text-[9px] font-black tabular-nums text-[#0a1630]">×{g.count}</span>}
              </span>
              <span className="leading-tight">
                <span className="block whitespace-nowrap text-xs font-bold">{g.award_name}</span>
                {g.latest_date && <span className="block text-[10px] text-white/45">{fmtDate(g.latest_date)}</span>}
              </span>
            </span>
          ))}
        </span>
        {groups.length > 0 && <Link to="/profile?tab=achievements" className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-[var(--accent)] hover:underline">All<ChevronRight size={14} aria-hidden /></Link>}
      </div>
    </section>
  );
}

const FORM_LOOK: Record<string, { letter: string; band: string }> = {
  won: { letter: 'W', band: 'bg-emerald-500' },
  lost: { letter: 'L', band: 'bg-rose-500' },
  draw: { letter: 'D', band: 'bg-slate-400' },
};

/** One result in the latest-form row: a coloured band with W/D/L, the score, who it was against. */
function FormTile({ m, iconOf }: { m: MatchSummary; iconOf: (s: string | null) => string }) {
  const nav = useNavigate();
  const look = FORM_LOOK[m.result] ?? (m.status === 'live' ? { letter: 'LIVE', band: 'bg-rose-500' } : { letter: 'NEXT', band: 'bg-sky-500' });
  const scored = m.my_score != null && m.opp_score != null;
  return (
    <button type="button" onClick={() => nav(`/profile/matches/${m.id}`)}
      className="group flex w-40 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <span className={cn('flex items-center justify-between px-3 py-1.5 text-white', look.band)}>
        <span className="text-sm font-black tracking-wider">{look.letter}</span>
        <span className="text-sm" aria-hidden>{iconOf(m.sport)}</span>
      </span>
      <span className="flex flex-1 flex-col gap-1 p-3">
        <span className={cn('font-black tabular-nums', scored ? 'text-2xl text-slate-900 dark:text-slate-100' : 'text-lg text-sky-600 dark:text-sky-300')}>
          {scored ? `${formatPoints(m.my_score)}-${formatPoints(m.opp_score)}`
            : m.scheduled_at ? new Date(m.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : 'TBC'}
        </span>
        <span className="line-clamp-2 text-xs font-semibold leading-snug text-slate-600 dark:text-slate-300">vs {m.opponent?.name ?? 'TBC'}</span>
        <span className="mt-auto pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{m.scheduled_at ? fmtDate(m.scheduled_at) : 'Date TBC'}</span>
      </span>
    </button>
  );
}

/** One stop on the career journey: a node on the line, the event, and how it went there. */
function JourneyStop({ e, iconOf, last }: { e: EventCardData; iconOf: (s: string | null) => string; last: boolean }) {
  const look = eventStatusLook(e.status);
  const start = e.start_date ? new Date(e.start_date) : null;
  // The bar splits only decided matches into W / D / L; unplayed ones are counted apart, not as "not won".
  const w = e.win_count; const d = e.draw_count ?? 0; const l = e.loss_count ?? 0;
  const decided = w + d + l;
  const toPlay = Math.max(0, e.match_count - (e.played_count ?? decided));
  const pct = (n: number) => (decided ? (n / decided) * 100 : 0);
  return (
    <li className="relative grid grid-cols-[3.25rem_1.5rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[5rem_1.75rem_minmax(0,1fr)]">
      {/* When: month over year. */}
      <span className="pt-3 text-right">
        <span className="block text-sm font-black text-slate-800 dark:text-slate-100">{start ? start.toLocaleDateString(undefined, { month: 'short' }) : '-'}</span>
        <span className="block text-[11px] font-semibold text-slate-400">{start?.getFullYear() ?? ''}</span>
      </span>
      {/* The line and its node, coloured by the event's status. */}
      <span className="relative flex justify-center">
        {!last && <span aria-hidden className="absolute bottom-0 top-5 w-0.5 bg-slate-200 dark:bg-slate-800" />}
        <span aria-hidden className={cn('relative mt-4 h-3.5 w-3.5 rounded-full ring-4 ring-[var(--canvas)]', look.solid.split(' ')[0])} />
      </span>
      <Link to={`/profile/championships/${e.id}`}
        className="group mb-4 block min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[var(--accent-deep)]/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 text-[15px] font-black leading-snug text-slate-900 group-hover:text-[var(--accent-deep)] dark:text-slate-100">{e.name}</span>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]', look.solid)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', look.dot, e.status === 'ongoing' && 'animate-pulse')} aria-hidden />{look.label}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{fmtDateRange(e.start_date, e.end_date)}</span>
          {e.sports.length > 0 && <span className="flex items-center gap-0.5" title={e.sports.join(', ')}>{e.sports.slice(0, 6).map((s) => <span key={s} aria-hidden>{iconOf(s)}</span>)}{e.sports.length > 6 && <span className="ml-0.5 font-bold">+{e.sports.length - 6}</span>}</span>}
        </span>
        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex h-1.5 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" title={decided ? `${w} won, ${d} drawn, ${l} lost` : 'Nothing decided yet'}>
            <span className="bg-emerald-500" style={{ width: `${pct(w)}%` }} />
            <span className="bg-slate-400" style={{ width: `${pct(d)}%` }} />
            <span className="bg-rose-500" style={{ width: `${pct(l)}%` }} />
          </span>
          <span className="min-w-0 text-xs font-bold tabular-nums text-slate-600 dark:text-slate-300">
            {decided ? <><span className="text-emerald-600 dark:text-emerald-400">{w}W</span> · {d}D · <span className="text-rose-500">{l}L</span></> : 'No results yet'}
            <span className="font-semibold text-slate-400">{toPlay > 0 && ` · ${toPlay} to play`} · {e.team_count} team{e.team_count === 1 ? '' : 's'}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ParticipantDashboard() {
  const { data, isLoading } = useApi<DashboardData>('/me/dashboard');
  const iconOf = useSportIcon();
  const [journeyShown, setJourneyShown] = useState(JOURNEY_INITIAL);

  // Collapse awards by name so repeated honours read as one "×7 Player of the Match".
  const achievementGroups = useMemo(() => {
    const map = new Map<string, AchievementGroup>();
    for (const a of data?.achievements ?? []) {
      let g = map.get(a.award_name);
      if (!g) { g = { award_name: a.award_name, count: 0, latest_date: null, instances: [] }; map.set(a.award_name, g); }
      g.count += 1;
      if (a.date && (g.latest_date == null || a.date > g.latest_date)) g.latest_date = a.date;
      g.instances.push({
        id: a.id, championship: a.championship?.name ?? null, tournament: a.tournament?.name ?? null,
        sport: a.sport, discipline: a.discipline, opponent_team_name: a.opponent_team_name,
        date: a.date, fixture_id: a.fixture_id,
        team: a.team_award ? a.my_team_name : null,
      });
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.award_name.localeCompare(b.award_name));
  }, [data?.achievements]);
  // Newest first along the journey.
  const journey = useMemo(() => [...(data?.championships ?? [])]
    .sort((a, b) => new Date(b.start_date ?? 0).getTime() - new Date(a.start_date ?? 0).getTime()), [data?.championships]);

  if (isLoading || !data) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading">
        <span className={cn('block h-40 animate-pulse rounded-2xl', PERSONAL_NAVY)} />
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <span key={i} className="h-36 w-40 shrink-0 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
      </div>
    );
  }
  if (data.stats.total_events === 0) {
    return (
      <EmptyState icon={<Compass size={22} />} title="You haven't played in a championship yet"
        description="Join a team via an invite from your captain, or find an event. Your journey starts here."
        action={<Link to="/discover" className="!bg-[var(--accent)] !text-slate-950"><Compass size={14} aria-hidden />Find an event</Link>} />
    );
  }

  return (
    <div className="space-y-7">
      <TrophyCabinet groups={achievementGroups} />

      <section>
        <SectionTitle icon={Sparkles} title="Latest form" action={<Link to="/profile/matches" className={LINK}>All matches<ChevronRight size={14} aria-hidden /></Link>} />
        {data.recent_matches.length === 0
          ? <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700">No matches yet. Your results line up here once you play.</p>
          : <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">{data.recent_matches.map((m) => <FormTile key={m.id} m={m} iconOf={iconOf} />)}</div>}
      </section>

      <section>
        <SectionTitle icon={Route} title="Career journey" action={<Link to="/championships" className={LINK}>My events<ChevronRight size={14} aria-hidden /></Link>} />
        <ol>{journey.slice(0, journeyShown).map((e, i, arr) => <JourneyStop key={e.id} e={e} iconOf={iconOf} last={i === arr.length - 1} />)}</ol>
        {journey.length > journeyShown && (
          <div className="pl-[5.25rem] sm:pl-[7.25rem]"><button type="button" onClick={() => setJourneyShown(journey.length)} className={LINK}>Show {journey.length - journeyShown} earlier event{journey.length - journeyShown === 1 ? '' : 's'}</button></div>
        )}
      </section>
    </div>
  );
}
