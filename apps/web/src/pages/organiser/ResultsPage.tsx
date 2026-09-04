import { useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2, ChevronRight, Clock, Eye, Flag, Lock, LockOpen, Pencil, Radio, ShieldCheck, Users,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEvent } from './EventLayout';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { titleCase, whenLabel } from '../../lib/format';
import {
  Badge, Button, Card, EmptyState, FilterChips, Modal, Select, Spinner, StatusBadge, Textarea, cn, confirmDialog, toast,
} from '../../components/ui';
import { useUrlState, usePreserveScroll } from '../../components/primitives';

// A flattened fixture row from GET /championships/:id/fixtures.
interface ResultRow {
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
}

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
    .replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '··';
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
 * Status as a glyph plus one word, rather than a full badge.
 *
 * A StatusBadge is the right density beside a match on a desktop table. On a phone
 * it competed with the score for the same line, so this is the same information at a
 * third of the width - and colour is never the only signal, because the glyph
 * differs too.
 */
function StatusGlyph({ locked, individual, status }: { locked: boolean; individual: boolean; status: string }) {
  const done = status === 'completed' || status === 'confirmed';
  const [Icon, text, cls] = locked
    ? [ShieldCheck, 'Official', 'text-emerald-600 dark:text-emerald-400']
    : individual
      ? [Users, 'Individual', 'text-slate-500 dark:text-slate-400']
      : done
        ? [CheckCircle2, 'Played', 'text-emerald-600 dark:text-emerald-400']
        // 'live' is the value the database actually stores - FIXTURE_STATUS is
        // scheduled | live | completed | postponed | cancelled | bye | walkover.
        // This read 'in_progress', which is not one of them, so every match in play
        // fell through to the grey "Scheduled" clock.
        : status === 'live'
          ? [Radio, 'Live', 'text-[var(--live)]']
          : status === 'walkover' || status === 'bye'
            ? [CheckCircle2, titleCase(status), 'text-slate-500 dark:text-slate-400']
            : [Clock, titleCase(status || 'Scheduled'), 'text-slate-400 dark:text-slate-500'];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-wide', cls)}
      title={text}
    >
      <Icon size={14} />
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}

/**
 * The statuses this page is about: being played, or played.
 *
 * `scheduled` is Schedule's business, and `postponed` / `cancelled` will never
 * produce a result.
 */
const RESULTABLE = new Set(['live', 'completed', 'walkover', 'bye']);

const teamShort = (t: Side | null) =>
  t?.short_name || t?.org_units?.code || t?.organizations?.short_name || teamLabel(t);

