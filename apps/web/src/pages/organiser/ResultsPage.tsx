import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight, Clock, Eye, Flag, Lock, LockOpen, Pencil, Radio, ShieldCheck,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EARLY_END_LABEL, earlyEndNoteOf, earlyEndOf, isKnockoutRound, KHO_END_LABEL, khoSettlementOf, resultSummary, shootoutLabel, shootoutOf, TBD_LABEL } from '@semp/shared';
import { useEvent } from './EventLayout';
import { AwardsBoard, MatchAwardsLine, type AwardsBoardData, type BoardMatchAward } from '../../features/awards/AwardsBoard';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  Button, Card, EmptyState, Modal, Segmented, Select, Spinner, Textarea, cn, confirmDialog, toast,
} from '../../components/ui';
import { GroupTables, TallyTabLabel } from '../../components/GroupTables';
import { EventTallyTable, TitleTallyCard, hasTally as sportHasTally, titleTallyPath, type TitleTallyResponse } from '../../components/TitleTally';
import { useUrlState, usePreserveScroll } from '../../components/primitives';
import { BackToTop } from '../../components/BackToTop';
import { LiveStrip, MatchCard, ProgressRing, sortByCategory, ViewTabs, PulseBanner, SportChips, TeamChips, type CardSide, type PulseTile, type TeamSide } from '../../features/schedule/ScheduleParts';

// A flattened fixture row from GET /championships/:id/fixtures.
interface ResultRow {
  /** Catalogue sport - which organisers may act on this match. */
  sport_id?: string | null;
  /** The draw (sport discipline) this match belongs to. */
  tournament_discipline_id?: string | null;
  /** Sequential within the championship - how a person refers to this match. */
  match_no?: number | null;
  /** When it is played. Rendered as Today / Tomorrow / 28th Aug, 2026 · 7:30 PM. */
  scheduled_at?: string | null;
  id: string;
  status: string;
  /** Whoever was assigned to score this match, if anyone. */
  official_id: string | null;
  round: string | null;
  entry_type: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  /** draft -> submitted -> locked. A locked result is official and immutable. */
  scorecard_status: string;
  locked_at: string | null;
  sport: string | null;
  sport_icon: string | null;
  tournament: { id: string; name: string } | null;
  discipline: string | null;
  home: Side | null;
  away: Side | null;
  /** The console's working state; read here only for how a match ended. */
  live_state?: unknown;
  /** Where it is played, when the organiser set one. */
  ground?: { id: string; name: string; venue: string | null } | null;
}

/** "Turfup · Turf 1" - venue then ground, whichever are set. */
const venueLabel = (g: ResultRow['ground']) => (g ? [g.venue, g.name].filter(Boolean).join(' · ') : '');

interface Side {
  id: string;
  name: string;
  /** The squad's own scoreboard abbreviation, entered when it was created. */
  short_name?: string | null;
  organizations?: { short_name?: string | null; name?: string | null } | null;
  /** The campus or batch this squad plays FOR, when it plays for one. */
  org_units?: { id: string; name: string; code?: string | null; type?: string | null } | null;
}

// Both labels read the CONTINGENT - the unit when there is one, the organisation
// otherwise. Reading the organisation first was right while every competitor was an
// institution and wrong the moment they were not: in a championship contested
// between Northfield's own campuses, both sides of every match belonged to
// Northfield, so the whole results page read "Northfield vs Northfield". The
// Schedule page already leads with something that distinguishes the two sides;
// this brings Results into line.
// A unit's own short code is used VERBATIM, up to four characters. Squeezing it to
// three collapsed "BT23", "BT24", "BT25" and "BT26" into one chip reading "BT2" -
// four batches indistinguishable on a results page, which is the same failure as
// labelling them all by their institution, just one level down.
const teamCode = (t: Side | null) => {
  const code = (t?.org_units?.code ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (code) return code.slice(0, 4).toUpperCase();
  return (t?.org_units?.name || t?.organizations?.short_name || t?.name || '')
    .replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || '··';
};

const teamLabel = (t: Side | null) =>
  t?.org_units?.name || t?.organizations?.name || t?.organizations?.short_name || t?.name || '';

/**
 * The name that fits on a phone.
 *
 * A results row has room for roughly twelve characters a side. The squad's own
 * `short_name` is entered by whoever created it and is the right answer; the
 * organisation's short name is the fallback for a squad that predates the column,
 * and the full label is the last resort.
 *
 * This is what stopped the phone view being a horizontal scroll container: the row
 * was laying out "Northfield Institute of Technology B.Tech 2024" twice and a score,
 * which cannot be done in 390px, so it was made draggable instead of made to fit.
 */
/**
 * A square, thumb-sized action carrying a glyph instead of a word.
 *
 * The phone row had three text buttons - Lock, Unlock, "Record →" - spending most of
 * a 390px line on labels for actions whose glyphs are unambiguous, on a row that did
 * not fit anyway. 40px is above the touch floor, and `label` becomes both the
 * accessible name and the tooltip, so the meaning is available to anybody reading
 * with a screen reader or hovering on a tablet.
 */
function IconAction({
  label, short, children, onClick, disabled, busy, tone, expressive,
}: {
  /** The accessible name and the tooltip. Always present. */
  label: string;
  /** The word shown beside the glyph where there is room. */
  short?: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'primary' | 'warn';
  /**
   * Show the word from sm up.
   *
   * A phone has room for a glyph and nothing else, so there it stays square. A
   * tablet and a desktop have the width, and a glyph plus its word is simply
   * clearer than a glyph alone - there is no reason to make a mouse user hover to
   * find out what a button does when the label fits.
   */
  expressive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        // 36px square by default: these sit in a row of three at the top of a card
        // that is itself a tap target for the common action, so the surrounding
        // surface carries the reach.
        'inline-grid h-9 shrink-0 place-items-center rounded-lg transition-colors active:scale-95 disabled:opacity-40',
        expressive && short
          ? 'w-9 sm:flex sm:w-auto sm:items-center sm:gap-1.5 sm:px-3 sm:text-[13px] sm:font-semibold'
          : 'w-9',
        tone === 'primary'
          ? 'bg-brand-600 text-white hover:bg-brand-700'
          : tone === 'warn'
            ? 'border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10'
            : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
        busy && 'animate-pulse',
      )}
    >
      {children}
      {expressive && short && <span className="hidden sm:inline">{short}</span>}
    </button>
  );
}

