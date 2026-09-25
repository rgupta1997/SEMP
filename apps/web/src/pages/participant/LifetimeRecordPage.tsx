import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Clock, Medal, Trophy, RotateCw, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useApi, fmtDate } from '../../lib/hooks';
import { titleCase } from '../../lib/format';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Pagination, Spinner, StatCard, cn,
} from '../../components/ui';

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
    outcome?: 'won' | 'lost' | 'drew' | null; score?: string | null; round?: string | null;
    sport?: string | null; discipline?: string | null; championship_name?: string | null;
    chips?: Chip[];
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

const OUTCOME_TONE: Record<string, string> = {
  won: 'text-emerald-600 dark:text-emerald-400',
  lost: 'text-rose-500 dark:text-rose-400',
  drew: 'text-slate-500 dark:text-slate-400',
};

function ChipRow({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        <Badge key={i} tone={c.medal === 'gold' ? 'amber' : c.kind === 'award' ? 'violet' : 'slate'}>
          <span className="flex items-center gap-1">
            {c.medal ? <Medal size={12} className={MEDAL_TONE[c.medal]} aria-hidden /> : <Trophy size={12} aria-hidden />}
            {c.title}
          </span>
        </Badge>
      ))}
    </div>
  );
}

const MEDAL_DOT = { gold: 'bg-amber-400', silver: 'bg-slate-300 dark:bg-slate-500', bronze: 'bg-orange-500' } as const;

/** What the rail dot should look like: the best medal this row carries, otherwise the outcome. */
function dotTone(e: TimelineEntry): string {
  const chips = e.detail?.chips ?? [];
  const medal = chips.find((c) => c.medal === 'gold')?.medal
    ?? chips.find((c) => c.medal === 'silver')?.medal
    ?? chips.find((c) => c.medal === 'bronze')?.medal;
  if (medal) return MEDAL_DOT[medal];
  const outcome = e.detail?.outcome;
  if (outcome === 'won') return 'bg-emerald-500';
  if (outcome === 'lost') return 'bg-rose-400';
  if (outcome === 'drew') return 'bg-slate-400';
  return 'bg-slate-300 dark:bg-slate-600';
}

/** Same-day entries under one date heading - a five-event meet reads as one day, not five. */
function groupByDate(timeline: TimelineEntry[]): { date: string; entries: TimelineEntry[] }[] {
  const groups: { date: string; entries: TimelineEntry[] }[] = [];
  for (const e of timeline) {
    const date = fmtDate(e.date);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.entries.push(e);
    else groups.push({ date, entries: [e] });
  }
  return groups;
}

/** One row on the rail. Opening it reveals the role played - the "view full
 *  result" link is held back for now: it 404s on a ranking event, which has no
 *  team to resolve the detail page from (see me.routes.ts's /me/matches/:id). */