// The dark square chip used for each side of a match (e.g. "INF", "WIP"). When the
// side isn't decided yet (knockout placeholder / bye), show a clear "TBD" chip so
// the match still reads as a listed fixture instead of an empty row.
function TeamChip({ team, winner }: { team: ResultRow['home']; winner?: boolean }) {
  if (!team) {
    return (
      <span
        className="grid h-9 min-w-9 place-items-center rounded-lg border border-dashed border-slate-300 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500"
        title="To be decided"
      >
        TBD
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg font-bold tracking-tight',
        // Four characters need the smaller size to stay inside the square.
        teamCode(team).length > 3 ? 'text-[9px]' : 'text-[11px]',
        winner ? 'bg-brand-500 text-white' : 'bg-slate-900 text-slate-100 dark:bg-slate-800',
      )}
      title={team.org_units?.name ? `${team.name} · ${team.org_units.name}` : team.name}
    >
      {teamCode(team)}
    </span>
  );
}

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
  const { eventId, canManage } = useEvent();
  const { ctx } = useAuth();
  const navigate = useNavigate();
  const { data: fixtures = [], isLoading, isFetching } = useApi<ResultRow[]>(`/championships/${eventId}/fixtures`);
  // Is this championship awarding custom (hand-entered) points anywhere? If so, the
  // organiser is reminded to add points per result. Rules are organiser-only.
  const { data: rulesData } = useApi<{ default: { scheme: string }; rules: { scope_type: string; config: { scheme: string } }[] }>(
    canManage ? `/championships/${eventId}/standings-rules` : null,
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
  const [sportId, setSportId] = useUrlState<string>('sport', '');

  const rows = useMemo(
    () => fixtures.filter((f) =>
      (!tournamentId || f.tournament?.id === tournamentId) &&
      (!sportId || f.sport === sportId)),
    [fixtures, tournamentId, sportId],
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
  const canScore = (f: ResultRow) => canManage || (!!myId && f.official_id === myId);
  const scoresAny = canManage || rows.some(canScore);

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
  const hiddenCount = useMemo(() => rows.length - rows.filter(started).length, [rows]);

  const readyRows = useMemo(() => rows.filter(started).filter(lockable), [rows]);
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
  const [sort, setSort] = useUrlState<string>('sort', 'match');
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
    const map = new Map<string, { key: string; sport: string | null; discipline: string | null; icon: string | null; rows: ResultRow[] }>();
    for (const f of sortRows(visibleRows)) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [visibleRows, sortRows]);

  const matchLabel = (f: ResultRow) =>
    (f.home || f.away) ? `${teamLabel(f.home) || 'TBD'} vs ${teamLabel(f.away) || 'TBD'}` : (f.discipline ?? f.sport ?? 'This event');

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="hidden text-sm text-slate-500 sm:block dark:text-slate-400">
          {canManage
            ? 'Tap a match to enter its result. Standings recalculate instantly.'
            : scoresAny
              ? 'Tap a match you are officiating to record its result.'
              : 'Live scores and final results across the championship.'}
        </p>
        {/* Background refresh keeps the list visible while the latest scores are
            pulled. The slot holds its width whether or not it is showing anything:
            an indicator that appears and disappears in a flex row was one of the
            things nudging the list under the reader between renders. */}
        <div className="min-w-[7.5rem] shrink-0 text-right" aria-live="polite">
          {isFetching && !isLoading && <Spinner label="Refreshing…" />}
        </div>
      </div>

      {customActive && canManage && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Custom points are on.</span> Open a completed match to award each side its championship points - standings won’t update until you do.
        </div>
      )}

      {/* The lock queue. Shown only while there is something to do with it - an
          organiser with nothing finished does not need to be told a number. */}
      {canManage && readyRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2.5 text-sm text-brand-800 sm:px-4 sm:py-3 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <div className="min-w-0 flex-1">
            <span className="font-semibold">
              {readyRows.length} finished {readyRows.length === 1 ? 'result is' : 'results are'} waiting to be made official.
            </span>
            {/* The explanation is for the first time somebody sees this, not the
                fiftieth, and on a phone it was three of the banner's four lines. */}
            <span className="hidden sm:inline">
              {' '}Locking publishes the standings and is what certificates are issued from.
            </span>
            {lockedCount > 0 && <span className="text-brand-600/80 dark:text-brand-300/70"> {lockedCount} already locked.</span>}
          </div>
          <Button size="sm" disabled={busyId !== null} onClick={lockAllReady}>
            <Lock size={14} /> {busyId === 'bulk' ? 'Locking…' : `Lock ${Math.min(readyRows.length, 50)}`}
          </Button>
        </div>
      )}

      {/* The queue. An organiser mid-event wants the ones that need them. */}
      {playable.length > 0 && (
        <FilterChips
          label="Show"
          value={queue}
          onChange={setQueue}
          options={[
            { key: 'all', label: 'All matches', count: queueCounts.all },
            { key: 'ready', label: 'Awaiting review', count: queueCounts.ready },
            { key: 'pending', label: 'Being played', count: queueCounts.pending },
            { key: 'locked', label: 'Official', count: queueCounts.locked },
          ]}
        />
      )}

      {/* Tournament, sport and sort - the axes that used to be split between the app
          header and here. One row, wrapping, on the page's own margin. */}
      {(tournamentOptions.length > 0 || sportOptions.length > 0 || playable.length > 1) && (
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          {tournamentOptions.length > 0 && (
            <Select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}
              aria-label="Filter by tournament" className="!py-1.5 text-[13px]">
              <option value="">All tournaments</option>
              {tournamentOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
          {sportOptions.length > 0 && (
            <Select value={sportId} onChange={(e) => setSportId(e.target.value)}
              aria-label="Filter by sport" className="!py-1.5 text-[13px]">
              <option value="">All sports</option>
              {sportOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
          {(tournamentId || sportId) && (
            <Button size="sm" variant="ghost" onClick={() => { setTournamentId(''); setSportId(''); }}>
              Clear
            </Button>
          )}
          {playable.length > 1 && (
            <div className="ml-auto flex items-center gap-2">
              <label className="t-eyebrow" htmlFor="results-sort">Sort</label>
              <Select id="results-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="!py-1.5 text-[13px]">
                <option value="match">Match number</option>
                <option value="soonest">Soonest first</option>
                <option value="latest">Latest first</option>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Said once, quietly, so the missing cards are not a mystery - and now with a
          way to act on it. This used to read "start them from Schedule", which was a
          dead end: Schedule had no scoring entry point, so the only way to start a
          match was to edit its status field by hand. Schedule has a Score button on
          every row now, and this links straight there. */}
      {hiddenCount > 0 && (
        <p className="t-meta">
          {hiddenCount} scheduled {hiddenCount === 1 ? 'match is' : 'matches are'} not shown here —
          they appear once scoring starts.{' '}
          <Link to={`/championships/${eventId}/schedule`} className="font-medium underline underline-offset-2">
            Score a match from Schedule
          </Link>
        </p>
      )}

      {isLoading ? <Spinner /> : visibleRows.length === 0 ? (
        <EmptyState
          icon={<Flag size={24} />}
          title={fixtures.length === 0 ? 'No fixtures yet'
            : queue === 'ready' ? 'Nothing waiting to be made official'
            : queue === 'locked' ? 'No results are official yet'
            : queue === 'pending' ? 'Everything here has been played'
            : 'No matches for this sport'}
          description={fixtures.length === 0
            ? (canManage ? 'Generate draws on the Schedule tab - matches appear here for scoring.' : 'Results will appear here once matches are scheduled and played.')
            : queue !== 'all' ? 'Nothing in this view. Choose "All matches" to see the rest.'
            : 'Clear the sport filter or pick another sport.'}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-base">{g.icon ?? '◇'}</span>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {g.sport ?? 'Sport'}
                  {g.discipline && <span className="font-medium text-slate-400 dark:text-slate-500"> · {g.discipline}</span>}
                </h3>
                <Badge tone="slate">{g.rows.length}</Badge>
              </div>

              {g.rows.map((f) => {
                const individual = f.entry_type === 'individual';
                // Ranking events (powerlifting/swimming/athletics) have no head-to-head
                // matchup - the generator emits one team-less fixture with round 'Event'.
                // Showing "TBD vs TBD" there is wrong: there's no opponent to decide, so
                // we show the discipline name + a Ranking event tag instead.
                const rankingEvent = f.round === 'Event' && !f.home && !f.away;
                const completed = f.status === 'completed' || f.status === 'confirmed';
                const isLocked = locked(f);
                const scored = !individual && !rankingEvent && f.home_score != null && f.away_score != null;
                const homeWon = f.winner_team_id != null && f.winner_team_id === f.home?.id;
                const awayWon = f.winner_team_id != null && f.winner_team_id === f.away?.id;
                return (
                  // TWO LAYOUTS, NOT ONE THAT SCROLLS.
                  //
                  // This used to be a single row that was wider than a phone, made
                  // into a horizontal scroll container with the actions pinned to the
                  // right edge. That is not a layout - it is a desktop row you have
                  // to drag, and the two things an organiser needs mid-event (the
                  // score and the lock) were the two furthest off-screen.
                  //
                  // Below sm it is a scoreboard: meta line, then one line per side
                  // with the squad's short name and its score, then the actions. The
                  // shape everybody already reads on a sports app, and it fits 390px
                  // with room left over. At sm+ the original three-column grid is
                  // untouched.
                  <Card key={f.id} interactive={canScore(f)} onClick={() => open(f)} className="block p-0 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-x-4 lg:p-4">

                    {/* ---------------- phone ---------------- */}
                    <div className="flex flex-col gap-1 px-3 py-2 lg:hidden">
                      {/* Round, status and actions on ONE line. They were a header
                          row and a footer row with a divider between them, which
                          cost ~70px per card - and there are 224 cards. Nothing is
                          dropped: the actions are icons, so all three fit beside a
                          status that is itself a glyph and one word. */}
                      <div className="flex items-center gap-2">
                        {/* The number first: it is the handle somebody uses out loud
                            ("score match 14"), and two team names are not unique in
                            a round robin where the same pair meets twice. */}
                        {f.match_no != null && (
                          <span className="t-num shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            #{f.match_no}
                          </span>
                        )}
                        <span className="t-meta min-w-0 flex-1 truncate text-[12px]">
                          {[f.round || (rankingEvent ? 'Event' : ''), whenLabel(f.scheduled_at)].filter(Boolean).join(' · ')}
                        </span>
                        <StatusGlyph locked={isLocked} individual={individual} status={f.status} />
                        {canManage && (
                          <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {/* `expressive` reveals the word from sm up. This card
                                layout now serves phones AND tablets, and a tablet
                                has the width for "Reopen" beside the glyph - only a
                                390px row genuinely cannot spare it. */}
                            {isLocked && (
                              <IconAction expressive short="Reopen" tone="warn"
                                label="Reopen this result" onClick={() => setUnlocking(f)} disabled={busyId !== null}>
                                <LockOpen size={16} />
                              </IconAction>
                            )}
                            {lockable(f) && (
                              <IconAction expressive short={busyId === f.id ? 'Locking…' : 'Lock'} tone="primary"
                                label="Make this result official"
                                onClick={() => void lockOne(f)} disabled={busyId !== null} busy={busyId === f.id}>
                                <Lock size={16} />
                              </IconAction>
                            )}
                            <IconAction
                              expressive
                              short={isLocked ? 'View' : completed ? 'Edit' : 'Record'}
                              label={isLocked ? 'View scorecard' : completed ? 'Edit result' : 'Record result'}
                              tone={!isLocked && !completed ? 'primary' : undefined}
                              onClick={() => open(f)}>
                              {isLocked ? <Eye size={16} /> : completed ? <Pencil size={16} /> : <ChevronRight size={17} />}
                            </IconAction>
                          </span>
                        )}
                      </div>

                      {individual || rankingEvent ? (
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                            {f.discipline ?? f.sport ?? 'Event'}
                          </span>
                          <Badge tone="violet">Ranking</Badge>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {([[f.home, f.home_score, homeWon], [f.away, f.away_score, awayWon]] as const).map(([side, score, won], i) => (
                            <div key={i} className="flex items-baseline gap-2.5">
                              {/* No chip here. It carried a 3-letter slice of the
                                  same name the text now shows in full-short form -
                                  "BT23" beside "BT2023" - so it was 44px spent
                                  saying the thing twice. The winner is carried by
                                  weight instead, which needs no width at all. */}
                              <span
                                className={cn(
                                  'min-w-0 flex-1 truncate text-[15px] leading-6 tracking-tight',
                                  won ? 'font-extrabold text-slate-900 dark:text-slate-50' : 'font-semibold text-slate-600 dark:text-slate-300',
                                )}
                                title={teamLabel(side)}
                              >
                                {/* THE FULL NAME, TRUNCATED - not the abbreviation.
                                    The row is `min-w-0 flex-1 truncate`, so a long
                                    name ellipsises and can never push the score off
                                    the card; that is what made the horizontal scroll
                                    unnecessary, not shortening the text. With the
                                    abbreviation in this slot a 390px row read "DB"
                                    against "PB" with 200px of nothing between them -
                                    less information than the full name AND worse
                                    looking. The short name stays the fallback for a
                                    squad that has no full name to show. */}
                                {side ? (teamLabel(side) || teamShort(side)) : 'TBD'}
                              </span>
                              <span
                                className={cn(
                                  't-num shrink-0 text-[17px] leading-6 tabular-nums',
                                  won ? 'font-extrabold text-slate-900 dark:text-slate-50' : 'font-bold text-slate-700 dark:text-slate-300',
                                )}
                              >
                                {scored ? score : <span className="text-slate-300 dark:text-slate-600">·</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                    </div>

                    {/* ---------------- lg+ : the three-column row ---------------- */}
                    <div className="hidden items-center gap-x-2 lg:contents">
                    {/* Left cell (1fr): match type — always shown in full.
                        Both outer cells are equal 1fr so the auto center column is
                        always physically centered regardless of their content widths. */}
                    <div className="min-w-0 text-xs text-slate-500 dark:text-slate-400" title={f.round ?? undefined}>
                      <div className="flex items-center gap-1.5">
                        {f.match_no != null && (
                          <span className="t-num rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            #{f.match_no}
                          </span>
                        )}
                        <span className="truncate font-semibold uppercase tracking-wide">{f.round || '-'}</span>
                      </div>
                      {/* When it is played. It was on the Schedule tab and nowhere
                          near the result being recorded, which is where somebody
                          checking "is this the right match?" is standing. */}
                      <div className="mt-0.5 truncate">{whenLabel(f.scheduled_at)}</div>
                    </div>

                    {/* Center cell (auto): home · score · away. Ranking/event fixtures
                        have no head-to-head matchup, so show the event (discipline) name
                        instead of two empty team chips. */}
                    <div className="flex items-center gap-2 sm:gap-3">
                      {individual || rankingEvent ? (
                        <div className="flex w-[19rem] items-center justify-center gap-2 text-center sm:w-[27rem]">
                          <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200" title={f.discipline ?? f.sport ?? undefined}>
                            {f.discipline ?? f.sport ?? 'Event'}
                          </span>
                          <Badge tone="violet">Ranking event</Badge>
                        </div>
                      ) : (
                        <>
                          <div className="flex w-36 items-center justify-end gap-2 sm:w-52">
                            {f.home && <span className="truncate text-right text-sm font-medium text-slate-700 dark:text-slate-200" title={teamLabel(f.home)}>{teamLabel(f.home)}</span>}
                            <TeamChip team={f.home} winner={f.winner_team_id != null && f.winner_team_id === f.home?.id} />
                          </div>
                          <span className="w-16 shrink-0 whitespace-nowrap text-center text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {scored ? `${f.home_score}–${f.away_score}` : <span className="text-slate-300 dark:text-slate-600">··</span>}
                          </span>
                          <div className="flex w-36 items-center gap-2 sm:w-52">
                            <TeamChip team={f.away} winner={f.winner_team_id != null && f.winner_team_id === f.away?.id} />
                            {f.away && <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={teamLabel(f.away)}>{teamLabel(f.away)}</span>}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Right cell (1fr): status + actions.
                        THE SAME VOCABULARY AS THE PHONE, SPOKEN MORE FULLY. The
                        phone gives each action a glyph because that is all that
                        fits; here the glyph keeps its word beside it. Same
                        components, same icons, same colours - so somebody who
                        learns "🔓 reopens this" on a laptop recognises the bare
                        glyph on their phone at the pitch.
                        "Record" was a bare text link and the only affordance that
                        did not look like a button, which on the most-used action of
                        the page was the wrong way round. */}
                    <div className="flex items-center justify-end gap-2">
                      {isLocked ? (
                        // The lock outranks the match status here: "completed" and
                        // "official" are different claims, and this cell can only
                        // lead with one of them.
                        <StatusBadge status="locked" label="Locked" />
                      ) : individual ? (
                        <StatusBadge status="" label="Individual" />
                      ) : (
                        <StatusBadge status={f.status} />
                      )}
                      {/* Every one of these stops the click reaching the card -
                          otherwise locking a result also navigates away from the
                          list. */}
                      {canManage && isLocked && (
                        <IconAction expressive short="Reopen" tone="warn"
                          label="Reopen this result" disabled={busyId !== null}
                          onClick={() => setUnlocking(f)}>
                          <LockOpen size={15} />
                        </IconAction>
                      )}
                      {canManage && lockable(f) && (
                        <IconAction expressive short={busyId === f.id ? 'Locking…' : 'Lock'} tone="primary"
                          label="Make this result official" disabled={busyId !== null} busy={busyId === f.id}
                          onClick={() => void lockOne(f)}>
                          <Lock size={15} />
                        </IconAction>
                      )}
                      {canManage && (
                        <IconAction
                          expressive
                          short={isLocked ? 'View' : completed ? 'Edit' : 'Record'}
                          tone={!isLocked && !completed ? 'primary' : undefined}
                          label={isLocked ? 'View scorecard' : completed ? 'Edit result' : 'Record result'}
                          onClick={() => open(f)}
                        >
                          {isLocked ? <Eye size={15} /> : completed ? <Pencil size={15} /> : <ChevronRight size={16} />}
                        </IconAction>
                      )}
                    </div>
                    </div>
                  </Card>
                );
              })}
            </section>
          ))}
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
