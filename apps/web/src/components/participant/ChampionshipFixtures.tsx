import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Calendar, Flag, MapPin } from 'lucide-react';
import { EARLY_END_LABEL, earlyEndOf, formatPoints, isGroupBye, isKnockoutRound, KHO_END_LABEL, KHO_END_SHORT, khoSettlementOf, shootoutLabel, shootoutOf, shootoutTerms, TBD_LABEL } from '@semp/shared';
import { useApi } from '../../lib/hooks';
import { Button, EmptyState, Modal, cn } from '../../components/ui';
import { GroupTables } from '../GroupTables';
import { EventTallyTable, TitleTallyCard, hasTally as sportHasTally, titleTallyPath, type TitleTallyResponse } from '../TitleTally';
import { returnAfterLogin } from '../../lib/browserStorage';
import { FitName } from '../FitName';
import { Bracket } from '../Bracket';
import { LiveDot, TeamAvatar, ViewTabs } from '../../features/schedule/ScheduleParts';
import { SportFilterButton, SportFilterPanel } from '../../features/personal/SportFilter';

// A flattened fixture from GET /championships/:id/fixtures.
interface TeamRef {
  id: string;
  name: string;
  /** The squad's abbreviation, for a phone where the full name will not fit. */
  short_name?: string | null;
  organizations?: { short_name: string | null; name: string } | null;
  /** The campus or batch this squad plays for, when it plays for one. */
  org_units?: { id: string; name: string; code?: string | null; type?: string | null } | null;
}
interface FixtureRow {
  id: string; status: string; round: string | null; scheduled_at: string | null;
  entry_type: string | null; home_score: number | null; away_score: number | null; winner_team_id: string | null;
  ground: { id: string; name: string; venue: string | null } | null;
  sport: string | null; sport_icon: string | null; sport_id?: string | null;
  tournament: { id: string; name: string } | null; discipline: string | null;
  scorecard_url: string | null;
  home: TeamRef | null;
  away: TeamRef | null;
  /** Read here for how a match ended (retired / disqualified / conceded), and by the bracket. */
  live_state?: any;
  // For the bracket view.
  tournament_discipline_id?: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  bracket_position: number | null;
  pool_number?: number | null;
  home_slot_label?: string | null;
  away_slot_label?: string | null;
}

// Results shows concluded matches AND in-progress ones (live), so a live match with
// a running score appears here (marked LIVE) instead of only on the Schedule.
// Not byes: one squad and no opponent is not a result, it read "Squad vs TBD".
const RESULT_STATUSES = new Set(['live', 'completed', 'walkover', 'cancelled']);
const STATUS_ORDER = ['scheduled', 'live', 'completed', 'walkover', 'bye', 'postponed', 'cancelled'];