/**
 * The statuses this page is about: being played, or played.
 *
 * `scheduled` is Schedule's business, and `postponed` / `cancelled` will never
 * produce a result.
 *
 * `bye` is not a match either: one squad, no opponent, advanced by the generator
 * the moment the draw was made. Listed here it read "Squad vs TBD" - a row with
 * nothing to score, nothing to decide, and a lock that changes nothing (records
 * skip byes, and the bracket already moved). The bracket and Schedule still show it.
 */
const RESULTABLE = new Set(['live', 'completed', 'walkover']);

/** A filter Select that fills its grid column on a phone (Select's own wrapper never stretches). */
const PHONE_FILL = 'min-w-0 max-sm:[&>div]:w-full max-sm:[&_select]:w-full';

const teamShort = (t: Side | null) =>
  t?.short_name || t?.org_units?.code || t?.organizations?.short_name || teamLabel(t);

/**
 * Unlocking is a correction, and a correction has to say what it is correcting.
 *
 * A plain confirm would not do: the server refuses a reason under five characters
 * because the audit trail is the only reason unlocking is allowed at all, and a
 * dialog that cannot collect one would just relay a rejection the user could not act
 * on.
 */
function UnlockModal({ label, busy, onClose, onConfirm }: {
  label: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < 5;
  return (
    <Modal
      title="Unlock this result?"
      onClose={onClose}
      banner={<span className="text-lg font-bold text-white">Unlock this result?</span>}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy || tooShort} onClick={() => onConfirm(reason.trim())}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        {label} is official. Unlocking takes it back to submitted, recomputes the standings, and
        supersedes the records and certificates it produced. Your reason is recorded against the result.
      </p>
      <Textarea
        autoFocus
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Away score was entered against the wrong side"
      />
      {tooShort && <p className="mt-2 text-xs text-slate-400">Give at least a few words - this goes on the record.</p>}
    </Modal>
  );
}

