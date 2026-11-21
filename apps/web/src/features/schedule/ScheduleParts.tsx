import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, MapPin, Radio, UserRound } from 'lucide-react';
import { formatPoints, isGroupBye, KNOCKOUT_ROUND, knockoutRoundSize, teamPresetsFor } from '@semp/shared';
import { cn } from '../../components/ui';

// The Schedule page's presentation pieces: event pulse, live strip, sport chips, match cards.

export type Phase = 'live' | 'upcoming' | 'unscheduled' | 'done' | 'off';
export type PhaseFilter = '' | Exclude<Phase, 'off'>;
export const PHASE_FILTERS: PhaseFilter[] = ['', 'live', 'upcoming', 'unscheduled', 'done'];

/** Where a match is in its life, as a new organiser would put it. */
export function matchPhase(f: any): Phase {
  if (f.status === 'live') return 'live';
  if (f.status === 'completed' || f.status === 'walkover') return 'done';
  if (['cancelled', 'postponed', 'bye'].includes(f.status)) return 'off';
  return f.scheduled_at ? 'upcoming' : 'unscheduled';
}

/**
 * "Full time" only fits a sport that ends on the clock (football, hockey, kabaddi);
 * volleyball or chess just finish. The match's own frozen format wins, else the sport's default.
 */
export function endsOnClock(f: any, sport?: string | null): boolean {
  const snap = f?.live_state?.format?.levels?.[0]?.terminator;
  if (snap) return snap === 'clock';
  return teamPresetsFor(sport)[0]?.levels?.[0]?.terminator === 'clock';
}

/** A finished match's pill: "Full time" / "FT" for clock sports, "Completed" / "Done" otherwise. */
export function doneLabel(f: any, sport?: string | null, short = false): string {
  if (f?.status === 'walkover') return short ? 'W/O' : 'Walkover';
  if (endsOnClock(f, sport)) return short ? 'FT' : 'Full time';
  return short ? 'Done' : 'Completed';
}

/** Category order within a sport: Men, Women, Mixed, then anything else. */
export function categoryRank(name: string): number {
  if (/\b(women|woman|girls?|ladies|female)/i.test(name)) return 1; // before "men": "Women's" contains it
  if (/\b(men|man|boys?|male)\b|\bmen's/i.test(name)) return 0;
  if (/\bmixed\b/i.test(name)) return 2;
  return 3;
}

/** Sorts categories Men > Women > Mixed > the rest, A-Z within each. */
export function sortByCategory<T>(list: T[], nameOf: (x: T) => string): T[] {
  return [...list].sort((a, b) => categoryRank(nameOf(a)) - categoryRank(nameOf(b)) || nameOf(a).localeCompare(nameOf(b)));
}

/** A match that is actually played: not a group's rest slot or a bye. */
export const realMatch = (f: any) => !isGroupBye(f) && f.status !== 'bye';

/** "SF" reads as nothing to a new user; spell the round out. */
export function roundName(round?: string | null): string {
  if (!round) return 'Match';
  if (round === KNOCKOUT_ROUND.final) return 'Final';
  if (round === KNOCKOUT_ROUND.semiFinal) return 'Semi-final';
  if (round === KNOCKOUT_ROUND.quarterFinal) return 'Quarter-final';
  if (round === KNOCKOUT_ROUND.thirdPlace) return '3rd-place play-off';
  const n = knockoutRoundSize(round);
  return n > 0 ? `Round of ${n}` : round;
}

function whenParts(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = d.toDateString() === now.toDateString();
  return {
    day: today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase()),
    today,
  };
}

export function countPhases(fixtures: any[]): Record<Phase, number> {
  const c: Record<Phase, number> = { live: 0, upcoming: 0, unscheduled: 0, done: 0, off: 0 };
  for (const f of fixtures) if (realMatch(f)) c[matchPhase(f)] += 1;
  return c;
}

/** A finished draw: a quiet pill beside its name, not a big badge. */
export function AllPlayedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
      <Check size={12} strokeWidth={2.5} aria-hidden />All played
    </span>
  );
}

