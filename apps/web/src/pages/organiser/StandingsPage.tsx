import { useEffect, useMemo, useState } from 'react';
import { formatPoints } from '@semp/shared';
import { ChevronDown, ListOrdered, Medal, Trophy } from 'lucide-react';
import { useEvent } from './EventLayout';
import { useApi } from '../../lib/hooks';
import { EmptyState, RefreshBar, cn } from '../../components/ui';
import { useUrlState } from '../../components/primitives';
import { SharePublicLink } from '../../components/SharePublicLink';
import { StandingsBreakdown } from '../../components/StandingsBreakdown';
import { StandingsAdjustments, StandingsCalculation } from '../../components/StandingsAdjustments';
import { rankMedals } from '../../components/StandingsMedalTable';
import { RANK_COLORS, RankBadge } from '../../components/RankBadge';
import { SportChips, SportsDecor, StandingsBoardSkeleton, TeamAvatar, ViewTabs } from '../../features/schedule/ScheduleParts';
import { HEAD_ROW, Pts } from '../../components/GroupTables';

interface StandingRow {
  /**
   * The CONTINGENT this row is for - a campus or department id in a championship
   * contested inside one organisation, an organisation id in an open one. This is
   * the row's identity: in an intra event every row shares one organization_id, so
   * keying a list or an expand-state on that collapses twelve campuses into one.
   */
  entity_id: string;
  /** What to print. Resolved server-side so no two surfaces can label it differently. */
  name: string;
  short_name: string | null;
  org_unit: { id: string; name: string; code: string | null; type: string; parent: string | null } | null;
  organization_id: string;
  organization: { id: string; name: string; short_name?: string | null; logo_url?: string | null } | null;
  played: number; won: number; drawn: number; lost: number; points: number;
  detail: Record<string, number>;
  rank: number | null;
}
interface StandingsResponse { scope: string; scope_id: string | null; standings: StandingRow[]; completed_matches: number }

// A draw row (subset of GET /:id/draws): the sport list, and the adjustments form.
interface DrawRow {
  id: string;
  disciplines?: { name: string } | null;
  tournament_sports: {
    sports: { id: string; name: string; icon?: string | null } | null;
    tournaments: { id: string; name: string } | null;
  } | null;
}

type View = 'points' | 'medals';
type SportOption = { id: string; name: string; icon: string | null; live: number; total: number };

// Podium step heights, by place.
const STEP_H = ['h-24 sm:h-28', 'h-16 sm:h-20', 'h-11 sm:h-14'];

interface PodiumEntry { id: string; name: string; short: string | null; place: number; value: string }