/** Each fixture status as a solid pill, and its tab label. */
const STATUS_LOOK: Record<string, { label: string; pill: string }> = {
  scheduled: { label: 'Scheduled', pill: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200' },
  live: { label: 'Live', pill: 'bg-rose-500 text-white' },
  completed: { label: 'Completed', pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' },
  walkover: { label: 'Walkover', pill: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200' },
  bye: { label: 'Bye', pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  postponed: { label: 'Postponed', pill: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' },
  cancelled: { label: 'Cancelled', pill: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
};
const statusLook = (s: string) => STATUS_LOOK[s] ?? { label: s, pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };

function StatusPill({ status }: { status: string }) {
  const look = statusLook(status);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', look.pill)}>
      {status === 'live' && <LiveDot className="h-1.5 w-1.5" />}{look.label}
    </span>
  );
}

function teamLabel(t: TeamRef | null) { return t?.name ?? TBD_LABEL; }
// Campus or batch first, organisation otherwise - the org alone showed the same
// name on both sides of every match in an internal championship.
function orgLabel(t: TeamRef | null) {
  return t?.org_units?.name || t?.organizations?.short_name || t?.organizations?.name || '';
}
const shortOf = (t: TeamRef | null) => t?.short_name || t?.organizations?.short_name || null;

// Ranking events (powerlifting/swimming/athletics) get one team-less 'Event' fixture
// with no opponent to decide, so show the discipline + a Ranking tag, not "TBD v TBD".
function isRankingEvent(f: FixtureRow) { return f.round === 'Event' && !f.home && !f.away; }

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}`;
};

// One side: crest, then the name (full when it fits, the short code on a phone) and its organisation.
function TeamName({ team, align, won }: { team: TeamRef | null; align: 'left' | 'right'; won: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', align === 'right' && 'flex-row-reverse')}>
      <span className="max-sm:hidden"><TeamAvatar name={teamLabel(team)} short={shortOf(team)} size="sm" /></span>
      <div className={cn('min-w-0 flex-1', align === 'right' ? 'text-right' : 'text-left', won ? 'font-black text-slate-900 dark:text-slate-100' : 'font-semibold text-slate-600 dark:text-slate-300')}>
        <FitName full={teamLabel(team)} short={team?.short_name} align={align} fullBelow belowClassName="text-[10px]" />
        {orgLabel(team) && <div className="truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{orgLabel(team)}</div>}
      </div>
    </div>
  );
}

// Whole-championship fixtures (as spectators see them) so players can follow every
// match, not just their own. `results` narrows `schedule` to concluded matches.
/** Point tallies on a results list: shown to all, opened only when signed in (public page). */
export interface TallyAccess { championshipId: string; signedIn: boolean }

export function ChampionshipFixtures({ championshipId, mode, apiBase, tally }: {
  championshipId: string; mode: 'schedule' | 'results'; apiBase?: string; tally?: TallyAccess;
}) {
  const base = apiBase ?? `/championships/${championshipId}`;
  const location = useLocation();
  // After sign-in the visitor lands back with ?tally=<draw> or ?title=<sport>: that
  // discipline's Point tally opens (keyed by draw), or the sport's title tally, and scrolls into view.
  const [searchParams] = useSearchParams();
  const backTo = { tally: searchParams.get('tally'), title: searchParams.get('title') };
  const [tallyOpen, setTallyOpen] = useState<Record<string, boolean>>(() => (backTo.tally ? { [backTo.tally]: true } : {}));
  /** Where to come back to after signing in, or null when the prompt is closed. */
  const [askSignIn, setAskSignIn] = useState<string | null>(null);
  const ask = (target: { tally?: string; title?: string }) =>
    setAskSignIn(`${location.pathname}?tab=results${target.tally ? `&tally=${target.tally}` : ''}${target.title ? `&title=${target.title}` : ''}`);
  // Bring the tally they came back for into view once the list has rendered it.
  useEffect(() => {
    const anchor = backTo.tally ? `tally-${backTo.tally}` : backTo.title ? `title-${backTo.title}` : null;
    if (!anchor || !tally?.signedIn) return;
    let tries = 0;
    const t = window.setInterval(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (el || ++tries > 40) window.clearInterval(t);
    }, 250);
    return () => window.clearInterval(t);
  }, [backTo.tally, backTo.title, tally?.signedIn]);
  const { data: titleTally } = useApi<TitleTallyResponse>(tally?.signedIn ? titleTallyPath(tally.championshipId) : null);
  const { data: all = [], isLoading } = useApi<FixtureRow[]>(`${base}/fixtures`);
  const [sports, setSports] = useState<string[]>([]);
  const [sportsOpen, setSportsOpen] = useState(false);
  // Status filter ('' = all), from the tabs.
  const [status, setStatus] = useState('');
  // Groups shown as a bracket instead of a list (Schedule only), by group key.
  const [asBracket, setAsBracket] = useState<Record<string, boolean>>({});

  // Team names by id, for the bracket - it is drawn from ids, not the row objects.
  const teamsById = useMemo(() => {
    const m = new Map<string, TeamRef>();
    for (const f of all) for (const t of [f.home, f.away]) if (t) m.set(t.id, t);
    return m;
  }, [all]);
  const bracketTeamName = (id: string | null) => (id ? teamLabel(teamsById.get(id) ?? null) : TBD_LABEL);
  const bracketTeamOrg = (id: string | null) => (id ? orgLabel(teamsById.get(id) ?? null) : '');
  // The badge text: the squad's code, else its institute's, as on Schedule.
  const bracketTeamShort = (id: string | null) => shortOf(id ? teamsById.get(id) ?? null : null);

  // Schedule shows every fixture (the championship calendar); Results only those that have concluded.
  const inMode = useMemo(
    // A group's rest slots are never played, so they are not listed.
    () => (mode === 'schedule' ? all : all.filter((f) => RESULT_STATUSES.has(f.status))).filter((f) => !isGroupBye(f)),
    [all, mode],
  );
  // One chip per sport, counting its matches in this tab.
  const sportOptions = useMemo(() => {
    const m = new Map<string, { icon: string | null; total: number; live: number }>();
    for (const f of inMode) {
      if (!f.sport) continue;
      const e = m.get(f.sport) ?? { icon: f.sport_icon, total: 0, live: 0 };
      e.total++; if (f.status === 'live') e.live++;
      m.set(f.sport, e);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([name, e]) => ({ id: name, name, icon: e.icon, live: e.live, total: e.total }));
  }, [inMode]);
  const inSports = useMemo(() => inMode.filter((f) => !sports.length || (f.sport != null && sports.includes(f.sport))), [inMode, sports]);
  const rows = useMemo(() => inSports.filter((f) => !status || f.status === status), [inSports, status]);

  // Status tabs: only the statuses this tab actually holds, in canonical order.
  const statusTabs = useMemo(() => {
    const present = STATUS_ORDER.filter((s) => inSports.some((f) => f.status === s));
    return [
      { value: '', label: 'All', badge: <span className="tabular-nums opacity-70">{inSports.length}</span> },
      ...present.map((s) => ({ value: s, label: statusLook(s).label, badge: <span className="tabular-nums opacity-70">{inSports.filter((f) => f.status === s).length}</span> })),
    ];
  }, [inSports]);

  // Group by sport + discipline so the list reads as sections.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; sport: string | null; discipline: string | null; icon: string | null; rows: FixtureRow[] }>();
    for (const f of rows) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [rows]);

  if (isLoading) {
    const bar = 'block animate-pulse rounded-full bg-slate-200 dark:bg-slate-800';
    return (
      <div className="space-y-4" role="status" aria-label="Loading">
        <span className={cn(bar, 'h-10 w-80 max-w-full')} />
        {[0, 1].map((i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800"><span className={cn(bar, 'h-4 w-40')} /></div>
            {[0, 1, 2].map((r) => <div key={r} className="flex items-center gap-4 border-t border-slate-100 px-4 py-4 first-of-type:border-t-0 dark:border-slate-800"><span className={cn(bar, 'h-3 w-16')} /><span className={cn(bar, 'h-4 flex-1')} /><span className={cn(bar, 'h-4 w-20')} /></div>)}
          </div>
        ))}
      </div>
    );
  }
  if (inMode.length === 0) {
    return (
      <EmptyState
        icon={mode === 'schedule' ? <Calendar size={22} /> : <Flag size={22} />}
        title={mode === 'schedule' ? 'Nothing scheduled' : 'No results yet'}
        description={mode === 'schedule' ? 'Upcoming matches will appear here once they are scheduled.' : 'Results appear here as matches are played.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto"><ViewTabs value={status} onChange={setStatus} options={statusTabs} /></div>
        {sportOptions.length > 1 && <SportFilterButton open={sportsOpen} picked={sports.length} onToggle={() => setSportsOpen((o) => !o)} controls={`${mode}-sports`} />}
      </div>
      {sportsOpen && sportOptions.length > 1 && (
        <SportFilterPanel id={`${mode}-sports`} sports={sportOptions} value={sports} onChange={setSports} allTotal={inMode.length} />
      )}

      {askSignIn && (
        <Modal title="Sign in to see the point tally" onClose={() => setAskSignIn(null)}
          footer={(
            <div className="flex justify-end gap-2">
              <Link to="/login?mode=signup" onClick={() => returnAfterLogin.set(askSignIn)}><Button variant="outline">Sign up</Button></Link>
              <Link to="/login" onClick={() => returnAfterLogin.set(askSignIn)}><Button>Sign in</Button></Link>
            </div>
          )}>
          <p className="text-sm text-slate-600 dark:text-slate-300">Group tables, event standings and title tallies are available once you sign in. You'll come straight back to this page.</p>
        </Modal>
      )}
      {rows.length === 0 && <EmptyState compact icon={<Calendar size={20} />} title="No matches match" description="Try another status or sport." />}
      {groups.map((g) => {
        // Point tally: group / league tables, or a ranking event's own standing.
        const drawId = g.rows[0]?.tournament_discipline_id ?? null;
        const sportId = g.rows[0]?.sport_id ?? null;
        const isEvent = g.rows.every((f) => f.round === 'Event');
        const hasPools = !!drawId && all.some((f) => f.tournament_discipline_id === drawId && f.round !== 'Event' && !isKnockoutRound(f.round));
        const showTallyTab = !!tally && !!drawId && (isEvent || hasPools);
        const tallyShown = showTallyTab && !!tally?.signedIn && !!drawId && !!tallyOpen[drawId];
        const eventTally = titleTally?.events.find((e) => e.draw_id === drawId);
        // A ranking sport's title tally sits once, above its first event.
        const firstOfSport = isEvent && groups.find((x) => x.rows.every((f) => f.round === 'Event') && x.rows[0]?.sport_id === sportId)?.key === g.key;
        const sportTally = titleTally?.sports.find((x) => x.sport_id === sportId);
        // A bracket is drawn from the WHOLE knockout draw, whatever the status tab
        // says - a filtered tree would have holes. Pool matches are not part of it.
        const knockout = mode === 'schedule'
          ? all.filter((f) => f.sport === g.sport && f.discipline === g.discipline && f.pool_number == null)
          : [];
        const hasBracket = knockout.some((f) => f.bracket_position != null);
        const showBracket = hasBracket && !!asBracket[g.key];
        return (
        <section key={g.key} id={drawId ? `tally-${drawId}` : undefined} className="scroll-mt-24 space-y-2">
          {tally && firstOfSport && (tally.signedIn
            ? (sportHasTally(sportTally) && <div id={`title-${sportId}`} className="scroll-mt-24"><TitleTallyCard tally={sportTally!} /></div>)
            : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{g.sport} · Title tally</span>
                <Button size="sm" variant="outline" onClick={() => ask({ title: sportId ?? undefined })}>View tally</Button>
              </div>
            ))}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-base dark:bg-slate-800/60" aria-hidden>{g.icon ?? '🏅'}</span>
              <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                {g.sport ?? 'Sport'}{g.discipline && <span className="font-semibold text-slate-400 dark:text-slate-500"> · {g.discipline}</span>}
              </h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">{g.rows.length}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                {showTallyTab && (
                  <ViewTabs size="sm" value={tallyShown ? 'tally' : 'matches'}
                    onChange={(v) => (tally?.signedIn ? setTallyOpen((s) => ({ ...s, [drawId!]: v === 'tally' })) : v === 'tally' && ask({ tally: drawId! }))}
                    options={[{ value: 'matches', label: 'Matches' }, { value: 'tally', label: 'Point tally' }]} />
                )}
                {hasBracket && (
                  <ViewTabs size="sm" value={showBracket ? 'bracket' : 'list'}
                    onChange={(v) => setAsBracket((s) => ({ ...s, [g.key]: v === 'bracket' }))}
                    options={[{ value: 'list', label: 'List' }, { value: 'bracket', label: 'Bracket' }]} />
                )}
              </div>
            </div>

            {tallyShown ? (
              <div className="p-3">{eventTally ? <EventTallyTable event={eventTally} /> : <GroupTables drawId={drawId!} canManage={false} />}</div>
            ) : showBracket ? (
              <div className="p-3 sm:p-4">
                {/* Read-only: no onSelect / onScore, so nothing in it can be edited. */}
                <Bracket fixtures={knockout} sportName={g.sport} teamName={bracketTeamName} teamShort={bracketTeamShort} teamOrg={bracketTeamOrg} />
              </div>
            ) : g.rows.map((f) => {
              const scored = f.home_score != null && f.away_score != null;
              const homeWon = f.winner_team_id != null && f.winner_team_id === f.home?.id;
              const awayWon = f.winner_team_id != null && f.winner_team_id === f.away?.id;
              const early = earlyEndOf(f.live_state);
              const pens = scored ? shootoutOf(f.live_state) : null;
              // Kho kho: a level score settled on minimum chase, or a win by an innings.
              const khoEnd = scored ? khoSettlementOf(f.live_state) : null;
              const live = f.status === 'live';
              return (
                // "v" dead centre, whatever the names: equal side columns around the match on
                // wider screens, and two equal name columns around the score inside it.
                <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 first-of-type:border-t-0 dark:border-slate-800 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
                  <div className="w-28 shrink-0 sm:w-auto">
                    <span className="block truncate text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400" title={f.round ?? undefined}>{f.round || '-'}</span>
                  </div>
                  {/* Phone: status on the round's line, so the date and venue can sit BELOW the teams. */}
                  <span className="ml-auto sm:hidden"><StatusPill status={f.status} /></span>

                  <div className={cn('basis-full text-sm sm:basis-auto',
                    isRankingEvent(f) ? 'flex items-center justify-center' : 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3')}>
                    {isRankingEvent(f) ? (
                      <div className="flex items-center justify-center gap-2 text-center">
                        <span className="truncate font-bold text-slate-700 dark:text-slate-200" title={f.discipline ?? f.sport ?? undefined}>{f.discipline ?? f.sport ?? 'Event'}</span>
                        <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">Ranking event</span>
                      </div>
                    ) : (
                      <>
                        <TeamName team={f.home} align="right" won={homeWon} />
                        <span className="flex min-w-[4ch] flex-col items-center text-center">
                          {scored
                            ? <span className={cn('rounded-lg px-2 py-0.5 text-base font-black tabular-nums', live ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100')}>
                              {formatPoints(f.home_score)}-{formatPoints(f.away_score)}
                            </span>
                            : <span className="text-xs font-black text-slate-300 dark:text-slate-600">VS</span>}
                          {/* Stopped early: an unfinished score must not read as a match played out. */}
                          {scored && early && <span className="mt-0.5 text-[10px] font-semibold leading-3 text-amber-600 dark:text-amber-400">{EARLY_END_LABEL[early]}</span>}
                          {pens && (
                            <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold leading-3 text-slate-500 dark:text-slate-400" title={`Won ${shootoutTerms(f.sport).phrase}`}>
                              {shootoutLabel(pens.home, pens.away, f.sport)}
                            </span>
                          )}
                          {khoEnd && (
                            <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold leading-3 text-slate-500 dark:text-slate-400" title={KHO_END_LABEL[khoEnd.reason]}>
                              {KHO_END_SHORT[khoEnd.reason]}
                            </span>
                          )}
                        </span>
                        <TeamName team={f.away} align="left" won={awayWon} />
                      </>
                    )}
                  </div>

                  {/* Phone: a full-width line under the teams. sm+: the right-hand column. */}
                  <div className="flex basis-full flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 sm:basis-auto sm:justify-end">
                    {f.scorecard_url && (
                      <a href={f.scorecard_url} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent-deep)] hover:underline dark:text-[var(--accent)]" onClick={(e) => e.stopPropagation()}>
                        Scorecard ↗
                      </a>
                    )}
                    {/* When and where - each only when the organiser set it. */}
                    {f.scheduled_at && <span className="whitespace-nowrap font-semibold">{clock(f.scheduled_at)}</span>}
                    {f.ground && (
                      <span className="flex items-center gap-1" title="Venue">
                        <MapPin size={12} className="shrink-0" aria-hidden />
                        {[f.ground.venue, f.ground.name].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <span className="hidden sm:inline-flex"><StatusPill status={f.status} /></span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        );
      })}
    </div>
  );
}