export function ResultsPage() {
  const { eventId, organises, canManageSport, championship } = useEvent();
  const { ctx } = useAuth();
  const navigate = useNavigate();
  // Archived: results stay visible, but none can be rescored, locked or reopened -
  // the server refuses it too, so the controls are off rather than failing on click.
  const archived = !!championship.archived_at;
  const { data: fixtures = [], isLoading, isFetching } = useApi<ResultRow[]>(`/championships/${eventId}/fixtures`);
  const { data: board } = useApi<AwardsBoardData>(`/championships/${eventId}/awards/board`);
  const awardsByFixture = useMemo(() => {
    const m = new Map<string, BoardMatchAward[]>();
    for (const a of board?.match ?? []) m.set(a.fixture_id, [...(m.get(a.fixture_id) ?? []), a]);
    return m;
  }, [board]);
  // Is this championship awarding custom (hand-entered) points anywhere? If so, the
  // organiser is reminded to add points per result. Rules are organiser-only.
  const { data: rulesData } = useApi<{ default: { scheme: string }; rules: { scope_type: string; config: { scheme: string } }[] }>(
    organises ? `/championships/${eventId}/standings-rules` : null,
  );
  const customActive = useMemo(() => {
    if (!rulesData) return false;
    const champ = rulesData.rules.find((r) => r.scope_type === 'championship');
    return (champ?.config?.scheme ?? rulesData.default?.scheme) === 'custom' || rulesData.rules.some((r) => r.config?.scheme === 'custom');
  }, [rulesData]);

  // Tournament + Sport filters live in the shared header; options come from the
  // fixtures present. Tournament sits first, defaulting to "All tournaments".
  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    fixtures.forEach((f) => { if (f.tournament) map.set(f.tournament.id, f.tournament.name); });
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [fixtures]);
  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    fixtures.forEach((f) => { if (f.sport) set.add(f.sport); });
    return [...set].sort().map((name) => ({ id: name, name }));
  }, [fixtures]);
  /**
   * TOURNAMENT AND SPORT LIVE ON THIS PAGE, NOT IN THE APP HEADER.
   *
   * They used to be published to the shared header bar via `usePageFilters`, which
   * split this screen's filtering across two places: two axes at the top of the
   * window and three (queue, sort, search) in the page. Nobody could see everything
   * that was applied at once, there was no way to clear them together, and on a
   * phone the header pair had to be found behind a separate button from the page's
   * own. One row, one place, one "clear".
   *
   * In the URL like the rest, so a filtered view is a link somebody can send.
   */
  const [tournamentId, setTournamentId] = useUrlState<string>('tournament', '');
  // Several sports at once: a comma list in the URL (?sport=Football,Volleyball).
  const [sportId, setSportId] = useUrlState<string>('sport', '');
  const pickedSports = useMemo(() => (sportId ? sportId.split(',') : []), [sportId]);

  // Institute badges, the same as Schedule: every squad an institute (or batch) fields.
  const [sideKey, setSideKey] = useUrlState<string>('side', '');
  const sides = useMemo(() => {
    const map = new Map<string, TeamSide>();
    for (const f of fixtures) {
      if (!RESULTABLE.has(f.status)) continue;
      for (const s of [f.home, f.away]) {
        if (!s) continue;
        const key = s.org_units?.id ? `u:${s.org_units.id}` : `o:${s.organizations?.short_name || s.organizations?.name || s.id}`;
        const e = map.get(key) ?? { key, label: teamCode(s), full: teamLabel(s), logo: null, ids: new Set<string>(), matches: 0, live: 0 };
        e.ids.add(s.id);
        map.set(key, e);
      }
    }
    for (const f of fixtures) {
      if (!RESULTABLE.has(f.status)) continue;
      for (const e of map.values()) {
        if ((f.home && e.ids.has(f.home.id)) || (f.away && e.ids.has(f.away.id))) { e.matches += 1; if (f.status === 'live') e.live += 1; }
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [fixtures]);
  const pickedSide = sides.find((s) => s.key === sideKey);

  const rows = useMemo(
    () => fixtures.filter((f) =>
      (!tournamentId || f.tournament?.id === tournamentId) &&
      (!pickedSports.length || (!!f.sport && pickedSports.includes(f.sport))) &&
      (!pickedSide || (!!f.home && pickedSide.ids.has(f.home.id)) || (!!f.away && pickedSide.ids.has(f.away.id)))),
    [fixtures, tournamentId, pickedSports, pickedSide],
  );

  // Group matches by their draw (sport + discipline) so the list reads as sections
  // instead of one long flat run. Groups keep first-appearance order; rows keep the
  // scheduled order from the API.
  // Who may open the console for THIS match: the organiser, or the official the
  // match was assigned to. Per match, not per championship, because that is the
  // rule the server enforces (permissions.ts, fixtureScorer) - an official offered
  // a row they are not on would be refused the moment the console loaded.
  //
  // Officials could previously reach Results and see every match, and tap none of
  // them: the whole tab was gated on canManage, which only an organiser holds. The
  // one person actually there to record the score had to leave the event and find
  // the match again in their own Officiating queue.
  const myId = ctx?.user?.id;
  // Organising this match's sport - every sport for an overall organiser, their own
  // for a sport organiser. Mirrors fixtureScorer / sportManager on the server.
  const manages = (f: ResultRow) => canManageSport(f.sport_id);
  // Still opens while archived - the scoring page is read-only then, so the host can view the result.
  const canScore = (f: ResultRow) => manages(f) || (!!myId && f.official_id === myId);

  const open = (f: ResultRow) => {
    if (!canScore(f)) return;
    navigate(`/score/${f.id}`, { state: { from: `/championships/${eventId}/results` } });
  };

  // ---- the scorecard lifecycle -------------------------------------------
  //
  // Locking is what makes a result official: it publishes the standings, advances
  // the bracket, writes the lifetime records and is the ONLY thing certificates can
  // be issued from. The whole state machine already existed on the server and had no
  // control anywhere in the product, so a championship could be played to the end
  // and still have nothing to certify.
  const qc = useQueryClient();
  const preserveScroll = usePreserveScroll();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<ResultRow | null>(null);

  /**
   * WHAT ACTUALLY CHANGED, AND NOTHING ELSE.
   *
   * This used to invalidate EVERY query whose key contained this championship -
   * the fixtures list, the standings, the lock status, the event summary - which
   * refetched the list you are looking at and re-laid it out underneath you.
   *
   * Locking a scorecard changes one fixture. So the fixture is patched in place in
   * the cache: no request, no refetch, no reflow, and the row updates under your
   * finger. Standings genuinely do change, so those are invalidated - they are a
   * different query on a different tab and moving them costs this page nothing.
   */
  const patchFixture = (ids: string[], patch: Partial<ResultRow>) => {
    qc.setQueryData<ResultRow[]>([`/championships/${eventId}/fixtures`], (prev) =>
      (prev ?? []).map((f) => (ids.includes(f.id) ? { ...f, ...patch } : f)));
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === 'string'
          && k.includes(`/championships/${eventId}`)
          && !k.endsWith('/fixtures');
      },
    });
  };

  const locked = (f: ResultRow) => f.scorecard_status === 'locked';
  // What the server will accept, mirrored here so a button is not offered on a
  // scorecard that cannot take it: a played match with a score, a walkover or bye,
  // or a ranking event (whose completeness only the server can judge, from marks).
  const lockable = (f: ResultRow) => !locked(f) && (
    f.status === 'walkover' || f.status === 'bye'
    || (f.round === 'Event' && !f.home && !f.away)
    || ((f.status === 'completed' || f.status === 'confirmed') && f.home_score != null && f.away_score != null)
  );
  /**
   * A SCHEDULED MATCH IS NOT A RESULT.
   *
   * This page is the results queue: what is being played, and what has been played
   * and needs a decision. Everything still marked `scheduled` belongs on Schedule,
   * whatever its kick-off time says - a fixture becomes this page's business when
   * somebody starts it, not when the clock passes it.
   *
   * (An earlier pass hid them by TIME instead, on the reasoning that this morning's
   * unscored match still needs scoring. It does - but it needs its status moving
   * first, and a list that quietly mixes "nobody has started this" into "these need
   * a result" is the thing that made the queue unreadable. The scoring entry point
   * is Schedule, which is where an organiser goes to start a match anyway.)
   *
   * `postponed` and `cancelled` go too: neither will produce a result.
   */
  const started = (f: ResultRow) => RESULTABLE.has(f.status);
  // Byes are not counted: they are not waiting to be started, they will never be.
  const hiddenCount = useMemo(() => rows.filter((f) => !started(f) && f.status !== 'bye').length, [rows]);

  // Only what this organiser may lock: a sport organiser's queue is their sports'.
  const readyRows = useMemo(() => rows.filter(started).filter(lockable).filter(manages), [rows, canManageSport]);
  const lockedCount = useMemo(() => rows.filter(started).filter(locked).length, [rows]);

  /**
   * THE QUEUE, AS A FILTER.
   *
   * Mid-event an organiser is not browsing results, they are working through the
   * ones that need them - and this page offered no way to see only those. "Awaiting
   * review" is the whole job: everything finished, scored, and not yet official.
   * Kept in the URL so coming back from a scorecard returns to the same queue.
   */

  const [queue, setQueue] = useUrlState<string>('show', 'all');

  /**
   * SORTING, WHICH THE MATCH NUMBER IS WHAT MAKES POSSIBLE.
   *
   * The list was fixed in the API's order and offered no control. Mid-event the
   * useful orders are: the running order (match number), what is next (soonest
   * first), and what has been waiting longest for a decision (oldest first). Kept
   * in the URL beside the queue filter so a view can be returned to.
   */
  const [sort] = useUrlState<string>('sort', 'match');
  const sortRows = useMemo(() => {
    const byDate = (a: ResultRow, b: ResultRow, dir: number) => {
      // An unscheduled fixture has no place in a date ordering, so it goes last
      // whichever way the sort runs rather than pretending to be 1 Jan 1970.
      const av = a.scheduled_at ? +new Date(a.scheduled_at) : null;
      const bv = b.scheduled_at ? +new Date(b.scheduled_at) : null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    };
    return (list: ResultRow[]) => [...list].sort((a, b) => {
      if (sort === 'soonest') return byDate(a, b, 1);
      if (sort === 'latest') return byDate(a, b, -1);
      // Default: the running order. Unnumbered last, for the same reason.
      const an = a.match_no ?? Number.MAX_SAFE_INTEGER;
      const bn = b.match_no ?? Number.MAX_SAFE_INTEGER;
      return an - bn;
    });
  }, [sort]);
  const playable = useMemo(() => rows.filter(started), [rows]);
  const visibleRows = useMemo(() => playable.filter((f) => {
    if (queue === 'ready') return lockable(f);
    if (queue === 'locked') return locked(f);
    if (queue === 'pending') return !locked(f) && !lockable(f);
    return true;
  }), [playable, queue]);

  const queueCounts = useMemo(() => ({
    all: playable.length,
    ready: readyRows.length,
    locked: lockedCount,
    pending: playable.length - readyRows.length - lockedCount,
  }), [playable.length, readyRows.length, lockedCount]);

  // Grouped from the FILTERED rows, so choosing "Awaiting review" narrows the
  // sport headings too rather than leaving empty ones behind.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; sport: string | null; sportId: string | null; drawId: string | null; discipline: string | null; icon: string | null; rows: ResultRow[] }>();
    for (const f of sortRows(visibleRows)) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, sportId: f.sport_id ?? null, drawId: f.tournament_discipline_id ?? null, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [visibleRows, sortRows]);

  // Each discipline with pools or a league table has a Point tally tab (its group tables).
  // Opened straight from the Schedule's tie banner via ?tally=<draw id>.
  const [searchParams] = useSearchParams();
  // Ranking sports: the master title tally (top of the sport) and each event's standing.
  const { data: tally } = useApi<TitleTallyResponse>(titleTallyPath(eventId!));
  const eventTallyOf = (drawId: string | null) => (drawId ? tally?.events.find((e) => e.draw_id === drawId) : undefined);
  const sportTallyOf = (sportId: string | null) => tally?.sports.find((s) => s.sport_id === sportId);
  const [tallyOpen, setTallyOpen] = useState<Set<string>>(() => new Set(searchParams.get('tally') ? [searchParams.get('tally')!] : []));
  const hasTally = (drawId: string | null) => !!drawId && (!!eventTallyOf(drawId)
    || fixtures.some((f) => f.tournament_discipline_id === drawId && f.round !== 'Event' && !isKnockoutRound(f.round)));
  // The title tally sits once, at the top of a ranking sport's first section.
  const firstGroupOfSport = (key: string, sportId: string | null) => groups.find((x) => x.sportId === sportId)?.key === key;
  const setTally = (drawId: string, open: boolean) => setTallyOpen((s) => {
    const next = new Set(s);
    if (open) next.add(drawId); else next.delete(drawId);
    return next;
  });

  const matchLabel = (f: ResultRow) =>
    (f.home || f.away) ? `${teamLabel(f.home) || TBD_LABEL} vs ${teamLabel(f.away) || TBD_LABEL}` : (f.discipline ?? f.sport ?? 'This event');

  const lockOne = async (f: ResultRow) => {
    const ok = await confirmDialog({
      title: 'Make this result official?',
      message: `${matchLabel(f)} will be published: standings recalculate, the bracket advances, and the medals behind it become certifiable. Changing it afterwards needs an unlock with a stated reason.`,
      confirmLabel: 'Lock result',
      tone: 'primary',
    });
    if (!ok) return;
    setBusyId(f.id);
    // Everything above the list can change height when a lock lands - the queue
    // banner counts down, and disappears entirely on the last one. Hold the
    // reader's position across it.
    const restore = preserveScroll();
    try {
      await api('POST', `/fixtures/${f.id}/lock`, {});
      patchFixture([f.id], { scorecard_status: 'locked' });
      restore();
      toast.success('Result locked', `${matchLabel(f)} is now official.`);
    } catch (e: any) {
      toast.error('Could not lock this result', e.message);
    } finally { setBusyId(null); }
  };

  const unlockOne = async (f: ResultRow, reason: string) => {
    setBusyId(f.id);
    try {
      await api('POST', `/fixtures/${f.id}/unlock`, { reason });
      patchFixture([f.id], { scorecard_status: 'submitted' });
      setUnlocking(null);
      toast.success('Result unlocked', 'It is back to submitted and can be corrected.');
    } catch (e: any) {
      toast.error('Could not unlock this result', e.message);
    } finally { setBusyId(null); }
  };

  // Finishing a meet is not fifty separate confirmations. The server caps a batch at
  // 50 and reports per-card failures rather than refusing the lot, so a card that is
  // not ready holds up nothing but itself.
  const lockAllReady = async () => {
    const batch = readyRows.slice(0, 50);
    const ok = await confirmDialog({
      title: `Lock ${batch.length} result${batch.length === 1 ? '' : 's'}?`,
      message: `Every finished match in this view becomes official. ${readyRows.length > 50 ? 'The first 50 are locked now - run it again for the rest. ' : ''}Anything that is not ready is reported back and left alone.`,
      confirmLabel: 'Lock them',
      tone: 'primary',
    });
    if (!ok) return;
    setBusyId('bulk');
    const restore = preserveScroll();
    try {
      const r = await api<{ locked: number; failed: number; results: Array<{ id?: string; error?: string }> }>(
        'POST', `/championships/${eventId}/fixtures/lock-bulk`, { fixture_ids: batch.map((f) => f.id) },
      );
      // Only the ones that actually locked. The server reports per-card failures
      // rather than refusing the batch, so marking all 50 locked would show a
      // scorecard as official that the server had refused.
      const failedIds = new Set(r.results.filter((x) => x.error).map((x) => x.id));
      patchFixture(batch.map((f) => f.id).filter((id) => !failedIds.has(id)), { scorecard_status: 'locked' });
      restore();
      const firstError = r.results.find((x) => x.error)?.error;
      if (r.failed > 0) {
        toast.warning(`${r.locked} locked, ${r.failed} could not be`, firstError);
      } else {
        toast.success(`${r.locked} result${r.locked === 1 ? '' : 's'} locked`, 'Certificates can now be issued from them.');
      }
    } catch (e: any) {
      toast.error('Could not lock these results', e.message);
    } finally { setBusyId(null); }
  };

  // The same banner as Schedule, counting the results pipeline instead of the clock.
  const pulseTiles: PulseTile[] = [
    { key: 'pending', label: 'Being played', hint: 'Not finished yet', icon: Radio, count: queueCounts.pending, live: true,
      on: 'bg-rose-500 text-white ring-rose-300', idle: 'text-rose-600 dark:text-rose-300' },
    { key: 'ready', label: 'Awaiting review', hint: 'Finished, not official', icon: Clock, count: queueCounts.ready,
      on: 'bg-amber-400 text-amber-950 ring-amber-200', idle: 'text-amber-600 dark:text-amber-300' },
    { key: 'locked', label: 'Official', hint: 'Locked and published', icon: ShieldCheck, count: queueCounts.locked,
      on: 'bg-emerald-500 text-white ring-emerald-200', idle: 'text-emerald-600 dark:text-emerald-300' },
  ];

  // Sport chips filter the page. Every sport gets one (not just the picked one),
  // counted within the tournament and institute filters. The filter keys on the name.
  const chipSports = useMemo(() => {
    const m = new Map<string, { id: string; name: string; icon: string | null; live: number; total: number }>();
    for (const f of fixtures) {
      if (!f.sport || !RESULTABLE.has(f.status)) continue;
      if (tournamentId && f.tournament?.id !== tournamentId) continue;
      if (pickedSide && !((f.home && pickedSide.ids.has(f.home.id)) || (f.away && pickedSide.ids.has(f.away.id)))) continue;
      const e = m.get(f.sport) ?? { id: f.sport, name: f.sport, icon: f.sport_icon, live: 0, total: 0 };
      e.total += 1; if (f.status === 'live') e.live += 1;
      m.set(f.sport, e);
    }
    return [...m.values()].sort((a, b) => b.live - a.live || a.name.localeCompare(b.name));
  }, [fixtures, tournamentId, pickedSide]);

  // The live strip (moved here from Schedule): matches in play, within the current filters.
  const stripItems = rows.filter((f) => f.status === 'live').map((f) => ({
    f, sport: f.sport ?? 'Sport', icon: f.sport_icon, draw: f.discipline ?? '',
    home: teamLabel(f.home) || TBD_LABEL, away: teamLabel(f.away) || TBD_LABEL, homeShort: teamCode(f.home), awayShort: teamCode(f.away),
  }));

  // Category tabs: each sport's draws in Men > Women > Mixed order, and the pick per sport.
  const [catBySport, setCatBySport] = useState<Record<string, string>>({});
  const categoriesOf = (sid: string | null) => sortByCategory(groups.filter((x) => x.sportId === sid), (x) => x.discipline ?? '');
  const sportOrder = [...new Set(groups.map((x) => x.sportId))];

  // A squad as the shared match card shows it.
  const cardSide = (s: Side | null): CardSide => (s
    ? { id: s.id, full: teamLabel(s) || teamShort(s), short: teamCode(s), org: '', slotLabel: TBD_LABEL }
    : { id: null, full: null, short: null, org: '', slotLabel: TBD_LABEL });

  return (
    <div className="relative space-y-5">
      <BackToTop />
      {/* Background refresh: floats in the corner so it never moves the page. */}
      <div className="pointer-events-none absolute right-0 top-0 z-10" aria-live="polite">
        {isFetching && !isLoading && <Spinner label="Refreshing…" />}
      </div>

      <TeamChips sides={sides} value={sideKey} onChange={setSideKey} />

      {isLoading
        ? <div className="grid h-36 place-items-center rounded-2xl bg-slate-50 dark:bg-slate-800/40"><Spinner /></div>
        : (
          <PulseBanner
            eyebrow={pickedSide ? `${pickedSide.full} · results` : 'Results'}
            done={queueCounts.locked} total={queueCounts.all} unit="results official" pctLabel="of played matches official"
            empty="No results yet - matches appear here once scoring starts."
            tiles={pulseTiles} value={queue === 'all' ? '' : queue} onChange={(k) => setQueue(k || 'all')}
          />
        )}

      {queue === 'all' && (
        <LiveStrip liveOnly items={stripItems} renderAction={(f) => canScore(f) && (
          <Button size="sm" onClick={() => open(f)}>{archived ? 'View' : 'Resume'}</Button>
        )} />
      )}

      {customActive && organises && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Custom points are on.</span> Open a completed match to award each side its championship points - standings won’t update until you do.
        </div>
      )}

      {/* The lock queue, shown only while there is something to do with it. */}
      {organises && readyRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900 sm:px-4 sm:py-3 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="min-w-0 flex-1">
            <span className="font-semibold">
              {readyRows.length} finished {readyRows.length === 1 ? 'result is' : 'results are'} waiting to be made official.
            </span>
            <span className="hidden sm:inline"> Locking publishes the standings and is what certificates are issued from.</span>
          </div>
          <Button size="sm" disabled={busyId !== null || archived} onClick={lockAllReady}>
            <Lock size={14} /> {busyId === 'bulk' ? 'Locking…' : `Lock ${Math.min(readyRows.length, 50)}`}
          </Button>
        </div>
      )}

      <AwardsBoard awards={board?.event ?? []} />

      <SportChips sports={chipSports} value={pickedSports} onChange={(ids) => setSportId(ids.join(','))} />

      {/* Tournament filter and Clear: shown only when there is something to offer. */}
      {(tournamentOptions.length > 1 || tournamentId || sportId || sideKey) && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {tournamentOptions.length > 1 && (
            <div className={cn(PHONE_FILL, 'col-span-2 sm:col-span-1')}>
              <Select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}
                aria-label="Filter by tournament" className="!py-1.5 text-[13px]">
                <option value="">All tournaments</option>
                {tournamentOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
          )}
          {(tournamentId || sportId || sideKey) && (
            <Button size="sm" variant="ghost" onClick={() => { setTournamentId(''); setSportId(''); setSideKey(''); }}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Said once, quietly, so the missing cards are not a mystery. */}
      {hiddenCount > 0 && (
        <p className="t-meta">
          {hiddenCount} scheduled {hiddenCount === 1 ? 'match is' : 'matches are'} not shown here -
          they appear once scoring starts.{' '}
          <Link to={`/championships/${eventId}/schedule`} className="font-medium underline underline-offset-2">
            Score a match from Schedule
          </Link>
        </p>
      )}

      {isLoading ? null : visibleRows.length === 0 ? (
        <EmptyState
          icon={<Flag size={24} />}
          title={fixtures.length === 0 ? 'No fixtures yet'
            : queue === 'ready' ? 'Nothing waiting to be made official'
            : queue === 'locked' ? 'No results are official yet'
            : queue === 'pending' ? 'Everything here has been played'
            : 'No matches for this filter'}
          description={fixtures.length === 0
            ? (organises ? 'Generate draws on the Schedule tab - matches appear here for scoring.' : 'Results will appear here once matches are scheduled and played.')
            : queue !== 'all' ? 'Nothing in this view. Tap the tile again to see everything.'
            : 'Clear the filters or pick another sport.'}
        />
      ) : (
        <div className="space-y-6">
          {sportOrder.map((sid) => {
            // One section per sport, in a fixed order; its picked category renders, the rest are tabs.
            const cats = categoriesOf(sid);
            const g = cats.find((x) => x.key === catBySport[sid ?? '']) ?? cats[0];
            if (!g) return null;
            const firstOfSport = true;
            const sportRows = visibleRows.filter((f) => f.sport_id === g.sportId);
            const sportLive = sportRows.filter((f) => f.status === 'live').length;
            const sportOfficial = sportRows.filter(locked).length;
            const live = g.rows.filter((f) => f.status === 'live').length;
            const official = g.rows.filter(locked).length;
            return (
              <div key={g.key} className="space-y-3">
                {firstOfSport && (
                  <div id={g.sportId ? `sport-${g.sportId}` : undefined} className="scroll-mt-24 space-y-3">
                    {/* The same sport heading as Schedule. */}
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 text-2xl shadow-sm ring-1 ring-brand-200/60 dark:from-brand-500/15 dark:to-brand-500/5 dark:ring-brand-500/20" aria-hidden>
                        {g.icon || '🏅'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{g.sport ?? 'Sport'}</h3>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                          <span>{sportRows.length} result{sportRows.length === 1 ? '' : 's'}</span>
                          {sportLive > 0 && <><span aria-hidden>·</span><span className="font-bold text-rose-600 dark:text-rose-300">{sportLive} live</span></>}
                          <span aria-hidden>·</span><span>{sportOfficial} official</span>
                        </div>
                      </div>
                    </div>
                    {sportHasTally(sportTallyOf(g.sportId)) && <TitleTallyCard tally={sportTallyOf(g.sportId)!} />}
                    {cats.length > 1 && (
                      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
                        <ViewTabs value={g.key} onChange={(k) => setCatBySport((m) => ({ ...m, [g.sportId ?? '']: k }))}
                          options={cats.map((c) => {
                            const live = c.rows.filter((f) => f.status === 'live').length;
                            return {
                              value: c.key, label: c.discipline ?? c.sport ?? 'Matches',
                              badge: live > 0 ? <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white">{live}</span> : undefined,
                            };
                          })} />
                      </div>
                    )}
                  </div>
                )}

                {/* One card per category, like Schedule's draw cards. */}
                <Card className="min-w-0 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {queue === 'all' && g.rows.length > 0 && official < g.rows.length && <ProgressRing done={official} live={live} total={g.rows.length} />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-slate-900 dark:text-slate-100">{g.discipline ?? g.sport ?? 'Matches'}</span>
                          {queue === 'all' && g.rows.length > 0 && official === g.rows.length && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <ShieldCheck size={12} aria-hidden />All official
                            </span>
                          )}
                          {live > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">{live} live</span>}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {g.rows.length} result{g.rows.length === 1 ? '' : 's'} · {official} official
                        </div>
                      </div>
                    </div>
                    {hasTally(g.drawId) && (
                      <Segmented size="sm" value={tallyOpen.has(g.drawId!) ? 'tally' : 'matches'}
                        onChange={(v) => setTally(g.drawId!, v === 'tally')}
                        options={[{ value: 'matches', label: 'Matches' }, {
                          value: 'tally',
                          // Event tallies have no group ties, so only table draws can carry the dot.
                          label: eventTallyOf(g.drawId!) ? 'Point tally'
                            : <TallyTabLabel drawId={g.drawId!} canManage={canManageSport(g.sportId) && !archived} />,
                        }]} />
                    )}
                  </div>

                  {g.drawId && tallyOpen.has(g.drawId) && hasTally(g.drawId)
                    ? (eventTallyOf(g.drawId)
                      ? <EventTallyTable event={eventTallyOf(g.drawId)!} />
                      : <GroupTables drawId={g.drawId} canManage={canManageSport(g.sportId) && !archived} />)
                    : (
                      <div className="@container space-y-2">
                        {g.rows.map((f) => {
                          // Ranking events (swimming/powerlifting) have no head-to-head:
                          // one team-less fixture with round 'Event'.
                          const rankingEvent = f.round === 'Event' && !f.home && !f.away;
                          const walkover = f.status === 'walkover';
                          const completed = f.status === 'completed' || f.status === 'confirmed' || walkover;
                          const isLocked = locked(f);
                          const scored = !rankingEvent && f.home_score != null && f.away_score != null;
                          const homeWon = f.winner_team_id != null && f.winner_team_id === f.home?.id;
                          const awayWon = f.winner_team_id != null && f.winner_team_id === f.away?.id;
                          // Stopped early: marked beside the side that stopped.
                          const early = earlyEndOf(f.live_state);
                          const endNote = early ? earlyEndNoteOf(f.live_state) : null;
                          const summary = scored ? resultSummary(f.sport, f.live_state) : null;
                          const pens = scored ? shootoutOf(f.live_state) : null;
                          const khoEnd = scored ? khoSettlementOf(f.live_state) : null;
                          const scoreNote = (side: 'home' | 'away') => {
                            const won = side === 'home' ? homeWon : awayWon;
                            return (
                              <>
                                {early && scored && !won && (homeWon || awayWon) && (
                                  <span className="shrink-0 text-[11px] font-semibold text-amber-600 dark:text-amber-400" title={endNote ?? undefined}>{EARLY_END_LABEL[early]}</span>
                                )}
                                {pens && (
                                  <span className="shrink-0 text-[11px] font-semibold text-brand-600 dark:text-brand-400" title="Penalty shoot-out">({side === 'home' ? pens.home : pens.away})</span>
                                )}
                              </>
                            );
                          };
                          const footer = (khoEnd || summary || pens || awardsByFixture.has(f.id)) ? (
                            <div className="mt-1 space-y-0.5 text-[11px]">
                              {pens && <div className="font-semibold text-brand-600 dark:text-brand-400">{shootoutLabel(pens.home, pens.away, f.sport)}</div>}
                              {khoEnd && <div className="font-semibold text-brand-600 dark:text-brand-400">{teamLabel(khoEnd.winner === 'A' ? f.home : f.away)} {KHO_END_LABEL[khoEnd.reason]}</div>}
                              {summary && <div className="tabular-nums text-slate-500 dark:text-slate-400">{summary}</div>}
                              {awardsByFixture.has(f.id) && <MatchAwardsLine awards={awardsByFixture.get(f.id)!} />}
                            </div>
                          ) : null;
                          const badge = isLocked
                            ? <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><ShieldCheck size={11} aria-hidden />Official</span>
                            : lockable(f)
                              ? <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Awaiting review</span>
                              : null;
                          return (
                            <MatchCard
                              key={f.id}
                              f={f}
                              home={rankingEvent ? undefined : cardSide(f.home)}
                              away={rankingEvent ? undefined : cardSide(f.away)}
                              eventTitle={rankingEvent ? (f.discipline ?? f.sport ?? 'Event') : undefined}
                              sportName={f.sport ?? undefined}
                              ground={venueLabel(f.ground) || null}
                              canManage={manages(f)}
                              badge={badge}
                              scoreNote={scoreNote}
                              footer={footer}
                              onOpen={canScore(f) ? () => open(f) : undefined}
                              actions={manages(f) && (
                                <>
                                  {isLocked && (
                                    <IconAction expressive short="Reopen" tone="warn"
                                      label="Reopen this result" onClick={() => setUnlocking(f)} disabled={busyId !== null || archived}>
                                      <LockOpen size={15} />
                                    </IconAction>
                                  )}
                                  {lockable(f) && (
                                    <IconAction expressive short={busyId === f.id ? 'Locking…' : 'Lock'} tone="primary"
                                      label="Make this result official"
                                      onClick={() => void lockOne(f)} disabled={busyId !== null || archived} busy={busyId === f.id}>
                                      <Lock size={15} />
                                    </IconAction>
                                  )}
                                  <IconAction
                                    expressive
                                    short={isLocked ? 'View' : completed ? 'Edit' : 'Record'}
                                    label={isLocked ? 'View scorecard' : completed ? 'Edit result' : 'Record result'}
                                    tone={!isLocked && !completed ? 'primary' : undefined}
                                    onClick={() => open(f)}>
                                    {isLocked ? <Eye size={15} /> : completed ? <Pencil size={15} /> : <ChevronRight size={16} />}
                                  </IconAction>
                                </>
                              )}
                            />
                          );
                        })}
                      </div>
                    )}
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {unlocking && (
        <UnlockModal
          label={matchLabel(unlocking)}
          busy={busyId === unlocking.id}
          onClose={() => setUnlocking(null)}
          onConfirm={(reason) => void unlockOne(unlocking, reason)}
        />
      )}
    </div>
  );
}
