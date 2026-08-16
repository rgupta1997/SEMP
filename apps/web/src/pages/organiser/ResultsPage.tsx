import { useMemo, useState, type ReactNode } from 'react';
import { Flag, Lock, LockOpen, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEvent } from './EventLayout';
import { usePageFilters } from '../../lib/filters';
import { useApi, fmtDate } from '../../lib/hooks';
import { api } from '../../lib/api';
import {
  Badge, BulkBar, Button, Card, Checkbox, EmptyState, Field, Modal, Spinner, StatusBadge, Textarea,
  cn, confirmDialog, toast,
} from '../../components/ui';

// A flattened fixture row from GET /championships/:id/fixtures.
interface ResultRow {
  id: string;
  status: string;
  // Where the paperwork has got to: draft -> submitted -> locked. 'locked' is the
  // only state that means Verified; everything else is provisional.
  scorecard_status: 'draft' | 'submitted' | 'locked';
  // > 0 once the card has been unlocked for a correction at least once; amended_at
  // is the date that correction landed, and is what the public notice shows.
  lock_version: number;
  amended_at: string | null;
  round: string | null;
  entry_type: string | null;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  sport: string | null;
  sport_icon: string | null;
  tournament: { id: string; name: string } | null;
  discipline: string | null;
  home: { id: string; name: string; organizations?: { short_name?: string | null; name?: string | null } | null } | null;
  away: { id: string; name: string; organizations?: { short_name?: string | null; name?: string | null } | null } | null;
}

const teamCode = (t: ResultRow['home']) =>
  (t?.organizations?.short_name || t?.name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || '··';

// Full label shown next to the chip - the organization's name, else the team name.
const teamLabel = (t: ResultRow['home']) =>
  t?.organizations?.name || t?.organizations?.short_name || t?.name || '';

// The dark square chip used for each side of a match (e.g. "INF", "WIP"). When the
// side isn't decided yet (knockout placeholder / bye), show a clear "TBD" chip so
// the match still reads as a listed fixture instead of an empty row.
function TeamChip({ team, winner }: { team: ResultRow['home']; winner?: boolean }) {
  if (!team) {
    return (
      <span
        className="grid h-9 min-w-9 place-items-center rounded-lg border border-dashed border-slate-300 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500"
        title="To be decided"
      >
        TBD
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg text-[11px] font-bold tracking-tight',
        winner ? 'bg-brand-500 text-white' : 'bg-slate-900 text-slate-100 dark:bg-slate-800',
      )}
      title={team.name}
    >
      {teamCode(team)}
    </span>
  );
}

// ONE chip for where the paperwork has got to, not four competing ones.
//
// The row used to carry the scorecard state, a long "RESULT AMENDED <date>" pill,
// the match status and the action buttons all side by side, which read as noise
// rather than as a state. The correction is now a quiet marker on the state chip
// itself - it qualifies the verification, so that is where it belongs - and the
// date moves into the tooltip and the actions dialog, where there is room to say
// it properly.
function ScorecardBadge({ status, amended, amendedAt }:
  { status: ResultRow['scorecard_status']; amended?: boolean; amendedAt?: string | null }) {
  const tone = status === 'locked' ? 'green' : status === 'submitted' ? 'amber' : 'slate';
  const label = status === 'locked' ? '✓ Verified' : status === 'submitted' ? 'Ready to lock' : 'Draft';
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={amended ? `Corrected after it was first made official${amendedAt ? ` on ${fmtDate(amendedAt)}` : ''}. The correction is on the record.` : undefined}
    >
      <Badge tone={tone}>{label}</Badge>
      {amended && (
        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
          Amended
        </span>
      )}
    </span>
  );
}

