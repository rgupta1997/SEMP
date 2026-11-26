import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Clock, Medal, Trophy, RotateCw, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDate } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import { Button, EmptyState, PillPagination, cn } from '../../components/ui';
import { type MatchOutcome, type MatchPosition } from '@semp/shared';
import { useSportIcon } from '../../features/personal/SportFilter';

// The lifetime record (J4-E2) - a player's permanent, verified sporting history.
//
// The page has NO edit affordance anywhere, and that is the feature. Every row
// here was written by the lock transaction from a result an organiser made
// official; the only way any of it changes is by correcting that result, which
// is audited. A pencil icon on this page would quietly turn an institutional
// record into a claim.
//
// The same component serves the player's own view and a coordinator's view of
// one of their players, from the same endpoint - so a coordinator can never be
// shown something the player cannot see about themselves.

interface Chip { kind: string; title: string; medal?: 'gold' | 'silver' | 'bronze'; placement?: string }

interface TimelineEntry {
  id: string;
  date: string;
  kind: string;
  title: string;
  /** false = played, but the organiser has not made it official yet. */
  verified: boolean;
  fixture_id: string | null;
  detail: {
    role?: string; team_name?: string | null; opponent_name?: string | null;
    outcome?: MatchOutcome | null; score?: string | null; round?: string | null;
    sport?: string | null; discipline?: string | null; championship_name?: string | null;
    chips?: Chip[];
    /** Set where the match named its players (a lineup, or a tie's rubber). */
    position?: MatchPosition; partner_name?: string | null; opponent_names?: string[];
    rubber_label?: string | null; tie_score?: string | null;
  } | null;
}

interface AchievementRecord {
  id: string; date: string; kind: string; medal: 'gold' | 'silver' | 'bronze' | null; title: string;
  detail: { placement?: string; sport?: string | null; championship_name?: string | null } | null;
}

interface Profile {
  person: { id: string; name: string; email: string | null; phone: string | null };
  stats: {
    events: number; won: number; lost: number; drew: number;
    medals: { gold: number; silver: number; bronze: number };
    awards: number; total_medals: number; provisional: number;
  };
  timeline: TimelineEntry[];
  achievements: AchievementRecord[];
}

const MEDAL_TONE = {
  gold: 'text-amber-500',
  silver: 'text-slate-400',
  bronze: 'text-orange-600 dark:text-orange-500',
} as const;

/** A medal as a small disc: gold, silver or bronze; violet for an award, slate for a placing. */
const DISC = {
  gold: 'bg-gradient-to-b from-amber-200 to-amber-500 text-amber-950',
  silver: 'bg-gradient-to-b from-slate-100 to-slate-400 text-slate-800',
  bronze: 'bg-gradient-to-b from-orange-200 to-orange-500 text-orange-950',
  award: 'bg-gradient-to-b from-violet-300 to-violet-600 text-white',
  other: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
} as const;

const OUTCOME_LOOK: Record<string, { label: string; letter: string; node: string; tag: string }> = {
  won: { label: 'Won', letter: 'W', node: 'bg-emerald-500 text-white', tag: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30' },
  lost: { label: 'Lost', letter: 'L', node: 'bg-rose-500 text-white', tag: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30' },
  drew: { label: 'Drew', letter: 'D', node: 'bg-slate-400 text-white', tag: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700' },
};

function ChipRow({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1',
          c.medal === 'gold' ? 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30'
            : c.kind === 'award' ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30'
              : 'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700')}>
          {c.medal ? <Medal size={12} className={MEDAL_TONE[c.medal]} aria-hidden /> : <Trophy size={12} aria-hidden />}
          {c.title}
        </span>
      ))}
    </div>
  );
}

/** The rail node: the best medal this row carries, else its outcome letter, else a plain dot. */
function RailNode({ e }: { e: TimelineEntry }) {
  const chips = e.verified ? e.detail?.chips ?? [] : [];
  const medal = (['gold', 'silver', 'bronze'] as const).find((m) => chips.some((c) => c.medal === m));
  const outcome = e.detail?.outcome ? OUTCOME_LOOK[e.detail.outcome] : null;
  return (
    <span aria-hidden className={cn('relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black shadow-sm ring-[3px] ring-[var(--canvas)]',
      medal ? DISC[medal] : outcome ? outcome.node : 'bg-white text-slate-400 ring-slate-200 dark:bg-slate-800')}>
      {medal ? <Medal size={13} /> : outcome ? outcome.letter : <Trophy size={12} />}
    </span>
  );
}

