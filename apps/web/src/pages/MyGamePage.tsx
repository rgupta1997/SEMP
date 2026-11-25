import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, ChevronRight, ClipboardPen, Compass, Medal, Trophy, Users, type LucideIcon } from 'lucide-react';
import { KHO_END_LABEL, KHO_END_SHORT } from '@semp/shared';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/pageTitle';
import { EmptyState, cn } from '../components/ui';
import { LiveDot, TeamAvatar } from '../features/schedule/ScheduleParts';
import { HEX_CLIP, PILL_GHOST, PILL_TEAL, TEAL_TILE } from '../features/personal/styles';
import { MyGameSkeleton } from '../features/personal/MyGameSkeleton';
import { DayTile, MatchMeta, RESULT_TAG, Scoreline, score } from '../features/personal/MatchParts';

// My Game - personal landing screen (PG-10, F-040..F-044). A new account lands here with
// nothing, so empty states must read as a beginning, not a broken page.

interface Match {
  id: string; round: string | null; status: string; scheduled_at: string | null;
  sport: string | null; discipline: string | null;
  championship: { id: string; name: string; slug: string } | null;
  my_team: { id: string; name: string; short_name?: string | null } | null;
  opponent: { id: string; name: string; short_name?: string | null; organization: string | null } | null;
  my_score: number | null; opp_score: number | null;
  /** Shoot-out kicks [mine, theirs] when a level match was settled on penalties. */
  pens?: [number, number] | null;
  /** Kho kho: settled on minimum chase or won by an innings. */
  settled?: 'minimum_chase' | 'innings' | null;
  result: 'won' | 'lost' | 'draw' | 'pending' | null;
  reason?: string;
}

interface Home {
  next: Match | null;
  live: Match[];
  pending: Match[];
  recent: Match[];
  teams: Array<{ id: string; name: string | null; organization: string | null; sport: string | null; role: string }>;
  stats: { games: number; events: number; sports: number; wins: number };
}

// Lists here grow without bound; cap each so this first screen stays an overview.
const ROW_LIMIT = 5;
const CARD = 'overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';
const CARD_HEAD = 'flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800';

/** How each result reads: the form-guide letter, the row's tone. */
const RESULT_LOOK: Record<string, { letter: string; label: string; chip: string; bar: string }> = {
  won: { letter: 'W', label: 'Won', chip: 'bg-emerald-500 text-white', bar: 'bg-emerald-500' },
  lost: { letter: 'L', label: 'Lost', chip: 'bg-rose-500 text-white', bar: 'bg-rose-500' },
  draw: { letter: 'D', label: 'Drawn', chip: 'bg-slate-400 text-white', bar: 'bg-slate-400' },
};
const lookOf = (r: Match['result']) => RESULT_LOOK[r ?? ''] ?? { letter: '-', label: 'Played', chip: 'bg-slate-200 text-slate-600', bar: 'bg-slate-300' };

