import { useMemo, useState } from 'react';
import { Flag, Lock, LockOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEvent } from './EventLayout';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { usePageFilters } from '../../lib/filters';
import { useApi } from '../../lib/hooks';
import {
  Badge, Button, Card, EmptyState, Modal, Spinner, StatusBadge, Textarea, cn, confirmDialog, toast,
} from '../../components/ui';

// A flattened fixture row from GET /championships/:id/fixtures.
interface ResultRow {
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
  const { tournamentId, sportId } = usePageFilters({
    tournaments: tournamentOptions.length ? tournamentOptions : undefined,
    sports: sportOptions.length ? sportOptions : undefined,
  });

  const rows = useMemo(
    () => fixtures.filter((f) =>
      (!tournamentId || f.tournament?.id === tournamentId) &&
      (!sportId || f.sport === sportId)),
    [fixtures, tournamentId, sportId],
  );

  // Group matches by their draw (sport + discipline) so the list reads as sections
  // instead of one long flat run. Groups keep first-appearance order; rows keep the
  // scheduled order from the API.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; sport: string | null; discipline: string | null; icon: string | null; rows: ResultRow[] }>();
    for (const f of rows) {
      const key = `${f.sport ?? ''}__${f.discipline ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { key, sport: f.sport, discipline: f.discipline, icon: f.sport_icon, rows: [] }; map.set(key, g); }
      g.rows.push(f);
    }
    return [...map.values()];
  }, [rows]);

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<ResultRow | null>(null);

  const refreshAfterLock = () => qc.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).includes(`/championships/${eventId}`),
  });

  const locked = (f: ResultRow) => f.scorecard_status === 'locked';
  // What the server will accept, mirrored here so a button is not offered on a
  // scorecard that cannot take it: a played match with a score, a walkover or bye,
  // or a ranking event (whose completeness only the server can judge, from marks).
  const lockable = (f: ResultRow) => !locked(f) && (
    f.status === 'walkover' || f.status === 'bye'
    || (f.round === 'Event' && !f.home && !f.away)
    || ((f.status === 'completed' || f.status === 'confirmed') && f.home_score != null && f.away_score != null)
  );
  const readyRows = useMemo(() => rows.filter(lockable), [rows]);
  const lockedCount = useMemo(() => rows.filter(locked).length, [rows]);

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
    try {
      await api('POST', `/fixtures/${f.id}/lock`, {});
      await refreshAfterLock();
      toast.success('Result locked', `${matchLabel(f)} is now official.`);
    } catch (e: any) {
      toast.error('Could not lock this result', e.message);
    } finally { setBusyId(null); }
  };

  const unlockOne = async (f: ResultRow, reason: string) => {
    setBusyId(f.id);
    try {
      await api('POST', `/fixtures/${f.id}/unlock`, { reason });
      await refreshAfterLock();
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
    try {
      const r = await api<{ locked: number; failed: number; results: Array<{ error?: string }> }>(
        'POST', `/championships/${eventId}/fixtures/lock-bulk`, { fixture_ids: batch.map((f) => f.id) },
      );
      await refreshAfterLock();
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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canManage
            ? 'Tap a match to enter its result. Standings recalculate instantly.'
            : scoresAny
              ? 'Tap a match you are officiating to record its result.'
              : 'Live scores and final results across the championship.'}
        </p>
        {/* Background refresh (e.g. returning here right after a sign-off) keeps the
            list visible but signals that the latest scores are being pulled. */}
        {isFetching && !isLoading && <Spinner label="Refreshing…" />}
      </div>

      {customActive && canManage && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Custom points are on.</span> Open a completed match to award each side its championship points - standings won’t update until you do.
        </div>
      )}

      {/* The lock queue. Shown only while there is something to do with it - an
          organiser with nothing finished does not need to be told a number. */}
      {canManage && readyRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <div>
            <span className="font-semibold">
              {readyRows.length} finished {readyRows.length === 1 ? 'result is' : 'results are'} waiting to be made official.
            </span>{' '}
            Locking publishes the standings and is what certificates are issued from.
            {lockedCount > 0 && <span className="text-brand-600/80 dark:text-brand-300/70"> {lockedCount} already locked.</span>}
          </div>
          <Button size="sm" disabled={busyId !== null} onClick={lockAllReady}>
            <Lock size={14} /> {busyId === 'bulk' ? 'Locking…' : `Lock ${Math.min(readyRows.length, 50)}`}
          </Button>
        </div>
      )}

      {isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState
          icon={<Flag size={24} />}
          title={fixtures.length === 0 ? 'No fixtures yet' : 'No matches for this sport'}
          description={fixtures.length === 0
            ? (canManage ? 'Generate draws on the Schedule tab - matches appear here for scoring.' : 'Results will appear here once matches are scheduled and played.')
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
                return (
                  // On phone the row content is wider than the viewport, so the card
                  // becomes a horizontal scroll container and the status/action column
                  // is pinned (sticky) so it stays reachable. The inner wrapper uses
                  // `sm:contents` so on larger screens the three cells fall back into
                  // the original 1fr / auto / 1fr grid unchanged.
                  <Card key={f.id} interactive={canScore(f)} onClick={() => open(f)} className="block overflow-x-auto sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-4 sm:overflow-visible sm:p-4">
                    <div className="flex w-max items-center gap-x-2 py-3 pl-3 sm:contents">
                    {/* Left cell (1fr): match type — always shown in full.
                        Both outer cells are equal 1fr so the auto center column is
                        always physically centered regardless of their content widths. */}
                    <div className="shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" title={f.round ?? undefined}>
                      {f.round || '-'}
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

                    {/* Right cell (1fr): status + actions. Pinned to the right edge on
                        phone (sticky) so it stays visible while the match info scrolls
                        underneath; reverts to a plain grid cell from sm up. */}
                    <div className="sticky right-0 z-10 flex items-center justify-end gap-2 self-stretch bg-white pl-3 pr-3 shadow-[-8px_0_8px_-6px_rgba(15,23,42,0.08)] dark:bg-slate-900 sm:static sm:z-auto sm:self-auto sm:gap-3 sm:bg-transparent sm:pl-0 sm:pr-0 sm:shadow-none dark:sm:bg-transparent">
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
                      {/* The buttons live inside a clickable card, so every one of
                          them has to stop the click reaching it - otherwise locking
                          a result also navigates away from the list. */}
                      {canManage && isLocked && (
                        <Button
                          size="sm" variant="ghost" disabled={busyId !== null}
                          onClick={(e) => { e.stopPropagation(); setUnlocking(f); }}
                        >
                          <LockOpen size={14} /> Unlock
                        </Button>
                      )}
                      {canManage && lockable(f) && (
                        <Button
                          size="sm" disabled={busyId !== null}
                          onClick={(e) => { e.stopPropagation(); void lockOne(f); }}
                        >
                          <Lock size={14} /> {busyId === f.id ? 'Locking…' : 'Lock'}
                        </Button>
                      )}
                      {canManage && (
                        <span className="shrink-0 text-right text-sm font-semibold text-brand-600 dark:text-brand-300">
                          {isLocked ? 'View' : completed ? 'Edit' : 'Record →'}
                        </span>
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