/** Same-day entries under one date - a five-event meet reads as one day, not five. */
function groupByDate(timeline: TimelineEntry[]): { day: Date; entries: TimelineEntry[] }[] {
  const groups: { day: Date; entries: TimelineEntry[] }[] = [];
  for (const e of timeline) {
    const day = new Date(e.date);
    const last = groups[groups.length - 1];
    if (last && last.day.toDateString() === day.toDateString()) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}

/** One result on the rail. Opening it shows the role played; the "full result" link is held
 *  back for now - it 404s on a ranking event, which has no team to resolve the detail page from. */
function TimelineRow({ e }: { e: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const d = e.detail ?? {};
  const meta = [d.championship_name, d.round].filter(Boolean).join(' · ');
  // "vs Sameer · with Neha" - who it was actually against, where the match named them.
  const people = [
    d.opponent_names?.length ? `vs ${d.opponent_names.join(' / ')}` : null,
    d.partner_name ? `with ${d.partner_name}` : null,
  ].filter(Boolean).join(' · ');
  const expandable = !!d.role;
  const outcome = d.outcome ? OUTCOME_LOOK[d.outcome] : null;

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      <RailNode e={e} />
      <div className={cn('min-w-0 flex-1 rounded-2xl border bg-white shadow-sm dark:bg-slate-900', e.verified ? 'border-slate-200 dark:border-slate-800' : 'border-dashed border-amber-300 opacity-80 dark:border-amber-500/40')}>
        <button type="button" onClick={() => expandable && setOpen((o) => !o)} aria-expanded={expandable ? open : undefined}
          className={cn('flex w-full items-start justify-between gap-3 px-4 py-3 text-left', !expandable && 'cursor-default')}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{e.title}</span>
            {people && <span className="mt-0.5 block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{people}</span>}
            {meta && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{meta}</span>}
            {/* Chips ride only on verified rows: a medal shown against a scorecard that can still change is a claim, not a record. */}
            {e.verified && <ChipRow chips={d.chips ?? []} />}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            {outcome && <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1', outcome.tag)}>{outcome.label}{d.score ? ` ${d.score}` : ''}</span>}
            {e.verified
              ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><ShieldCheck size={12} aria-hidden />Verified</span>
              : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400"><Clock size={12} aria-hidden />Awaiting lock</span>}
            {expandable && <ChevronDown size={14} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />}
          </span>
        </button>
        {open && expandable && (
          <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Played as <span className="font-bold text-slate-700 dark:text-slate-200">{titleCase(d.role!)}</span>
            {d.team_name && <> for <span className="font-bold text-slate-700 dark:text-slate-200">{d.team_name}</span></>}
            {d.position && <> · {titleCase(d.position)}</>}
            {d.score && <> · Score {d.score}</>}
            {d.rubber_label && d.tie_score && <> · Tie {d.tie_score}</>}
          </div>
        )}
      </div>
    </li>
  );
}

const TIMELINE_PAGE_SIZE = 8;
const HONOURS_PAGE_SIZE = 12;

/** Every medal, placement and award, as tiles - the Achievements tab's view of the record. */
function HonoursCard({ achievements }: { achievements: AchievementRecord[] }) {
  const [page, setPage] = useState(0);
  const iconOf = useSportIcon();
  if (achievements.length === 0) {
    return <EmptyState icon={<Trophy size={22} />} title="No honours yet" description="Medals, placements and awards appear here once the result behind them is made official." />;
  }
  const shown = achievements.slice(page * HONOURS_PAGE_SIZE, (page + 1) * HONOURS_PAGE_SIZE);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">Every medal, placement and award, each tied to a verified result.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => (
          <div key={a.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* The medal, with the sport it was won in pinned to its rim. */}
            <span className="relative shrink-0" title={a.detail?.sport ?? undefined}>
              <span className={cn('grid h-11 w-11 place-items-center rounded-full shadow-sm', DISC[a.medal ?? (a.kind === 'award' ? 'award' : 'other')])} aria-hidden>
                {a.kind === 'award' ? <Trophy size={18} /> : <Medal size={18} />}
              </span>
              {a.detail?.sport && <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white text-[13px] shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" aria-hidden>{iconOf(a.detail.sport)}</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-black text-slate-900 dark:text-slate-100">{a.title}</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{[a.detail?.sport, a.detail?.championship_name, fmtDate(a.date)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', a.kind === 'award' ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>{titleCase(a.kind)}</span>
          </div>
        ))}
      </div>
      <PillPagination page={page} pageCount={Math.ceil(achievements.length / HONOURS_PAGE_SIZE)} total={achievements.length} pageSize={HONOURS_PAGE_SIZE} onPage={setPage} noun="honour" />
    </div>
  );
}

/** The verified totals as one strip. They count VERIFIED results only; the awaiting tag keeps
 *  that from reading as data loss when the timeline plainly shows more. */
function RecordStrip({ stats }: { stats: Profile['stats'] }) {
  const cell = 'min-w-0 px-4 py-3 sm:px-5';
  const label = 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400';
  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-4 [&>*]:border-slate-100 dark:[&>*]:border-slate-800 [&>*:nth-child(even)]:border-l sm:[&>*]:border-l sm:[&>*:first-child]:border-l-0 max-sm:[&>*:nth-child(n+3)]:border-t">
      <div className={cell}>
        <div className="flex items-baseline gap-2"><span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{stats.events}</span>
          {stats.provisional > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" title={`${stats.provisional} more played, but the organiser has not locked the scorecard yet. They count once locked.`}>+{stats.provisional} not locked yet</span>}</div>
        <div className={label}>Verified events</div>
      </div>
      <div className={cell}>
        <div className="text-2xl font-black tabular-nums"><span className="text-emerald-600 dark:text-emerald-400">{stats.won}</span><span className="text-slate-300"> / </span><span className="text-rose-500">{stats.lost}</span><span className="text-slate-300"> / </span><span className="text-slate-500">{stats.drew}</span></div>
        <div className={label}>Won / Lost / Drew</div>
      </div>
      <div className={cell}>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{stats.total_medals}</span>
          {stats.total_medals > 0 && (
            <span className="flex gap-1.5 text-xs font-black tabular-nums" title={`${stats.medals.gold} gold · ${stats.medals.silver} silver · ${stats.medals.bronze} bronze`}>
              {(['gold', 'silver', 'bronze'] as const).map((m) => <span key={m} className="inline-flex items-center gap-0.5"><Medal size={15} className={MEDAL_TONE[m]} aria-hidden />{stats.medals[m]}</span>)}
            </span>
          )}
        </div>
        <div className={label}>Medals</div>
      </div>
      <div className={cell}>
        <div className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{stats.awards}</div>
        <div className={label}>Awards</div>
      </div>
    </section>
  );
}

export function LifetimeRecordPage({ hideHonours, hideTimeline }: { hideHonours?: boolean; hideTimeline?: boolean } = {}) {
  // No :userId → the signed-in player's own record.
  const { userId } = useParams();
  const { data, isLoading, error, refetch } = useApi<Profile>(userId ? `/people/${userId}/profile` : '/me/profile');
  const [page, setPage] = useState(0);
  // A coordinator switching between players' records shouldn't stay on page 3 of somebody else's timeline.
  useEffect(() => { setPage(0); }, [userId]);

  if (isLoading) {
    return (
      <div className="space-y-5" role="status" aria-label="Loading">
        <span className="block h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        {[0, 1].map((g) => (
          <div key={g} className="flex gap-4">
            <span className="h-16 w-16 shrink-0 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
            <div className="flex-1 space-y-3">{[0, 1].map((i) => <span key={i} className="block h-20 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    // Only a real 403 gets the access-denied copy - a 500 on your OWN profile shouldn't read as "this isn't yours".
    const forbidden = (error as { status?: number }).status === 403;
    return forbidden ? (
      <EmptyState icon={<ShieldCheck size={22} />} title="This record is not yours to open"
        description="You can only view the record of someone in an institution you belong to." />
    ) : (
      <EmptyState icon={<AlertTriangle size={22} className="text-amber-500" />} title="Couldn't load this record"
        description="Something went wrong on our end. Please try again."
        action={<Button variant="outline" onClick={() => refetch()}><RotateCw size={14} /> Try again</Button>} />
    );
  }
  if (!data) return null;

  const { stats, timeline, achievements } = data;

  return (
    <div className="space-y-5">
      <RecordStrip stats={stats} />

      {!hideHonours && <HonoursCard key={userId} achievements={achievements} />}

      {!hideTimeline && (
        timeline.length === 0 ? (
          <EmptyState icon={<Trophy size={22} />} title="Nothing here yet"
            description="Matches appear as soon as they are scored, and become permanent once the organiser locks the scorecard." />
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-slate-500 dark:text-slate-400">Most recent first. Verified entries are permanent; ones awaiting lock can still change.</p>
            {/* Paginated over the flat list, then grouped by day within the page, so a day never splits across pages. */}
            {groupByDate(timeline.slice(page * TIMELINE_PAGE_SIZE, (page + 1) * TIMELINE_PAGE_SIZE)).map((g) => (
              <section key={g.day.toDateString()} className="flex gap-3 sm:gap-4">
                {/* The day: a navy date tile, like a fixture card's. */}
                <span className="sticky top-4 flex h-fit w-11 shrink-0 flex-col items-center rounded-xl bg-[#0a1630] py-1.5 text-center text-white">
                  <span className="text-lg font-black leading-none tabular-nums">{g.day.getDate()}</span>
                  <span className="mt-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--accent)]">{g.day.toLocaleDateString(undefined, { month: 'short' })}</span>
                  <span className="text-[9px] font-semibold leading-tight text-white/50">{g.day.getFullYear()}</span>
                </span>
                {/* The rail runs behind the nodes. */}
                <ol className="relative min-w-0 flex-1 before:absolute before:bottom-4 before:left-[13px] before:top-4 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                  {g.entries.map((e) => <TimelineRow key={e.id} e={e} />)}
                </ol>
              </section>
            ))}
            <PillPagination page={page} pageCount={Math.ceil(timeline.length / TIMELINE_PAGE_SIZE)} total={timeline.length} pageSize={TIMELINE_PAGE_SIZE} onPage={setPage} noun="entry" plural="entries" />
          </div>
        )
      )}
    </div>
  );
}