/** A real podium, 2nd - 1st - 3rd, beside the headline. */
function PodiumHero({ eyebrow, headline, sub, meta, podium, onPick }: {
  eyebrow: string; headline: string; sub: string; meta: string; podium: PodiumEntry[]; onPick: (id: string) => void;
}) {
  const order = [podium[1], podium[0], podium[2]].filter(Boolean) as PodiumEntry[];
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white shadow-sm">
      <SportsDecor />
      <div className="relative flex flex-col gap-5 px-5 pt-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 pb-1 md:pb-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{eyebrow}</div>
          <h2 className="mt-1 truncate text-2xl font-black sm:text-3xl">{headline}</h2>
          <p className="mt-1 text-sm font-semibold text-white/85">{sub}</p>
          <p className="mt-2 text-xs text-white/70">{meta}</p>
        </div>
        {order.length > 0 && (
          <div className="flex items-end justify-center gap-2 sm:gap-3 md:w-[26rem] md:shrink-0">
            {order.map((p) => {
              const medal = RANK_COLORS[p.place - 1] ?? RANK_COLORS[2];
              return (
                <button key={p.id} type="button" onClick={() => onPick(p.id)} title={`${p.name}: see how these were earned`}
                  className="group flex w-1/3 min-w-0 flex-col items-center focus:outline-none">
                  <span className="relative mb-1.5 transition group-hover:-translate-y-0.5">
                    {p.place === 1 && <Trophy size={18} className="absolute -top-5 left-1/2 -translate-x-1/2 text-amber-300" aria-hidden />}
                    <span className="block scale-[1.2] rounded-full ring-2 ring-brand-700"><TeamAvatar name={p.name} short={p.short} /></span>
                  </span>
                  <span className="mt-1 w-full truncate text-center text-sm font-black" title={p.name}>{p.short || p.name}</span>
                  <span className="mb-2 w-full truncate text-center text-[11px] text-white/70">{p.value}</span>
                  <span className={cn('grid w-full place-items-center rounded-t-xl border-t-4 bg-white/15 text-2xl font-black ring-1 ring-inset ring-white/15 transition group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-white/60', STEP_H[p.place - 1] ?? STEP_H[2])}
                    style={{ borderTopColor: medal.bg }}>{p.place}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** Desktop: the sports as a sticky list. */
function SportList({ sports, value, onChange }: { sports: SportOption[]; value: string; onChange: (id: string) => void }) {
  const item = (id: string, label: string, icon: React.ReactNode) => {
    const active = value === id;
    return (
      <li key={id || 'all'}>
        <button type="button" aria-pressed={active} onClick={() => onChange(id)}
          className={cn('relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
            active ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60')}>
          {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden />}
          <span className="grid w-5 place-items-center text-base leading-none" aria-hidden>{icon}</span>
          <span className="truncate">{label}</span>
        </button>
      </li>
    );
  };
  return (
    <nav aria-label="Standings for" className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Standings for</div>
      <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto px-2 pb-2">
        {item('', 'Whole championship', <Trophy size={15} className="text-amber-500" />)}
        {sports.map((s) => item(s.id, s.name, s.icon || '🏅'))}
      </ul>
    </nav>
  );
}

interface BoardRow {
  id: string; pos: number; name: string; short: string | null; parent: string | null;
  /** Desktop number columns (P W D L, or the three medals). */
  cells: React.ReactNode[];
  /** The muted column before the main figure: gap to the leader, or points. */
  aside: React.ReactNode;
  main: React.ReactNode;
  /** Phone: the line under the name, standing in for the columns. */
  line: React.ReactNode;
}
interface BoardCols { cells: React.ReactNode[]; aside: string; main: string }

/** Every place gets a circle: medal colours for the top three, grey after. */
function Rank({ pos }: { pos: number }) {
  if (pos <= 3) return <RankBadge pos={pos} />;
  return <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-xs font-bold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{pos}</span>;
}

function Leaderboard({ rows, cols, expanded, onToggle, breakdown }: {
  rows: BoardRow[]; cols: BoardCols; expanded: string | null; onToggle: (id: string) => void; breakdown: (id: string) => React.ReactNode;
}) {
  // One grid for the header and every row, so the columns line up.
  const grid = { gridTemplateColumns: `2.25rem minmax(0,1fr) repeat(${cols.cells.length}, 2.75rem) 4.5rem 3.5rem 1.25rem` };
  // Columns need ~45rem; narrower screens get the two-line rows.
  const desk = 'hidden items-center gap-x-2 lg:grid';
  return (
    <div>
      <div className={cn(desk, HEAD_ROW, 'px-4 py-2')} style={grid}>
        <span>#</span><span>Team</span>
        {cols.cells.map((h, i) => <span key={i} className="text-center">{h}</span>)}
        <span className="text-right">{cols.aside}</span><span className="text-center">{cols.main}</span><span />
      </div>
      <ol>
        {rows.map((r) => {
          const open = expanded === r.id;
          const lead = r.pos === 1 && !open;
          return (
            <li key={r.id} data-row={r.id} className="border-t border-slate-100 dark:border-slate-800">
              <button type="button" aria-expanded={open} onClick={() => onToggle(r.id)} title="Show how these were earned"
                className={cn('w-full text-left text-sm transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30',
                  open ? 'bg-slate-50 dark:bg-slate-800/40' : lead && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                {/* Desktop: aligned columns. */}
                <span className={cn(desk, 'px-4 py-2.5')} style={grid}>
                  <Rank pos={r.pos} />
                  <span className="flex min-w-0 items-center gap-2.5">
                    <TeamAvatar name={r.name} short={r.short} size="sm" />
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-100" title={r.name}>{r.name}</span>
                    {r.parent && <span className="truncate text-xs text-slate-400">{r.parent}</span>}
                  </span>
                  {r.cells.map((c, i) => <span key={i} className="text-center tabular-nums">{c}</span>)}
                  <span className="text-right text-xs font-semibold tabular-nums text-slate-400">{r.aside}</span>
                  <span className="text-center">{r.main}</span>
                  <ChevronDown size={15} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
                </span>
                {/* Phone: name over a one-line record. */}
                <span className="flex items-center gap-2.5 px-3 py-2.5 lg:hidden">
                  <Rank pos={r.pos} />
                  <TeamAvatar name={r.name} short={r.short} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{r.name}</span>
                    <span className="mt-0.5 block">{r.line}</span>
                  </span>
                  {r.main}
                  <ChevronDown size={15} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
                </span>
              </button>
              {open && <div className="bg-slate-50/60 px-4 pb-4 dark:bg-slate-800/20">{breakdown(r.id)}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const muted = 'text-slate-500 dark:text-slate-400';
const won = 'font-semibold text-emerald-600 dark:text-emerald-400';
const lost = 'text-rose-500 dark:text-rose-400';
const MEDAL_KEYS = ['gold', 'silver', 'bronze'] as const;
const pip = (k: string) => <span className={`medal-pip medal-pip--${k} inline-block align-middle`} aria-label={k} />;

export function StandingsPage() {
  const { eventId, championship, canManage } = useEvent();
  // Plural host noun - "Teams scoring", "Batches scoring".
  const entrants = championship.entry?.entrant_label_plural ?? championship.entry?.entrant_label ?? 'Organizations';
  const { data: draws = [] } = useApi<DrawRow[]>(`/championships/${eventId}/draws`);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Points lead: the championship is decided on points; the medal tally is a second reading.
  const [view, setView] = useUrlState<View>('view', 'points');
  const [sportParam, setSportParam] = useUrlState<string>('sport', '');

  const sportOptions = useMemo(() => {
    const map = new Map<string, SportOption>();
    draws.forEach((d) => {
      const s = d.tournament_sports?.sports;
      if (!s) return;
      const e = map.get(s.id) ?? { id: s.id, name: s.name, icon: s.icon ?? null, live: 0, total: 0 };
      e.total += 1;
      map.set(s.id, e);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [draws]);

  // Standings are materialized one scope at a time: one sport, or the whole championship.
  const sport = sportOptions.find((s) => s.id === sportParam) ?? null;
  const scope = sport ? 'sport' : 'championship';
  const scopeId = sport?.id ?? null;
  const pickSport = (id: string) => { setSportParam(id); setExpanded(null); };

  const query = scopeId ? `?scope=${scope}&scopeId=${scopeId}` : `?scope=${scope}`;
  const { data, isLoading, refetch, dataUpdatedAt, isFetching } = useApi<StandingsResponse>(`/championships/${eventId}/standings${query}`);
  const rows = data?.standings ?? [];

  // Live-ish standings: re-pull every 10s so completed matches show without a reload.
  useEffect(() => {
    const t = setInterval(() => refetch(), 10000);
    return () => clearInterval(t);
  }, [refetch]);

  const base = `/championships/${eventId}`;
  const breakdown = (id: string) => (
    <StandingsBreakdown base={base} scope={scope} scopeId={scopeId} entityId={id} showConverted={view === 'medals'} />
  );
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));
  // A podium step opens that team's breakdown and brings its row into view.
  const pick = (id: string) => {
    setExpanded(id);
    requestAnimationFrame(() => document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const counted = data?.completed_matches ?? 0;
  const meta = `${counted} match${counted === 1 ? '' : 'es'} counted · ${rows.length} ${entrants.toLowerCase()} scoring`;
  const scopeName = sport ? sport.name : 'Championship';

  // Both views feed the same hero and leaderboard.
  const board = useMemo(() => {
    if (view === 'medals') {
      const ranked = rankMedals(rows, { includeAll: true });
      const most = Math.max(...ranked.map((m) => m.total), 0);
      const medallists = ranked.filter((m) => m.total > 0);
      const lead = medallists[0];
      return {
        eyebrow: `${scopeName} medal tally`,
        headline: lead ? lead.row.short_name || lead.row.name : 'No medals yet',
        sub: lead ? `${lead.gold} gold · ${lead.silver} silver · ${lead.bronze} bronze` : 'Medals land as finals and ranking events are decided',
        podium: medallists.slice(0, 3).map((m, i) => ({ id: m.row.entity_id, name: m.row.name, short: m.row.short_name, place: i + 1, value: `${m.gold} gold · ${m.total} total` })),
        cols: { cells: MEDAL_KEYS.map((k) => pip(k)), aside: 'Pts', main: 'Total' } as BoardCols,
        rows: ranked.map((m, i): BoardRow => ({
          id: m.row.entity_id, pos: i + 1, name: m.row.name, short: m.row.short_name, parent: m.row.org_unit?.parent ?? null,
          cells: MEDAL_KEYS.map((k) => (m[k] ? <span className="font-semibold text-slate-700 dark:text-slate-200">{m[k]}</span> : <span className="text-slate-300 dark:text-slate-600">-</span>)),
          aside: formatPoints(m.row.points),
          main: <span className="inline-grid min-w-8 place-items-center rounded-md bg-brand-50 px-1.5 py-0.5 text-[13px] font-black tabular-nums text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{m.total}</span>,
          line: (
            <span className={cn('flex items-center gap-2.5 text-[11px] font-semibold tabular-nums', muted)}>
              {MEDAL_KEYS.map((k) => <span key={k} className="inline-flex items-center gap-1">{pip(k)}{m[k]}</span>)}
              <span>{formatPoints(m.row.points)} pts</span>
            </span>
          ),
        })),
      };
    }
    const [first, second] = rows;
    const gap = first && second ? first.points - second.points : 0;
    const top = first?.points ?? 0;
    return {
      eyebrow: `${scopeName} standings`,
      headline: first ? first.short_name || first.name : 'No results yet',
      sub: !first ? 'Standings fill in as officials complete matches'
        : !second ? `On top with ${formatPoints(first.points)} points`
        : gap > 0 ? `On top with ${formatPoints(first.points)} points, ${formatPoints(gap)} clear of ${second.short_name || second.name}`
        : `Level on ${formatPoints(first.points)} points with ${second.short_name || second.name}`,
      podium: rows.slice(0, 3).map((r, i) => ({ id: r.entity_id, name: r.name, short: r.short_name, place: r.rank ?? i + 1, value: `${formatPoints(r.points)} pts` })),
      cols: { cells: ['P', 'W', 'D', 'L'], aside: 'Behind', main: 'Pts' } as BoardCols,
      rows: rows.map((r, i): BoardRow => ({
        id: r.entity_id, pos: r.rank ?? i + 1, name: r.name, short: r.short_name, parent: r.org_unit?.parent ?? null,
        cells: [
          <span className={muted}>{r.played}</span>, <span className={won}>{r.won}</span>,
          <span className={muted}>{r.drawn}</span>, <span className={lost}>{r.lost}</span>,
        ],
        aside: i === 0 ? 'Leader' : `-${formatPoints(top - r.points)}`,
        main: <Pts v={r.points} />,
        line: (
          <span className={cn('flex items-center gap-2 text-[11px] font-semibold tabular-nums', muted)}>
            <span>P{r.played}</span><span className={won}>W{r.won}</span><span>D{r.drawn}</span><span className={lost}>L{r.lost}</span>
            {i > 0 && <span className="text-slate-400">Â· -{formatPoints(top - r.points)}</span>}
          </span>
        ),
      })),
    };
  }, [view, rows, scopeName]);

  return (
    <div className="space-y-5">
      {isLoading ? <StandingsBoardSkeleton hero /> : (
        <PodiumHero eyebrow={board.eyebrow} headline={board.headline} sub={board.sub} meta={meta} podium={board.podium} onPick={pick} />
      )}

      {/* Below xl the sports are chips; on wide screens the list sits beside the board. */}
      <div className="xl:hidden">
        <SportChips sports={sportOptions} showCounts={false} label="Standings for" allLabel="Whole championship" allIcon="🏆"
          value={sport ? [sport.id] : []}
          onChange={(ids) => pickSport(ids.filter((i) => i !== sport?.id).pop() ?? '')} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <span className="text-sm font-black text-slate-800 dark:text-slate-100">Leaderboard</span>
              {rows.length > 0 && (
                <ViewTabs size="sm" value={view} onChange={(v) => { setView(v); setExpanded(null); }}
                  options={[{ value: 'points', label: 'Points', icon: ListOrdered }, { value: 'medals', label: 'Medals', icon: Medal }]} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RefreshBar updatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => refetch()} />
              <SharePublicLink eventId={eventId} />
            </div>
          </header>
          {isLoading ? <StandingsBoardSkeleton /> : rows.length === 0 ? (
            <div className="p-2">
              <EmptyState icon={<Trophy size={24} />} title="No results yet" description="Standings fill in as officials complete matches with scores." />
            </div>
          ) : (
            <>
              <Leaderboard rows={board.rows} cols={board.cols} expanded={expanded} onToggle={toggle} breakdown={breakdown} />
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
                {view === 'medals' ? 'Ranked by gold, then silver, then bronze.' : 'Each discipline scores by its own rule; tap a team to see where its points came from.'}
              </p>
            </>
          )}
        </section>

        <aside className="hidden xl:sticky xl:top-4 xl:block xl:self-start">
          <SportList sports={sportOptions} value={sport?.id ?? ''} onChange={pickSport} />
        </aside>
      </div>

      {canManage && <StandingsCalculation eventId={eventId} />}
      {canManage && scope === 'championship' && rows.length > 0 && <StandingsAdjustments eventId={eventId} rows={rows} draws={draws} />}
    </div>
  );
}