// One row action, as a full-width button with the consequence written underneath.
// An organiser choosing between "lock" and "send back" is choosing between two
// very different things, and a bare verb does not say which.
function ActionRow({ icon, title, detail, tone = 'default', disabled, onClick }: {
  icon: ReactNode; title: string; detail: string;
  tone?: 'default' | 'primary' | 'danger'; disabled?: boolean; onClick: () => void;
}) {
  const ring = tone === 'danger'
    ? 'hover:border-rose-300 dark:hover:border-rose-500/40'
    : tone === 'primary'
      ? 'hover:border-brand-300 dark:hover:border-brand-500/40'
      : 'hover:border-slate-300 dark:hover:border-slate-600';
  const iconTone = tone === 'danger' ? 'text-rose-600 dark:text-rose-400'
    : tone === 'primary' ? 'text-brand-600 dark:text-brand-300'
      : 'text-slate-500 dark:text-slate-400';
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border border-slate-200 p-3 text-left transition dark:border-slate-700',
        'disabled:cursor-not-allowed disabled:opacity-50', ring,
      )}
    >
      <span className={cn('mt-0.5 shrink-0', iconTone)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{detail}</span>
      </span>
    </button>
  );
}

// Everything you can do to one scorecard, in one popup.
//
// Every action is performed from in here rather than from a button on the row:
// locking publishes a result as official, and sending one back takes it off a
// scorer's finished pile. Both deserve a screen that says what they mean, and
// neither belongs behind a 13px icon in a crowded row.
type Step = 'actions' | 'lock' | 'unlock' | 'retract' | 'submit';