/** "Good morning" by the clock. */
function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "4:46 PM" in any locale: 12-hour, upper-case AM/PM. */
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** "Today · 5:00 PM", "Tomorrow · 9:30 AM", "28 Nov · 4:00 PM". */
function when(iso: string | null) {
  if (!iso) return 'Time to be confirmed';
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'Today'
    : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day} · ${clock(d)}`;
}

/** "in 45 min", "in 3 h", "in 2 days" - how long until kick-off. */
function countdown(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return 'starting now';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}


/** Faint pitch lines and kit stripes behind the hero: sporty texture, not a picture. */
function HeroTexture() {
  return (
    <svg aria-hidden viewBox="0 0 1200 360" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
      <g stroke="#fff" strokeOpacity=".06" strokeWidth="2" fill="none">
        <rect x="540" y="24" width="640" height="312" />
        <line x1="860" y1="24" x2="860" y2="336" />
        <circle cx="860" cy="180" r="62" />
        <rect x="540" y="100" width="80" height="160" />
        <rect x="1100" y="100" width="80" height="160" />
      </g>
      <g fill="#5CE1E6">
        <polygon points="380,360 470,360 710,0 620,0" opacity=".07" />
        <polygon points="490,360 520,360 760,0 730,0" opacity=".12" />
        <polygon points="538,360 550,360 790,0 778,0" opacity=".18" />
      </g>
    </svg>
  );
}

/** One side of the fixture: crest and name. */
function Side({ team }: { team: Match['my_team'] | Match['opponent'] }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <TeamAvatar name={team?.name ?? 'TBD'} short={team?.short_name} />
      <span className="line-clamp-2 text-[13px] font-bold leading-tight text-slate-800 dark:text-slate-100" title={team?.name ?? ''}>{team?.name ?? 'TBC'}</span>
    </div>
  );
}

/** The next fixture, laid out like a match-centre card: crests either side, kick-off in the middle. */
function FixtureCard({ next, iconOf, onOpen, emptyAction }: {
  next: Match | null; iconOf: (s: string | null) => string; onOpen: () => void; emptyAction: ReactNode;
}) {
  const at = next?.scheduled_at ? new Date(next.scheduled_at) : null;
  const left = next ? countdown(next.scheduled_at) : null;
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-white text-slate-900 shadow-xl shadow-black/30 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent-deep)] dark:text-[var(--accent)]">Next fixture</span>
        {left && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-bold text-[var(--accent-deep)] dark:text-[var(--accent)]">Starts {left}</span>}
      </div>
      {next ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-4">
            <Side team={next.my_team} />
            <div className="text-center">
              <div className="text-xl font-black tabular-nums sm:text-2xl">{at ? clock(at) : 'TBC'}</div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{at ? at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Time to be confirmed'}</div>
            </div>
            <Side team={next.opponent} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <span className="min-w-0 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
              <span aria-hidden>{iconOf(next.sport)} </span>{[next.sport, next.discipline, next.round].filter(Boolean).join(' · ')}
            </span>
            <button type="button" onClick={onOpen} className={PILL_TEAL}>Open match<ArrowRight size={14} aria-hidden /></button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-10 w-10 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" />
            <span className="text-xs font-black text-slate-400">VS</span>
            <span className="h-10 w-10 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" />
          </div>
          <div>
            <div className="text-sm font-black">No fixture yet</div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Your next match shows here once it is scheduled.</p>
          </div>
          {emptyAction}
        </div>
      )}
    </div>
  );
}

/** The player's season along the foot of the hero, like a broadcast stat band. */
function SeasonBand({ stats, winRate, teams, form }: { stats: Home['stats']; winRate: number | null; teams: number; form: Match[] }) {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // "across 2 events" beside each count, once there is something to count.
  const across = (n: number) => (n && stats.events ? plural(stats.events, 'event') : undefined);
  const figures: Array<[string, ReactNode, string?]> = [
    ['Games', stats.games, across(stats.games)], ['Wins', stats.wins, across(stats.wins)],
    ['Win rate', winRate == null ? '-' : `${winRate}%`], ['Sports', stats.sports, across(stats.sports)], ['Teams', teams, across(teams)],
  ];
  return (
    // Phones: three figures over two (6-col grid); desktop: one row of five, then form.
    <div className="relative grid grid-cols-6 border-t border-white/10 bg-black/25 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
      {figures.map(([k, v, sub], i) => (
        <div key={k} className={cn('min-w-0 border-r border-white/10 px-3 py-3 sm:px-4 lg:col-span-1 lg:px-3 xl:px-5', i < 3 ? 'col-span-2' : 'col-span-3 border-t lg:border-t-0')}>
          {/* The note rides beside the number, so the band keeps one height. */}
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-xl font-black tabular-nums sm:text-2xl">{v}</span>
            {/* "across" drops where the cells are narrowest: small phones and the 1024-1279 row of five. */}
            {sub && <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--accent)]" title={`across ${sub}`}><span className="max-[374px]:hidden lg:max-xl:hidden">across </span>{sub}</span>}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">{k}</div>
        </div>
      ))}
      <div className="col-span-6 flex items-center gap-2 border-t border-white/10 px-3 py-2.5 sm:px-4 lg:col-span-1 lg:border-t-0 xl:px-5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">Form</span>
        {form.length ? form.map((r) => (
          <span key={r.id} title={lookOf(r.result).label} className={cn('grid h-6 w-6 place-items-center rounded-md text-[11px] font-black', lookOf(r.result).chip)}>{lookOf(r.result).letter}</span>
        )) : <span className="text-xs text-white/45">No results yet</span>}
      </div>
    </div>
  );
}

/** The player in the Sportagon hexagon: photo or initials, teal edge, shirt number on the rim. */
function PlayerBadge({ name, photo, number }: { name: string; photo?: string | null; number?: number | null }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span aria-hidden className="relative shrink-0 drop-shadow-[0_8px_14px_rgba(0,0,0,.45)] max-sm:hidden">
      <span className="block h-[64px] w-[56px] bg-gradient-to-b from-[var(--accent)] to-[var(--accent-deep)] p-[2.5px]" style={{ clipPath: HEX_CLIP }}>
        <span className="grid h-full w-full place-items-center overflow-hidden bg-gradient-to-br from-[#2453b8] to-[#1a3d8f] text-lg font-black tracking-tight text-white" style={{ clipPath: HEX_CLIP }}>
          {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
      </span>
      {number != null && (
        <span className="absolute -bottom-1 -right-1.5 rounded-full bg-white px-1 py-px text-[10px] font-black tabular-nums text-[#0a1630] shadow ring-2 ring-[#0a1630]">#{number}</span>
      )}
    </span>
  );
}

function CardTitle({ icon: Icon, title, sub, tone = 'brand' }: { icon: LucideIcon; title: string; sub?: string; tone?: 'brand' | 'amber' | 'rose' }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl',
        tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
          : tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
            : TEAL_TILE)}><Icon size={16} aria-hidden /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{sub}</span>}
      </span>
    </span>
  );
}

/** "View all (12)" / "Show less" for a capped list. */
function MoreToggle({ total, expanded, onToggle }: { total: number; expanded: boolean; onToggle: () => void }) {
  if (total <= ROW_LIMIT) return null;
  return (
    <button type="button" onClick={onToggle}
      className="w-full border-t border-slate-100 py-2.5 text-center text-[13px] font-semibold text-[var(--accent-deep)] transition hover:bg-slate-50 dark:border-slate-800 dark:text-[var(--accent)] dark:hover:bg-slate-800/40">
      {expanded ? 'Show less' : `View all (${total})`}
    </button>
  );
}

export function MyGamePage() {
  const { ctx } = useAuth();
  const { data, isLoading } = useApi<Home>('/me/home');
  const { data: catalogue = [] } = useApi<Array<{ name: string; icon?: string | null }>>('/sports');
  const nav = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }));
  // The title lives in the top bar, as on the organisation pages.
  usePageTitle('My Game');

  const iconOf = useMemo(() => {
    const m = new Map(catalogue.map((s) => [s.name.toLowerCase(), s.icon || '🏅']));
    return (sport: string | null) => (sport ? m.get(sport.toLowerCase()) ?? '🏅' : '🏅');
  }, [catalogue]);

  const first = ctx?.user?.name?.split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  if (isLoading) return <MyGameSkeleton />;
  const d = data ?? { next: null, live: [], pending: [], recent: [], teams: [], stats: { games: 0, events: 0, sports: 0, wins: 0 } };
  const winRate = d.stats.games ? Math.round((d.stats.wins / d.stats.games) * 100) : null;
  // Newest first from the API; the form guide reads left to right, oldest to newest.
  const form = d.recent.filter((r) => r.result && r.result !== 'pending').slice(0, 5).reverse();
  const n = d.next;

  return (
    <div className="space-y-5 pb-16">
      {/* Matchday: who you are, your next fixture, and your season along the foot. */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0a1630] text-white shadow-lg">
        <HeroTexture />
        <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <PlayerBadge name={ctx?.user?.name ?? ''} photo={ctx?.user?.avatar_url}
              number={ctx?.user?.jersey_number} />
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Matchday · {today}</div>
              <h1 className="mt-0.5 text-2xl font-black leading-tight sm:text-3xl">{greeting()}{first ? `, ${first}` : ''}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-white/85">
                {[`${d.teams.length} squad${d.teams.length === 1 ? '' : 's'}`, `${d.stats.sports} sport${d.stats.sports === 1 ? '' : 's'}`, `${d.stats.events} event${d.stats.events === 1 ? '' : 's'}`].map((c) => (
                  <span key={c} className="rounded-full bg-white/10 px-2.5 py-0.5 ring-1 ring-white/15">{c}</span>
                ))}
                {d.live.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-0.5 font-bold text-white"><LiveDot className="h-1.5 w-1.5" />{d.live.length} live</span>}
              </div>
            </div>
          </div>
          <FixtureCard next={n} iconOf={iconOf}
            onOpen={() => n && nav(`/profile/matches/${n.id}`)}
            emptyAction={d.teams.length
              ? <Link to="/profile/matches" className={PILL_TEAL}><CalendarClock size={14} aria-hidden />My matches</Link>
              : <Link to="/discover" className={PILL_TEAL}><Compass size={14} aria-hidden />Find an event</Link>} />
        </div>
        <SeasonBand stats={d.stats} winRate={winRate} teams={d.teams.length} form={form} />
      </section>

      {/* Right now: only when something is live or waiting on you. */}
      {(d.live.length > 0 || d.pending.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.live.length > 0 && (
            <section className={cn(CARD, 'border-rose-200 dark:border-rose-500/30')}>
              <div className={cn(CARD_HEAD, 'bg-rose-50/60 dark:bg-rose-500/5')}>
                <span className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-500 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white"><LiveDot className="h-1.5 w-1.5" />Live</span>
                  <span className="text-sm font-black text-slate-900 dark:text-slate-100">Playing now</span>
                </span>
                <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">{d.live.length} match{d.live.length === 1 ? '' : 'es'}</span>
              </div>
              <ul>
                {(expanded.live ? d.live : d.live.slice(0, ROW_LIMIT)).map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => nav(`/profile/matches/${g.id}`)}
                      className="group flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-rose-50/40 dark:border-slate-800 dark:hover:bg-rose-500/5">
                      <span className="min-w-0 flex-1 space-y-2">
                        <Scoreline m={g} live />
                        <MatchMeta m={g} iconOf={iconOf} />
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-rose-500" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <MoreToggle total={d.live.length} expanded={!!expanded.live} onToggle={() => toggle('live')} />
            </section>
          )}
          {d.pending.length > 0 && (
            <section className={cn(CARD, 'border-amber-200 dark:border-amber-500/30')}>
              <div className={cn(CARD_HEAD, 'bg-amber-50/60 dark:bg-amber-500/5')}>
                <CardTitle icon={ClipboardPen} tone="amber" title="Waiting on you" sub="Matches you are scoring" />
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{d.pending.length} to finish</span>
              </div>
              <ul>
                {(expanded.pending ? d.pending : d.pending.slice(0, ROW_LIMIT)).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-xl dark:bg-slate-800/60" aria-hidden>{iconOf(p.sport)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{p.my_team?.name ?? 'TBC'} <span className="font-semibold text-slate-400">vs</span> {p.opponent?.name ?? 'TBC'}</span>
                      </span>
                      <MatchMeta m={p} iconOf={() => ''} />
                      <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{p.reason ?? 'Needs your attention'}</span>
                    </span>
                    <button type="button" onClick={() => nav(`/score/${p.id}`)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400 px-3.5 py-1.5 text-[13px] font-black text-amber-950 shadow-sm shadow-amber-500/20 transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">
                      Open<ArrowRight size={13} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <MoreToggle total={d.pending.length} expanded={!!expanded.pending} onToggle={() => toggle('pending')} />
            </section>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Recent results: scorelines, newest first, each tagged with how it went. */}
        <section className={cn(CARD, 'flex flex-col')}>
          <div className={CARD_HEAD}>
            <CardTitle icon={Medal} title="Recent results" sub={d.recent.length ? `Your last ${d.recent.length}` : 'Nothing played yet'} />
            <Link to="/profile/matches" className={PILL_GHOST}>
              All matches<ChevronRight size={14} aria-hidden />
            </Link>
          </div>
          {d.recent.length === 0 ? (
            <EmptyState bare compact icon={<Medal size={22} />} title="No results yet" description="Your results show up here as soon as you have played." />
          ) : (
            <>
              <ul>
                {(expanded.recent ? d.recent : d.recent.slice(0, ROW_LIMIT)).map((r) => {
                  const look = lookOf(r.result);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => nav(`/profile/matches/${r.id}`)}
                        className="group flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-800/30">
                        <DayTile iso={r.scheduled_at} />
                        <span className="min-w-0 flex-1 space-y-2">
                          <Scoreline m={r} />
                          <MatchMeta m={r} iconOf={iconOf} />
                        </span>
                        <span className="flex w-16 shrink-0 flex-col items-end gap-1 text-right">
                          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-black uppercase tracking-wider ring-1', RESULT_TAG[r.result ?? ''] ?? RESULT_TAG.draw)}>{look.label}</span>
                          {r.pens && <span className="text-[10px] font-semibold text-slate-400" title="Penalty shoot-out">{r.pens[0]}-{r.pens[1]} pens</span>}
                          {r.settled && <span className="text-[10px] font-semibold text-slate-400" title={KHO_END_LABEL[r.settled]}>{KHO_END_SHORT[r.settled]}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <MoreToggle total={d.recent.length} expanded={!!expanded.recent} onToggle={() => toggle('recent')} />
            </>
          )}
        </section>

        <aside className="space-y-5">
          {/* My teams: the squads you play for right now. */}
          <section className={CARD}>
            <div className={CARD_HEAD}><CardTitle icon={Users} title="My teams" sub={d.teams.length ? `${d.teams.length} squad${d.teams.length === 1 ? '' : 's'}` : 'Not in a squad yet'} /></div>
            {d.teams.length === 0 ? (
              <EmptyState bare compact icon={<Users size={22} />} title="You are not in a squad yet"
                description="Join an organisation or enter an event, and the teams you play for appear here."
                action={<Link to="/discover" className="!bg-[var(--accent)] !text-slate-950"><Compass size={14} aria-hidden />Find something to play</Link>} />
            ) : (
              <>
                <ul>
                  {(expanded.teams ? d.teams : d.teams.slice(0, ROW_LIMIT)).map((t) => {
                    const captain = t.role === 'captain';
                    return (
                      <li key={t.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 dark:border-slate-800">
                        <span className="relative shrink-0">
                          <TeamAvatar name={t.name ?? t.organization} short={t.organization} />
                          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" aria-hidden>{iconOf(t.sport)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{t.name ?? t.organization ?? 'Team'}</span>
                          {/* The organisation only when it isn't already the title. */}
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[t.sport, t.organization && t.organization !== (t.name ?? t.organization) ? t.organization : null].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
                          captain ? 'bg-[var(--accent)] text-slate-950' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
                          {captain && <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-slate-950 text-[8px] text-[var(--accent)]" aria-hidden>C</span>}
                          {t.role.replace(/_/g, ' ')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <MoreToggle total={d.teams.length} expanded={!!expanded.teams} onToggle={() => toggle('teams')} />
              </>
            )}
          </section>

          {/* Where to go next from here. */}
          <section className={CARD}>
            <div className={CARD_HEAD}><CardTitle icon={ArrowRight} title="Jump to" /></div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {([[Compass, 'Discover', 'Find events', '/discover'], [CalendarClock, 'My matches', 'Every fixture', '/profile/matches'],
                [Trophy, 'My events', 'Where you play', '/championships'], [Medal, 'Achievements', 'Awards, certificates', '/profile/achievements']] as Array<[LucideIcon, string, string, string]>).map(([Icon, label, hint, to]) => (
                <Link key={to} to={to}
                  className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-slate-100 p-2.5 transition hover:border-[var(--accent-deep)]/30 hover:bg-[var(--accent)]/10 dark:border-slate-800">
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg transition group-hover:bg-[var(--accent)] group-hover:text-slate-950', TEAL_TILE)}><Icon size={15} aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{label}</span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
