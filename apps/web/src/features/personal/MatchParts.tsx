import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { formatPoints, KHO_END_LABEL, KHO_END_SHORT, type Settlement } from '@semp/shared';
import { JerseyBadge } from '../scoring/Jersey';
import { cn } from '../../components/ui';
import { LiveDot, TeamAvatar } from '../schedule/ScheduleParts';

// Match pieces shared by the personal pages (My Game, All matches): a scoreline,
// its meta line, a day tile, and the tag that says how the match stands.

type Side = { name: string; short_name?: string | null } | null;
/** The fields these pieces read; both /me/home and /me/matches rows carry them. */
export interface MatchLike {
  status: string; scheduled_at: string | null; round: string | null;
  sport: string | null; discipline: string | null; championship: { name: string } | null;
  my_team: Side; opponent: Side; my_score: number | null; opp_score: number | null;
  result: string | null;
}

export const score = (n: number | null) => (n != null ? formatPoints(n) : '-');

/** Two scoreline rows, crest + name + score; the side that won (or leads) in bold. */
export function Scoreline({ m, live = false, kicks }: { m: MatchLike; live?: boolean; kicks?: [number, number] | null }) {
  const mine = m.my_score ?? 0; const theirs = m.opp_score ?? 0;
  const lead = m.result === 'won' || (live && mine > theirs) ? 'me' : m.result === 'lost' || (live && theirs > mine) ? 'them' : null;
  const row = (team: Side, value: number | null, on: boolean, k?: number) => (
    <span className="flex items-center gap-2.5">
      <TeamAvatar name={team?.name ?? 'TBD'} short={team?.short_name} size="sm" />
      <span className={cn('min-w-0 flex-1 truncate text-sm', on ? 'font-black text-slate-900 dark:text-slate-100' : 'font-semibold text-slate-500 dark:text-slate-400')}>{team?.name ?? 'TBC'}</span>
      {k != null && <span className="shrink-0 text-[11px] font-bold text-slate-400" title="Penalty shoot-out">({k})</span>}
      <span className={cn('shrink-0 text-base tabular-nums', on ? 'font-black' : 'font-semibold text-slate-500 dark:text-slate-400',
        on && live ? 'text-rose-600 dark:text-rose-300' : on ? 'text-slate-900 dark:text-slate-100' : '')}>{score(value)}</span>
    </span>
  );
  return (
    <span className="block space-y-1.5">
      {row(m.my_team, m.my_score, lead !== 'them', kicks?.[0])}
      {row(m.opponent, m.opp_score, lead === 'them', kicks?.[1])}
    </span>
  );
}

/** "Football · Men · Semi-final · Event" under a scoreline. */
export function MatchMeta({ m, iconOf, event = true }: { m: MatchLike; iconOf: (s: string | null) => string; event?: boolean }) {
  return (
    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
      <span aria-hidden>{iconOf(m.sport)} </span>{[m.sport, m.discipline, m.round, event ? m.championship?.name : null].filter(Boolean).join(' · ')}
    </span>
  );
}

/** A day tile: "24" over "NOV". */
export function DayTile({ iso }: { iso: string | null }) {
  const d = iso ? new Date(iso) : null;
  return (
    <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-slate-50 py-1 text-center dark:bg-slate-800/60">
      <span className="text-base font-black leading-none tabular-nums text-slate-800 dark:text-slate-100">{d ? d.getDate() : '-'}</span>
      <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">{d ? d.toLocaleDateString(undefined, { month: 'short' }) : 'TBC'}</span>
    </span>
  );
}

export const RESULT_TAG: Record<string, string> = {
  won: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  lost: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30',
  draw: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  upcoming: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  awaiting: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
};

/** How the match stands for you, from its status first: a live match is Live, never "Upcoming". */
export function MatchTag({ m }: { m: MatchLike }) {
  if (m.status === 'live') {
    return <span className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white"><LiveDot className="h-1.5 w-1.5" />Live</span>;
  }
  const key = m.result === 'won' || m.result === 'lost' || m.result === 'draw' ? m.result
    : m.status === 'completed' ? 'awaiting' : 'upcoming';
  const label = { won: 'Won', lost: 'Lost', draw: 'Drawn', awaiting: 'Played', upcoming: 'Upcoming' }[key];
  return <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-black uppercase tracking-wider ring-1', RESULT_TAG[key])}>{label}</span>;
}

/** Faint kit stripes for a navy band: sporty texture, not a picture. */
export function KitStripes() {
  return (
    <svg aria-hidden viewBox="0 0 400 200" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
      <polygon points="250,200 290,200 390,0 350,0" fill="#5CE1E6" opacity=".07" />
      <polygon points="300,200 312,200 412,0 400,0" fill="#5CE1E6" opacity=".12" />
      <polygon points="322,200 327,200 427,0 422,0" fill="#5CE1E6" opacity=".18" />
    </svg>
  );
}

/** A row in a match list: MatchLike plus the extras the list shows. */
export interface MatchRowData extends MatchLike {
  id: string; pens?: [number, number] | null; settled?: Settlement | null; my_jersey?: number | null;
}

/** "Today", "Tomorrow", "Yesterday", else "Sat 22 Nov"; null dates group as "Time to be confirmed". */
function dayLabel(iso: string | null) {
  if (!iso) return 'Time to be confirmed';
  const d = new Date(iso); const today = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 864e5);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : diff === -1 ? `Yesterday · ${date}` : date;
}
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() : 'TBC');

/** One match: kick-off time, the scoreline with its meta, and how it stands. */
function MatchLine({ m, iconOf }: { m: MatchRowData; iconOf: (s: string | null) => string }) {
  const nav = useNavigate();
  const live = m.status === 'live';
  return (
    <button type="button" onClick={() => nav(`/profile/matches/${m.id}`)}
      className="group flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50/70 focus:outline-none focus-visible:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/30">
      <span className={cn('w-16 shrink-0 text-xs font-black tabular-nums', live ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400')}>{clock(m.scheduled_at)}</span>
      <span className="min-w-0 flex-1 space-y-2">
        <Scoreline m={m} live={live} kicks={m.pens} />
        <MatchMeta m={m} iconOf={iconOf} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <MatchTag m={m} />
        {m.settled && <span className="text-[10px] font-semibold text-slate-400" title={KHO_END_LABEL[m.settled]}>{KHO_END_SHORT[m.settled]}</span>}
        {m.my_jersey != null && <JerseyBadge num={m.my_jersey} title="Your jersey number in this match" />}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--accent-deep)] max-sm:hidden" aria-hidden />
    </button>
  );
}


/** A list of matches, each day under its own heading ("Today", "Sat 22 Nov"). */
export function MatchDayList({ matches, iconOf }: { matches: MatchRowData[]; iconOf: (s: string | null) => string }) {
  const days: Array<{ label: string; rows: MatchRowData[] }> = [];
  for (const row of matches) {
    const label = dayLabel(row.scheduled_at);
    if (days[days.length - 1]?.label === label) days[days.length - 1].rows.push(row); else days.push({ label, rows: [row] });
  }
  return (
    <div className="space-y-4">
      {days.map((g) => (
        <section key={g.label} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-400">
            {g.label}<span className="font-bold tabular-nums text-slate-400">{g.rows.length}</span>
          </h2>
          {g.rows.map((row) => <MatchLine key={row.id} m={row} iconOf={iconOf} />)}
        </section>
      ))}
    </div>
  );
}