function ScorecardDialog({ fixture, onOpenConsole, onClose, onDone }: {
  fixture: ResultRow; onOpenConsole: () => void; onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState<Step>('actions');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const locked = fixture.scorecard_status === 'locked';
  const submitted = fixture.scorecard_status === 'submitted';
  const draft = fixture.scorecard_status === 'draft';
  const scored = fixture.home_score != null && fixture.away_score != null;
  const tooShort = reason.trim().length < 5;

  const run = async (verb: string, body: unknown, ok: [string, string]) => {
    setBusy(true);
    try {
      await api('POST', `/fixtures/${fixture.id}/${verb}`, body);
      toast.success(ok[0], ok[1]);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const title = locked ? 'Verified result' : submitted ? 'Scorecard ready to lock' : 'Scorecard';
  const matchup = fixture.home || fixture.away
    ? `${teamLabel(fixture.home) || 'TBD'} vs ${teamLabel(fixture.away) || 'TBD'}`
    : fixture.discipline ?? fixture.sport ?? 'Event';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{matchup}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {[fixture.sport, fixture.discipline, fixture.round].filter(Boolean).join(' · ')}
          {scored && ` — ${fixture.home_score}–${fixture.away_score}`}
        </p>
        {fixture.lock_version > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Corrected after it was first made official{fixture.amended_at ? ` on ${fmtDate(fixture.amended_at)}` : ''}.
            The reason is on the activity trail.
          </p>
        )}
      </div>

      {step === 'actions' && (
        <div className="space-y-2">
          {draft && (
            <ActionRow
              icon={<Flag size={16} />} tone="primary"
              title={scored ? 'Edit the result' : 'Record the result'}
              detail="Opens the scoring console."
              onClick={onOpenConsole}
            />
          )}
          {draft && scored && (
            <ActionRow
              icon={<Send size={16} />}
              title="Submit for review"
              detail="Hands the finished card to the organiser. You can still take it back."
              onClick={() => setStep('submit')}
            />
          )}
          {submitted && (
            <>
              <ActionRow
                icon={<Lock size={16} />} tone="primary"
                title="Lock the scorecard"
                detail="Publishes the result as verified. Changing it afterwards needs a recorded correction."
                onClick={() => setStep('lock')}
              />
              <ActionRow
                icon={<Flag size={16} />}
                title="Edit the result"
                detail="Opens the scoring console. The card stays submitted."
                onClick={onOpenConsole}
              />
              <ActionRow
                icon={<Send size={16} />}
                title="Send back to the scorer"
                detail="Returns it to draft so it can be corrected before anything is published."
                onClick={() => setStep('retract')}
              />
            </>
          )}
          {locked && (
            <>
              <ActionRow
                icon={<LockOpen size={16} />} tone="danger"
                title="Amend this result"
                detail="Unlocks it for correction. Needs a reason, and marks the result as amended everywhere."
                onClick={() => setStep('unlock')}
              />
              <p className="px-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
                A locked result cannot be edited by anyone — organiser, official or platform admin —
                until it is amended.
              </p>
            </>
          )}
        </div>
      )}

      {step === 'lock' && (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            The result becomes <b>official</b>. It appears as Verified on standings, on every player's
            permanent record and on the public page, and medals are awarded from it. Changing it
            afterwards needs a recorded correction.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('actions')}>Back</Button>
            <Button disabled={busy}
              onClick={() => run('lock', undefined, ['Result locked', 'It now reads as verified.'])}>
              {busy ? 'Locking…' : 'Lock it'}
            </Button>
          </div>
        </>
      )}

      {step === 'submit' && (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Marks the card as finished and ready for the organiser to review. Nothing is published
            yet, and you can take it back for editing.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('actions')}>Back</Button>
            <Button disabled={busy}
              onClick={() => run('submit', undefined, ['Scorecard submitted', 'The organiser can review and lock it.'])}>
              {busy ? 'Submitting…' : 'Submit it'}
            </Button>
          </div>
        </>
      )}

      {step === 'retract' && (
        <>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Returns the card to <b>Draft</b> so the scorer can correct it. Nothing has been published,
            so this leaves no correction notice.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('actions')}>Back</Button>
            <Button disabled={busy}
              onClick={() => run('retract', undefined, ['Sent back for editing', 'The card is a draft again.'])}>
              {busy ? 'Sending back…' : 'Send it back'}
            </Button>
          </div>
        </>
      )}

      {/* Unlocking is the only way a published result changes, and it is never
          silent: the reason is stored on the audit trail and the lock version moves
          on, so anything generated from the old result can be told apart from what
          replaces it. */}
      {step === 'unlock' && (
        <>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            Unlocking returns this to <b>Ready to lock</b> so it can be edited, records who did it and
            why, and marks medals and record entries generated from it as superseded.
          </p>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            From then on the match carries a dated <b>Amended</b> marker everywhere it appears,
            including the public share page.
          </p>
          <Field label="Reason for the correction">
            <Textarea rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Scorer recorded the third set the wrong way round" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep('actions')}>Back</Button>
            <Button variant="danger" disabled={busy || tooShort}
              onClick={() => run('unlock', { reason: reason.trim() }, ['Result unlocked', 'It can be edited and then locked again.'])}>
              {busy ? 'Unlocking…' : 'Unlock for correction'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function ResultsPage() {
  const { eventId, canManage } = useEvent();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: fixtures = [], isLoading, isFetching } = useApi<ResultRow[]>(`/championships/${eventId}/fixtures`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<ResultRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const refetchKeys = [`/championships/${eventId}/fixtures`, `/championships/${eventId}/lock-status`];

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

  // The organiser's queue: cards a scorer has handed over for review.
  const readyToLock = useMemo(() => rows.filter((f) => f.scorecard_status === 'submitted'), [rows]);

  const open = (f: ResultRow) => {
    if (!canManage) return;
    navigate(`/score/${f.id}`, { state: { from: `/championships/${eventId}/results` } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {canManage
            ? 'Tap a match to enter its result. Standings recalculate instantly.'
            : 'Live scores and final results across the championship.'}
        </p>
        {/* Background refresh (e.g. returning here right after a sign-off) keeps the
            list visible but signals that the latest scores are being pulled. */}
        {isFetching && !isLoading && <Spinner label="Refreshing…" />}
      </div>

      {canManage && readyToLock.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
          <Lock size={16} className="shrink-0" />
          <span>
            <b>{readyToLock.length} scorecard{readyToLock.length === 1 ? '' : 's'}</b> submitted and waiting for your review.
            Locking publishes the result as verified — it can only be changed afterwards through a recorded correction.
          </span>
          <Button size="sm" className="ml-auto" disabled={bulkBusy}
            onClick={() => setSelected(new Set(readyToLock.map((f) => f.id)))}>
            Select all
          </Button>
        </div>
      )}

      {canManage && (
        <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" disabled={bulkBusy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Lock ${selected.size} scorecard${selected.size === 1 ? '' : 's'}?`,
                message: 'Locked results become official and can only be changed through a recorded correction.',
                confirmLabel: 'Lock them',
              });
              if (!ok) return;
              setBulkBusy(true);
              try {
                // Per-fixture on the server, so one bad card doesn't block the rest.
                const res = await api<{ locked: number; failed: number; results: { fixture_id: string; ok: boolean; error?: string }[] }>(
                  'POST', `/championships/${eventId}/fixtures/lock-bulk`, { fixture_ids: [...selected] },
                );
                if (res.failed === 0) toast.success(`Locked ${res.locked} scorecard${res.locked === 1 ? '' : 's'}`);
                else toast.error(`Locked ${res.locked}, ${res.failed} could not be locked`,
                  res.results.find((r) => !r.ok)?.error);
                setSelected(new Set());
                // The dialog invalidates through its own onDone; this one
                // is a bare api() call, so without this the rows keep their old
                // status until something else happens to refetch.
                await qc.invalidateQueries({
                  predicate: (q) => typeof q.queryKey[0] === 'string'
                    && (q.queryKey[0] as string).startsWith(`/championships/${eventId}`),
                });
              } catch (e: any) {
                toast.error(e.message);
              } finally { setBulkBusy(false); }
            }}>
            {bulkBusy ? 'Locking…' : 'Lock selected'}
          </Button>
        </BulkBar>
      )}

      {customActive && canManage && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-semibold">Custom points are on.</span> Open a completed match to award each side its championship points - standings won’t update until you do.
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
                const scored = !individual && !rankingEvent && f.home_score != null && f.away_score != null;
                const locked = f.scorecard_status === 'locked';
                const selectable = canManage && f.scorecard_status === 'submitted';
                return (
                  // On phone the row content is wider than the viewport, so the card
                  // becomes a horizontal scroll container and the status/action column
                  // is pinned (sticky) so it stays reachable. The inner wrapper uses
                  // `sm:contents` so on larger screens the three cells fall back into
                  // the original 1fr / auto / 1fr grid unchanged.
                  <Card key={f.id} interactive={canManage && !locked} onClick={() => { if (!locked) open(f); }} className="block overflow-x-auto sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-4 sm:overflow-visible sm:p-4">
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
                      {/* One state, one chip. The correction marker rides on it
                          because it qualifies the verification; the organiser sees
                          exactly what a spectator sees, just not shouted. */}
                      <ScorecardBadge status={f.scorecard_status} amended={f.lock_version > 0} amendedAt={f.amended_at} />
                      {/* The match's own status is secondary once the paperwork has a
                          state of its own, so it is only shown while they can still
                          differ - a locked card is completed by definition. */}
                      {individual ? (
                        <StatusBadge status="" label="Individual" />
                      ) : !locked && <StatusBadge status={f.status} />}
                      {canManage && selectable && (
                        <span onClick={(e) => e.stopPropagation()} title="Select for bulk locking">
                          <Checkbox
                            checked={selected.has(f.id)}
                            onChange={() => setSelected((prev) => {
                              const next = new Set(prev);
                              next.has(f.id) ? next.delete(f.id) : next.add(f.id);
                              return next;
                            })}
                          />
                        </span>
                      )}
                      {/* One button, every action behind it. Lock, amend and send-back
                          all publish or retract something an institution stands behind,
                          and none of them belongs behind a 13px icon in a crowded row. */}
                      {canManage && (
                        <Button size="sm" variant={f.scorecard_status === 'submitted' ? 'outline' : 'ghost'}
                          onClick={(e: any) => { e.stopPropagation(); setActing(f); }}>
                          {f.scorecard_status === 'submitted'
                            ? <><Lock size={13} /> Review</>
                            : locked
                              ? <><LockOpen size={13} /> Manage</>
                              : <><Flag size={13} /> {scored ? 'Edit' : 'Record'}</>}
                        </Button>
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

      {acting && (
        <ScorecardDialog
          fixture={acting}
          onOpenConsole={() => { const f = acting; setActing(null); open(f); }}
          onClose={() => setActing(null)}
          // Every action in the dialog changes the card's state, so the list and
          // the organiser's "ready to lock" queue both have to be re-read.
          onDone={() => { qc.invalidateQueries({ predicate: (q) => refetchKeys.includes(q.queryKey[0] as string) }); }}
        />
      )}
    </div>
  );
}