function TimelineRow({ e }: { e: TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const d = e.detail ?? {};
  const meta = [d.championship_name, [d.sport, d.discipline].filter(Boolean).join(' · ') || null, d.round]
    .filter(Boolean).join(' · ');
  const expandable = !!d.role;

  return (
    <li className="relative pb-6 last:pb-0">
      <span
        className={cn('absolute -left-[38px] top-2 h-2 w-2 rounded-full ring-4 ring-white dark:ring-slate-950', dotTone(e))}
        aria-hidden
      />
      <div className={cn(!e.verified && 'opacity-70')}>
        <button
          type="button"
          onClick={() => expandable && setOpen((o) => !o)}
          className={cn('flex w-full items-start justify-between gap-3 text-left', !expandable && 'cursor-default')}
        >
          <div className="min-w-0">
            <p className={cn('truncate text-sm font-medium', d.outcome ? OUTCOME_TONE[d.outcome] : '')}>{e.title}</p>
            {meta && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{meta}</p>}
            {/* Chips ride only on verified rows. A gold medal shown against a
                scorecard the official can still edit is exactly the claim this
                subsystem exists to avoid. */}
            {e.verified && <ChipRow chips={d.chips ?? []} />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {e.verified ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <ShieldCheck size={12} aria-hidden /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                <Clock size={12} aria-hidden /> Provisional
              </span>
            )}
            {expandable && (
              <ChevronDown size={14} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
            )}
          </div>
        </button>
        {open && expandable && (
          <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
            Played as <span className="font-medium text-slate-700 dark:text-slate-300">{titleCase(d.role!)}</span>
          </div>
        )}
      </div>
    </li>
  );
}

const TIMELINE_PAGE_SIZE = 8;
const HONOURS_PAGE_SIZE = 8;

/** Standalone so the Achievements tab can show it on its own, paginated - the
 *  Timeline tab dropped it, so this is now the only place it's rendered. */
function HonoursCard({ achievements }: { achievements: AchievementRecord[] }) {
  const [page, setPage] = useState(0);
  if (achievements.length === 0) return null;
  const page_ = achievements.slice(page * HONOURS_PAGE_SIZE, (page + 1) * HONOURS_PAGE_SIZE);
  return (
    <Card>
      <CardHeader title="Honours" subtitle="Every medal, placement and award, each tied to a verified result." />
      <CardBody className="pt-0">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {page_.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-start gap-2">
                <Medal size={16} className={cn('mt-0.5 shrink-0', a.medal ? MEDAL_TONE[a.medal] : 'text-slate-400')} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {[a.detail?.sport, fmtDate(a.date)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              <Badge tone={a.kind === 'award' ? 'violet' : 'slate'}>{titleCase(a.kind)}</Badge>
            </li>
          ))}
        </ul>
        <Pagination
          page={page}
          pageCount={Math.ceil(achievements.length / HONOURS_PAGE_SIZE)}
          total={achievements.length}
          pageSize={HONOURS_PAGE_SIZE}
          onPage={setPage}
        />
      </CardBody>
    </Card>
  );
}

export function LifetimeRecordPage({ hideHonours, hideTimeline }: { hideHonours?: boolean; hideTimeline?: boolean } = {}) {
  // No :userId → the signed-in player's own record.
  const { userId } = useParams();
  const { data, isLoading, error, refetch } = useApi<Profile>(userId ? `/people/${userId}/profile` : '/me/profile');
  const [page, setPage] = useState(0);
  // A coordinator can open one player's record after another without this
  // component remounting - stuck on page 3 of somebody else's timeline is a
  // bug the moment it happens.
  useEffect(() => { setPage(0); }, [userId]);

  if (isLoading) return <Spinner />;
  if (error) {
    // A 403 from authorizeRecordView() means the access-control copy below; any
    // other status (500, a dropped connection) is a server hiccup, not a
    // rejection - telling someone their OWN profile "isn't theirs" during an
    // outage is actively misleading, and hides the outage from bug reports.
    const forbidden = (error as { status?: number }).status === 403;
    return forbidden ? (
      <EmptyState
        icon={<ShieldCheck size={24} />}
        title="This record is not yours to open"
        description="You can only view the record of someone in an institution you belong to."
      />
    ) : (
      <EmptyState
        icon={<AlertTriangle size={24} className="text-amber-500" />}
        title="Couldn't load this record"
        description="Something went wrong on our end. Please try again."
        action={<Button variant="outline" onClick={() => refetch()}><RotateCw size={14} /> Try again</Button>}
      />
    );
  }
  if (!data) return null;

  const { stats, timeline, achievements } = data;

  return (
    <div className="space-y-5">
      {/* The totals count VERIFIED results only. The provisional hint is what
          keeps that from reading as data loss when a player can plainly see
          more matches on the timeline than the counter admits. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Verified events"
          value={stats.events}
          hint={stats.provisional > 0 ? `${stats.provisional} awaiting the organiser` : undefined}
        />
        <StatCard label="Won / Lost / Drew" value={`${stats.won} / ${stats.lost} / ${stats.drew}`} />
        <StatCard
          label="Medals"
          value={stats.total_medals}
          hint={stats.total_medals > 0 ? `${stats.medals.gold} gold · ${stats.medals.silver} silver · ${stats.medals.bronze} bronze` : undefined}
        />
        <StatCard label="Awards" value={stats.awards} />
      </div>

      {!hideHonours && <HonoursCard key={userId} achievements={achievements} />}

      {!hideTimeline && (
        <Card>
          <CardHeader title="Timeline" subtitle="Most recent first. Verified entries are permanent; provisional ones can still change." />
          <CardBody className="pt-0">
            {timeline.length === 0 ? (
              <EmptyState
                icon={<Trophy size={24} />}
                title="Nothing here yet"
                description="Matches appear as soon as they are scored, and become permanent once the organiser locks the scorecard."
              />
            ) : (
              // A provisional row is dimmed rather than hidden: the player played
              // the match and knows it, so the honest thing is to show it and say
              // what is still missing. Paginated over the flat list, then grouped
              // by date within the page, so a date heading never gets split
              // across two pages.
              <div className="space-y-4">
                {groupByDate(timeline.slice(page * TIMELINE_PAGE_SIZE, (page + 1) * TIMELINE_PAGE_SIZE)).map((g) => (
                  <div key={g.date}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{g.date}</div>
                    <ol className="relative ml-1 border-l-2 border-slate-200 pl-8 dark:border-slate-800">
                      {g.entries.map((e) => <TimelineRow key={e.id} e={e} />)}
                    </ol>
                  </div>
                ))}
                <Pagination
                  page={page}
                  pageCount={Math.ceil(timeline.length / TIMELINE_PAGE_SIZE)}
                  total={timeline.length}
                  pageSize={TIMELINE_PAGE_SIZE}
                  onPage={setPage}
                />
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