/** A draw in progress as a small ring: green arc played, red arc live, "1/3" inside. */
export function ProgressRing({ done, live, total }: { done: number; live: number; total: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const doneLen = total ? (done / total) * c : 0;
  const liveLen = total ? (live / total) * c : 0;
  return (
    <div className="relative h-9 w-9 shrink-0" role="img" aria-label={`${done} of ${total} matches played`}>
      <svg viewBox="0 0 44 44" className="h-9 w-9 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-slate-200 dark:stroke-slate-700" />
        {liveLen > 0 && (
          <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-rose-400"
            strokeDasharray={`${liveLen} ${c}`} strokeDashoffset={-doneLen} />
        )}
        {doneLen > 0 && (
          <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
            className="stroke-emerald-500 transition-all" strokeDasharray={`${doneLen} ${c}`} />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[10px] font-black tabular-nums text-slate-700 dark:text-slate-200">
        {done}/{total}
      </span>
    </div>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
    </span>
  );
}

// Line-drawn kit, each centred on its own origin so a layout only places it.
const KIT = {
  basketball: <><circle r="58" /><path d="M-58 0H58M0-58V58M-41-41C-16-16-16 16-41 41M41-41C16-16 16 16 41 41" /></>,
  shuttlecock: <><path d="M-12 0A12 12 0 0 0 12 0Z" /><path d="M-12 0L-26-58M12 0L26-58M-4 0L-9-61M4 0L9-61M-26-58Q0-67 26-58M-18-24Q0-29 18-24" /></>,
  racket: <><ellipse rx="30" ry="38" /><path d="M0-36V36M-15-32V32M15-32V32M-26-19H26M-30 0H30M-26 19H26M-10 37L-4 58M10 37L4 58" /><rect x="-5" y="58" width="10" height="48" rx="3" /></>,
  bat: <><rect x="-4" y="-78" width="8" height="40" rx="3" /><path d="M-12-38H12V64Q12 75 0 77Q-12 75-12 64Z" /><path d="M0-26V62" /></>,
  ball: <><circle r="15" /><path d="M-5-14Q3 0-5 14M5-14Q13 0 5 14" /></>,
  football: <><circle r="42" /><path d="M0-15L14-5 9 12H-9L-14-5Z" /><path d="M0-15V-42M14-5L40-13M9 12L25 34M-9 12L-25 34M-14-5L-40-13" /></>,
  volleyball: <><circle r="40" /><path d="M0-40Q-6-6-35 20M0-40Q8 0 35 20M-35 20Q0 4 35 20" /></>,
};
type Kit = keyof typeof KIT;
const at = (k: Kit, x: number, y: number, rot = 0, s = 1) => (
  <g key={`${k}${x}`} transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>{KIT[k]}</g>
);
const SVG_PROPS = { fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

const ICON_OFFSET: Partial<Record<Kit, number>> = { racket: -34, shuttlecock: 28 };
/** The kit's pieces, in a pleasant order for cycling through. */
export const SPORT_ICON_KINDS: Kit[] = ['football', 'racket', 'basketball', 'shuttlecock', 'bat', 'volleyball', 'ball'];
/** One piece of the kit as a plain line icon (a bolder stroke, since it is drawn small). */
export function SportIcon({ kind, size = 28, className }: { kind: Kit; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="-80 -80 160 160" className={className} {...SVG_PROPS} strokeWidth={9}>
      {/* The racket and shuttlecock are drawn off-centre for the banner; centre them here. */}
      <g transform={`translate(0 ${ICON_OFFSET[kind] ?? 0})`}>{KIT[kind]}</g>
    </svg>
  );
}

/**
 * Faint line-drawn sports kit behind the banner: purely decorative. A wide layout
 * anchored right (the headline stays clean) and a compact one for a phone.
 */
export function SportsDecor() {
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full text-white/[0.09] sm:block" viewBox="0 0 1400 220" preserveAspectRatio="xMaxYMid slice" {...SVG_PROPS}>
        {at('basketball', 1318, 78, 18)}
        {at('shuttlecock', 1168, 196, -28)}
        {at('racket', 1040, 58, 34)}
        {at('bat', 900, 92, 38)}
        {at('ball', 948, 186)}
        {at('football', 760, 186, -12)}
        {at('volleyball', 640, 118, 14, 0.9)}
      </svg>
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.09] sm:hidden" viewBox="0 0 360 300" preserveAspectRatio="xMaxYMid slice" {...SVG_PROPS}>
        {at('basketball', 300, 52, 18, 0.62)}
        {at('racket', 330, 196, 30, 0.62)}
        {at('bat', 205, 150, 40, 0.55)}
        {at('football', 120, 268, -12, 0.6)}
        {at('shuttlecock', 34, 286, -24, 0.6)}
        {at('ball', 262, 284, 0, 0.8)}
      </svg>
    </>
  );
}

/** One tile in a PulseBanner: a count that doubles as a filter. */
export interface PulseTile {
  key: string; label: string; hint: string; icon: typeof Radio; count: number;
  /** Classes when picked, and the icon colour when not. */
  on: string; idle: string;
  /** Pulses its dot while the count is above zero (live matches). */
  live?: boolean;
}

/**
 * The shared hero banner on Schedule and Results: a headline with a progress bar,
 * and tiles that filter the list below. Same look on both pages by construction.
 */
export function PulseBanner({ eyebrow, done, total, unit, empty, pctLabel = 'complete', tiles, value, onChange }: {
  eyebrow: string; done: number; total: number;
  /** "matches played", "results official" */
  unit: string;
  /** Shown under the bar while there is nothing to count yet. */
  empty: string;
  /** What the percentage means: "complete", "of played matches official". */
  pctLabel?: string;
  tiles: PulseTile[]; value: string; onChange: (key: string) => void;
}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-4 text-white shadow-sm sm:p-5">
      <SportsDecor />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 lg:max-w-xs">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{eyebrow}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-black tabular-nums">{done}</span>
            <span className="text-sm font-semibold text-white/80">of {total} {unit}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-lime-300 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-white/70">{total === 0 ? empty : `${pct}% ${pctLabel}`}</div>
        </div>
        {/* Fixed width + equal columns: picking a tile changes its colour, never its size. */}
        <div className={cn('grid grid-cols-2 gap-2 lg:shrink-0 [&>*]:min-w-0',
          tiles.length === 3 ? 'sm:grid-cols-3 lg:w-[33rem]' : 'sm:grid-cols-4 lg:w-[36rem]')}>
          {tiles.map((t) => {
            const active = value === t.key;
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" aria-pressed={active}
                onClick={() => onChange(active ? '' : t.key)}
                className={cn('group rounded-xl px-3 py-2.5 text-left ring-1 transition focus:outline-none focus-visible:ring-2',
                  active ? cn(t.on, 'shadow-lg ring-2') : 'bg-white/10 ring-white/15 hover:bg-white/15')}>
                <div className="flex items-center gap-1.5">
                  {t.live && t.count > 0 && !active ? <LiveDot /> : <Icon size={14} className={active ? undefined : t.idle} aria-hidden />}
                  <span className={cn('truncate text-[11px] font-bold uppercase tracking-wide', active ? undefined : 'text-white/85')}>{t.label}</span>
                </div>
                <div className="mt-0.5 text-2xl font-black tabular-nums">{t.count}</div>
                <div className={cn('truncate text-[11px] max-sm:hidden', active ? 'opacity-80' : 'text-white/60')}>{active ? 'Tap to clear' : t.hint}</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Schedule's banner: how far the event has got, by match state. */
export function EventPulse({ counts, value, onChange, title }: {
  counts: Record<Phase, number>; value: PhaseFilter; onChange: (v: PhaseFilter) => void; title: string;
}) {
  const tiles: PulseTile[] = [
    { key: 'live', label: 'Live now', hint: 'Being scored', icon: Radio, count: counts.live, live: true,
      on: 'bg-rose-500 text-white ring-rose-300', idle: 'text-rose-600 dark:text-rose-300' },
    { key: 'upcoming', label: 'Upcoming', hint: 'Time is set', icon: CalendarClock, count: counts.upcoming,
      on: 'bg-white text-brand-700 ring-white/60', idle: 'text-sky-600 dark:text-sky-300' },
    { key: 'unscheduled', label: 'Need a time', hint: 'Not scheduled yet', icon: Clock, count: counts.unscheduled,
      on: 'bg-amber-400 text-amber-950 ring-amber-200', idle: 'text-amber-600 dark:text-amber-300' },
    { key: 'done', label: 'Completed', hint: 'Result is in', icon: CheckCircle2, count: counts.done,
      on: 'bg-emerald-500 text-white ring-emerald-200', idle: 'text-emerald-600 dark:text-emerald-300' },
  ];
  return (
    <PulseBanner eyebrow={title} done={counts.done} total={counts.live + counts.upcoming + counts.unscheduled + counts.done}
      unit="matches played" empty="No matches yet - generate a draw to get started."
      tiles={tiles} value={value} onChange={(k) => onChange(k as PhaseFilter)} />
  );
}

/** A pill switch in the chips' style: page views (Fixtures / Timeline) and a sport's categories. */
export function ViewTabs<T extends string>({ value, onChange, options, size = 'md' }: {
  value: T; onChange: (v: T) => void;
  /** sm: inside a card's action row. */
  size?: 'sm' | 'md';
  options: Array<{ value: T; label: string; icon?: typeof Radio; badge?: ReactNode }>;
}) {
  return (
    <div role="tablist" className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.value)}
            className={cn('flex items-center gap-1.5 rounded-full font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
              size === 'sm' ? 'px-3 py-1 text-[13px]' : 'px-4 py-1.5 text-sm',
              active ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500' : 'text-slate-600 hover:bg-slate-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-brand-300')}>
            {Icon && <Icon size={size === 'sm' ? 14 : 15} aria-hidden />}{o.label}{o.badge}
          </button>
        );
      })}
    </div>
  );
}

/** A rounded action button in the chips' style; `primary` for the one thing to do next. */
export function PillButton({ icon: Icon, children, onClick, disabled, title, tone = 'default' }: {
  icon?: typeof Radio; children: ReactNode; onClick: () => void; disabled?: boolean; title?: string;
  tone?: 'default' | 'primary';
}) {
  return (
    // Disabled stays hoverable (no pointer-events-none), so its title explains why.
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        tone === 'primary'
          ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-500 dark:bg-brand-500'
          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700 disabled:hover:border-slate-200 disabled:hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-500/50 dark:hover:text-brand-300')}>
      {Icon && <Icon size={14} aria-hidden />}{children}
    </button>
  );
}

/** An institute (or batch) and every squad it fields. */
export interface TeamSide { key: string; label: string; full: string; logo: string | null; ids: Set<string>; matches: number; live: number }

/** Institutes as round badges, scores-app style; tap one to see only its matches. */
export function TeamChips({ sides, value, onChange }: { sides: TeamSide[]; value: string; onChange: (key: string) => void }) {
  if (sides.length < 2) return null;
  // `label` sits under the badge: the code when a logo fills it, else the match count.
  const chip = (key: string, label: string, title: string, badge: ReactNode, live = 0) => {
    const active = value === key;
    return (
      <button key={key} type="button" aria-pressed={active} title={title} onClick={() => onChange(active && key ? '' : key)}
        className="group flex w-16 shrink-0 snap-start flex-col items-center gap-1.5 focus:outline-none">
        <span className={cn('relative grid h-12 w-12 place-items-center rounded-full ring-2 transition',
          active ? 'ring-brand-600 ring-offset-2 ring-offset-white dark:ring-brand-400 dark:ring-offset-slate-950' : 'ring-transparent group-hover:ring-slate-200 dark:group-hover:ring-slate-700')}>
          {badge}
          {live > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white ring-2 ring-white dark:ring-slate-950">{live}</span>}
        </span>
        <span className={cn('w-full truncate text-center text-[11px] font-bold leading-tight',
          active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300')}>{label}</span>
      </button>
    );
  };
  return (
    <nav aria-label="Filter by team" className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:thin]">
      {chip('', 'All teams', 'All teams',
        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">ALL</span>)}
      {sides.map((s) => chip(s.key, s.logo ? s.label : `${s.matches} match${s.matches === 1 ? '' : 'es'}`, `${s.full} · ${s.matches} match${s.matches === 1 ? '' : 'es'}`,
        s.logo
          ? <img src={s.logo} alt="" className="h-12 w-12 rounded-full border border-slate-200 bg-white object-contain p-1 dark:border-slate-700" />
          : <span className="scale-[1.33]"><TeamAvatar name={s.full} short={s.label} /></span>,
        s.live))}
    </nav>
  );
}

/** Sports as multi-select filter chips with live dots; "All sports" first clears them. */
export function SportChips({ sports, value, onChange, allLabel = 'All sports', allIcon = '🏟️', label = 'Filter by sport', minItems = 2, showCounts = true }: {
  /** Off where a match count means nothing (Standings). */
  showCounts?: boolean;
  sports: Array<{ id: string; name: string; icon?: string | null; live: number; total: number }>;
  /** The picked ids; empty means all. */
  value: string[]; onChange: (ids: string[]) => void;
  /** Reused for squads: the first chip's wording and icon, and the row's name. */
  allLabel?: string; allIcon?: string; label?: string;
  /** Hide the row below this many options. */
  minItems?: number;
}) {
  if (sports.length < minItems) return null;
  const allLive = sports.reduce((n, s) => n + s.live, 0);
  const allTotal = sports.reduce((n, s) => n + s.total, 0);
  const chip = (id: string, label: string, icon: ReactNode, live: number, total: number) => {
    const active = id ? value.includes(id) : value.length === 0;
    // A sport toggles in or out of the set; "All sports" empties it.
    const toggle = () => onChange(!id ? [] : active ? value.filter((v) => v !== id) : [...value, id]);
    return (
      <button key={id || 'all'} type="button" aria-pressed={active} onClick={toggle}
        className={cn('flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          active
            ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500'
            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-500/50 dark:hover:text-brand-300')}>
        <span className="text-base leading-none" aria-hidden>{icon}</span>
        {label}
        {live > 0
          ? <span className={cn('flex items-center gap-1 rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300')}><LiveDot className="h-1.5 w-1.5" />{live}</span>
          : showCounts && <span className={cn('rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>{total}</span>}
      </button>
    );
  };
  return (
    <nav aria-label={label} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      {chip('', allLabel, allIcon, allLive, allTotal)}
      {sports.map((s) => chip(s.id, s.name, s.icon || '🏅', s.live, s.total))}
    </nav>
  );
}

/** Live matches first; with none live, the next few on the clock. */
/** Cards per page in the live strip. */
const STRIP_PAGE = 20;

export function LiveStrip({ items, renderAction, liveOnly = false }: {
  items: Array<{ f: any; sport: string; icon?: string | null; draw: string; home: string; away: string; homeShort?: string | null; awayShort?: string | null }>;
  renderAction: (f: any) => ReactNode;
  /** No "Up next" fallback: Results only deals in matches that have started. */
  liveOnly?: boolean;
}) {
  const live = items.filter((i) => i.f.status === 'live');
  const upNext = items
    .filter((i) => matchPhase(i.f) === 'upcoming' && new Date(i.f.scheduled_at).getTime() >= Date.now() - 30 * 60_000)
    .sort((a, b) => new Date(a.f.scheduled_at).getTime() - new Date(b.f.scheduled_at).getTime())
    .slice(0, 6);
  const shown = live.length || liveOnly ? live : upNext;

  // Pages of STRIP_PAGE cards, so a busy event never renders a 100-card row.
  const [page, setPage] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(shown.length / STRIP_PAGE));
  const current = Math.min(page, pages - 1);
  useEffect(() => { if (page !== current) setPage(current); }, [page, current]);
  // Jump to the row's start instantly, then slide the new cards in from the side
  // being moved towards. A smooth scroll back read as going backwards on "Show more".
  const dir = useRef<1 | -1 | 0>(0);
  useEffect(() => {
    const el = row.current;
    if (!el || !dir.current) return;
    el.scrollLeft = 0;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.animate(
        [{ transform: `translateX(${dir.current * 48}px)`, opacity: 0.2 }, { transform: 'translateX(0)', opacity: 1 }],
        { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
    dir.current = 0;
  }, [current]);
  const go = (p: number) => { dir.current = p > current ? 1 : -1; setPage(p); };
  if (!shown.length) return null;
  const from = current * STRIP_PAGE;
  const slice = shown.slice(from, from + STRIP_PAGE);
  // A card-sized button at either end of the row, so paging sits where the eye already is.
  const pager = (dir: 'prev' | 'next') => {
    const prev = dir === 'prev';
    const n = prev ? STRIP_PAGE : Math.min(STRIP_PAGE, shown.length - from - STRIP_PAGE);
    return (
      <button type="button" onClick={() => go(current + (prev ? -1 : 1))}
        className="group flex w-24 shrink-0 snap-start flex-col items-center justify-center gap-1.5 text-sm font-semibold text-slate-600 transition hover:text-brand-700 focus:outline-none dark:text-slate-300 dark:hover:text-brand-300">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 transition group-hover:bg-brand-600 group-hover:text-white group-hover:ring-brand-600 group-focus-visible:ring-2 group-focus-visible:ring-brand-400 dark:bg-slate-800 dark:ring-slate-700">{prev ? <ChevronLeft size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}</span>
        <span>{prev ? 'Previous' : 'Show more'}</span>
        <span className="text-[11px] font-medium text-slate-400">{prev ? `Back to ${from - STRIP_PAGE + 1}-${from}` : `Next ${n}`}</span>
      </button>
    );
  };
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
        {live.length ? <><LiveDot /> Live now</> : <><CalendarClock size={15} className="text-brand-600 dark:text-brand-300" aria-hidden /> Up next</>}
        {pages > 1 && <span className="ml-1 text-[11px] font-semibold normal-case tracking-normal text-slate-400">{from + 1}-{from + slice.length} of {shown.length}</span>}
      </h2>
      <div ref={row} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {current > 0 && pager('prev')}
        {slice.map(({ f, sport, icon, draw, home, away, homeShort, awayShort }) => {
          const w = whenParts(f.scheduled_at);
          const scored = f.home_score != null || f.away_score != null;
          return (
            <div key={f.id} className={cn('w-64 shrink-0 snap-start rounded-xl border bg-white p-3 shadow-sm dark:bg-slate-900',
              f.status === 'live' ? 'border-rose-200 dark:border-rose-500/30' : 'border-slate-200 dark:border-slate-700')}>
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <span className="truncate"><span aria-hidden>{icon || '🏅'}</span> {sport} · {draw}</span>
                {f.status === 'live'
                  ? <span className="flex shrink-0 items-center gap-1 font-bold text-rose-600 dark:text-rose-300"><LiveDot className="h-1.5 w-1.5" />LIVE</span>
                  : w && <span className="shrink-0 font-bold text-brand-700 dark:text-brand-300">{w.day === 'Today' ? w.time : `${w.day} ${w.time}`}</span>}
              </div>
              <div className="mt-2 space-y-1">
                {[[home, homeShort, f.home_score, f.home_team_id], [away, awayShort, f.away_score, f.away_team_id]].map(([name, short, score, id], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <TeamAvatar name={name as string} short={short as string | null} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={name as string}>{(short as string) || (name as string)}</span>
                    {scored && <span className={cn('text-lg font-black tabular-nums', f.winner_team_id && f.winner_team_id === id ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white')}>{(score as number) ?? 0}</span>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{roundName(f.round)}</span>
                {renderAction(f)}
              </div>
            </div>
          );
        })}
        {current < pages - 1 && pager('next')}
      </div>
    </section>
  );
}

const AVATAR_TONES = [
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200',
];

/** A team's badge: initials on a colour picked from its name, so each team keeps its colour. */
export function TeamAvatar({ name, short, size = 'md' }: { name?: string | null; short?: string | null; size?: 'sm' | 'md' }) {
  const clean = (name ?? '').trim();
  const tbd = !clean || clean === 'TBD';
  let h = 0;
  for (const ch of (short || clean)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const words = clean.split(/\s+/).filter(Boolean);
  // The short code ("LSC") says more than initials of "LSC Football Men".
  // Up to 4 letters: "IIMB" and "IIMK" must not both shrink to "IIM".
  const initials = tbd ? '?' : short ? short.slice(0, 4).toUpperCase()
    : (words.length > 1 ? words[0][0] + words[1][0] : clean.slice(0, 2)).toUpperCase();
  const long = initials.length > 3;
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full font-black',
      size === 'sm' ? cn('h-6 w-6', long ? 'text-[7px] tracking-tight' : 'text-[9px]') : cn('h-9 w-9', long ? 'text-[9px] tracking-tight' : 'text-[11px]'),
      tbd ? 'border border-dashed border-slate-300 text-slate-400 dark:border-slate-600' : AVATAR_TONES[h % AVATAR_TONES.length])}>
      {initials}
    </span>
  );
}

export interface CardSide {
  full: string | null; short?: string | null; slotLabel: string; org: string; blocked?: boolean; title?: string; id?: string | null;
}

/**
 * One match as a card, scores-app style: when on the left, the two teams stacked
 * with their scores in one column, and the actions on the right.
 */
export function MatchCard({ f, home, away, ground, official, canManage, actions, eventTitle, sportName, badge, scoreNote, footer, onOpen }: {
  f: any; home?: CardSide; away?: CardSide; ground: string | null; canManage: boolean; actions: ReactNode;
  /** The match official's name; undefined hides the line (Results has no names to show). */
  official?: string | null;
  /** Extra tag after the court, e.g. Results' "Official" lock badge. */
  badge?: ReactNode;
  /** Beside a side's score: shoot-out kicks, retired, and the like. */
  scoreNote?: (side: 'home' | 'away') => ReactNode;
  /** Extra lines under the result line (game scores, awards). */
  footer?: ReactNode;
  /** Makes the whole card open the match. Buttons inside must stop the click. */
  onOpen?: () => void;
  /** A ranking event (swimming, athletics) has no two sides: show its name instead. */
  eventTitle?: string;
  /** Picks the finished label: "Full time" only for clock sports. */
  sportName?: string;
}) {
  const phase = matchPhase(f);
  const w = whenParts(f.scheduled_at);
  const scored = f.home_score != null || f.away_score != null;

  const statusTag = {
    live: <span className="flex items-center gap-1 font-black text-rose-600 dark:text-rose-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />LIVE</span>,
    done: <span className="font-bold text-emerald-700 dark:text-emerald-400">{(eventTitle && f.status !== 'walkover' ? 'Completed' : doneLabel(f, sportName)).toUpperCase()}</span>,
    upcoming: <span className="font-bold text-sky-700 dark:text-sky-400">UPCOMING</span>,
    unscheduled: <span className="font-bold text-amber-700 dark:text-amber-400">NEEDS A TIME</span>,
    off: <span className="font-bold uppercase text-slate-500 dark:text-slate-400">{f.status}</span>,
  }[phase];

  // One team per row; its score sits in a shared right-hand column.
  const row = (s: CardSide, score: number | null | undefined, side: 'home' | 'away') => {
    const won = !!f.winner_team_id && f.winner_team_id === s.id;
    const lost = !!f.winner_team_id && !!s.id && f.winner_team_id !== s.id;
    // The org line only when the squad name doesn't already say it ("IIMB Badminton Men's").
    const showOrg = !!s.org && !!s.full && !s.full.toLowerCase().includes(s.org.toLowerCase());
    return (
      <div className={cn('flex items-center gap-2.5', lost && 'opacity-55')}>
        {s.full ? <TeamAvatar name={s.full} short={s.short} size="sm" /> : <TeamAvatar name={null} size="sm" />}
        <div className="min-w-0 flex-1">
          {s.full ? (
            <span className={cn('block truncate text-sm', won ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200')} title={s.full}>
              {s.full}{showOrg && <span className="ml-1.5 text-[11px] font-normal text-slate-400">{s.org}</span>}
            </span>
          ) : (
            <span className={cn('block truncate pr-1 text-sm italic', s.blocked ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500')} title={s.title}>{s.slotLabel}</span>
          )}
        </div>
        {scored && (
          <span className={cn('w-10 shrink-0 text-right text-base font-black tabular-nums',
            won ? 'text-slate-900 dark:text-white' : phase === 'live' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300')}>
            {formatPoints(score ?? 0)}
          </span>
        )}
        {scoreNote?.(side)}
      </div>
    );
  };

  // A line under the teams that says what happened, like a scores app does.
  const winnerName = f.winner_team_id && home && away ? (f.winner_team_id === home.id ? home.full : f.winner_team_id === away.id ? away.full : null) : null;
  const note = phase === 'done' ? (winnerName ? `${winnerName} won${f.status === 'walkover' ? ' by walkover' : ''}` : f.status === 'walkover' ? 'Walkover' : 'Match drawn')
    : phase === 'live' ? 'Match in progress'
      : phase === 'unscheduled' ? 'Time to be announced'
        : null;

  return (
    <div onClick={onOpen} className={cn('relative overflow-hidden rounded-xl border bg-white transition hover:shadow-md dark:bg-slate-900', onOpen && 'cursor-pointer',
      phase === 'live' ? 'border-rose-200 bg-rose-50/40 dark:border-rose-500/30 dark:bg-rose-500/5' : 'border-slate-200 dark:border-slate-800',
      phase === 'off' && 'opacity-70')}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1',
        { live: 'bg-rose-500', done: 'bg-emerald-500', upcoming: 'bg-sky-500', unscheduled: 'bg-amber-400', off: 'bg-slate-300 dark:bg-slate-600' }[phase])} />
      {/* Fixed side columns, so names start and scores end in the same place on every row. */}
      <div className="flex flex-col gap-2 py-3 pl-4 pr-3 @min-[40rem]:grid @min-[40rem]:grid-cols-[7rem_minmax(0,1fr)_13rem] @min-[40rem]:items-center @min-[40rem]:gap-4">
        {/* When */}
        <div className="flex items-baseline gap-2 @min-[40rem]:block">
          {w ? (
            <>
              <div className={cn('text-[11px] font-bold uppercase tracking-wide', w.today ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')}>{w.day}</div>
              <div className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{w.time}</div>
            </>
          ) : <div className="text-xs font-semibold text-slate-400 dark:text-slate-500">Time TBD</div>}
        </div>

        {/* Match */}
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {statusTag}
            <span aria-hidden>•</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{eventTitle ? (f.round || 'Ranking event') : roundName(f.round)}</span>
            {f.match_no != null && <span className="text-slate-400">#{f.match_no}</span>}
            {/* The dot travels with the court, so a wrap never leaves it dangling. */}
            <span className={cn('flex items-center gap-1', !ground && canManage && 'text-amber-600 dark:text-amber-400')}>
              <span aria-hidden className="mr-0.5 text-slate-500 dark:text-slate-400">•</span>
              <MapPin size={11} aria-hidden />{ground ?? (canManage ? 'No court yet' : 'Court TBD')}
            </span>
            {badge}
          </div>
          {eventTitle || !home || !away ? (
            <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{eventTitle}</div>
          ) : (
            <div className="space-y-1.5">
              {row(home, f.home_score, 'home')}
              {row(away, f.away_score, 'away')}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
            {note && <span className={cn(phase === 'done' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : phase === 'live' ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')}>{note}</span>}
            {official !== undefined && (
              <span className={cn('flex items-center gap-1', !official && canManage ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500')}>
                <UserRound size={11} aria-hidden />{official ?? (canManage ? 'No official yet' : 'Official TBD')}
              </span>
            )}
          </div>
          {footer}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800 @min-[40rem]:h-full @min-[40rem]:border-l @min-[40rem]:border-t-0 @min-[40rem]:pl-4 @min-[40rem]:pt-0">
          {actions}
        </div>
      </div>
    </div>
  );
}

/**
 * The three steps every draw goes through, so a first-time organiser knows what
 * comes next. Only shown to people who can act on them.
 */
export function DrawSteps({ hasFixtures, unscheduled, live, done, total, onTimeline }: {
  hasFixtures: boolean; unscheduled: number; live: number; done: number; total: number; onTimeline: () => void;
}) {
  const step = !hasFixtures ? 0 : unscheduled > 0 ? 1 : done < total ? 2 : 3;
  const steps = ['Generate the draw', 'Set times & courts', 'Score the matches'];
  const next = [
    'Start by generating the draw from the registered teams.',
    `${unscheduled} match${unscheduled === 1 ? '' : 'es'} still need${unscheduled === 1 ? 's' : ''} a time.`,
    live ? `${live} live now. Tap Score on a match to keep going.` : 'Tap Score on a match to enter its result.',
    'All results are in. Nice work!',
  ][step];
  return (
    <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {steps.map((label, i) => {
          const isDone = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex items-center gap-1">
              <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
                isDone ? 'text-emerald-700 dark:text-emerald-300'
                  : current ? 'bg-brand-600 text-white' : 'text-slate-400 dark:text-slate-500')}>
                <span className={cn('grid h-4 w-4 place-items-center rounded-full text-[9px]',
                  isDone ? 'bg-emerald-500 text-white' : current ? 'bg-white/25' : 'border border-slate-300 dark:border-slate-600')}>
                  {isDone ? <Check size={10} strokeWidth={3.5} aria-hidden /> : i + 1}
                </span>
                {label}
              </span>
              {i < steps.length - 1 && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span>{next}</span>
        {step === 1 && (
          <button type="button" onClick={onTimeline} className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
            Open the timeline to place them
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Loading skeletons: the page's real shapes, shimmering, instead of a spinner ----

/** One grey block. */
function Skel({ className }: { className?: string }) {
  // cn() only joins classes, so the default rounding applies only when none is given.
  return <span aria-hidden className={cn('block animate-pulse bg-slate-200/80 dark:bg-slate-800', !className?.includes('rounded') && 'rounded-md', className)} />;
}

/** The blue progress banner, waiting for its numbers. */
export function BannerSkeleton({ tiles = 4 }: { tiles?: 3 | 4 }) {
  return (
    <div aria-hidden className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 p-4 sm:p-5">
      <div className="flex animate-pulse flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2.5 lg:w-72">
          <span className="block h-2.5 w-28 rounded bg-white/25" />
          <span className="block h-7 w-52 rounded bg-white/30" />
          <span className="block h-2 w-full rounded-full bg-white/20" />
          <span className="block h-2.5 w-24 rounded bg-white/20" />
        </div>
        <div className={cn('grid grid-cols-2 gap-2 lg:shrink-0', tiles === 3 ? 'sm:grid-cols-3 lg:w-[33rem]' : 'sm:grid-cols-4 lg:w-[36rem]')}>
          {Array.from({ length: tiles }, (_, i) => <span key={i} className="block h-[5.25rem] rounded-xl bg-white/10 ring-1 ring-white/15" />)}
        </div>
      </div>
    </div>
  );
}

/** One stacked match card. */
export function MatchCardSkeleton() {
  return (
    <div aria-hidden className="relative overflow-hidden rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-3 dark:border-slate-800 dark:bg-slate-900">
      <span className="absolute inset-y-0 left-0 w-1 bg-slate-200 dark:bg-slate-700" />
      <div className="flex gap-4">
        <div className="hidden w-[7rem] shrink-0 space-y-1.5 sm:block"><Skel className="h-2.5 w-14" /><Skel className="h-3.5 w-16" /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <Skel className="h-2.5 w-48 max-w-full" />
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skel className="h-6 w-6 rounded-full" /><Skel className="h-3.5 w-40 max-w-[60%]" /><Skel className="ml-auto h-4 w-6" />
            </div>
          ))}
          <Skel className="h-2.5 w-32" />
        </div>
        <div className="hidden w-[13rem] shrink-0 items-center justify-end gap-2 border-l border-slate-100 pl-4 sm:flex dark:border-slate-800">
          <Skel className="h-8 w-20 rounded-lg" /><Skel className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** A sport heading and its category card with a few match cards. */
export function SportSectionSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-hidden className="space-y-3">
      <div className="flex items-center gap-3">
        <Skel className="h-11 w-11 rounded-2xl" />
        <div className="space-y-1.5"><Skel className="h-4 w-28" /><Skel className="h-2.5 w-44" /></div>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><Skel className="h-9 w-9 rounded-full" /><div className="space-y-1.5"><Skel className="h-3.5 w-24" /><Skel className="h-2.5 w-36" /></div></div>
          <div className="flex gap-2"><Skel className="h-7 w-28 rounded-full" /><Skel className="h-7 w-20 rounded-full" /></div>
        </div>
        {Array.from({ length: cards }, (_, i) => <MatchCardSkeleton key={i} />)}
      </div>
    </div>
  );
}

/** Standings: the podium hero (`hero`), or the leaderboard rows. */
export function StandingsBoardSkeleton({ hero = false, rows = 8 }: { hero?: boolean; rows?: number }) {
  if (hero) {
    return (
      <div aria-hidden className="flex animate-pulse flex-col gap-5 rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 px-5 pt-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2.5 pb-6"><span className="block h-2.5 w-36 rounded bg-white/25" /><span className="block h-8 w-40 rounded bg-white/30" /><span className="block h-3.5 w-64 max-w-full rounded bg-white/20" /><span className="block h-2.5 w-48 rounded bg-white/20" /></div>
        <div className="flex items-end justify-center gap-3 md:w-[26rem]">
          {['h-16 sm:h-20', 'h-24 sm:h-28', 'h-11 sm:h-14'].map((h, i) => (
            <div key={i} className="flex w-1/3 flex-col items-center gap-1.5"><span className="block h-10 w-10 rounded-full bg-white/25" /><span className="block h-3 w-12 rounded bg-white/20" /><span className={cn('mt-1 block w-full rounded-t-xl bg-white/10', h)} /></div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800">
          <Skel className="h-6 w-6 rounded-full" /><Skel className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5"><Skel className="h-3.5 w-44 max-w-[60%]" /><Skel className="h-3 w-32" /></div>
          <Skel className="hidden h-3 w-16 sm:block" /><Skel className="h-6 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Participants: banner, chips, toolbar and a few organisation cards. */
export function ParticipantsSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div aria-hidden className="flex animate-pulse flex-col gap-5 rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2.5"><span className="block h-2.5 w-24 rounded bg-white/25" /><span className="block h-9 w-44 rounded bg-white/30" /><span className="block h-3.5 w-60 max-w-full rounded bg-white/20" /><span className="block h-1.5 w-64 max-w-full rounded-full bg-white/20" /></div>
        <div className="space-y-3">
          <div className="flex md:justify-end">{Array.from({ length: 6 }, (_, i) => <span key={i} className="-ml-2 block h-9 w-9 rounded-full bg-white/25 ring-2 ring-brand-700 first:ml-0" />)}</div>
          <div className="flex gap-2">{['w-28', 'w-28', 'w-32'].map((w, i) => <span key={i} className={cn('block h-8 rounded-full bg-white/10 ring-1 ring-white/15', w)} />)}</div>
        </div>
      </div>
      <ChipsSkeleton />
      <div className="flex flex-wrap gap-2"><Skel className="h-9 w-72 max-w-full rounded-lg" /><Skel className="h-9 w-48 rounded-lg" /></div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <Skel className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5"><Skel className="h-3.5 w-52 max-w-[70%]" /><Skel className="h-2.5 w-32" /></div>
          <Skel className="hidden h-6 w-24 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Organising team: hero, then the tabbed card of people. */
export function TeamSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div aria-hidden className="flex animate-pulse flex-col gap-5 rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2.5"><span className="block h-2.5 w-28 rounded bg-white/25" /><span className="block h-9 w-56 max-w-full rounded bg-white/30" /><span className="block h-3.5 w-40 rounded bg-white/20" /><span className="block h-1.5 w-64 max-w-full rounded-full bg-white/20" /></div>
        <div className="space-y-3">
          <div className="flex md:justify-end">{Array.from({ length: 7 }, (_, i) => <span key={i} className="-ml-2 block h-9 w-9 rounded-full bg-white/25 ring-2 ring-brand-700 first:ml-0" />)}</div>
          <div className="flex gap-2">{['w-36', 'w-36'].map((w, i) => <span key={i} className={cn('block h-8 rounded-full bg-white/10 ring-1 ring-white/15', w)} />)}</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800"><Skel className="h-8 w-56 rounded-full" /><Skel className="ml-auto hidden h-9 w-64 rounded-full sm:block" /></div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800">
            <Skel className="h-8 w-8 rounded-full" /><Skel className="h-3.5 w-40 max-w-[40%]" /><Skel className="hidden h-5 w-24 rounded-full sm:block" /><Skel className="ml-auto h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Event setup: slim header, then the checklist beside the open step. */
export function SetupSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div aria-hidden className="flex animate-pulse items-center justify-between rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 px-5 py-4">
        <div className="space-y-2"><span className="block h-2.5 w-24 rounded bg-white/25" /><span className="block h-6 w-64 max-w-full rounded bg-white/30" /><span className="block h-2.5 w-36 rounded bg-white/20" /></div>
        <span className="block h-8 w-28 rounded-full bg-white/30" />
      </div>
      <div className="hidden grid-cols-4 divide-x divide-slate-100 rounded-2xl border border-slate-200 bg-white sm:grid dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="flex items-center gap-3 p-3"><Skel className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-1.5"><Skel className="h-3.5 w-24" /><Skel className="h-2.5 w-28 max-w-full" /></div></div>)}
      </div>
      <div>
        <div className="space-y-3">
          <div className="flex items-center gap-3"><Skel className="h-10 w-10 rounded-xl" /><div className="space-y-1.5"><Skel className="h-4 w-40" /><Skel className="h-3 w-72 max-w-full" /></div></div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} aria-hidden className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <Skel className="h-11 w-11 rounded-2xl" /><div className="flex-1 space-y-1.5"><Skel className="h-4 w-32" /><Skel className="h-3 w-52 max-w-[70%]" /></div><Skel className="h-8 w-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Event overview: the hero with its scoreboard, then the two columns of cards. */
export function OverviewSkeleton() {
  const card = (rows: number, key: number) => (
    <div key={key} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2.5"><Skel className="h-8 w-8 rounded-xl" /><Skel className="h-3.5 w-36" /></div>
      {Array.from({ length: rows }, (_, i) => <Skel key={i} className="h-10 w-full rounded-xl" />)}
    </div>
  );
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div aria-hidden className="animate-pulse rounded-2xl bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-brand-900/90 p-4 sm:p-5">
        <div className="space-y-2.5"><span className="block h-2.5 w-20 rounded bg-white/25" /><span className="block h-8 w-80 max-w-full rounded bg-white/30" /><span className="block h-4 w-56 rounded bg-white/20" /></div>
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-1.5 p-4"><span className="block h-2 w-14 rounded bg-white/20" /><span className="block h-6 w-10 rounded bg-white/30" /><span className="block h-2.5 w-20 rounded bg-white/15" /></div>)}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">{card(4, 1)}{card(2, 2)}</div>
        <div className="space-y-5">{card(2, 3)}{card(3, 4)}</div>
      </div>
    </div>
  );
}

const CHIP_WIDTHS = ['w-28', 'w-24', 'w-28', 'w-24', 'w-24', 'w-20', 'w-28'];
const ChipsSkeleton = () => (
  <div className="flex gap-2 overflow-hidden">
    {CHIP_WIDTHS.map((w, i) => <Skel key={i} className={cn('h-9 shrink-0 rounded-full', w)} />)}
  </div>
);

/** Schedule, Results or Standings, before anything has loaded. */
export function PageSkeleton({ kind }: { kind: 'schedule' | 'results' | 'standings' }) {
  if (kind === 'standings') {
    return (
      <div role="status" aria-label="Loading" className="space-y-5">
        <StandingsBoardSkeleton hero />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800"><Skel className="h-4 w-24" /><Skel className="h-7 w-32 rounded-lg" /></div>
            <StandingsBoardSkeleton />
          </div>
          <div className="hidden space-y-2 rounded-2xl border border-slate-200 bg-white p-3 xl:block dark:border-slate-800 dark:bg-slate-900">
            {Array.from({ length: 9 }, (_, i) => <Skel key={i} className="h-7 w-full rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      {kind === 'schedule' && <Skel className="h-9 w-56 rounded-full" />}
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-1.5"><Skel className="h-12 w-12 rounded-full" /><Skel className="h-2.5 w-12" /></div>)}
      </div>
      <BannerSkeleton tiles={kind === 'results' ? 3 : 4} />
      {kind === 'results' && (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-36 w-64 shrink-0 rounded-xl" />)}
        </div>
      )}
      <ChipsSkeleton />
      <SportSectionSkeleton />
      <SportSectionSkeleton cards={2} />
    </div>
  );
}
