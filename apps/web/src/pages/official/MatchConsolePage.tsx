import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Spinner, StatusBadge, Textarea, BackButton, cn, confirmDialog, toast } from '../../components/ui';
import { awayTeam, championshipIdOf, disciplineLabel, eventInfo, eventLabel, homeTeam, orgLabel, orgTitle, sportIdOf, sportName as sportNameOf, teamLabel, teamShort, venueLabel } from './fixtureHelpers';
import {
  cricketScore, headline, hydrate, oversStr, oversToBalls, reduce, sportDef, subLine,
  type Action, type LogEntry, type MatchState, type SportDef,
} from '../../features/scoring/engine';
import { resolveTemplate, tieTemplateFor, eventTemplateFor } from '../../features/scoring/templates';
import {
  hydrateTie, initTie, rubbersWon, tieScore, tieOutcome, tieTarget, rubberDef, decideRubber as decideRubberFn, reopenRubber as reopenRubberFn,
  type TieState, type RubberInstance,
} from '../../features/scoring/tie';
import { hydrateEvent, hasResultIn, moveUnplacedTo, aggregateEvent, subEventResults, readTimeInput, formatTime, placementPoints, type EventState, type ParticipantResult } from '../../features/scoring/event';
import { ARCHIVED_READ_ONLY_MESSAGE, rankingContributions, detailedContributions, effectiveEventSpec, isRelaySubEvent, resultStatusOf, RESULT_STATUSES, RESULT_STATUS_LABEL, type ResultStatus, foldCricket, foldRally, rallyTiming, formatClock, clockReading, isCricketSport, isKernelSport, isRacquetSport, statSpecFor, eventMinuteLabels, resolveFormat, resolveMatchFormat, resultEnvelope, isCricketFormat, cricketHeadline, inningsLine, EVENT_UNIT_LABEL, type CricketLog, type CricketState } from '@semp/shared';
import { carromHeadline, carromMatchOf, carromRulesOf, drawSettlement, isCarromSport } from '@semp/shared';
import { CarromResult, hydrateCarrom, type CarromState } from '../../features/scoring/CarromResult';
import { PoolResult, hydratePool } from '../../features/scoring/PoolResult';
import { isFrameContest, isPoolSport, poolRubber } from '@semp/shared';
import { TieLayoutEditor, type TieLayoutValue } from '../../features/scoring/TieLayoutEditor';
import { CHESS_ENDINGS, chessPresetForDiscipline, describeTimeControl, formatPoints, groupTiebreakAllowed, isChessSport, isKnockoutFixture, whiteOnBoard, formatForPairing, misconductTerms, playersPerSide, readLineup, resolveMatchLineup, rubberSize, tieForRound, tieSpecSchema } from '@semp/shared';
import { unitWinner, type TieSpec, type EventSpec, type EventScoringOpts, type ScoringMode, type ScoringFormat, type KernelState, type Pairing, type RallyLog, type RubberLineup, type Side } from '@semp/shared';
import { RacquetDeck, hydrateRally, hydrateFirstServer, hydratePairSwap } from '../../features/scoring/RacquetDeck';
import { LineupPanel } from '../../features/scoring/LineupPanel';
import { ChessResult, EndingChips, chessGamesIn, chessSummary, hydrateChess, type ChessState } from '../../features/scoring/ChessResult';
import { CricketDeck } from '../../features/scoring/CricketDeck';
import { TeamDeck } from '../../features/scoring/TeamDeck';
import { TeamSheetPanel } from '../../features/scoring/TeamSheetPanel';
import { matchdaySquad, readTeamSheet, substitute, usualSide, type SheetPerson, type TeamSheet } from '@semp/shared';
import { AUTOSAVE_MS, useLiveSave, useSaveStatus, useUnloadGuard, useDraftAutosave } from '../../features/scoring/useLiveSave';
import { flushFixture, getStatus, readOutbox, type OutboxEntry } from '../../features/scoring/liveOutbox';

// Walkover is handled separately (it needs a winner + reason); these are the plain
// status-only secondary actions. Postpone is intentionally omitted here - it's done
// from the Schedule tab, not mid-scoring.
const SECONDARY: { status: string; label: string; variant: 'outline' | 'danger' }[] = [
  { status: 'cancelled', label: 'Cancel match', variant: 'danger' },
];

// Matches can only be recorded once the championship is under way (status
// "ongoing"). Before that, scoring is blocked - these explain the current state.
const NOT_STARTED_STATUS: Record<string, string> = {
  draft: 'still in draft and hasn’t opened yet',
  registration_open: 'open for registration but hasn’t started yet',
};

/** Where the console was opened from, and what that page is called. First match wins. */
const BACK_LABELS: Array<[RegExp, string]> = [
  [/^\/officiating\b/, 'My matches'],
  [/\/results\b/, 'Results'],
  [/\/schedule\b/, 'Schedule'],
];

/** A match with a result in it. Nothing is left to score, whatever the deck shows. */
const OVER = ['completed', 'walkover', 'bye'];

export function MatchConsolePage() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Where to return when done - set by whoever opened the console (host Results
  // tab passes its path); officials fall back to their matches list.
  const back = (location.state as { from?: string } | null)?.from ?? '/officiating';
  // What to CALL the page we came from. Read off the path rather than assumed:
  // "anything that is not /officiating is Results" was true only while Results was
  // the one host tab that opened a console. The Schedule tab opens one too, so the
  // link said Results and landed on the schedule - the label promising one
  // destination and the link taking another.
  const backLabel = BACK_LABELS.find(([re]) => re.test(back))?.[1] ?? 'Back';
  // Single fixture, authorized for the assigned official OR the championship host.
  const { data: fixture, isLoading } = useApi<any>(fixtureId ? `/fixtures/${fixtureId}/scoring` : null);
  const { data: serverLive } = useApi<{ live_state: any; live_log: any[] }>(fixtureId ? `/fixtures/${fixtureId}/live` : null);
  // Anything this browser scored but never got acknowledged is replayed over the
  // server's snapshot before a single deck sees it - see useRecoveredLive below.
  const { live, recoveredAt } = useRecoveredLive(fixtureId, serverLive);
  // A refresh, a close or a typed URL with a tap still unsent gets the browser's
  // own "leave site?" dialog in front of it, and a keepalive PATCH on the way out.
  useUnloadGuard();

  /**
   * SCORING FOCUS: the console gets the whole screen, and nothing follows it.
   *
   * Cricket's ball-by-ball deck sizes itself to fill what is left of the scroll
   * container, which only means "no scrolling" if nothing is rendered after it. The
   * awards form and the manual scorecard are post-match admin - an official mid-over
   * is not filling either in - so while the deck is live they are put behind a
   * button rather than stacked underneath, where they were pushing the run pad off
   * the bottom of a phone.
   *
   * Only the ball-by-ball cricket deck asks for this; every other console keeps the
   * page exactly as it was.
   */
  const [focus, setFocus] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  if (isLoading) return <Spinner />;
  if (!fixture) return <EmptyState icon="⚑" title="Match not found" description="This fixture isn't available to you." action={<Button onClick={() => navigate(back)}>Back</Button>} />;

  /**
   * ONCE THE MATCH IS OVER, THE CONSOLE GOES BACK TO BEING A PAGE.
   *
   * Focus mode gives the deck the whole screen so a tap-per-action console is not
   * pushed off the bottom of a phone by the admin sections after it. That is worth
   * the collapsed header only while there is something left to tap. When the result
   * is in, the deck shrinks to a single result card - and the header region focus
   * mode removes is where the one remaining action lives: LOCKING the scorecard,
   * which is what makes the result official.
   *
   * So a completed match was the single state in which the console hid the only
   * thing still outstanding, and it hid it for every sport that scores on the team
   * deck - football included. Entering the score got the match to "completed" and
   * there was no way onward from the console at all.
   */
  const scoringFocus = focus && !adminOpen && !OVER.includes(fixture.status);

  // The fixture's structure (single / tie / event) and scoring depth (detailed /
  // manual) are now chosen by the official on the console (see ScoringTabs) rather than
  // fixed by the discipline - so here we only need to know whether this sport can be an
  // event (which has no two teams) to relax the "both teams set" guard below.
  const canBeEvent = !!eventTemplateFor(sportNameOf(fixture));
  // Refresh the official list AND the host's championship views (results table +
  // live-computed standings) after any scoring change.
  const evId = eventInfo(fixture)?.id;
  const invalidate: (string | null)[] = [
    '/me/officiating',
    `/fixtures/${fixtureId}/scoring`,
    evId ? `/championships/${evId}/fixtures` : null,
    evId ? `/championships/${evId}/standings` : null,
  ];
  /**
   * LEAVING THE CONSOLE WITH SOMETHING UNSENT.
   *
   * `beforeunload` covers a refresh, a close or a typed URL; walking back to the
   * results list is an in-app navigation and fires no such event. Nothing is
   * actually lost either way - the outbox is on disk and the sender keeps retrying
   * from wherever the official goes next - but "the last four points never saved"
   * is not something to find out about later, so it is said here, with the offer to
   * wait for it to land.
   *
   * It never refuses to leave. An official whose venue has no signal would be
   * trapped on a page by a guard that insisted, and their scoring is safe on the
   * device regardless; the honest thing is to say where it is and let them go.
   */
  const done = async () => {
    if (fixtureId && getStatus(fixtureId).unsaved) {
      const ok = await confirmDialog({
        title: 'Scoring not saved yet',
        tone: 'primary',
        confirmLabel: 'Save and leave',
        cancelLabel: 'Stay here',
        message: 'Some of this match hasn’t reached the server yet. It’s stored on this device and will keep being sent in the background, but you can wait for it now.',
      });
      if (!ok) return;
      const landed = await flushFixture(fixtureId);
      if (!landed) {
        toast.error('Still can’t reach the server. Your scoring is saved on this device and will be sent automatically - reopen this match to check.');
      }
    }
    navigate(back);
  };

  // The championship must have started before any match can be recorded. Mirror the
  // server rule in the UI so the official sees *why* - and can't waste effort scoring.
  const champStatus = fixture.tournament_disciplines?.tournament_sports?.tournaments?.championships?.status;
  const notStarted = champStatus === 'draft' || champStatus === 'registration_open';
  // Archived: the result can be looked at, not changed. Everything below sits in a
  // disabled fieldset, so every console's inputs and Save buttons are off at once.
  const archived = !!fixture.tournament_disciplines?.tournament_sports?.tournaments?.championships?.archived_at;
  // A match can't be scored until both sides are known - a TBD bracket slot (e.g. a
  // final waiting on its semis) has no teams to score. Mirror the server rule here.
  // Sports that can be scored as a multi-competitor event have no two teams, so the
  // check doesn't apply to them.
  const missingTeams = !canBeEvent && (!fixture.home_team_id || !fixture.away_team_id);

  return (
    <div className={scoringFocus ? 'flex h-full min-h-0 flex-col' : undefined}>
      {!scoringFocus && <BackButton onClick={done}>{backLabel}</BackButton>}
      {scoringFocus ? (
        // One line, so the console keeps the screen. Everything the fuller header
        // says is a tap away on the way back out.
        <div className="mb-2 flex shrink-0 items-center gap-2 text-xs">
          <button type="button" onClick={done}
            className="font-semibold text-brand-600 hover:underline">← {backLabel}</button>
          <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">
            {disciplineLabel(fixture)}{fixture.round ? ` · ${fixture.round}` : ''}
          </span>
          <SaveIndicator fixtureId={fixtureId!} compact />
          <StatusBadge status={fixture.status} />
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="min-w-0 truncate">{disciplineLabel(fixture)} {fixture.round ? `· ${fixture.round}` : ''}</span>
            <span className="flex shrink-0 items-center gap-2">
              <SaveIndicator fixtureId={fixtureId!} />
              <StatusBadge status={fixture.status} />
            </span>
          </div>
          <div className="mb-4 text-sm text-slate-500 dark:text-slate-400">{eventLabel(fixture)} · {venueLabel(fixture)} · {fmtDateTime(fixture.scheduled_at)}</div>
        </>
      )}

      {recoveredAt !== null && <RecoveredBanner at={recoveredAt} fixtureId={fixtureId!} />}

      {archived && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {ARCHIVED_READ_ONLY_MESSAGE}
        </p>
      )}

      {/* Carries the flex chain in scoring-focus mode, so the deck still fills the screen. */}
      <fieldset disabled={archived} className={cn('m-0 min-w-0 border-0 p-0', scoringFocus && 'flex min-h-0 flex-1 flex-col')}>
      {/* A result exists, so the sign-off that makes it official is the next thing
          to do - no longer also conditioned on the layout, which is what hid it. */}
      {OVER.includes(fixture.status) && (
        <LockScorecardPanel fixtureId={fixtureId!} scorecardStatus={fixture.scorecard_status} invalidate={invalidate} />
      )}

      {notStarted ? (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardBody className="space-y-3 py-8 text-center">
            <div className="text-4xl" aria-hidden>⏳</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">This match can’t be recorded yet</h2>
            <p className="mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300">
              <b>{eventLabel(fixture)}</b> is {NOT_STARTED_STATUS[champStatus] ?? 'not under way yet'}. A match can only be scored once its championship has started.
            </p>
            <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
              The organiser needs to move the championship to <b>Ongoing</b> (from the championship’s Settings). Once it’s started, reopen this match to record the result.
            </p>
            <div className="pt-1"><Button variant="outline" onClick={done}>Back to {backLabel.toLowerCase()}</Button></div>
          </CardBody>
        </Card>
      ) : missingTeams ? (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardBody className="space-y-3 py-8 text-center">
            <div className="text-4xl" aria-hidden>🆚</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Both teams aren’t set yet</h2>
            <p className="mx-auto max-w-md text-sm text-slate-600 dark:text-slate-300">
              This match still has a <b>TBD</b> slot - it can’t go live or be scored until both teams are assigned.
            </p>
            <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
              The organiser sets the teams from the championship’s <b>Schedule → Fixtures</b> tab (edit the fixture). Once both sides are in, reopen this match to score it.
            </p>
            <div className="pt-1"><Button variant="outline" onClick={done}>Back to {backLabel.toLowerCase()}</Button></div>
          </CardBody>
        </Card>
      ) : (
        <div className={scoringFocus ? 'flex min-h-0 flex-1 flex-col' : undefined}>
          <ScoringTabs fixture={fixture} fixtureId={fixtureId!} live={live} invalidate={invalidate} onDone={done}
            focus={scoringFocus}
            onFocusable={setFocus}
            onOpenAdmin={() => setAdminOpen(true)} />

          {adminOpen && (
            <div className="mt-3">
              <Button variant="subtle" size="sm" onClick={() => setAdminOpen(false)}>
                ← Back to the scoring console
              </Button>
            </div>
          )}

          {!scoringFocus && fixture.point_scheme === 'custom' && (
            <div className="mt-5">
              <CustomPointsPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
            </div>
          )}

          {!scoringFocus && sportDef(sportNameOf(fixture)).archetype === 'cricket' && (
            <div className="mt-5">
              <ScorecardPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
            </div>
          )}

          {!scoringFocus && (
            <div className="mt-5">
              <AwardsPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
            </div>
          )}
        </div>
      )}
      </fieldset>
    </div>
  );
}

/* ----------------------------- Scoring tabs (structure + depth) ----------------------------- */
type Structure = 'single' | 'tie' | 'event';

// A pill toggle for picking among a few options (structure / scoring depth).
function TabBar<T extends string>({ value, onChange, options, label, compact, compactLabels }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
    compact?: boolean; compactLabels?: Record<string, string> }) {
  if (options.length < 2) return null;
  // COMPACT is for the cricket deck, which is sized to whatever vertical space is
  // left over. The stacked caption and the full labels cost about 110px - which is
  // two rows of the wicket form, or the difference between the run pad being
  // comfortable and being cramped.
  return (
    <div>
      {!compact && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      )}
      <div className={cn('inline-flex rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60',
        compact ? 'p-0.5' : 'p-1')}>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={cn('rounded-lg font-medium transition',
              compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              o.value === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')}>
            {(compact && compactLabels?.[o.value]) || o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Crash recovery ----------------------------- */
/**
 * WHAT THE CONSOLE OPENS ONTO.
 *
 * Normally the server's snapshot, which is the only thing this page used to read.
 * But the whole point of the outbox is that the server's snapshot can be BEHIND
 * what the official actually scored: they tapped, the network was gone, the phone
 * was locked, the tab was reloaded. Seeding the decks from the server in that state
 * is how a half of football vanished - the taps were on disk the entire time, and
 * nothing looked at them.
 *
 * So the staged body is replayed over the server's snapshot before any deck seeds
 * from it. Every console hydrates from this one object, which is why one overlay
 * here covers cricket, racquet, team, tie and event scoring alike.
 *
 * Read ONCE, into a ref, and never re-read: the sender is flushing the same entry
 * in parallel, and if this re-ran after the flush cleared it, the overlay would
 * fall back to a server response that may have been fetched before the flush
 * landed - which is the original bug, reintroduced by the fix for it.
 */
function useRecoveredLive(fixtureId: string | undefined, server?: { live_state: any; live_log: any[] }) {
  const staged = useRef<OutboxEntry | null | undefined>(undefined);
  if (staged.current === undefined) staged.current = fixtureId ? readOutbox(fixtureId) : null;

  return useMemo(() => {
    const entry = staged.current;
    const body = entry?.body as { live_state?: any; live_log?: any[] } | undefined;
    // A status-only entry (a walkover, say) carries no scoring to restore.
    if (!body || (body.live_state === undefined && body.live_log === undefined)) {
      return { live: server, recoveredAt: null as number | null };
    }
    return {
      live: {
        live_state: body.live_state ?? server?.live_state ?? {},
        live_log: body.live_log ?? server?.live_log ?? [],
      },
      recoveredAt: entry!.at,
    };
  }, [server]);
}

/** "Recovered 3 min ago" - relative, because the absolute time means nothing here. */
function agoLabel(at: number): string {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return 'moments ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
}

/**
 * Said once, on the way in, when the console had to reach into the outbox to
 * rebuild the match. The official needs to know that what they are looking at is
 * their own unsent scoring rather than the server's record of it - if the two ever
 * disagree (a second device scored the same match in between) this line is the only
 * warning they will get before signing off on the wrong one.
 */
function RecoveredBanner({ at, fixtureId }: { at: number; fixtureId: string }) {
  const status = useSaveStatus(fixtureId);
  const [dismissed, setDismissed] = useState(false);
  // Once the recovered scoring has landed there is nothing left to warn about, so
  // the banner retires itself - and LATCHES, because `unsaved` goes true again on
  // the very next tap and a warning about a past recovery must not come back with
  // it. This is why it is a state that only ever moves one way rather than a plain
  // read of the current status.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!status.unsaved && status.savedAt !== null) setSettled(true);
  }, [status.unsaved, status.savedAt]);
  if (dismissed || settled) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <span aria-hidden>⟳</span>
      <span className="flex-1">
        <b>Unsaved scoring restored.</b> Changes made {agoLabel(at)} never reached the server - they’ve been
        put back on screen and are being saved now. Don’t re-enter them.
      </span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}

/* ----------------------------- Save indicator ----------------------------- */
/**
 * THE ONE PLACE THAT SAYS WHETHER THE MATCH IS SAFE.
 *
 * An official scoring a live game cannot be asked to infer it from an absent error
 * toast, and a browser's "leave site?" dialog says only that something might be
 * lost, never what. So the header carries the answer at all times: saved and when,
 * saving, or unsaved with a way to try again right now.
 *
 * It re-renders on a one-second tick only while something is outstanding, so the
 * "unsaved for 40s" count keeps moving without the console repainting all match.
 */
function SaveIndicator({ fixtureId, compact }: { fixtureId: string; compact?: boolean }) {
  const status = useSaveStatus(fixtureId);
  const [, tick] = useState(0);
  const live = status.unsaved || status.sending;
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  if (!status.unsaved && status.savedAt === null && !status.storageFailed) return null;

  const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold';
  if (status.unsaved) {
    const stuck = status.failed || (status.unsavedSince !== null && Date.now() - status.unsavedSince > 15_000);
    return (
      <span className={cn(base, stuck
        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200')}>
        <span className={cn('h-1.5 w-1.5 rounded-full', stuck ? 'bg-red-500' : 'animate-pulse bg-amber-500')} />
        {stuck ? 'Not saved' : 'Saving…'}
        {stuck && (
          <button type="button" className="underline" onClick={() => { void flushFixture(fixtureId); }}>Retry</button>
        )}
      </span>
    );
  }
  if (status.storageFailed) {
    return (
      <span className={cn(base, 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200')}
        title="This browser refused to keep a local backup (private mode, or storage full). Scoring still saves to the server, but a crash before it lands would lose the last tap.">
        No offline backup
      </span>
    );
  }
  return (
    <span className={cn(base, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300')}>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {compact ? 'Saved' : `Saved ${new Date(status.savedAt!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}
    </span>
  );
}

// The compact labels for the depth toggle, which has to say in two or three words
// what "detailed" MEANS for the sport in hand. It used to say "Ball by ball" for
// everything, because cricket is where the compact toggle was built - so a football
// official was offered a ball-by-ball tab above a console with no balls in it.
// Each family gets the term its own officials use.
function depthLabels(sport: string | null): Record<string, string> {
  const detailed = isCricketSport(sport) ? 'Ball by ball'
    : isRacquetSport(sport) ? 'Point by point'
    : 'Play by play';
  return { detailed, manual: 'Totals' };
}

// Officials pick how to score this match here, not the organiser: the structure
// (single / team tie / multi-competitor event - only those the sport supports) and the
// depth (live point-by-point vs final score). Defaults to the sport's natural format
// (and to whatever has already been scored on reload); switching tabs is non-destructive
// since each structure keeps its own slice of live_state.
function ScoringTabs({ fixture, fixtureId, live, invalidate, onDone, focus, onFocusable, onOpenAdmin }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[];
    onDone: () => void;
    focus?: boolean; onFocusable?: (v: boolean) => void; onOpenAdmin?: () => void }) {
  const sportName = sportNameOf(fixture);
  const template = resolveTemplate(fixture);
  const singleDef: SportDef = template.single ?? sportDef(sportName);

  /**
   * A TEAM TIE IS A PROPERTY OF THE DISCIPLINE, NOT THE SPORT.
   *
   * `tieTemplateFor` is keyed by sport alone, so it hands back the 5-rubber
   * MS/WS/MD/WD/XD set for EVERY table-tennis fixture - including a Men's Singles
   * quarter-final, which then opened as "Team tie · 5 rubbers" and asked the
   * official to score Women's Doubles inside a men's singles match.
   *
   * The discipline already says which it is: `disciplines.entry_type` is
   * individual | doubles | team, and only a `team` discipline ("Mixed", "Whole
   * sport") is a tie. Singles and doubles draws are one contest between two sides.
   *
   * An explicitly stored template still wins - if an organiser has configured this
   * draw as a tie, that is a decision, not an inference.
   */
  const disciplineEntry: string | null = fixture?.tournament_disciplines?.disciplines?.entry_type ?? null;
  const tieAllowed = template.fixtureType === 'tie' || disciplineEntry === null || disciplineEntry === 'team';
  // A tie already under way keeps the layout it started with, however the draw's
  // layout is edited later - its rubbers line up with what was scored.
  const frozenTie = useMemo(() => {
    const parsed = tieSpecSchema.safeParse(live?.live_state?.tieSpec);
    return parsed.success ? parsed.data : undefined;
  }, [live?.live_state?.tieSpec]);
  // A match already scored as a single match keeps that shape if a sport standard tie
  // appears later (pickleball gained one): its points would not line up with rubbers.
  const startedAsSingle = !frozenTie && Array.isArray(live?.live_state?.rally) && live!.live_state.rally.length > 0;
  const drawTie = (template.fixtureType === 'tie' && template.tie)
    ? template.tie
    : tieAllowed && !startedAsSingle ? tieTemplateFor(sportName)?.tie : undefined;
  // Group and league rounds may play dead rubbers out; knockouts stop once decided. Applied to a
  // layout saved for this match as well - doing it twice changes nothing.
  const tieSpec = frozenTie ? tieForRound(frozenTie, fixture?.round) : drawTie ? tieForRound(drawTie, fixture?.round) : undefined;
  // The layout as set, before the round's rule: what "Edit rubbers" starts from, so saving
  // it keeps the group and knockout dead-rubber settings apart.
  const tieLayout = frozenTie ?? drawTie;
  // Chess ties are always won on board points, every board played - including draws
  // set up before the template said so.
  const consoleTieSpec = useMemo(
    () => (tieSpec && isChessSport(sportName) ? { ...tieSpec, boardPoints: true, skipDeadRubbers: false, skipDeadInGroups: false } : tieSpec),
    [tieSpec, sportName],
  );
  const rawEventSpec = (template.fixtureType === 'event' && template.event) ? template.event : eventTemplateFor(sportName)?.event;
  // null discipline_id = "Whole sport", the only shape that mixes categories -
  // a named discipline ("66kg") collapses to just that one.
  const disciplineId: string | null = fixture?.tournament_disciplines?.discipline_id ?? null;
  const disciplineName: string | null = fixture?.tournament_disciplines?.disciplines?.name ?? null;
  const eventSpec = rawEventSpec ? effectiveEventSpec(rawEventSpec, { id: disciplineId, name: disciplineName }) : undefined;

  // Ranking/event sports (powerlifting/swimming/athletics) have no head-to-head match,
  // so they're event-only - the "Single match" structure doesn't apply and is omitted.
  const structures: Structure[] = eventSpec
    ? ['event']
    : ['single', ...(tieSpec ? ['tie' as const] : [])];
  // Default structure: an explicit stored config wins; otherwise the sport's natural
  // format (event/tie sports default to those, everything else to a single match).
  const storedType = fixture?.tournament_disciplines?.format_config?.scoring?.fixtureType as Structure | undefined;
  const naturalDefault: Structure = eventSpec ? 'event' : tieSpec ? 'tie' : 'single';
  const baseDefault: Structure = storedType && structures.includes(storedType) ? storedType : naturalDefault;

  const [structure, setStructure] = useState<Structure>(baseDefault);
  // Once the live snapshot arrives, snap to whatever's already been scored (so a
  // half-finished tie/event reopens on the right tab). `touched` guards against a slow
  // live query: if the official picks a tab before it resolves, this one-shot seed must
  // not stomp their choice when it finally lands (that read as "the toggle won't switch").
  const seeded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (seeded.current || touched.current || !live) return;
    seeded.current = true;
    if (live.live_state?.tie && tieSpec) setStructure('tie');
    else if (live.live_state?.event && eventSpec) setStructure('event');
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot seed

  // An event has two entries under separate live_state keys - org-level "Team
  // ranking" (default) and detailed per-athlete - so scoring one never
  // clobbers the other. Snaps to whichever this fixture was last scored with.
  const [eventMode, setEventMode] = useState<'team' | 'detailed'>('team');
  // Competitors an institute may enter in this event: the draw's squad size, else the discipline's.
  const perInstitute: number = fixture?.tournament_disciplines?.squad_max ?? fixture?.tournament_disciplines?.disciplines?.squad_max ?? 1;
  const eventModeSeeded = useRef(false);
  useEffect(() => {
    if (eventModeSeeded.current || touched.current || !live) return;
    eventModeSeeded.current = true;
    if (live.live_state?.event) setEventMode('detailed');
    // Nothing scored yet and an institute may enter more than one competitor (not a relay):
    // only per-athlete entry can place two from the same institute.
    else if (!live.live_state?.eventRanking && eventSpec && perInstitute > 1 && !isRelaySubEvent(eventSpec.subEvents[0])) setEventMode('detailed');
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot seed

  // Measured/time single sports have no per-tick scoring, so they're manual-only.
  //
  // CRICKET IS NO LONGER ONE OF THEM. It used to be listed here because the only
  // cricket deck was a tap counter with no notion of an over; now it has a real
  // ball-by-ball engine. Leaving it in this list made `forcedManual` true for
  // cricket, which pinned effectiveMode to 'manual' and left CricketConsole
  // unreachable - the deck rendered nowhere.
  const manualOnlyArchetype = singleDef.archetype === 'time';
  const forcedManual = structure === 'single' && manualOnlyArchetype;

  // What the FORMAT says it wants. A corporate 15-over game nobody can staff
  // declares `entryMode: 'summary'`, and opening the full ball-by-ball deck for it
  // asks an organiser to score 180 deliveries they were never going to score.
  const formatEntryMode = useMemo<ScoringMode | null>(() => {
    if (!isCricketSport(sportName)) return null;
    const td = fixture?.tournament_disciplines ?? {};
    const resolved = resolveMatchFormat(
      {
        scoring_format_id: fixture?.scoring_format_id ?? null,
        round: fixture?.round ?? null,
        stage_sequence: fixture?.stage_sequence ?? null,
        frozen_format: (live?.live_state as any)?.format ?? null,
        // The organiser's per-match rules, patched on top of whatever rung wins.
        format_overrides: fixture?.format_overrides ?? null,
      },
      { scoring_format_id: td.scoring_format_id ?? null, scoring_preset_key: td.scoring_preset_key ?? null, round_formats: td.round_formats, sport: sportName },
      (fixture?.scoring_formats ?? []) as any[],
    );
    if (!isCricketFormat(resolved.format)) return null;
    return resolved.format.entryMode === 'summary' ? 'manual' : 'detailed';
  }, [fixture, live?.live_state, sportName]);

  const storedMode = fixture?.tournament_disciplines?.format_config?.scoring?.scoringMode as ScoringMode | undefined;
  // The order is the same one the format ladder uses: an EXPLICIT choice on the draw
  // beats what the format merely prefers, which beats the archetype's default.
  // Either way it is only a DEFAULT - the toggle stays, because manual entry has to
  // be able to overrule the engine at any point.
  const [mode, setMode] = useState<ScoringMode>(
    storedMode ?? formatEntryMode ?? (manualOnlyArchetype ? 'manual' : 'detailed'),
  );
  const effectiveMode: ScoringMode = forcedManual ? 'manual' : mode;
  const showDepth = structure !== 'event' && !forcedManual;

  // The format only arrives with the live snapshot, which lands after the first
  // render, so the initial useState above may have guessed before it knew. This is a
  // ONE-SHOT correction, guarded by `touched` exactly as the structure seed is: if
  // the official has already picked a mode, a late-arriving format must not stomp it.
  const modeSeeded = useRef(false);
  useEffect(() => {
    if (modeSeeded.current || touched.current) return;
    if (storedMode || !formatEntryMode) return;
    modeSeeded.current = true;
    setMode(formatEntryMode);
  }, [formatEntryMode, storedMode]);
  // Multi-competitor events default to a simple team ranking (which team did well); the
  // detailed per-athlete console is kept available behind this toggle.

  const structureLabel = (s: Structure) =>
    s === 'tie' ? `Team tie · ${tieSpec?.rubbers.length ?? 0} rubbers`
    : s === 'event' ? `Event · ${eventSpec?.subEvents.length ?? 0} sub-events`
    : 'Single match';

  // Whether the match has any scoring worth protecting before a tab switch - it's gone
  // live, has a score, a point log, or a saved tie/event slice.
  const ls = live?.live_state;
  const hasProgress =
    fixture.status === 'live' || fixture.status === 'completed' ||
    fixture.home_score != null || fixture.away_score != null ||
    (live?.live_log?.length ?? 0) > 0 ||
    !!ls?.tie?.rubbers?.some((r: any) => r?.winner) ||
    !!(ls?.event && Object.keys(ls.event).length > 0);

  // Scoped to the live entry mode, not `hasProgress` above - switching away only
  // matters if THAT mode's own data (places, or a mark) was actually entered.
  const eventHasProgress = eventMode === 'team'
    ? (ls?.eventRanking?.rows?.length ?? 0) > 0
    : (ls?.event?.participants?.length ?? 0) > 0;

  // Each structure signs off its own result, so moving to another one abandons whatever
  // was scored under the current one. Confirm the switch once the match has any scoring
  // recorded so the official can't lose a part-scored tie/match by tapping the wrong tab.
  const switchStructure = async (next: Structure) => {
    if (next === structure) return;
    touched.current = true;
    if (hasProgress) {
      const ok = await confirmDialog({
        title: 'Switch scoring structure?',
        confirmLabel: 'Switch & discard',
        message: `The ${structureLabel(structure)} score recorded here will be lost if you switch to ${structureLabel(next)}. This can't be undone.`,
      });
      if (!ok) return;
    }
    setStructure(next);
  };

  // Detailed ↔ Manual keeps the running score (Manual seeds from the live tally), but it
  // changes how the rest of the match is scored - a softer confirm so the official doesn't
  // flip the mode mid-scoring by accident.
  const switchMode = async (next: ScoringMode) => {
    if (next === mode) return;
    touched.current = true;
    if (hasProgress) {
      const ok = await confirmDialog({
        title: 'Switch scoring mode?',
        confirmLabel: 'Switch',
        message: next === 'manual'
          ? 'Switch to entering a final score? The current score carries over, but live point-by-point scoring stops.'
          : 'Switch to live point-by-point scoring? The current score carries over.',
      });
      if (!ok) return;
    }
    setMode(next);
  };

  // Team ranking <-> Detailed carries nothing over (separate live_state keys),
  // so confirm before switching whenever the side being left has data.
  const switchEventMode = async (next: 'team' | 'detailed') => {
    if (next === eventMode) return;
    touched.current = true;
    if (eventHasProgress) {
      const ok = await confirmDialog({
        title: 'Switch scoring entry?',
        confirmLabel: 'Switch & discard',
        message: `The ${eventMode === 'team' ? 'team ranking' : 'per-athlete'} data recorded here will be lost if you switch to ${next === 'team' ? 'team ranking' : 'per-athlete entry'}. This can't be undone.`,
      });
      if (!ok) return;
    }
    setEventMode(next);
  };

  // WHICH CONSOLES FILL THE SCREEN.
  //
  // A deck that sizes itself to what is left of the scroll container only means
  // "no scrolling" if nothing is rendered after it - so the page has to know. Two
  // do: cricket's ball-by-ball deck, and the team deck that every invasion, raid,
  // net and board sport scores through. Both are tap-per-action consoles an
  // official holds in one hand, and both were pushing their own buttons off the
  // bottom of a phone behind the awards form.
  //
  // Everything else is an ordinary page section and must not have the header
  // collapsed out from under it. Named for what it MEANS rather than for cricket:
  // the condition below has covered the team deck since before this merge, and a
  // variable called cricketDeckLive was telling the next reader otherwise.
  const fullHeightDeck = structure === 'single'
    && effectiveMode === 'detailed'
    && (isCricketSport(sportName) || (isKernelSport(sportName) && !isRacquetSport(sportName)));
  useEffect(() => { onFocusable?.(fullHeightDeck); }, [fullHeightDeck]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={focus ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      {(structures.length > 1 || showDepth || structure === 'event') && (
        <div className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', focus ? 'mb-2 shrink-0' : 'mb-5')}>
          {/* Only offer the structure switch when there's a real choice - event-only
              sports have a single structure, so the lone tab is hidden. */}
          {structures.length > 1 && (
            <TabBar label="Match structure" value={structure} onChange={switchStructure} compact={focus}
              options={structures.map((s) => ({ value: s, label: structureLabel(s) }))} />
          )}
          {/* Event/ranking sports (swimming, powerlifting, athletics) default to the
              org-level Team ranking; the detailed per-athlete entry is a named toggle
              of its own, not the depth toggle other sports use below. */}
          {structure === 'event' ? (
            <TabBar label="Scoring" value={eventMode} onChange={switchEventMode} compact={focus}
              compactLabels={{ team: 'Team ranking', detailed: 'Per-athlete' }}
              options={[{ value: 'team', label: 'Team ranking' }, { value: 'detailed', label: 'Per-athlete · detailed' }]} />
          ) : showDepth ? (
            <TabBar label="Scoring" value={mode} onChange={switchMode} compact={focus}
              compactLabels={depthLabels(sportName)}
              options={[{ value: 'detailed', label: 'Detailed · live' }, { value: 'manual', label: 'Manual · final score' }]} />
          ) : null}
        </div>
      )}

      {structure === 'event' && eventSpec
        ? (eventMode === 'detailed'
          ? <EventConsole key={`evd-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={eventSpec} live={live} invalidate={invalidate} />
          : <EventRankingConsole key={`evr-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={eventSpec} live={live} invalidate={invalidate} />)
        : structure === 'tie' && tieSpec
          ? <TieConsole key={`tie-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={consoleTieSpec ?? tieSpec} layout={tieLayout} mode={effectiveMode} live={live} invalidate={invalidate} onDone={onDone} />
          // Chess records each game's result - nothing is counted during play - so it
          // has its own screen rather than the generic two-number form.
          : isChessSport(sportName)
            ? <ChessConsole key={`chess-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
          : effectiveMode === 'manual'
            // Manual mode draws a FORM, and cricket's form is runs/wickets/overs
            // rather than a pair of numbers. This is also where a format declaring
            // `entryMode: 'summary'` lands.
            ? isCricketSport(sportName)
              ? <CricketManualResult key={`cman-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
              : <ManualResult key={`man-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} def={singleDef} live={live} invalidate={invalidate} onDone={onDone}
                  // Volleyball, throwball and pool are set-shaped too: check against their own best-of, not a fixed 5.
                  format={isRacquetSport(sportName) || statSpecFor(sportName)?.family === 'net' || isPoolSport(sportName)
                    ? racquetFormatFor(fixture, (live?.live_state as any)?.format ?? null).format
                    : isCarromSport(sportName) ? carromResolved(fixture, (live?.live_state as any)?.format ?? null).format as ScoringFormat | null
                    : null} />
            // Racquet sports score through the rules-aware kernel: real targets,
            // win-by, caps, deuce and serve tracking, instead of a tap counter whose
            // "next set" button awarded the game to whoever happened to be ahead.
            : isRacquetSport(sportName)
              ? <RacquetConsole key={`rac-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
              // Carrom records each board's result and the points follow. A match already
              // scored on the old +1 deck keeps it - its points are in a rally log.
              : isCarromSport(sportName) && !(live?.live_state?.rally?.length && !live?.live_state?.carrom)
                ? <CarromConsole key={`carrom-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
              // Every OTHER kernel sport - invasion, raid, net, board, combat - runs
              // the same kernel through a period-based deck: clock-terminated halves,
              // aggregate scoring, and actions attributed to a person.
              : isKernelSport(sportName)
                ? <TeamConsole key={`team-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
                // Cricket has its OWN engine, not the kernel: the scoring unit is a
                // delivery whose outcome credits three people at once, and an over
                // is six LEGAL balls. It reaches that engine through the same
                // format ladder as everything else.
                : isCricketSport(sportName)
                  ? <CricketConsole key={`cri-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} onOpenAdmin={onOpenAdmin} />
                  // The measured sports keep their own console by design.
                  : <LiveConsole key={`live-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} def={singleDef} live={live} invalidate={invalidate} onDone={onDone} />}
    </div>
  );
}

/* ----------------------------- Custom championship points ----------------------------- */
// Shown only when the draw's point system is "custom": the organiser awards
// championship points to each side for this result. Saved to the fixture and fed
// into standings. Current values come from the fixture's live_state.custom_points.
function CustomPointsPanel({ fixture, fixtureId, invalidate }: { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const homeOrg = orgLabel(homeTeam(fixture));
  const awayOrg = orgLabel(awayTeam(fixture));
  const cp = fixture.live_state?.custom_points ?? {};
  const [home, setHome] = useState(cp.home != null ? String(cp.home) : '');
  const [away, setAway] = useState(cp.away != null ? String(cp.away) : '');
  const save = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/points`, body), [`/fixtures/${fixtureId}/scoring`, ...invalidate]);

  const num = (s: string) => (s === '' ? null : Math.max(0, Math.floor(Number(s) || 0)));
  const submit = () => save.mutate(
    { home_points: num(home), away_points: num(away) },
    { onSuccess: () => toast.success('Championship points saved'), onError: (e: any) => toast.error(e.message) },
  );

  return (
    <Card>
      <CardHeader title="Championship points" subtitle="This championship awards custom points - enter the points each side earns from this result. They feed the standings." />
      <CardBody>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label className="block min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <span className="mb-1.5 block h-3.5 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{homeOrg}</span>
            <Input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-sm font-semibold text-slate-400 dark:text-slate-500">pts</span>
          <label className="block min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
            <span className="mb-1.5 block h-3.5 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{awayOrg}</span>
            <Input type="number" min={0} value={away} onChange={(e) => setAway(e.target.value)} className="text-center text-lg font-bold" />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save points'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ----------------------------- External scorecard (cricket) ----------------------------- */
// Cricket / Box Cricket: store a CrickHeroes (or any) full-scorecard URL. Saved to
// the fixture's live_state.scorecard_url and surfaced as a "View full scorecard" CTA
// on the match views for spectators.
function ScorecardPanel({ fixture, fixtureId, invalidate }: { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const [url, setUrl] = useState<string>(fixture.live_state?.scorecard_url ?? '');
  const save = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/scorecard`, body), [`/fixtures/${fixtureId}/scoring`, ...invalidate]);
  return (
    <Card>
      <CardHeader title="Full scorecard link" subtitle="Paste a CrickHeroes (or any) live scorecard URL - spectators get a button to open the full scorecard." />
      <CardBody className="space-y-3">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crickheroes.com/..." />
        <div className="flex items-center justify-between">
          {url
            ? <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">↗ Open scorecard</a>
            : <span className="text-xs text-slate-400">No link yet</span>}
          <Button size="sm" disabled={save.isPending}
            onClick={() => save.mutate({ url }, { onSuccess: () => toast.success('Scorecard link saved'), onError: (e: any) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save link'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ----------------------------- Awards ----------------------------- */
type AwardItem = { award_type_id: string; recipient_user_id: string | null; recipient_team_id: string | null };
type AwardRow = AwardItem & {
  id: string; award_name: string; award_type_id: string | null; award_type_code: string | null;
  recipient_kind: 'player' | 'team'; recipient_name: string | null;
};
type MatchAwardType = { id: string; code: string; label: string; recipient_kind: 'player' | 'team' };

const POTM_CODE = 'player_of_the_match';

function rosterPeople(team: any): { id: string; name: string; team: string }[] {
  return (team?.team_members ?? [])
    .map((tm: any) => ({ id: tm.users?.id as string, name: tm.users?.name ?? '-', team: teamLabel(team) }))
    .filter((p: { id?: string }) => !!p.id);
}

/** A squad as the team sheet reads it - with shirt number and role, for its order. */
function sheetSquad(team: any): SheetPerson[] {
  return (team?.team_members ?? [])
    .map((tm: any) => ({ id: tm.users?.id as string, name: tm.users?.name ?? '-', role: tm.role ?? null, jersey: tm.jersey_number ?? null }))
    .filter((p: { id?: string }) => !!p.id);
}

function matchSides(fixture: any) {
  const people = [...rosterPeople(homeTeam(fixture)), ...rosterPeople(awayTeam(fixture))];
  const teams = [homeTeam(fixture), awayTeam(fixture)]
    .filter((t: any) => !!t?.id)
    .map((t: any) => ({ id: t.id as string, name: teamLabel(t) }));
  return { people, teams };
}

/** The award types offered for this fixture's sport at match level (plus the event's own). */
function useMatchAwardTypes(fixture: any) {
  const sportId = sportIdOf(fixture);
  const champId = championshipIdOf(fixture);
  const qs = new URLSearchParams({ level: 'match', ...(sportId ? { sport_id: sportId } : {}), ...(champId ? { championship_id: champId } : {}) });
  return useApi<MatchAwardType[]>(`/award-types?${qs}`);
}

/** What the server expects for one award, from a saved row. */
const toInput = (a: AwardItem) => ({
  award_type_id: a.award_type_id,
  recipient_user_id: a.recipient_user_id || null,
  recipient_team_id: a.recipient_team_id || null,
});

// Awards picked from the catalogue (the award types the super admin offers for this
// sport) with a recipient from the two rosters, or one of the two teams when the
// award goes to a team. Replace-all save; these surface as the recipient's
// achievements on their dashboard.
function AwardsPanel({ fixture, fixtureId, invalidate }: { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const { people, teams } = matchSides(fixture);
  const { data: types = [], isLoading: typesLoading } = useMatchAwardTypes(fixture);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const { data: existing } = useApi<AwardRow[]>(`/fixtures/${fixtureId}/awards`);
  const [rows, setRows] = useState<Array<AwardItem & { legacy?: string }>>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && existing) {
      setRows(existing.map((a) => ({
        award_type_id: a.award_type_id ?? '',
        recipient_user_id: a.recipient_user_id,
        recipient_team_id: a.recipient_team_id,
        // Typed before the catalogue: the scorer has to pick its award type to keep it.
        legacy: a.award_type_id ? undefined : a.award_name,
      })));
      seeded.current = true;
    }
  }, [existing]);

  const saveAwards = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/awards`, body), [`/fixtures/${fixtureId}/awards`, ...invalidate]);

  const recipientFor = (type: MatchAwardType | undefined, current?: AwardItem): Pick<AwardItem, 'recipient_user_id' | 'recipient_team_id'> =>
    type?.recipient_kind === 'team'
      ? { recipient_user_id: null, recipient_team_id: current?.recipient_team_id && teams.some((t) => t.id === current.recipient_team_id) ? current.recipient_team_id : teams[0]?.id ?? null }
      : { recipient_team_id: null, recipient_user_id: current?.recipient_user_id && people.some((p) => p.id === current.recipient_user_id) ? current.recipient_user_id : people[0]?.id ?? null };

  const addRow = () => {
    const first = types[0];
    setRows((r) => [...r, { award_type_id: first?.id ?? '', ...recipientFor(first) }]);
  };
  const changeType = (i: number, typeId: string) => setRows((r) => r.map((row, idx) =>
    idx === i ? { ...row, award_type_id: typeId, legacy: undefined, ...recipientFor(typeById.get(typeId), row) } : row));
  const update = (i: number, patch: Partial<AwardItem>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const problem = rows.some((r) => !r.award_type_id || !typeById.has(r.award_type_id))
    ? 'Pick an award for every row, or remove it'
    : rows.some((r) => !r.recipient_user_id && !r.recipient_team_id) ? 'Pick who gets each award' : null;

  const save = () => {
    if (problem) { toast.error(problem); return; }
    saveAwards.mutate({ awards: rows.map(toInput) }, { onSuccess: () => toast.success('Awards saved'), onError: (e: any) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader title="Awards" subtitle="Pick an award and who gets it - e.g. Player of the Match. Multiple allowed." />
      <CardBody className="space-y-3">
        {people.length === 0 && teams.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No players on the team rosters yet - add players to a team to give awards.</p>
        ) : !typesLoading && types.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No awards are set up for this sport yet. A platform admin can add them under Award Types.</p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No awards yet.</p>}
            {rows.map((row, i) => {
              const type = typeById.get(row.award_type_id);
              return (
                <div key={i} data-qa="award-row" className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label="Award" hint={row.legacy ? `Was typed as "${row.legacy}" - pick its award to keep it` : undefined}>
                    <Select className="w-full" data-qa="award-type-select" value={type ? row.award_type_id : ''} onChange={(e) => changeType(i, e.target.value)}>
                      <option value="" disabled>Choose an award…</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.recipient_kind === 'team' ? ' (team)' : ''}</option>)}
                    </Select>
                  </Field>
                  <Field label={type?.recipient_kind === 'team' ? 'Team' : 'Player'}>
                    {type?.recipient_kind === 'team' ? (
                      <Select className="w-full" data-qa="award-team-select" value={row.recipient_team_id ?? ''} onChange={(e) => update(i, { recipient_team_id: e.target.value })}>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </Select>
                    ) : (
                      <Select className="w-full" data-qa="award-player-select" value={row.recipient_user_id ?? ''} disabled={!type} onChange={(e) => update(i, { recipient_user_id: e.target.value })}>
                        {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.team}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Button variant="ghost" size="sm" className="sm:mt-7" onClick={() => remove(i)} aria-label="Remove award" title="Remove">
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" size="sm" onClick={addRow} disabled={types.length === 0}>+ Add award</Button>
              <Button size="sm" data-qa="awards-save" disabled={saveAwards.isPending || !!problem} title={problem ?? undefined} onClick={save}>
                {saveAwards.isPending ? 'Saving…' : 'Save awards'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------- What follows a result, where the result is ------------------- */
/**
 * THE TWO THINGS THAT COME AFTER A SCORELINE.
 *
 * Confirming the score writes it and stops. It does not make the result official,
 * and it does not record who won the match for their side. Both of those already
 * existed on this page - the lock in a banner above the console, the awards in a
 * form well below it - but neither is where an official is looking at the moment
 * they finish a match, and for every sport on the team deck the banner was not
 * rendered at all. So this repeats those two actions inside the end-of-match card.
 *
 * THE ORDER IS NOT COSMETIC. `PATCH /fixtures/:id/awards` runs `assertNotLocked`,
 * so an award given after the lock is refused: locking is genuinely last, and the
 * button says so rather than letting somebody find out from a toast.
 *
 * Deliberately just "Player of the match", not the whole awards form - it is the
 * one award nearly every match gives, and the full form is still downstairs for a
 * second one. A replace-all save would drop those, so any award that is NOT the
 * player of the match is carried through untouched.
 */
function PostMatchActions({ fixture, fixtureId, invalidate }:
  { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const { people } = matchSides(fixture);
  const { data: types } = useMatchAwardTypes(fixture);
  // Only when the super admin offers Player of the Match for this sport.
  const potmType = types?.find((t) => t.code === POTM_CODE && t.recipient_kind === 'player');
  const { data: existing } = useApi<AwardRow[]>(`/fixtures/${fixtureId}/awards`);
  const locked = fixture.scorecard_status === 'locked';
  const potm = potmType ? existing?.find((a) => a.award_type_id === potmType.id) : undefined;
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState('');

  const saveAwards = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/awards`, body),
    [`/fixtures/${fixtureId}/awards`, ...invalidate]);
  const lock = useApiMutation(() => api('POST', `/fixtures/${fixtureId}/lock`, {}), invalidate);

  const giveAward = (recipient: string) => {
    if (!potmType) return;
    // A replace-all save: carry every other award through untouched. An award typed
    // before the catalogue has no type, and can't be re-saved until one is picked.
    if ((existing ?? []).some((a) => !a.award_type_id)) {
      toast.error('Pick an award type for the older awards first', 'Use the Awards panel below the scoreboard.');
      return;
    }
    const others = (existing ?? []).filter((a) => a.award_type_id !== potmType.id).map(toInput);
    const awards = recipient
      ? [...others, { award_type_id: potmType.id, recipient_user_id: recipient, recipient_team_id: null }]
      : others;
    saveAwards.mutate({ awards }, {
      onSuccess: () => { setPicking(false); toast.success(recipient ? 'Player of the match recorded' : 'Award removed'); },
      onError: (e: any) => toast.error(e.message),
    });
  };

  const doLock = async () => {
    if (potmType && !potm && !locked) {
      const ok = await confirmDialog({
        title: 'Lock without a player of the match?',
        message: 'A locked scorecard cannot be changed, and that includes its awards - this match would keep no player of the match unless it is unlocked again.',
        confirmLabel: 'Lock anyway',
      });
      if (!ok) return;
    }
    lock.mutate(undefined, {
      onSuccess: () => toast.success('Scorecard locked', 'This result is now official.'),
      onError: (e: any) => toast.error(e.message),
    });
  };

  return (
    <div data-qa="post-match" className="w-full max-w-sm space-y-2">
      {/* ---- the award ---- */}
      {potmType && people.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-2.5 dark:bg-slate-800/60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Player of the match</p>
          {potm && !picking ? (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">🏅 {potm.recipient_name ?? 'Recorded'}</span>
              {!locked && (
                <Button variant="subtle" size="sm" data-qa="potm-change"
                  onClick={() => { setChoice(potm.recipient_user_id ?? ''); setPicking(true); }}>Change</Button>
              )}
            </div>
          ) : locked ? (
            <p className="mt-1 text-sm text-muted">Not recorded. The scorecard is locked, so it can no longer be added.</p>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              {/* Its own shrinkable slot: Select's wrapper never shrinks and sizes to the
                  longest option ("Name · Long team name"), which pushed Save out of the box. */}
              <div className="min-w-0 flex-1">
                <Select className="w-full" value={choice} data-qa="potm-select"
                  onChange={(e) => setChoice(e.target.value)}>
                  <option value="">Nobody</option>
                  {people.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.team}</option>)}
                </Select>
              </div>
              <Button size="sm" className="shrink-0" data-qa="potm-save" disabled={saveAwards.isPending} onClick={() => giveAward(choice)}>
                {saveAwards.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- the lock ---- */}
      {locked ? (
        <div className="rounded-xl border border-line bg-slate-50 px-3 py-2 text-center text-sm dark:bg-slate-800/60">
          <span className="font-semibold">🔒 Scorecard locked</span>
          <span className="text-muted"> - official and permanent.</span>
        </div>
      ) : (
        <>
          <Button size="lg" className="w-full" data-qa="post-match-lock" disabled={lock.isPending} onClick={doLock}>
            {lock.isPending ? 'Locking…' : 'Lock scorecard'}
          </Button>
          <p className="text-center text-[11px] text-muted">
            Locking makes the result official and permanent, and is the last step - awards cannot be changed afterwards. Organiser only.
          </p>
        </>
      )}
    </div>
  );
}

/* --------------------------- Racquet console ---------------------------- */
/**
 * The five racquet sports score through the rally kernel. This wrapper does three
 * things and nothing else: resolve which format is in force, persist the append-only
 * rally log, and derive the headline the rest of the platform reads.
 *
 * The rally log lives in `live_state.rally` and the resolved format is SNAPSHOTTED
 * into `live_state.format` on the first tap - a played match must stay reproducible
 * under the rules it was played under, even if the format is edited afterwards.
 * `live_log` continues to carry the human-readable timeline so every existing reader
 * keeps working.
 */
function RacquetConsole({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const resolved = useMemo(() => racquetFormatFor(fixture, (live?.live_state as any)?.format),
    [fixture, live?.live_state]);

  const [log, setLog] = useState<RallyLog>(() => hydrateRally(live?.live_state));
  const [firstServer, setFirstServer] = useState<Side>(() => hydrateFirstServer(live?.live_state));
  // Which pairs list their second roster player first (chosen as first server/receiver).
  const [pairSwap, setPairSwap] = useState<{ A: boolean; B: boolean }>(() => hydratePairSwap(live?.live_state));
  // Who is playing, when the squad is bigger than the match.
  const [named, setNamed] = useState<RubberLineup | undefined>(() => readLineup(live?.live_state?.lineup));
  const [skipped, setSkipped] = useState<boolean>(() => live?.live_state?.lineupSkipped === true);
  const [pickingPlayers, setPickingPlayers] = useState(false);
  const [status, setStatus] = useState<string>(fixture.status);
  const [busy, setBusy] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && live) {
      setLog(hydrateRally(live.live_state));
      setFirstServer(hydrateFirstServer(live.live_state));
      setPairSwap(hydratePairSwap(live.live_state));
      setNamed(readLineup(live.live_state?.lineup));
      setSkipped(live.live_state?.lineupSkipped === true);
      seeded.current = true;
    }
  }, [live]);

  const persist = useLiveSave(fixtureId, invalidate);

  const homeRoster = useMemo(() => rosterPeople(homeTeam(fixture)), [fixture]);
  const awayRoster = useMemo(() => rosterPeople(awayTeam(fixture)), [fixture]);
  const size = playersPerSide(fixture?.tournament_disciplines?.disciplines?.entry_type);
  // The same rule the stat writer applies, so the console and careers never disagree.
  const who = resolveMatchLineup(
    { lineup: named, lineupSkipped: skipped, pairSwap },
    { A: homeRoster.map((p) => p.id), B: awayRoster.map((p) => p.id) },
    size,
  );
  const nameOfId = useMemo(() => new Map([...homeRoster, ...awayRoster].map((p) => [p.id, p.name])), [homeRoster, awayRoster]);
  const namesOf = (ids?: string[]) => ids?.map((id) => nameOfId.get(id) ?? '-');
  // Nobody named (skipped): a singles match still serves as singles, under the side names.
  const pairing: Pairing | undefined = who.lineup
    ? { A: namesOf(who.lineup.A)!, B: namesOf(who.lineup.B)! }
    : size === 1 ? { A: [teamLabel(homeTeam(fixture))], B: [teamLabel(awayTeam(fixture))] } : undefined;
  const squadIsBigger = homeRoster.length > size || awayRoster.length > size;
  // Singles plays a side-out format with one server per turn - the stat writer folds the same way.
  const format = resolved.format ? formatForPairing(resolved.format, pairing) : resolved.format;

  if (!format) {
    return <EmptyState title="No scoring format" description="This sport has no racquet format configured." />;
  }

  const save = (nextLog: RallyLog, state: KernelState, done: boolean, after?: () => void,
    lineupOver?: { lineup?: RubberLineup; lineupSkipped: boolean }, suspend = false) => {
    const env = resultEnvelope(format, state);
    // A match is only ever completed when the KERNEL says it ended - a target
    // reached by the required margin, a cap, or an explicit end event (retire,
    // walkover, award). Without this a sign-off part-way through game one wrote
    // `completed` with a 0-0 headline and no winner, which standings then read as a
    // legitimate draw. The deck no longer offers it, and this makes it unreachable
    // even if another caller asks.
    const reallyDone = done && env.ended;
    // A walkover from the deck is saved exactly like the Walkover button's: its own
    // status and no scoreline, so the record never shows a match nobody played.
    const walkover = reallyDone && state.reason === 'walkover';
    // A suspended match is postponed with its score; the next point tapped resumes it.
    const st = suspend
      ? 'postponed'
      : walkover
      ? 'walkover'
      : reallyDone
      ? 'completed'
      : (status === 'scheduled' || status === 'completed' || status === 'confirmed' || status === 'postponed' ? 'live' : status);
    const winner_team_id = !reallyDone || env.winner === null
      ? null
      : env.winner === 'A' ? fixture.home_team_id : fixture.away_team_id;
    setStatus(st);
    // A SCORE TAP NEVER FREEZES THE PAD. `busy` disables every button on the deck,
    // which is right while a sign-off is being written - that one must not be
    // double-submitted - and exactly wrong for an ordinary tap: on a slow
    // connection it locked the scorer out of the pad between every single point.
    // The outbox behind `persist` has already made the tap durable by the time the
    // request leaves, so there is nothing left for the pad to wait on.
    if (done) setBusy(true);
    persist.mutate(
      {
        live_state: {
          ...(live?.live_state ?? {}),
          rally: nextLog,
          firstServer,
          pairSwap,
          lineup: lineupOver ? lineupOver.lineup : named,
          lineupSkipped: lineupOver ? lineupOver.lineupSkipped : skipped,
          // Playing time, kept for scheduling reports (how long a format really takes).
          timing: rallyTiming(format, nextLog, firstServer),
          // Snapshot on first write, then leave alone.
          format: (live?.live_state as any)?.format ?? format,
          // Abandoned, or called off drawn: shared points (or none, the official's choice) whatever the score.
          noResult: reallyDone && drawSettlement(state, nextLog).noResult,
          drawNoPoints: reallyDone && drawSettlement(state, nextLog).drawNoPoints,
        },
        live_log: rallyTimeline(format, nextLog, firstServer, teamLabel(homeTeam(fixture)), teamLabel(awayTeam(fixture))),
        // A walkover carries the format's walkover scoreline (2-0), unless the organiser enters it.
        home_score: walkover && format.endStates.walkoverScoreline === 'organiserEnters' ? null : env.headline[0],
        away_score: walkover && format.endStates.walkoverScoreline === 'organiserEnters' ? null : env.headline[1],
        status: st,
        winner_team_id,
      },
      {
        onSuccess: () => { setBusy(false); after?.(); },
        // Releasing the button and saying so is ALL this does - the tap is still in
        // the outbox, and the retry loop will keep trying until it lands.
        onError: (e: any) => { setBusy(false); toast.error(e.message); },
      },
    );
  };

  const storeLineup = (lineup: RubberLineup | undefined, lineupSkipped: boolean) => {
    setNamed(lineup); setSkipped(lineupSkipped); setPickingPlayers(false);
    save(log, foldRally(format, log, firstServer).state, false, undefined, { lineup, lineupSkipped });
  };

  // A squad bigger than the match must say who is on court before the first point.
  if (pickingPlayers || who.source === 'legacy') {
    return (
      <LineupPanel
        title={disciplineLabel(fixture)}
        size={size}
        sides={[
          { side: 'A', name: orgTitle(homeTeam(fixture)) || teamLabel(homeTeam(fixture)), org: teamLabel(homeTeam(fixture)), roster: homeRoster },
          { side: 'B', name: orgTitle(awayTeam(fixture)) || teamLabel(awayTeam(fixture)), org: teamLabel(awayTeam(fixture)), roster: awayRoster },
        ]}
        initial={named}
        onSave={(l) => storeLineup(l, false)}
        onSkip={() => storeLineup(undefined, true)}
        onCancel={pickingPlayers ? () => setPickingPlayers(false) : undefined}
        disabled={busy}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {squadIsBigger && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {who.source === 'skipped'
            ? <span>Players not named - this result counts for the team only.</span>
            : <span>Players: {namesOf(who.lineup?.A)?.join(' / ')} vs {namesOf(who.lineup?.B)?.join(' / ')}</span>}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setPickingPlayers(true)}>
            {who.source === 'skipped' ? 'Name players' : 'Change players'}
          </button>
        </div>
      )}
      <RacquetDeck
        format={format}
        provenance={resolved.source}
        homeName={teamLabel(homeTeam(fixture))}
        awayName={teamLabel(awayTeam(fixture))}
        homeOrg={orgTitle(homeTeam(fixture))}
        awayOrg={orgTitle(awayTeam(fixture))}
        pairing={pairing}
        matchKey={fixtureId}
        homePlayers={namesOf(who.lineup?.A)}
        awayPlayers={namesOf(who.lineup?.B)}
        log={log}
        firstServer={firstServer}
        busy={busy}
        onFirstServerChange={(s) => { setFirstServer(s); }}
        // A named pair is reordered in place; a roster pair keeps the swap flag.
        onSwapPair={(s) => {
          if (named) storeLineup({ ...named, [s]: [...named[s]].reverse() }, false);
          else setPairSwap((cur) => ({ ...cur, [s]: !cur[s] }));
        }}
        onChange={(nextLog, state) => { setLog(nextLog); save(nextLog, state, false); }}
        onSignOff={(nextLog, state) => save(nextLog, state, true, onDone)}
        onSuspend={(nextLog, state) => save(nextLog, state, false, onDone, undefined, true)}
      />
    </div>
  );
}

/**
 * The carrom format for a fixture through the format ladder, and where it came from
 * (draw default, this match, sport default...). `frozen` wins once scoring has begun.
 */
function carromResolved(fixture: any, frozen: any) {
  const td = fixture?.tournament_disciplines ?? {};
  return resolveFormat(
    {
      scoring_format_id: fixture?.scoring_format_id ?? null,
      round: fixture?.round ?? null,
      stage_sequence: fixture?.stage_sequence ?? null,
      frozen_format: frozen ?? null,
      format_overrides: fixture?.format_overrides ?? null,
    },
    {
      scoring_format_id: td.scoring_format_id ?? null,
      scoring_preset_key: td.scoring_preset_key ?? null,
      round_formats: td.round_formats,
      sport: sportNameOf(fixture),
    },
    (fixture?.scoring_formats ?? []) as any[],
  );
}

/** The racquet rules for a fixture through the format ladder; `frozen` wins once scoring has begun. */
function racquetFormatFor(fixture: any, frozen: any) {
  const td = fixture?.tournament_disciplines ?? {};
  return resolveFormat(
    {
      scoring_format_id: fixture?.scoring_format_id ?? null,
      round: fixture?.round ?? null,
      stage_sequence: fixture?.stage_sequence ?? null,
      frozen_format: frozen ?? null,
      // The organiser's per-match rules, patched on top of whatever rung wins.
      format_overrides: fixture?.format_overrides ?? null,
    },
    { scoring_format_id: td.scoring_format_id ?? null, scoring_preset_key: td.scoring_preset_key ?? null, round_formats: td.round_formats, sport: sportNameOf(fixture) },
    // Formats referenced by id arrive with the fixture; otherwise the sport default.
    (fixture?.scoring_formats ?? []) as any[],
  );
}

/* ----------------------------- Cricket console ----------------------------- */
/**
 * Cricket's console. Same plumbing as RacquetConsole - resolve through the ladder,
 * persist an append-only log, snapshot the rules on first score - and a different
 * engine underneath, because none of the kernel's vocabulary fits a delivery.
 *
 * The format comes from `resolveMatchFormat`, which walks the SAME seven rungs as
 * every other sport. That is the whole point of the union: "the Final plays a full
 * twenty overs but the group games are tens" is set exactly where "the Final is best
 * of five" is set, and behaves identically.
 */
function CricketConsole({ fixture, fixtureId, live, invalidate, onDone, onOpenAdmin }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[];
    onDone: () => void; onOpenAdmin?: () => void }) {
  const sport = sportNameOf(fixture);
  const td = fixture?.tournament_disciplines ?? {};

  const resolved = useMemo(() => resolveMatchFormat(
    {
      scoring_format_id: fixture?.scoring_format_id ?? null,
      round: fixture?.round ?? null,
      stage_sequence: fixture?.stage_sequence ?? null,
      frozen_format: (live?.live_state as any)?.format ?? null,
      // The organiser's per-match rules, patched on top of whatever rung wins.
      format_overrides: fixture?.format_overrides ?? null,
    },
    { scoring_format_id: td.scoring_format_id ?? null, scoring_preset_key: td.scoring_preset_key ?? null, round_formats: td.round_formats, sport },
    (fixture?.scoring_formats ?? []) as any[],
  ), [fixture, live?.live_state, sport, td.round_formats, td.scoring_format_id]);

  const [log, setLog] = useState<CricketLog>(() => hydrateCricket(live?.live_state));
  const [status, setStatus] = useState<string>(fixture.status);
  const [busy, setBusy] = useState(false);
  // The team sheet, kept here and sent with every save (see TeamConsole).
  const [sheet, setSheet] = useState<TeamSheet | null>(() => readTeamSheet(live?.live_state));
  const [editingSheet, setEditingSheet] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && live) {
      setLog(hydrateCricket(live.live_state));
      setSheet(readTeamSheet(live.live_state));
      seeded.current = true;
    }
  }, [live]);

  const persist = useLiveSave(fixtureId, invalidate);
  const format = resolved.format;
  const squads = useMemo(() => ({ A: sheetSquad(homeTeam(fixture)), B: sheetSquad(awayTeam(fixture)) }), [fixture]);

  // The ladder returns the union; only a cricket format can drive this console. A
  // rally format here would mean the sport was mis-routed, which is worth saying
  // rather than rendering a broken deck.
  if (!isCricketFormat(format)) {
    return <EmptyState title="No cricket format" description="This draw has no cricket format configured." />;
  }

  const save = (nextLog: CricketLog, state: CricketState, done: boolean, after?: () => void) => {
    // Completed only when the ENGINE says the match ended - a chase passed, the last
    // innings closed, or an explicit end event. The racquet deck once allowed a
    // sign-off part-way through and wrote a completed 0-0 that standings read as a
    // draw; this makes that unreachable here too.
    const reallyDone = done && state.ended;
    const st = reallyDone
      ? 'completed'
      : (status === 'scheduled' || status === 'completed' || status === 'confirmed' ? 'live' : status);
    const winner_team_id = !reallyDone || state.winner === null
      ? null
      : state.winner === 'A' ? fixture.home_team_id : fixture.away_team_id;
    const headline = cricketHeadline(state);
    setStatus(st);
    // A SCORE TAP NEVER FREEZES THE PAD. `busy` disables every button on the deck,
    // which is right while a sign-off is being written - that one must not be
    // double-submitted - and exactly wrong for an ordinary tap: on a slow
    // connection it locked the scorer out of the pad between every single point.
    // The outbox behind `persist` has already made the tap durable by the time the
    // request leaves, so there is nothing left for the pad to wait on.
    if (done) setBusy(true);
    persist.mutate(
      {
        live_state: {
          ...(live?.live_state ?? {}),
          cricket: nextLog,
          // Snapshot on first write, then leave alone - a played match stays
          // reproducible under the rules it was played under.
          format: (live?.live_state as any)?.format ?? format,
          ...(sheet ? { teamSheet: sheet } : {}),
          // Abandoned or drawn: standings share the points whatever the runs.
          noResult: reallyDone && (state.outcome === 'void' || state.outcome === 'draw'),
        },
        live_log: cricketTimeline(state, teamLabel(homeTeam(fixture)), teamLabel(awayTeam(fixture))),
        // The headline is RUNS per side, which is what standings compare.
        home_score: headline[0],
        away_score: headline[1],
        status: st,
        winner_team_id,
      },
      {
        onSuccess: () => { setBusy(false); after?.(); },
        // Releasing the button and saying so is ALL this does - the tap is still in
        // the outbox, and the retry loop will keep trying until it lands.
        onError: (e: any) => { setBusy(false); toast.error(e.message); },
      },
    );
  };

  // A cricket side is the format's own number - eleven, or six for a six-a-side - and a few
  // substitutes, who may field but never bat or bowl.
  const usual = { onField: format.playersPerSide, bench: 4 };
  const locked = fixture.scorecard_status === 'locked';
  const hasSquads = squads.A.length + squads.B.length > 0;

  // The sheet on its own: no status or score, so confirming it does not start the match.
  const saveSheet = (next: TeamSheet) => {
    setSheet(next);
    setEditingSheet(false);
    persist.mutate(
      {
        live_state: { ...(live?.live_state ?? {}), cricket: log, teamSheet: next },
        live_log: cricketTimeline(foldCricket(format, log).state, teamLabel(homeTeam(fixture)), teamLabel(awayTeam(fixture))),
      },
      { onError: (e: any) => toast.error(e.message) },
    );
  };

  const needsSheet = !sheet && log.length === 0 && !locked && hasSquads;
  if (needsSheet || editingSheet) {
    return (
      <TeamSheetPanel
        sportName={sport ?? 'Cricket'}
        usual={usual}
        sides={[
          { side: 'A', name: teamLabel(homeTeam(fixture)), org: orgLabel(homeTeam(fixture)), squad: squads.A },
          { side: 'B', name: teamLabel(awayTeam(fixture)), org: orgLabel(awayTeam(fixture)), squad: squads.B },
        ]}
        initial={sheet}
        onSave={saveSheet}
        onCancel={editingSheet ? () => setEditingSheet(false) : undefined}
        disabled={busy}
      />
    );
  }

  // Batters and bowlers come from the playing XI; substitutes only field. No sheet: the whole squad, as before.
  const named = (s: SheetPerson[], ids: string[]) => ids.map((id) => s.find((p) => p.id === id)).filter((p): p is SheetPerson => !!p)
    .map((p) => ({ id: p.id, name: p.name }));
  const xi = (side: 'A' | 'B') => (sheet ? named(squads[side], sheet[side].playing) : squads[side].map((p) => ({ id: p.id, name: p.name })));
  const subs = (side: 'A' | 'B') => (sheet ? named(squads[side], sheet[side].bench) : []);

  return (
    <>
    {!locked && hasSquads && (
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {sheet
            ? `Team sheet: ${sheet.A.playing.length} + ${sheet.A.bench.length} subs · ${sheet.B.playing.length} + ${sheet.B.bench.length} subs`
            : 'No team sheet - the whole squads bat and bowl.'}
        </span>
        <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setEditingSheet(true)}>
          {sheet ? 'Change' : 'Add team sheet'}
        </button>
      </div>
    )}
    <CricketDeck
      format={format}
      provenance={resolved.source}
      homeName={teamLabel(homeTeam(fixture))}
      awayName={teamLabel(awayTeam(fixture))}
      homeOrg={orgLabel(homeTeam(fixture))}
      awayOrg={orgLabel(awayTeam(fixture))}
      homeSquad={xi('A')}
      awaySquad={xi('B')}
      homeSubs={subs('A')}
      awaySubs={subs('B')}
      everyone={[...squads.A, ...squads.B].map((p) => ({ id: p.id, name: p.name }))}
      log={log}
      busy={busy}
      onOpenAdmin={onOpenAdmin}
      onChange={(nextLog, state) => { setLog(nextLog); save(nextLog, state, false); }}
      onSignOff={(nextLog, state) => save(nextLog, state, true, onDone)}
    />
    <WalkoverRow fixture={fixture} fixtureId={fixtureId} invalidate={invalidate} onDone={onDone} />
    </>
  );
}

/** The ball log off live_state, defensively - a hand-edited state must not throw. */
function hydrateCricket(liveState: any): CricketLog {
  const raw = liveState?.cricket;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e: any) => e && typeof e === 'object' && typeof e.t === 'string');
}

/** The human-readable timeline every existing reader of live_log expects. */
function cricketTimeline(state: CricketState, homeName: string, awayName: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const inn of state.innings) {
    const side = inn.battingSide === 'A' ? homeName : awayName;
    out.unshift({
      t: inn.superOver ? `Super Over ${inn.superOver}` : `Innings ${inn.innings}`,
      team: inn.battingSide,
      txt: `${side} ${inningsLine(inn, state.format.ballsPerOver)}`
        + (inn.endedBy ? ` - ${inn.endedBy.replace('_', ' ')}` : ''),
      kind: 'innings',
    });
  }
  if (state.margin) {
    out.unshift({ t: 'Result', txt: state.margin, kind: 'end' });
  }
  return out.slice(0, 80);
}

/** The human-readable timeline every existing reader of live_log expects. */
/** Readable text for the non-rally events in the saved match timeline. */
const RALLY_EVENT_TEXT: Record<string, string> = {
  expedite: 'Expedite system in',
  switchPairServer: 'Doubles order changed for this game',
  switchReceiver: 'Receiving sides changed',
  setChoice: 'Set election at 8-all',
  switchBox: 'Service box switched',
  clockPause: 'Game clock paused',
  clockStart: 'Game clock resumed',
};

function rallyTimeline(format: any, log: RallyLog, firstServer: Side, homeName: string, awayName: string): LogEntry[] {
  const { trace } = foldRally(format, log, firstServer);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const out: LogEntry[] = [];
  trace.forEach((t, i) => {
    const unit = t.unitsWon.map((u) => `${u.label} ${u.score[0]}–${u.score[1]}`).join(' · ');
    const ev = t.event;
    const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');
    const txt = ev.t === 'point'
      ? (t.scored ? `${ev.kind === 'ace' ? 'Ace - point' : 'Point'} to ${nameOf(t.scored)}` : `${nameOf(ev.side)} won the rally - no point`)
      : ev.t === 'fault' ? (t.scored ? `Double fault · ${nameOf(ev.side)} - point to ${nameOf(t.scored)}` : `Fault · ${nameOf(ev.side)}`)
      : ev.t === 'card' ? `${misconductTerms(format?.sport).warning} to ${nameOf(ev.against)}`
      : ev.t === 'timeout' ? `Timeout - ${nameOf(ev.side)}`
      : ev.t === 'penalty' && ev.card === 'red' ? `${misconductTerms(format?.sport).foul} to ${nameOf(other(ev.side))} - point to ${nameOf(ev.side)}`
      : ev.t === 'end' && ev.reason === 'disqualified' && ev.winner ? `${nameOf(other(ev.winner))} disqualified`
      : RALLY_EVENT_TEXT[ev.t] ?? ev.t;
    out.unshift({
      t: `#${i + 1}`,
      team: t.scored ?? undefined,
      txt: unit ? `${txt} · ${unit}` : txt,
      kind: t.event.t,
    });
  });
  return out.slice(0, 80);
}

/* ----------------------------- Team console ----------------------------- */
/**
 * The kernel console for every non-racquet family.
 *
 * Identical plumbing to RacquetConsole - resolve the format, persist an append-only
 * log, snapshot the rules on first score - and a different deck, because a football
 * half ends on a whistle rather than a score and a goal belongs to a person.
 */
/* ----------------------------- Chess console ----------------------------- */
/** The headline is game points (2½-½), which is why fixture scores hold halves. */
function ChessConsole({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const td = fixture?.tournament_disciplines ?? {};
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const format = useMemo(() => resolveFormat(
    {
      scoring_format_id: fixture?.scoring_format_id ?? null,
      round: fixture?.round ?? null,
      stage_sequence: fixture?.stage_sequence ?? null,
      frozen_format: (live?.live_state as any)?.format ?? null,
      format_overrides: fixture?.format_overrides ?? null,
    },
    {
      scoring_format_id: td.scoring_format_id ?? null,
      // Nothing chosen: a Rapid or Blitz draw plays at its own pace, not the classical
      // default. Given to the ladder as the draw's preset, so per-match changes still apply.
      scoring_preset_key: td.scoring_preset_key
        ?? (td.scoring_format_id ? null : chessPresetForDiscipline(td.disciplines?.name)?.presetKey ?? null),
      round_formats: td.round_formats,
      sport: sportNameOf(fixture),
    },
    (fixture?.scoring_formats ?? []) as any[],
  ).format, [fixture, live?.live_state, td.round_formats, td.scoring_format_id, td.scoring_preset_key, td.disciplines?.name]);
  const gamesInMatch = chessGamesIn(format);
  const timeControl = describeTimeControl(format?.rulesSheet?.timeControl);
  const initial = useMemo(() => hydrateChess(live?.live_state?.chess), [live?.live_state?.chess]);
  const persist = useLiveSave(fixtureId, invalidate);
  const [status, setStatus] = useState<string>(fixture.status);

  const save = (state: ChessState, done: boolean) => {
    const s = chessSummary(state, gamesInMatch);
    const winner_team_id = s.winner === 'A' ? fixture.home_team_id : s.winner === 'B' ? fixture.away_team_id : null;
    const st = done ? 'completed' : (status === 'scheduled' || status === 'completed' ? 'live' : status);
    const live_log: LogEntry[] = state.games.map((g, i) => ({
      t: '', team: g.result === 'draw' ? undefined : g.result,
      txt: `Game ${i + 1}: ${g.result === 'draw' ? 'drawn' : `${g.result === 'A' ? homeName : awayName} won`}${g.ending ? ` (${CHESS_ENDINGS[g.ending].label.toLowerCase()})` : ''}`,
    }));
    persist.mutate(
      {
        // The rules are frozen with the first result, as every other console does - so
        // changing the draw from "Best of 3" to "Single game" cannot end a match at 1-0.
        live_state: {
          ...(live?.live_state ?? {}),
          chess: state,
          ...(!(live?.live_state as any)?.format && format && state.games.length ? { format } : {}),
        },
        live_log,
        home_score: state.games.length ? s.points[0] : null,
        away_score: state.games.length ? s.points[1] : null,
        status: st,
        winner_team_id: done || s.decided ? winner_team_id : null,
      },
      {
        onSuccess: () => { setStatus(st); if (done) onDone(); },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  return (
    <>
      <ChessResult homeName={homeName} awayName={awayName} gamesInMatch={gamesInMatch} needsWinner={isKnockoutFixture(fixture ?? {})}
        timeControl={timeControl} initial={initial}
        busy={persist.isPending} onSave={save} />
      <WalkoverRow fixture={fixture} fixtureId={fixtureId} invalidate={invalidate} onDone={onDone} />
    </>
  );
}

/* ----------------------------- Carrom console ----------------------------- */
/** Board by board: the points follow from each board's result (carrom.ts). */
function CarromConsole({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const resolved = useMemo(() => carromResolved(fixture, (live?.live_state as any)?.format), [fixture, live?.live_state]);
  const format = resolved.format as ScoringFormat | null;
  const rules = useMemo(() => carromRulesOf(format), [format]);
  const initial = useMemo(() => hydrateCarrom(live?.live_state?.carrom), [live?.live_state?.carrom]);
  const persist = useLiveSave(fixtureId, invalidate);
  const [status, setStatus] = useState<string>(fixture.status);

  const save = (state: CarromState, done: boolean) => {
    const m = carromMatchOf(state, rules);
    const [h, a] = carromHeadline(m, rules);
    const winner_team_id = m.winner === 'A' ? fixture.home_team_id : m.winner === 'B' ? fixture.away_team_id : null;
    const st = done ? 'completed' : (status === 'scheduled' || status === 'completed' ? 'live' : status);
    const live_log: LogEntry[] = m.games.flatMap((g, gi) => g.boards.map((b, bi) => ({
      t: '', team: b.winner,
      txt: `Game ${gi + 1}, board ${bi + 1}: ${b.winner === 'A' ? homeName : awayName} won ${b.points}${b.slam ? ' (slam)' : ''}`,
    })));
    persist.mutate(
      {
        // The rules freeze with the first board, as every other console does.
        live_state: {
          ...(live?.live_state ?? {}),
          carrom: state,
          ...(!(live?.live_state as any)?.format && format && state.boards.length ? { format } : {}),
        },
        live_log,
        home_score: state.boards.length ? h : null,
        away_score: state.boards.length ? a : null,
        status: st,
        winner_team_id: done || m.decided ? winner_team_id : null,
      },
      {
        onSuccess: () => { setStatus(st); if (done) onDone(); },
        onError: (e: any) => toast.error(e.message),
      },
    );
  };

  return (
    <>
      <CarromResult homeName={homeName} awayName={awayName} rules={rules} formatName={format?.name} provenance={resolved.source}
        initial={initial} busy={persist.isPending} onSave={save} />
      <WalkoverRow fixture={fixture} fixtureId={fixtureId} invalidate={invalidate} onDone={onDone} />
    </>
  );
}

function TeamConsole({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const sport = sportNameOf(fixture);
  const td = fixture?.tournament_disciplines ?? {};

  const resolved = useMemo(() => resolveFormat(
    {
      scoring_format_id: fixture?.scoring_format_id ?? null,
      round: fixture?.round ?? null,
      stage_sequence: fixture?.stage_sequence ?? null,
      frozen_format: (live?.live_state as any)?.format ?? null,
      // The organiser's per-match rules, patched on top of whatever rung wins.
      format_overrides: fixture?.format_overrides ?? null,
    },
    { scoring_format_id: td.scoring_format_id ?? null, scoring_preset_key: td.scoring_preset_key ?? null, round_formats: td.round_formats, sport },
    (fixture?.scoring_formats ?? []) as any[],
  ), [fixture, live?.live_state, sport, td.round_formats, td.scoring_format_id]);

  const [log, setLog] = useState<RallyLog>(() => hydrateRally(live?.live_state));
  const [status, setStatus] = useState<string>(fixture.status);
  const [busy, setBusy] = useState(false);
  // The team sheet: kept here and sent with EVERY save, because a save replaces the
  // whole live state and the fetched copy can be a step behind.
  const [sheet, setSheet] = useState<TeamSheet | null>(() => readTeamSheet(live?.live_state));
  const [editingSheet, setEditingSheet] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && live) {
      setLog(hydrateRally(live.live_state));
      setSheet(readTeamSheet(live.live_state));
      seeded.current = true;
    }
  }, [live]);

  const persist = useLiveSave(fixtureId, invalidate);
  const format = resolved.format;
  // Team sports whose actions are credited to a person - combat and board sports have
  // nobody to pick, and netball or tug of war record no individual actions to narrow.
  const usual = (statSpecFor(sport)?.events?.length ?? 0) > 0 ? usualSide(sport, format?.rulesSheet) : null;

  const squads = useMemo(() => ({ A: sheetSquad(homeTeam(fixture)), B: sheetSquad(awayTeam(fixture)) }), [fixture]);
  // Full rosters, not just two: an invasion sport attributes to eleven people, so
  // the pairing shortcut the racquet deck uses would drop most of the squad. With a
  // team sheet, the pickers offer the players on the field, and the substitutes one
  // tap away - never the rest of the squad. With none, the whole squad, as before.
  const roster = useMemo(() => {
    const pick = (side: 'A' | 'B') => (sheet
      ? matchdaySquad(squads[side], { playing: sheet[side].playing, bench: [] })
      : squads[side]).map((x) => ({ id: x.id, name: x.name }));
    return { A: pick('A'), B: pick('B') };
  }, [squads, sheet]);
  const bench = useMemo(() => {
    const pick = (side: 'A' | 'B') => (sheet ? matchdaySquad(squads[side], { playing: [], bench: sheet[side].bench }) : [])
      .map((x) => ({ id: x.id, name: x.name }));
    return { A: pick('A'), B: pick('B') };
  }, [squads, sheet]);

  /**
   * A RUNNING CLOCK KEEPS SAYING SO.
   *
   * Between kick-off and the first goal a football console can go ten minutes
   * without an event, which means ten minutes in which the ONLY record that the
   * half is under way is the single `clockStart` written at the whistle. If that
   * one write is the one that didn't land, the clock is not merely wrong on reload
   * - the match never started. Re-sending every ten seconds costs one small request
   * a minute and removes the single point of failure, and it keeps the stored
   * reading (see clockSnapshot) fresh for the spectator views that read it.
   *
   * Explicitly a background save: no spinner, no disabled pad, nothing on screen.
   * These hooks sit above the `!format` return, because hooks cannot be conditional;
   * the interval body checks for it instead.
   */
  const logRef = useRef(log);
  logRef.current = log;
  const saveRef = useRef<((l: RallyLog, st: KernelState, done: boolean, after?: () => void, quiet?: boolean) => void) | null>(null);
  const clockRunning = clockReading(log, 0, Date.now()).running;
  const locked = fixture.scorecard_status === 'locked';
  useEffect(() => {
    if (!clockRunning || locked || !format) return;
    const id = window.setInterval(() => {
      const l = logRef.current;
      saveRef.current?.(l, foldRally(format, l, 'A').state, false, undefined, true);
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [clockRunning, locked, format]);

  if (!format) {
    return <EmptyState title="No scoring format" description="This sport has no kernel format configured." />;
  }

  const save = (nextLog: RallyLog, state: KernelState, done: boolean, after?: () => void, quiet = false, suspend = false) => {
    const env = resultEnvelope(format, state);
    // Only the KERNEL ends a match - the same guard the racquet console keeps, so a
    // sign-off part-way through cannot publish a 0-0 with no winner.
    const reallyDone = done && env.ended;
    // A suspended match is postponed with its score; the next tap resumes it.
    const st = suspend
      ? 'postponed'
      : reallyDone
      ? 'completed'
      : (status === 'scheduled' || status === 'completed' || status === 'confirmed' || status === 'postponed' ? 'live' : status);
    const winner_team_id = !reallyDone || env.winner === null
      ? null
      : env.winner === 'A' ? fixture.home_team_id : fixture.away_team_id;
    setStatus(st);
    // A SCORE TAP NEVER FREEZES THE PAD. `busy` disables every button on the deck,
    // which is right while a sign-off is being written - that one must not be
    // double-submitted - and exactly wrong for an ordinary tap: on a slow
    // connection it locked the scorer out of the pad between every single point.
    // The outbox behind `persist` has already made the tap durable by the time the
    // request leaves, so there is nothing left for the pad to wait on.
    if (done) setBusy(true);
    persist.mutate(
      {
        live_state: {
          ...(live?.live_state ?? {}),
          rally: nextLog,
          // The clock, written down as a field rather than left to be folded out of
          // the log. See clockSnapshot - the log stays authoritative, this is for
          // the readers that have no log to fold.
          clock: clockSnapshot(nextLog),
          format: (live?.live_state as any)?.format ?? format,
          ...(sheet ? { teamSheet: sheet } : {}),
          // Abandoned, or called off drawn: shared points (or none, the official's choice) whatever the score.
          noResult: reallyDone && drawSettlement(state, nextLog).noResult,
          drawNoPoints: reallyDone && drawSettlement(state, nextLog).drawNoPoints,
        },
        // The attributed actions ARE the timeline here, and what the fact writer
        // reads to fill fixture_events.
        live_log: teamTimeline(nextLog, teamLabel(homeTeam(fixture)), teamLabel(awayTeam(fixture)), format),
        home_score: env.headline[0],
        away_score: env.headline[1],
        status: st,
        winner_team_id,
      },
      {
        background: quiet,
        onSuccess: () => { setBusy(false); after?.(); },
        // Releasing the button and saying so is ALL this does - the tap is still in
        // the outbox, and the retry loop will keep trying until it lands.
        onError: quiet ? undefined : (e: any) => { setBusy(false); toast.error(e.message); },
      },
    );
  };
  saveRef.current = save;

  // The sheet on its own: no status or score is sent, so confirming it before kick-off
  // does not put the match live.
  const saveSheet = (next: TeamSheet) => {
    setSheet(next);
    setEditingSheet(false);
    persist.mutate(
      {
        live_state: { ...(live?.live_state ?? {}), rally: log, clock: clockSnapshot(log), teamSheet: next },
        live_log: teamTimeline(log, teamLabel(homeTeam(fixture)), teamLabel(awayTeam(fixture)), format),
      },
      { onError: (e: any) => toast.error(e.message) },
    );
  };

  const hasSquads = squads.A.length + squads.B.length > 0;
  // Before the first event of a team sport, the sheet comes first - pre-filled, to change or confirm.
  const needsSheet = !!usual && !sheet && log.length === 0 && !locked && hasSquads;
  if (usual && (needsSheet || editingSheet)) {
    return (
      <TeamSheetPanel
        sportName={sport ?? 'This sport'}
        usual={usual}
        sides={[
          { side: 'A', name: teamLabel(homeTeam(fixture)), org: orgLabel(homeTeam(fixture)), squad: squads.A },
          { side: 'B', name: teamLabel(awayTeam(fixture)), org: orgLabel(awayTeam(fixture)), squad: squads.B },
        ]}
        initial={sheet}
        onSave={saveSheet}
        onCancel={editingSheet ? () => setEditingSheet(false) : undefined}
        disabled={busy}
      />
    );
  }

  const sheetBar = usual && !locked && hasSquads && (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      <span>
        {sheet
          ? `Team sheet: ${sheet.A.playing.length} + ${sheet.A.bench.length} subs · ${sheet.B.playing.length} + ${sheet.B.bench.length} subs`
          : 'No team sheet - the whole squads are in the pickers.'}
      </span>
      <button type="button" className="font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setEditingSheet(true)}>
        {sheet ? 'Change' : 'Add team sheet'}
      </button>
    </div>
  );

  return (
    <>
    {sheetBar}
    <TeamDeck
      format={format}
      provenance={resolved.source}
      sportName={sport}
      homeName={teamLabel(homeTeam(fixture))}
      awayName={teamLabel(awayTeam(fixture))}
      homeShort={teamShort(homeTeam(fixture))}
      awayShort={teamShort(awayTeam(fixture))}
      homeOrg={orgLabel(homeTeam(fixture))}
      awayOrg={orgLabel(awayTeam(fixture))}
      roster={roster}
      bench={bench}
      // A substitute credited with something came on: the sheet records the swap.
      onSubstitute={(s, onId, offId) => sheet && saveSheet({ ...sheet, [s]: substitute(sheet[s], onId, offId) })}
      log={log}
      busy={busy}
      // A LOCKED RESULT IS READ-ONLY, and the console has to say so by being it.
      // Every write path behind this deck runs assertNotLocked, so while the deck
      // stayed live on a locked match each tap was a 409 dressed as a button - and
      // the card now sits directly under "official and permanent", which made an
      // enabled Undo beneath it a straight contradiction.
      disabled={fixture.scorecard_status === 'locked'}
      recorded={status === 'completed'}
      knockout={isKnockoutFixture(fixture ?? {})}
      afterResult={<PostMatchActions fixture={fixture} fixtureId={fixtureId} invalidate={invalidate} />}
      onChange={(nextLog, state) => { setLog(nextLog); save(nextLog, state, false); }}
      // NO onDone HERE. Confirming used to navigate straight back to the results
      // list, which is what made the award and the lock unreachable from the match
      // that had just finished: the console was gone before either was offered.
      // The card below now carries both, and leaving is the official's own choice.
      // Keep the deck's log too: an innings, minimum-chase or shoot-out sign-off adds
      // the ending event, and without it the deck kept showing the confirm card.
      onSignOff={(nextLog, state) => { setLog(nextLog); save(nextLog, state, true); }}
      onSuspend={(nextLog, state) => save(nextLog, state, false, onDone, false, true)}
    />
    <WalkoverRow fixture={fixture} fixtureId={fixtureId} invalidate={invalidate} onDone={onDone} defaultScore={formatWalkoverScore(format)}
      countsInDifference={!!format?.endStates?.countWalkoverInDifference} />
    </>
  );
}

/**
 * THE MATCH CLOCK, AS A STORED FIELD.
 *
 * The reading is DERIVED, and stays derived: `clockStart` / `clockPause` /
 * `clockAdjust` in the rally log, plus the wall clock, reconstruct the time exactly
 * on any device at any later moment. That is why closing the tab mid-half has never
 * needed a stored number to get the clock back - what it needed was for those three
 * events to actually reach the database, which before the outbox they often didn't.
 *
 * This writes the reading down anyway, for every reader that has no log to fold: the
 * spectator ticker, the public championship page, anything looking at live_state
 * directly, and an official checking whether the half really is recorded as running.
 * `at` is what keeps it honest - a running clock read a minute later is
 * `elapsedMs + (now - at)`, never `elapsedMs`.
 *
 * Nothing hydrates from this. The log remains the only source of truth.
 */
function clockSnapshot(log: RallyLog): { elapsedMs: number; running: boolean; at: string } | null {
  // fullMs only decides overrun/stoppage, which are presentation and are recomputed
  // by whoever renders this against the format they resolve - so 0 is correct here.
  const r = clockReading(log, 0, Date.now());
  if (!r.started) return null;
  return { elapsedMs: r.elapsedMs, running: r.running, at: new Date().toISOString() };
}

/**
 * The timeline for an attributed log.
 *
 * `playerId` is carried through so the fact writer can attribute the action - which
 * is the whole reason a kabaddi raid or a football goal can now reach somebody's
 * career record.
 */
function teamTimeline(log: RallyLog, homeName: string, awayName: string, format?: ScoringFormat | null): LogEntry[] {
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const minutes = format ? eventMinuteLabels(format, log) : [];
  const out: LogEntry[] = [];
  // Shoot-out kicks scored so far, so the closing line can carry the tally.
  const kicks: [number, number] = [0, 0];
  log.forEach((ev, i) => {
    const any = ev as any;
    const who = any.playerName ? ` · ${any.playerName}` : '';
    if (ev.t === 'penaltyKick' && ev.scored) kicks[ev.side === 'A' ? 0 : 1] += 1;
    const txt = ev.t === 'point'
      ? `${any.label ?? 'Point'}${any.pts > 1 ? ` (+${any.pts})` : ''}${who}`
      : ev.t === 'endPeriod' ? 'Period ended'
        : ev.t === 'clockStart' ? 'Clock started'
          : ev.t === 'clockPause' ? 'Clock paused'
            : ev.t === 'clockAdjust' ? `Clock corrected to ${formatClock(any.toMs ?? 0)}`
              : ev.t === 'penaltyKick' ? `Shoot-out kick ${ev.scored ? 'scored' : 'missed'} (${kicks[0]}–${kicks[1]})${who}`
                : ev.t === 'end' && ev.reason === 'penalties' && ev.winner
                  ? `${nameOf(ev.winner)} won ${ev.winner === 'A' ? kicks[0] : kicks[1]}–${ev.winner === 'A' ? kicks[1] : kicks[0]} on penalties`
                  : ev.t === 'end' ? 'Match ended'
                    : ev.t;
    out.unshift({
      // THE MINUTE, not the entry number, once the match has a clock running. This
      // is what is persisted and what every read-only view renders, so a goal shows
      // as 23' on the public page and not as "#7".
      t: minutes[i] ?? `#${i + 1}`,
      team: (any.side as Side) ?? (ev.t === 'end' ? any.winner ?? undefined : undefined),
      txt,
      ...(any.playerName ? { player: any.playerName } : {}),
      ...(any.playerId ? { playerId: any.playerId } : {}),
      ...(any.secondId ? { secondId: any.secondId, secondName: any.secondName } : {}),
      ...(any.value !== undefined ? { value: any.value } : {}),
      kind: any.kind ?? ev.t,
    });
  });
  return out.slice(0, 120);
}

/* ----------------------------- Live console ----------------------------- */
function LiveConsole({ fixture, fixtureId, def, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; def: SportDef; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const homeOrg = orgLabel(homeTeam(fixture));
  const awayOrg = orgLabel(awayTeam(fixture));

  const [state, setState] = useState<MatchState>(() => hydrate(live?.live_state));
  const [log, setLog] = useState<LogEntry[]>(() => (Array.isArray(live?.live_log) ? live!.live_log : []));
  const [history, setHistory] = useState<{ state: MatchState; log: LogEntry[] }[]>([]);
  const [status, setStatus] = useState<string>(fixture.status);
  const [confirming, setConfirming] = useState(false);
  // Terminal actions (go live / sign off) track their own in-flight state so the
  // per-tap score autosave (`persist.isPending`) never disables the match controls.
  const [submitting, setSubmitting] = useState(false);
  // Re-open a completed match for corrections. Revealing the scorer doesn't touch
  // the server - the first scoring action (or re-sign-off) flips it back to live.
  const [editing, setEditing] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && live) {
      setState(hydrate(live.live_state));
      setLog(Array.isArray(live.live_log) ? live.live_log : []);
      seeded.current = true;
    }
  }, [live]);

  const persist = useLiveSave(fixtureId, invalidate);

  // `opts.winner` (when the key is present, even if null) overrides the derived
  // winner - used by the cricket quick-result panel to declare a winner directly.
  // `opts.notes` persists the final result text.
  const save = (s: MatchState, l: LogEntry[], st: string, done = false, onSuccess?: () => void,
    opts?: { winner?: string | null; notes?: string }, onError?: () => void) => {
    const h = headline(def, s);
    const winner_team_id = opts && 'winner' in opts
      ? (opts.winner ?? null)
      : (!done || h.a === h.b ? null : h.a > h.b ? fixture.home_team_id : fixture.away_team_id);
    const body: Record<string, unknown> = { live_state: s, live_log: l, home_score: h.a, away_score: h.b, status: st, winner_team_id };
    if (opts && opts.notes !== undefined) body.notes = opts.notes;
    persist.mutate(body, { onSuccess, onError: (e: any) => { onError?.(); toast.error(e.message); } });
  };

  const dispatch = (action: Action) => {
    // Scoring is frozen once the final period is ended - ignore point taps until reopened.
    if (state.ended && action.type === 'POINT') return;
    const { state: ns, entry } = reduce(def, state, action);
    setHistory((hh) => [...hh, { state, log }].slice(-50));
    const nlog = entry ? [entry, ...log].slice(0, 80) : log;
    const st = status === 'scheduled' || status === 'completed' || status === 'confirmed' ? 'live' : status;
    setState(ns); setLog(nlog); setStatus(st);
    save(ns, nlog, st);
  };

  const undo = () => {
    setHistory((hh) => {
      if (hh.length === 0) return hh;
      const prev = hh[hh.length - 1];
      setState(prev.state); setLog(prev.log);
      save(prev.state, prev.log, status);
      return hh.slice(0, -1);
    });
  };

  const goLive = () => {
    setSubmitting(true); setStatus('live');
    save(state, log, 'live', false,
      () => setSubmitting(false),
      undefined, () => setSubmitting(false));
  };
  // Keep the confirm dialog open (showing a spinner) until the save resolves, then
  // complete and return. Navigating only on success also lets the global mutation-
  // cache invalidation mark /fixtures stale before the Results page remounts -
  // returning eagerly raced the GET ahead of the PATCH and left the old score on
  // screen until a manual refresh. `submitting` (not the autosave's pending flag)
  // gates this so a slow background score-save can't lock the sign-off button.
  const signOff = () => {
    setSubmitting(true);
    save(state, log, 'completed', true,
      () => { setStatus('completed'); setConfirming(false); setSubmitting(false); onDone(); },
      undefined, () => setSubmitting(false));
  };

  // Cricket: write runs/wickets straight into state (so live_state + headline stay
  // consistent) and optionally declare the winner + final result text directly.
  const applyQuick = (v: { runsA: number; wktA: number; runsB: number; wktB: number; oversA: string; oversB: string; winner: 'auto' | 'home' | 'away' | 'draw'; notes: string; complete: boolean }) => {
    const ns: MatchState = { ...state, runsA: v.runsA, wktA: v.wktA, runsB: v.runsB, wktB: v.wktB, ballsA: oversToBalls(v.oversA), ballsB: oversToBalls(v.oversB) };
    setState(ns);
    const st = v.complete ? 'completed' : status === 'scheduled' ? 'live' : status;
    setStatus(st);
    const opts: { winner?: string | null; notes?: string } = { notes: v.notes };
    if (v.winner === 'home') opts.winner = fixture.home_team_id;
    else if (v.winner === 'away') opts.winner = fixture.away_team_id;
    else if (v.winner === 'draw') opts.winner = null;
    save(ns, log, st, v.complete, v.complete ? () => { setStatus('completed'); onDone(); } : undefined, opts);
  };

  // Manual override for non-cricket sports: type the headline result directly when
  // the live tally went wrong or wasn't used. Writes the numbers into the matching
  // state fields (so live_state stays consistent with the headline), then optionally
  // completes. 'auto' winner is left to `save` to derive from the headline.
  const applyDirect = (a: number, b: number, win: 'auto' | 'home' | 'away' | 'draw', complete: boolean) => {
    const ns: MatchState = { ...state, segScores: [...state.segScores] };
    if (def.archetype === 'sets' || def.archetype === 'rally') { ns.segsA = a; ns.segsB = b; }
    else { ns.a = a; ns.b = b; }
    setState(ns);
    const st = complete ? 'completed' : status === 'scheduled' ? 'live' : status;
    setStatus(st);
    const opts: { winner?: string | null } = {};
    if (win === 'home') opts.winner = fixture.home_team_id;
    else if (win === 'away') opts.winner = fixture.away_team_id;
    else if (win === 'draw') opts.winner = null;
    save(ns, log, st, complete, complete ? () => { setStatus('completed'); onDone(); } : undefined, 'winner' in opts ? opts : undefined);
  };

  const h = headline(def, state);
  const live_ = status === 'live';
  const completed = status === 'completed' || status === 'confirmed';

  return (
    <>
      <Card className="mb-5 overflow-hidden">
        <div className="bg-slate-900 px-6 py-6 text-white">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {live_ && <span className="inline-flex items-center gap-1.5 text-[var(--live)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--live)]" />LIVE</span>}
          </div>
          <div className="mt-2 flex items-center justify-center gap-5">
            <div className="flex-1 text-right">
              <div className="text-lg font-bold">{homeName}</div>
              {orgLabel(homeTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(homeTeam(fixture))}</div>}
            </div>
            {def.archetype === 'cricket' ? (
              <div className="flex items-start justify-center gap-3 tabular-nums">
                <div className="flex flex-col items-center">
                  <span className="text-3xl font-black leading-none">{state.runsA}/{state.wktA}</span>
                  <span className="mt-1.5 text-xs font-medium text-slate-400">{oversStr(state.ballsA)} ov</span>
                </div>
                <span className="pt-1.5 text-lg font-bold text-slate-500">vs</span>
                <div className="flex flex-col items-center">
                  <span className="text-3xl font-black leading-none">{state.runsB}/{state.wktB}</span>
                  <span className="mt-1.5 text-xs font-medium text-slate-400">{oversStr(state.ballsB)} ov</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-5xl font-black tabular-nums">
                <span>{h.a}</span><span className="text-slate-600">:</span><span>{h.b}</span>
              </div>
            )}
            <div className="flex-1 text-left">
              <div className="text-lg font-bold">{awayName}</div>
              {orgLabel(awayTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(awayTeam(fixture))}</div>}
            </div>
          </div>
          <div className="mt-2 text-center text-sm text-slate-400">{subLine(def, state) || ` `}</div>
        </div>
      </Card>

      {(!completed || editing) && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader title="Scoring" subtitle={`${def.segLabel} ${def.archetype === 'cricket' ? state.inn : state.seg}${def.archetype !== 'cricket' ? ` of ${def.segMax}` : ''}${state.ended ? ' · frozen' : ''}`} />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <SideDeck name={homeName} org={homeOrg} side="A" def={def} dispatch={dispatch} disabled={state.ended} />
                <SideDeck name={awayName} org={awayOrg} side="B" def={def} dispatch={dispatch} disabled={state.ended} />
              </div>

              {!!def.events?.length && def.archetype !== 'cricket' && (
                <div className="grid grid-cols-2 gap-3">
                  <EventDeck side="A" name={homeName} def={def} team={homeTeam(fixture)} dispatch={dispatch} disabled={state.ended} />
                  <EventDeck side="B" name={awayName} def={def} team={awayTeam(fixture)} dispatch={dispatch} disabled={state.ended} />
                </div>
              )}

              {(def.archetype === 'sets' || def.archetype === 'rally') && !state.ended && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'NEXT_SEG' })}>
                  End {def.segLabel.toLowerCase()} {state.seg} (award to leader)
                </Button>
              )}
              {(def.archetype === 'sets' || def.archetype === 'rally') && state.ended && (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-center text-sm font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  {headline(def, state).a > headline(def, state).b ? homeName : awayName} win {headline(def, state).a}–{headline(def, state).b}. Use ↶ Undo to reopen.
                </p>
              )}
              {def.archetype === 'points' && state.seg < def.segMax && !state.ended && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'NEXT_SEG' })}>
                  Advance to {def.segLabel} {state.seg + 1}
                </Button>
              )}
              {/* Final period (points sports e.g. basketball): freeze scoring so the last
                  period is recorded and accidental taps can't change the result. */}
              {def.archetype === 'points' && state.seg >= def.segMax && !state.ended && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'END_FINAL' })}>
                  End {def.segLabel.toLowerCase()} {state.seg} &amp; freeze scoring
                </Button>
              )}
              {def.archetype === 'points' && state.ended && (
                <Button variant="ghost" className="w-full" onClick={() => dispatch({ type: 'REOPEN' })}>
                  ↺ Reopen scoring
                </Button>
              )}
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Scoring log" action={<Button size="sm" variant="ghost" disabled={history.length === 0} onClick={undo}>↶ Undo</Button>} />
              <CardBody>
                {log.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No logs yet - start scoring.</p>
                ) : (
                  <ul className="max-h-64 space-y-1.5 overflow-auto">
                    {log.map((e, i) => (
                      <li key={i} className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm', i === 0 ? 'bg-brand-50 dark:bg-brand-500/10' : 'bg-slate-50 dark:bg-slate-800/60')}>
                        {e.t && <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{e.t}</span>}
                        {e.team && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{e.team === 'A' ? homeName : awayName}</span>}
                        <span className="text-slate-700 dark:text-slate-300">{e.txt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Match control" />
              <CardBody className="space-y-2">
                {!live_ && !editing && <Button className="w-full justify-start" disabled={submitting} onClick={goLive}>Start match (go live)</Button>}
                <Button className="w-full justify-start" onClick={() => setConfirming(true)}>✍ End match &amp; sign off</Button>
                <WalkoverButton fixtureId={fixtureId} homeName={homeName} awayName={awayName} homeOrg={homeOrg} awayOrg={awayOrg} homeTeamId={fixture.home_team_id} awayTeamId={fixture.away_team_id} invalidate={invalidate} onDone={onDone} />
                {SECONDARY.map((s) => (
                  <SecondaryStatus key={s.status} fixtureId={fixtureId} status={s.status} label={s.label} variant={s.variant} invalidate={invalidate} onDone={onDone} />
                ))}
              </CardBody>
            </Card>

            {def.archetype === 'cricket' ? (
              <CricketQuickResult key={`${state.runsA}-${state.wktA}-${state.runsB}-${state.wktB}-${state.ballsA}-${state.ballsB}`}
                state={state} homeName={homeName} awayName={awayName} homeOrg={homeOrg} awayOrg={awayOrg}
                currentNotes={fixture.notes ?? ''} pending={persist.isPending} onApply={applyQuick} />
            ) : (
              <DirectResult key={`${h.a}-${h.b}`} def={def} homeName={homeName} awayName={awayName} homeOrg={homeOrg} awayOrg={awayOrg}
                initialA={h.a} initialB={h.b} pending={persist.isPending} onApply={applyDirect} />
            )}
          </div>
        </div>
      )}

      {completed && !editing && (
        <Card><CardBody className="py-8 text-center">
          <div className="text-sm text-slate-500 dark:text-slate-400">Result recorded.</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{homeName} {h.a} – {h.b} {awayName}</div>
          {fixture.notes && <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{fixture.notes}</div>}
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>Edit result</Button>
            <Button onClick={onDone}>Back to matches</Button>
          </div>
        </CardBody></Card>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Confirm final result</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">This completes the match and updates standings.</p>
            <div className="my-4 space-y-1">
              <div className="flex items-center justify-between gap-4 text-base font-semibold text-slate-800 dark:text-slate-200">
                <span className="min-w-0 truncate text-left">{homeName}</span>
                <span className="tabular-nums text-2xl font-black text-slate-900 dark:text-slate-100">{h.a}</span>
              </div>
              <div className="flex items-center justify-between gap-4 text-base font-semibold text-slate-800 dark:text-slate-200">
                <span className="min-w-0 truncate text-left">{awayName}</span>
                <span className="tabular-nums text-2xl font-black text-slate-900 dark:text-slate-100">{h.b}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => setConfirming(false)}>Cancel</Button>
              <Button className="flex-1" disabled={submitting} onClick={signOff}>{submitting ? 'Signing off…' : 'Sign off'}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ----------------------------- Tie console (rubbers) ----------------------------- */
// A fixture made of several rubbers (e.g. TT team event MS/WS/MD/WD/XD). The tie owns
// persistence (whole tie -> live_state.tie, headline = rubbers won); each rubber is
// scored by the same per-contest deck. Detailed mode shows the live deck; manual mode
// (and measured rubbers like pool/chess) just records the rubber winner.
function TieConsole({ fixture, fixtureId, spec: specProp, layout, mode, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; spec: TieSpec; layout?: TieSpec; mode: ScoringMode; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  // The layout as edited (before this round's dead-rubber rule), after a change here.
  const [layoutOverride, setLayoutOverride] = useState<TieSpec | null>(null);
  // A layout just changed here wins until the saved one comes back, so the rubbers on
  // screen and the spec describing them never disagree for a render.
  const [specOverride, setSpecOverride] = useState<TieSpec | null>(null);
  const spec = specOverride ?? specProp;
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const homeOrg = orgLabel(homeTeam(fixture));
  const awayOrg = orgLabel(awayTeam(fixture));

  const [state, setState] = useState<TieState>(() => hydrateTie(live?.live_state?.tie, spec));
  const [status, setStatus] = useState<string>(fixture.status);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && live) { setState(hydrateTie(live.live_state?.tie, spec)); seeded.current = true; }
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps -- spec is stable per fixture

  const persist = useLiveSave(fixtureId, invalidate);

  // Racquet rubbers are scored point by point on the rally kernel, under the draw's
  // own rules - the same console a single match uses.
  const racquet = isRacquetSport(sportNameOf(fixture));
  const baseFormat = useMemo(() => (racquet ? racquetFormatFor(fixture, null) : null), [fixture, racquet]);
  // Carrom rubbers are scored board by board under the draw's carrom format, frozen per
  // rubber at its first board - not on the legacy tap counter.
  const carromTie = isCarromSport(sportNameOf(fixture));
  const carromBaseResolved = useMemo(() => (carromTie ? carromResolved(fixture, null) : null), [fixture, carromTie]);
  const carromBase = (carromBaseResolved?.format ?? null) as ScoringFormat | null;
  const carromRulesFor = (r: RubberInstance) => carromRulesOf(r.format ?? carromBase);
  // Pool rubbers are recorded frame by frame, best of the rubber's own frames. A layout saved
  // before frames existed (winner only) keeps the winner buttons.
  const poolTie = isPoolSport(sportNameOf(fixture));
  const poolFramesOf = (i: number) => {
    const c = rubberDef(spec, i);
    return poolTie && isFrameContest(c) ? c.segMax : null;
  };
  const homeRoster = useMemo(() => rosterPeople(homeTeam(fixture)), [fixture]);
  const awayRoster = useMemo(() => rosterPeople(awayTeam(fixture)), [fixture]);
  const nameOfId = useMemo(() => new Map([...homeRoster, ...awayRoster].map((p) => [p.id, p.name])), [homeRoster, awayRoster]);
  const namesOf = (ids?: string[]) => ids?.map((id) => nameOfId.get(id) ?? '-');
  const [editingLineup, setEditingLineup] = useState<number | null>(null);

  // CHANGING THE RUBBERS from the console, where an organiser actually sees them - the
  // setup wizard is a page nobody thinks to open. Only before anything is scored, so
  // no result ever lands under different rubbers than it was played as.
  const [editingLayout, setEditingLayout] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<TieLayoutValue | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const untouched = state.rubbers.every((r) =>
    r.status === 'pending' && !r.winner && !r.drawn && !r.rally?.length && !r.lineup && !r.lineupSkipped && !r.state.ended
    && r.state.a === 0 && r.state.b === 0);
  const saveLayout = async (scope: 'match' | 'draw') => {
    if (!layoutDraft) { setEditingLayout(false); return; }
    const sport = sportNameOf(fixture);
    const nextSpec = layoutDraft.standard ? (tieTemplateFor(sport)?.tie ?? layoutDraft.spec) : layoutDraft.spec;
    setSavingLayout(true);
    try {
      if (scope === 'draw') {
        // Same write as the setup wizard: the draw's own layout, every other key kept.
        const td = fixture?.tournament_disciplines ?? {};
        const { scoring: _old, ...rest } = (td.format_config ?? {}) as Record<string, unknown>;
        const format_config = layoutDraft.standard ? rest : {
          ...rest,
          scoring: { fixtureType: 'tie', scoringMode: (td.format_config as any)?.scoring?.scoringMode ?? 'detailed', tie: layoutDraft.spec },
        };
        await api('PATCH', `/tournament-disciplines/${td.id}`, { format_config });
      }
      // This match starts over on the new rubbers - nothing was scored, so nothing is lost.
      // This match plays it under its round's rule; the layout itself is kept as set. Chess keeps
      // its board points (½ draws, every board played) at once, not only after a reload.
      const ruled = tieForRound(nextSpec, fixture?.round);
      const forRound = isChessSport(sport) ? { ...ruled, boardPoints: true, skipDeadRubbers: false, skipDeadInGroups: false } : ruled;
      const fresh = initTie(forRound);
      setSpecOverride(forRound);
      setLayoutOverride(nextSpec);
      persist.mutate(
        { live_state: { ...(live?.live_state ?? {}), tie: fresh, tieSpec: nextSpec }, live_log: [] },
        { onError: (e: any) => toast.error(e.message) },
      );
      setState(fresh);
      setEditingLayout(false);
      toast.success(scope === 'draw' ? 'Rubbers changed for every match in this draw' : 'Rubbers changed for this match');
    } catch (e: any) {
      toast.error(scope === 'draw' ? 'Only the organiser can change the whole draw. Save it for this match instead.' : e.message);
    } finally {
      setSavingLayout(false);
    }
  };

  // Public ticker log: one line per decided rubber, naming who played it.
  const buildLog = (s: TieState): LogEntry[] =>
    s.rubbers.filter((r) => r.winner || r.drawn).map((r) => {
      const who = r.lineup ? ` (${namesOf(r.lineup.A)!.join(' / ')} v ${namesOf(r.lineup.B)!.join(' / ')})` : '';
      const how = r.ending ? ` (${CHESS_ENDINGS[r.ending].label.toLowerCase()})` : '';
      return { t: '', team: r.winner ?? undefined, txt: `${r.label}${who}: ${r.drawn ? 'drawn' : `${r.winner === 'A' ? homeName : awayName} won`}${how}` };
    });

  const save = (next: TieState, st: string, done = false, onSuccess?: () => void, onErr?: () => void) => {
    const { a, b } = tieScore(spec, next);
    const w = tieOutcome(spec, next).winner;
    const winner_team_id = done ? (w === 'A' ? fixture.home_team_id : w === 'B' ? fixture.away_team_id : null) : null;
    // A finished tie with no winner shares the points even if the score is not level.
    const noResult = done && w == null && a !== b;
    persist.mutate(
      // Keep other live_state keys (tie_blocked). Chess: home has white on board 1 by default
      // (FIDE "team named first"), saved so colour stats don't depend on a tap never made.
      { live_state: { ...(live?.live_state ?? {}), tie: spec.boardPoints && !next.firstWhite ? { ...next, firstWhite: 'A' } : next, tieSpec: layoutOverride ?? layout ?? spec, noResult }, live_log: buildLog(next), home_score: a, away_score: b, status: st, winner_team_id },
      { onSuccess, onError: (e: any) => { onErr?.(); toast.error(e.message); } },
    );
  };

  /** Patch one rubber and save; `winner` also records its result and moves on. */
  const updateRubber = (i: number, patch: Partial<RubberInstance>, winner?: 'A' | 'B' | 'draw', reopen = false) => {
    let next: TieState = { ...state, rubbers: state.rubbers.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
    if (reopen) next = reopenRubberFn(spec, next, i, false);
    // Only a kernel-ended rubber reaches here as 'draw' - its own rules drew it.
    if (winner) next = decideRubberFn(spec, next, i, winner, { drawnByRules: winner === 'draw' });
    const st = liveStatusFor(status);
    setState(next); setStatus(st); save(next, st);
  };

  /** People already named in OTHER rubbers of this tie - a warning, never a block. */
  const usedElsewhere = (i: number) => {
    const m = new Map<string, string[]>();
    state.rubbers.forEach((r, idx) => {
      if (idx === i || !r.lineup) return;
      for (const id of [...r.lineup.A, ...r.lineup.B]) m.set(id, [...(m.get(id) ?? []), r.label]);
    });
    return m;
  };

  // Going live the moment scoring starts (mirrors LiveConsole's status handling).
  const liveStatusFor = (st: string) => (st === 'scheduled' || st === 'completed' || st === 'confirmed' ? 'live' : st);

  const dispatchRubber = (action: Action) => {
    const i = state.activeRubber;
    const r = state.rubbers[i];
    if (!r || r.status === 'completed' || r.status === 'dead') return;
    const { state: ns } = reduce(rubberDef(spec, i), r.state, action);
    const rubbers = state.rubbers.map((rr, idx) => (idx === i ? { ...rr, state: ns, status: (rr.status === 'pending' ? 'live' : rr.status) as RubberInstance['status'] } : rr));
    let next: TieState = { ...state, rubbers };
    // When the rubber's contest clinches (best-of-N sets decided), auto-complete it
    // and advance to the next rubber - no separate "won" tap needed.
    if (ns.ended && !r.winner) next = decideRubberFn(spec, next, i, ns.segsA >= ns.segsB ? 'A' : 'B');
    const st = liveStatusFor(status);
    setState(next); setStatus(st); save(next, st);
  };

  const decide = (i: number, winner: 'A' | 'B' | 'draw') => {
    let next = decideRubberFn(spec, state, i, winner);
    // Chess stays on the board just recorded, so "how it ended" can be picked before
    // moving on - jumping ahead hid it on every board but the last.
    if (spec.boardPoints) next = { ...next, activeRubber: i };
    const st = liveStatusFor(status);
    setState(next); setStatus(st); save(next, st);
  };

  // The next board still to play, for the chess "Next board" button.
  const nextPlayable = state.rubbers.findIndex((r, idx) => idx !== state.activeRubber && (r.status === 'pending' || r.status === 'live'));

  // Correct a sub-match: clear a decided/skipped rubber so it can be re-scored. `reset`
  // also wipes its point tally (for a fresh detailed re-score). Reopening can un-decide
  // the tie, which revives skipped rubbers - so the official can finish it differently.
  const reopen = (i: number, reset = false) => {
    const next = reopenRubberFn(spec, state, i, reset);
    const st = liveStatusFor(status);
    setState(next); setStatus(st); save(next, st);
  };

  const setActive = (i: number) => setState((s) => ({ ...s, activeRubber: i }));

  const goLive = () => { setSubmitting(true); setStatus('live'); save(state, 'live', false, () => setSubmitting(false), () => setSubmitting(false)); };

  // A tie is finished when somebody reaches the target OR every rubber has been
  // played and nobody did. The second case is an ordinary chess result - the shipped
  // template is four boards with a majority of three, so 2-2 happens - and asking
  // only `tieWinner` left the official told to "record rubber results until one side
  // reaches 3" with no rubbers left to record, and no way to complete the fixture.
  const { winner: w, drawn, level, decided, playable } = tieOutcome(spec, state);
  const target = tieTarget(spec);
  // Chess boards, everything else rubbers - said the way the sport says it.
  const unit = spec.boardPoints ? 'board' : 'rubber';
  const knockout = isKnockoutFixture(fixture ?? {});
  // A level league or group tie: drawn, or won on a tie-break, as the layout says (chess: drawn).
  const groupTb = groupTiebreakAllowed(spec);
  const setTiebreak = (s: Side | undefined) => {
    const { tiebreakWinner: _drop, ...rest } = state;
    const next: TieState = s ? { ...rest, tiebreakWinner: s } : rest;
    setState(next); save(next, status);
  };
  // A tie-break winner picked before the layout ruled it out does not stand in a group match.
  useEffect(() => {
    if (!knockout && !groupTb && state.tiebreakWinner && !submitting) setTiebreak(undefined);
  }, [knockout, groupTb, state.tiebreakWinner]); // eslint-disable-line react-hooks/exhaustive-deps
  const signOff = async () => {
    if (!decided) { toast.error(`The tie isn’t decided yet - record ${unit} results until one side reaches ${formatPoints(target)}.`); return; }
    if (drawn && knockout) { toast.error('This is a knockout tie - record who won the tie-break before signing off.'); return; }
    // Chess plays every board: the board points are the result the standings rank on,
    // so a 2½-½ lead with a board to go is not a finished match.
    if (spec.boardPoints && playable > 0) {
      toast.error(`Record every board first - ${playable} still to play. Board points decide the standings.`);
      return;
    }
    const { a, b } = tieScore(spec, state);
    // A group tie that plays every rubber, decided with some still to play: ask, don't block
    // (a side may concede the rest). Knockout ties mark them skipped, so this stays 0 there.
    const unplayed = playable;
    const ok = await confirmDialog({
      title: unplayed > 0
        ? `${unplayed} ${unit}${unplayed === 1 ? '' : 's'} still to play in this group tie. Sign off anyway?`
        : drawn ? 'Confirm a drawn tie' : 'Confirm final result',
      confirmLabel: unplayed > 0 ? 'Sign off anyway' : drawn ? 'Sign off as a draw' : 'Sign off',
      message: drawn
        ? `${homeName} ${formatPoints(a)} - ${formatPoints(b)} ${awayName}. Every ${unit} has been played and neither side reached ${formatPoints(target)}, so this tie is drawn. Standings will record it as a draw for both sides.`
        : `${homeName} ${formatPoints(a)} - ${formatPoints(b)} ${awayName}${level && w ? `, ${w === 'A' ? homeName : awayName} on tie-break` : ''}. This completes the tie and updates standings.`
          + (unplayed > 0 ? ` The ${unit}s not played are left out of the result.` : ''),
    });
    if (!ok) return;
    setSubmitting(true);
    save(state, 'completed', true, () => { setStatus('completed'); setSubmitting(false); onDone(); }, () => setSubmitting(false));
  };

  const { a, b } = tieScore(spec, state);
  const live_ = status === 'live';
  const completed = status === 'completed' || status === 'confirmed';
  const active = state.rubbers[state.activeRubber];
  const rdef = rubberDef(spec, state.activeRubber);

  // Games won in a rubber scored on the kernel - "2–1".
  const rubberGames = (r: RubberInstance): string | null => {
    const frozen = r.format ?? baseFormat?.format;
    if (!racquet || !frozen || !r.rally?.length) return null;
    // Singles rubbers serve as singles: fold under the lineup's rules, as the deck scored it.
    const fmt = formatForPairing(frozen, r.lineup);
    const h = resultEnvelope(fmt, foldRally(fmt, r.rally, r.firstServer ?? 'A').state).headline;
    return `${h[0]}–${h[1]}`;
  };

  const rubberScore = (r: RubberInstance, i: number): string => {
    if (r.status === 'dead') return 'not played';
    if (r.drawn) return spec.boardPoints ? 'Drawn ½–½' : 'Drawn';
    if (carromTie && r.carrom?.boards.length) {
      const rules = carromRulesFor(r);
      const h = carromHeadline(carromMatchOf(r.carrom, rules), rules);
      return r.winner ? `${r.winner === 'A' ? homeName : awayName} won ${h[0]}–${h[1]}` : `${h[0]}–${h[1]}`;
    }
    const bestOf = poolFramesOf(i);
    if (bestOf && r.pool?.frames.length) {
      const f = poolRubber(r.pool, bestOf).framesWon;
      return r.winner ? `${r.winner === 'A' ? homeName : awayName} won ${f[0]}–${f[1]}` : `${f[0]}–${f[1]}`;
    }
    const games = rubberGames(r);
    if (r.winner) return `${r.winner === 'A' ? homeName : awayName} won${games ? ` ${games}` : ''}`;
    if (games) return games;
    const d = rubberDef(spec, i);
    if (d.archetype === 'time') return r.status === 'live' ? 'in progress' : 'not started';
    const h = headline(d, r.state);
    return `${h.a}–${h.b}`;
  };

  return (
    <>
      <Card className="mb-5 overflow-hidden">
        <div className="bg-slate-900 px-6 py-6 text-white">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {live_ && <span className="inline-flex items-center gap-1.5 text-[var(--live)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--live)]" />LIVE</span>}
            <span>Tie · first to {formatPoints(target)} {spec.boardPoints ? 'board points' : 'rubbers'}</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-5">
            <div className="flex-1 text-right">
              <div className="text-lg font-bold">{homeName}</div>
              {orgLabel(homeTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(homeTeam(fixture))}</div>}
            </div>
            <div className="flex items-center gap-3 text-5xl font-black tabular-nums"><span>{formatPoints(a)}</span><span className="text-slate-600">:</span><span>{formatPoints(b)}</span></div>
            <div className="flex-1 text-left">
              <div className="text-lg font-bold">{awayName}</div>
              {orgLabel(awayTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(awayTeam(fixture))}</div>}
            </div>
          </div>
          <div className="mt-2 text-center text-sm text-slate-400">{decided ? (drawn ? 'Tie drawn' : `${w === 'A' ? homeName : awayName} win the tie${level ? ' on tie-break' : ''}`) : `${state.rubbers.filter((r) => r.status === 'completed').length} of ${spec.rubbers.length} ${unit}s played`}</div>
        </div>
      </Card>

      {(!completed || editing) && (
        <>
        {/* The rubbers and the tie's controls side by side; the rubber being scored goes
            underneath at the full width - the console needs the room. */}
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Card>
              <CardHeader title={spec.boardPoints ? 'Boards' : 'Rubbers'} subtitle={spec.boardPoints
                ? 'Tap a board to record its result (or to correct one). A drawn board is ½ each; the match is won on board points.'
                : 'Tap a rubber to score it (or to reopen and correct one). The tie is won by taking the majority.'}
                action={untouched && !editingLayout ? (
                  <Button size="sm" variant="outline" onClick={() => { setLayoutDraft(null); setEditingLayout(true); }}>
                    Edit {spec.boardPoints ? 'boards' : 'rubbers'}
                  </Button>
                ) : undefined} />
              <CardBody className="space-y-1.5">
                {editingLayout && (
                  <div className="mb-3 grid gap-3 rounded-xl border border-brand-300 bg-brand-50/40 p-3 dark:border-brand-500/40 dark:bg-brand-500/5">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Change the {spec.boardPoints ? 'boards' : 'rubbers'} before play starts. Nothing has been scored yet, so nothing is lost.
                    </p>
                    <TieLayoutEditor sport={sportNameOf(fixture) ?? ''} stored={layoutOverride ?? layout ?? spec} onChange={setLayoutDraft} />
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" disabled={savingLayout} onClick={() => setEditingLayout(false)}>Cancel</Button>
                      <Button variant="outline" disabled={savingLayout || !layoutDraft} onClick={() => void saveLayout('match')}>Save for this match</Button>
                      <Button disabled={savingLayout || !layoutDraft} onClick={() => void saveLayout('draw')}>Save for every match in this draw</Button>
                    </div>
                  </div>
                )}
                {state.rubbers.map((r, i) => {
                  const isActive = i === state.activeRubber;
                  const dead = r.status === 'dead';
                  return (
                    <button key={r.key} type="button" onClick={() => setActive(i)}
                      className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition',
                        isActive ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                          : dead ? 'border-slate-200 opacity-60 hover:opacity-100 dark:border-slate-800'
                            : 'border-slate-200 hover:border-brand-300 dark:border-slate-800')}>
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-700 dark:text-slate-200">{r.label}</span>
                        {r.lineup ? (
                          <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {namesOf(r.lineup.A)!.join(' / ')} v {namesOf(r.lineup.B)!.join(' / ')}
                          </span>
                        ) : r.lineupSkipped ? (
                          <span className="block text-[11px] text-amber-600 dark:text-amber-400">Players not named</span>
                        ) : null}
                      </span>
                      <span className={cn('shrink-0 pl-2 text-xs font-semibold', r.winner ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')}>{rubberScore(r, i)}</span>
                    </button>
                  );
                })}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Tie control" />
              <CardBody className="space-y-2">
                {!live_ && !editing && <Button className="w-full justify-start" disabled={submitting} onClick={goLive}>Start tie (go live)</Button>}
                {/* Olympiad colours: one side has white on board 1, then they alternate. */}
                {spec.boardPoints && (
                  <div className="space-y-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    <div className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">White on board 1</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['A', 'B'] as Side[]).map((s) => (
                        <Button key={s} size="sm" variant={(state.firstWhite ?? 'A') === s ? 'primary' : 'outline'} disabled={submitting}
                          onClick={() => {
                            if ((state.firstWhite ?? 'A') === s) return;
                            const next: TieState = { ...state, firstWhite: s };
                            setState(next); save(next, status);
                          }}>
                          <span className="truncate">{s === 'A' ? homeName : awayName}</span>
                        </Button>
                      ))}
                    </div>
                    <p className="px-1 text-[11px] text-slate-400 dark:text-slate-500">Colours then alternate down the boards.</p>
                  </div>
                )}
                {level && (
                  <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
                    <div className="px-1 text-xs font-semibold text-amber-900 dark:text-amber-200">Level at {formatPoints(a)}–{formatPoints(b)}</div>
                    <p className="px-1 text-[11px] text-amber-900/80 dark:text-amber-200/80">
                      {knockout ? 'A knockout tie needs a winner: record who won the tie-break.'
                        : groupTb ? 'Sign off as a draw, or record who won the tie-break.'
                        : 'A level group match is a draw under this layout: sign it off as a draw.'}
                    </p>
                    <div className={cn('grid gap-1.5', knockout ? 'grid-cols-2' : groupTb ? 'grid-cols-3' : 'grid-cols-1')}>
                      {((knockout ? ['A', 'B'] : groupTb ? [undefined, 'A', 'B'] : [undefined]) as Array<Side | undefined>).map((s) => (
                        <Button key={s ?? 'none'} size="sm" variant={state.tiebreakWinner === s ? 'primary' : 'outline'} disabled={submitting}
                          onClick={() => { if (state.tiebreakWinner !== s) setTiebreak(s); }}>
                          <span className="truncate">{s ? (s === 'A' ? homeName : awayName) : 'Draw'}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <Button className="w-full justify-start" disabled={submitting} onClick={signOff}>✍ End tie &amp; sign off</Button>
                {!decided && <p className="px-1 text-xs text-slate-400 dark:text-slate-500">Record {unit} results until one side reaches {formatPoints(target)}.</p>}
                <WalkoverButton fixtureId={fixtureId} homeName={homeName} awayName={awayName} homeOrg={homeOrg} awayOrg={awayOrg} homeTeamId={fixture.home_team_id} awayTeamId={fixture.away_team_id} invalidate={invalidate} onDone={onDone} />
                {SECONDARY.map((s) => (
                  <SecondaryStatus key={s.status} fixtureId={fixtureId} status={s.status} label={s.label} variant={s.variant} invalidate={invalidate} onDone={onDone} />
                ))}
              </CardBody>
            </Card>
          </div>
        </div>

            {active && (
              <Card className="mt-5">
                <CardHeader title={active.label} subtitle={active.status === 'dead' ? 'Skipped (dead rubber)' : active.drawn ? 'Drawn - ½ each' : active.winner ? `${active.winner === 'A' ? homeName : awayName} won this ${unit}` : spec.boardPoints ? 'Record this board: a win, or a draw for ½ each.' : carromTie ? 'Board by board' : poolFramesOf(state.activeRubber) ? `Frame by frame · best of ${poolFramesOf(state.activeRubber)}` : racquet && mode === 'detailed' ? 'Point by point' : rdef.archetype === 'time' ? 'Pick the winner of this rubber.' : `${rdef.segLabel} ${Math.min(active.state.seg, rdef.segMax)} of ${rdef.segMax}`} />
                <CardBody className="space-y-4">
                  {active.status === 'dead' ? (
                    <div className="space-y-3 text-center">
                      <p className="text-sm text-slate-500 dark:text-slate-400">This rubber was skipped because the tie was already decided. Reopen it to record or correct a result.</p>
                      <Button variant="outline" className="w-full" onClick={() => reopen(state.activeRubber)}>↺ Reopen this rubber</Button>
                    </div>
                  ) : (editingLineup === state.activeRubber || (!active.lineup && !active.lineupSkipped && !active.winner && !active.drawn)) ? (
                    // Who played this rubber - the only thing that puts it in a player's career.
                    <LineupPanel
                      key={`lineup-${active.key}`}
                      title={active.label}
                      size={rubberSize(spec.rubbers[state.activeRubber])}
                      sides={[
                        { side: 'A', name: homeName, org: homeOrg, roster: homeRoster },
                        { side: 'B', name: awayName, org: awayOrg, roster: awayRoster },
                      ]}
                      initial={active.lineup}
                      usedElsewhere={usedElsewhere(state.activeRubber)}
                      onSave={(lineup) => { setEditingLineup(null); updateRubber(state.activeRubber, { lineup, lineupSkipped: false }); }}
                      onSkip={() => { setEditingLineup(null); updateRubber(state.activeRubber, { lineup: undefined, lineupSkipped: true }); }}
                      onCancel={editingLineup === state.activeRubber ? () => setEditingLineup(null) : undefined}
                      disabled={submitting}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {active.lineup
                          ? <span>Players: {namesOf(active.lineup.A)!.join(' / ')} vs {namesOf(active.lineup.B)!.join(' / ')}</span>
                          : <span>Players not named - this rubber counts for the team only.</span>}
                        <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setEditingLineup(state.activeRubber)}>
                          {active.lineup ? 'Change players' : 'Name players'}
                        </button>
                      </div>
                      {carromTie ? (
                        <CarromResult
                          key={`carrom-${active.key}`}
                          rubber
                          homeName={homeName}
                          awayName={awayName}
                          rules={carromRulesFor(active)}
                          formatName={(active.format ?? carromBase)?.name}
                          provenance={active.format ? 'frozen at this rubber\'s first board' : carromBaseResolved?.source}
                          initial={hydrateCarrom(active.carrom)}
                          busy={submitting}
                          onSave={(cs, done) => {
                            const fmt = active.format ?? carromBase ?? undefined;
                            const m = carromMatchOf(cs, carromRulesFor(active));
                            const patch: Partial<RubberInstance> = {
                              carrom: cs,
                              ...(cs.boards.length && fmt ? { format: fmt } : {}),
                              status: active.status === 'pending' ? 'live' : active.status,
                            };
                            // Confirmed and decided: the rubber goes to its winner. Undone past
                            // the end: a decided rubber reopens.
                            if (done && m.winner) updateRubber(state.activeRubber, patch, m.winner);
                            else updateRubber(state.activeRubber, patch, undefined, !!active.winner && !m.decided);
                          }}
                        />
                      ) : poolFramesOf(state.activeRubber) ? (
                        <PoolResult
                          key={`pool-${active.key}`}
                          homeName={homeName}
                          awayName={awayName}
                          bestOf={poolFramesOf(state.activeRubber)!}
                          initial={hydratePool(active.pool)}
                          busy={submitting}
                          onSave={(ps, done) => {
                            const res = poolRubber(ps, poolFramesOf(state.activeRubber)!);
                            const patch: Partial<RubberInstance> = { pool: ps, status: active.status === 'pending' ? 'live' : active.status };
                            // Confirmed: the rubber goes to its winner. Undone below the winning frame: it reopens.
                            if (done && res.winner) updateRubber(state.activeRubber, patch, res.winner);
                            else updateRubber(state.activeRubber, patch, undefined, !!active.winner && !res.decided);
                          }}
                        />
                      ) : racquet && mode === 'detailed' && baseFormat?.format ? (
                        <RacquetDeck
                          key={`rubber-${active.key}`}
                          format={active.format ?? baseFormat.format}
                          provenance={baseFormat.source}
                          homeName={homeName}
                          awayName={awayName}
                          homeOrg={orgTitle(homeTeam(fixture))}
                          awayOrg={orgTitle(awayTeam(fixture))}
                          // A singles rubber with nobody named still serves as singles.
                          pairing={active.lineup
                            ? { A: namesOf(active.lineup.A)!, B: namesOf(active.lineup.B)! }
                            : rubberSize(spec.rubbers[state.activeRubber]) === 1 ? { A: [homeName], B: [awayName] } : undefined}
                          homePlayers={namesOf(active.lineup?.A)}
                          awayPlayers={namesOf(active.lineup?.B)}
                          matchKey={`${fixtureId}:${active.key}`}
                          log={active.rally ?? []}
                          firstServer={active.firstServer ?? 'A'}
                          busy={submitting}
                          onFirstServerChange={(s) => updateRubber(state.activeRubber, { firstServer: s })}
                          onSwapPair={(s) => {
                            if (!active.lineup) return;
                            updateRubber(state.activeRubber, { lineup: { ...active.lineup, [s]: [...active.lineup[s]].reverse() } });
                          }}
                          // Each point is saved with the rubber; the rules freeze at its first point.
                          // Walking a finished rubber back with Undo reopens it.
                          onChange={(log, ks) => updateRubber(
                            state.activeRubber,
                            {
                              rally: log,
                              format: active.format ?? baseFormat.format!,
                              firstServer: active.firstServer ?? 'A',
                              status: active.status === 'pending' ? 'live' : active.status,
                            },
                            undefined,
                            !!active.winner && !ks.ended,
                          )}
                          onSignOff={(log, ks) => {
                            // A rubber that ended level under its rules (a drawn timed game) is a drawn rubber.
                            if (!ks.winner && !ks.ended) { toast.error('This rubber has no winner yet.'); return; }
                            updateRubber(state.activeRubber, { rally: log, format: active.format ?? baseFormat.format!, firstServer: active.firstServer ?? 'A' }, ks.winner ?? 'draw');
                          }}
                        />
                      ) : (
                    <>
                      {mode === 'detailed' && rdef.archetype !== 'time' && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <SideDeck name={homeName} org={homeOrg} side="A" def={rdef} dispatch={dispatchRubber} disabled={!!active.winner || active.state.ended} />
                            <SideDeck name={awayName} org={awayOrg} side="B" def={rdef} dispatch={dispatchRubber} disabled={!!active.winner || active.state.ended} />
                          </div>
                          {(rdef.archetype === 'sets' || rdef.archetype === 'rally') && !active.winner && !active.state.ended && (
                            <Button variant="outline" className="w-full" onClick={() => dispatchRubber({ type: 'NEXT_SEG' })}>End {rdef.segLabel.toLowerCase()} {active.state.seg} (award to leader)</Button>
                          )}
                          {!!rdef.events?.length && (
                            <div className="grid grid-cols-2 gap-3">
                              <EventDeck side="A" name={homeName} def={rdef} team={homeTeam(fixture)} dispatch={dispatchRubber} disabled={!!active.winner} />
                              <EventDeck side="B" name={awayName} def={rdef} team={awayTeam(fixture)} dispatch={dispatchRubber} disabled={!!active.winner} />
                            </div>
                          )}
                          <div className="text-center text-sm text-slate-500 dark:text-slate-400">{subLine(rdef, active.state) || ' '}</div>
                        </>
                      )}
                      {/* Chess: who had white on this board, from the tie's board-1 setting. */}
                      {spec.boardPoints && (
                        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                          White on this board: <b className="text-slate-700 dark:text-slate-200">{whiteOnBoard(state.firstWhite ?? 'A', state.activeRubber) === 'A' ? homeName : awayName}</b>
                        </p>
                      )}
                      <div className={cn('grid gap-2', spec.boardPoints ? 'grid-cols-3' : 'grid-cols-2')}>
                        <Button variant={active.winner === 'A' ? 'primary' : 'outline'} onClick={() => decide(state.activeRubber, 'A')}>
                          <span className="flex w-full min-w-0 flex-col items-center whitespace-normal break-words text-center leading-tight">
                            <span>{homeName} won</span>
                            {homeOrg && <span className="text-[11px] font-normal opacity-75">{homeOrg}</span>}
                          </span>
                        </Button>
                        {/* A drawn board - the commonest chess result - is ½ each. */}
                        {spec.boardPoints && (
                          <Button variant={active.drawn ? 'primary' : 'outline'} onClick={() => decide(state.activeRubber, 'draw')}>
                            <span className="flex w-full min-w-0 flex-col items-center whitespace-normal text-center leading-tight">
                              <span>Draw</span>
                              <span className="text-[11px] font-normal opacity-75">½–½</span>
                            </span>
                          </Button>
                        )}
                        <Button variant={active.winner === 'B' ? 'primary' : 'outline'} onClick={() => decide(state.activeRubber, 'B')}>
                          <span className="flex w-full min-w-0 flex-col items-center whitespace-normal break-words text-center leading-tight">
                            <span>{awayName} won</span>
                            {awayOrg && <span className="text-[11px] font-normal opacity-75">{awayOrg}</span>}
                          </span>
                        </Button>
                      </div>
                      {/* Chess: how the board's game ended, once it has a result - optional. */}
                      {spec.boardPoints && (active.winner || active.drawn) && (
                        <EndingChips result={active.drawn ? 'draw' : active.winner!} value={active.ending}
                          onChange={(ending) => updateRubber(state.activeRubber, { ending })} />
                      )}
                      {spec.boardPoints && (active.winner || active.drawn) && nextPlayable >= 0 && (
                        <Button className="w-full" onClick={() => setActive(nextPlayable)}>
                          Next board → {state.rubbers[nextPlayable].label}
                        </Button>
                      )}
                      {active.winner && mode === 'detailed' && rdef.archetype !== 'time' && (
                        <Button variant="ghost" className="w-full" onClick={() => reopen(state.activeRubber, true)}>↺ Reopen &amp; clear to re-score</Button>
                      )}
                    </>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>
            )}
        </>
      )}

      {completed && !editing && (
        <Card><CardBody className="py-8 text-center">
          <div className="text-sm text-slate-500 dark:text-slate-400">Tie recorded.</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{homeName} {formatPoints(a)} – {formatPoints(b)} {awayName}</div>
          <div className="mx-auto mt-3 max-w-md space-y-1 text-sm text-slate-500 dark:text-slate-400">
            {state.rubbers.map((r, i) => <div key={r.key} className="flex justify-between gap-4"><span>{r.label}</span><span>{rubberScore(r, i)}</span></div>)}
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>Edit result</Button>
            <Button onClick={onDone}>Back to matches</Button>
          </div>
        </CardBody></Card>
      )}
    </>
  );
}

/* ----------------------------- Event ranking (default for multi-competitor) ----------------------------- */
const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

// The default scoring for a multi-competitor event (swimming / powerlifting): no athlete
// detail at all - just rank the championship's teams/orgs by how they did. Points are
// awarded by placement (medalPoints) and shown as a standing. Stored separately from the
// detailed per-athlete state in live_state.eventRanking, so the two modes don't clobber.
function EventRankingConsole({ fixture, fixtureId, spec, live, invalidate }:
  { fixture: any; fixtureId: string; spec: EventSpec; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[] }) {
  // Only the clubs entered in THIS event can be ranked (not every club in the championship).
  const drawId = (fixture as any)?.tournament_discipline_id as string | undefined;
  const { data: entrants, isLoading: entrantsLoading } = useApi<Array<{ organizations?: { id: string; name: string } | null; organization_id: string }>>(
    drawId ? `/teams?tournament_discipline_id=${drawId}` : null);
  const orgs = [...new Map((entrants ?? []).map((t) => [t.organizations?.id ?? t.organization_id, t.organizations?.name ?? 'Unaffiliated'])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Organiser-configured ranking points (from the "Ranking" point system on the Standings
  // settings, resolved server-side per draw) win; otherwise the template default.
  const medalPoints: number[] = (fixture as any)?.ranking_points ?? spec.result.medalPoints ?? [5, 3, 1];
  // Every ranked org also gets the participation floor (e.g. 1); places beyond the points
  // list fall back to just that. Unranked orgs (no place) score nothing.
  const participation: number = (fixture as any)?.ranking_participation ?? 0;

  // place map keyed by orgId (independent of the async orgs fetch).
  const seed = (l?: { live_state: any }) => {
    const rows = l?.live_state?.eventRanking?.rows;
    const m: Record<string, number> = {};
    if (Array.isArray(rows)) for (const r of rows) if (r?.orgId && typeof r.place === 'number') m[r.orgId] = r.place;
    return m;
  };
  const [places, setPlaces] = useState<Record<string, number>>(() => seed(live));
  const seeded = useRef(false);
  useEffect(() => { if (!seeded.current && live) { seeded.current = true; setPlaces(seed(live)); } }, [live]);
  // Only an OFFICIAL'S edit arms the autosave. The seeding above changes `places`
  // too, and autosaving that would write the fixture's own ranking back to it the
  // moment anybody so much as opened the console.
  const [touched, setTouched] = useState(false);
  // Set by "Save & sign off": a draft still waiting must not land after it and undo it.
  const signedOff = useRef(false);

  const persist = useLiveSave(fixtureId, invalidate);
  const setPlace = (orgId: string, place: number | null) => {
    setTouched(true);
    signedOff.current = false;
    setPlaces((p) => { const n = { ...p }; if (place) n[orgId] = place; else delete n[orgId]; return n; });
  };
  // Championship points for an org. Participation is a consolation floor, NOT a top-up:
  // a ranked org earns its place points (10/7/3/…), OR - if it placed below the configured
  // places (0 points) - just the participation point. Unranked orgs score nothing.
  const pointsFor = (orgId: string) => {
    const pl = places[orgId];
    if (!pl) return 0;
    const placePts = placementPoints(pl, medalPoints);
    return placePts > 0 ? placePts : participation;
  };

  // Persist the ranking. `eventStandings` is the self-contained per-org contribution
  // (points + medals) the standings service reads - so events feed the championship table
  // without the server needing the event spec. `complete` signs the event off.
  const persistRanking = (complete: boolean, quiet = false) => {
    if (quiet && signedOff.current) return; // a late draft: the sign-off stands
    if (complete) signedOff.current = true;
    const rows = orgs.map((o) => ({ orgId: o.id, org: o.name, place: places[o.id] ?? null, points: pointsFor(o.id) }));
    // Drops any detailed per-athlete data this fixture was PREVIOUSLY scored
    // with - a stale `event` key here is what let derive.ts's two medal paths
    // both fire and hand out two medals for one result.
    const { event: _staleDetailed, ...restLiveState } = (live?.live_state ?? {}) as Record<string, unknown>;
    // "Save ranking" only stores the draft places - it must NOT move the standings. Only
    // "Save & sign off" writes `eventStandings` (what the standings service reads) and
    // completes the event, so the championship table changes only on sign-off. A plain
    // save keeps the fixture's current status + any previously signed-off contribution.
    const live_state = complete
      ? { ...restLiveState, eventRanking: { rows }, eventStandings: rankingContributions(rows, medalPoints) }
      : { ...restLiveState, eventRanking: { rows } };
    persist.mutate(
      {
        live_state,
        status: complete ? 'completed' : fixture.status,
      },
      {
        background: quiet,
        onSuccess: quiet ? undefined : () => toast.success(complete ? 'Event signed off' : 'Ranking saved (not in standings yet)'),
        onError: quiet ? undefined : (e: any) => toast.error(e.message),
      },
    );
  };
  const save = () => persistRanking(false);
  // A PLACE TYPED IS A PLACE SAVED. Nothing here reached the server until somebody
  // found the Save button, so a whole event's ranking lived in one tab's memory -
  // the single biggest way scoring was lost, and one no amount of retrying a
  // request nobody made could have caught. Two seconds after the last change the
  // draft goes into the outbox with everything else. Quietly: no toast, no spinner,
  // no disabled button. The official should never notice it happening.
  useDraftAutosave(places, () => persistRanking(false, true), touched);

  const n = orgs.length;
  const ranked = orgs
    .map((o) => ({ ...o, place: places[o.id] ?? null, points: pointsFor(o.id) }))
    .filter((r) => r.place != null)
    .sort((a, b) => b.points - a.points || (a.place! - b.place!) || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader title="Team ranking" subtitle={`Set each team's finishing place - points are awarded by placement (${medalPoints.join(' / ')}).`} />
        <CardBody className="space-y-2">
          {entrantsLoading || !entrants ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Loading the event's entrants…</p>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No teams are entered in this event yet.</p>
          ) : orgs.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{o.name}</span>
              <div className="flex items-center gap-2">
                <Select value={places[o.id] ?? ''} onChange={(e) => setPlace(o.id, e.target.value ? Number(e.target.value) : null)} className="w-28">
                  <option value="">- place -</option>
                  {Array.from({ length: n }, (_, i) => i + 1).map((pl) => <option key={pl} value={pl}>{ordinal(pl)}</option>)}
                </Select>
                <span className="w-8 text-right text-sm font-bold tabular-nums text-slate-500 dark:text-slate-400">{pointsFor(o.id)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={persist.isPending} onClick={() => persistRanking(false)}>{persist.isPending ? 'Saving…' : 'Save ranking'}</Button>
            <Button size="sm" disabled={persist.isPending} onClick={() => persistRanking(true)}>Save &amp; sign off</Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Standing" subtitle="Best team first" />
          <CardBody>
            {ranked.length === 0 ? <p className="text-sm text-slate-400 dark:text-slate-500">No places set yet.</p> : (
              <ul className="space-y-1.5">
                {ranked.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{i + 1}. {r.name}</span>
                    <span className="font-bold tabular-nums">{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CardBody className="text-xs text-slate-600 dark:text-slate-300">
            These placement points (and 🥇/🥈/🥉 for the top three) feed straight into the championship standings and medal tally.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- Event console (multi-competitor) ----------------------------- */
// Swimming heats / powerlifting categories: many participants, each recording a mark per
// sub-event, aggregated into team (org) points. Stores EventState in live_state.event,
// which derive.ts's eventMedals() reads at lock time to award medals per person.
// A sub-event's own resultType/winnerIs/unit wins when set (athletics mixes a time
// and a distance); falls back to the spec-level default otherwise.
const markMetaFor = (spec: EventSpec, se?: { resultType?: string; unit?: string }) => ({
  isTime: (se?.resultType ?? spec.result.resultType) === 'time',
  unit: se?.unit ?? spec.result.unit,
});

// Spelled out in full so "40" reads as an actual unit, not a guess.
const placeholderFor = (unit?: string) => (unit ? EVENT_UNIT_LABEL[unit as keyof typeof EVENT_UNIT_LABEL] ?? unit : 'value');

function EventConsole({ fixture, fixtureId, spec, live, invalidate }:
  { fixture: any; fixtureId: string; spec: EventSpec; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[] }) {
  const pickOne = !!spec.pickOne;
  const noun = spec.subEventNoun ?? 'sub-event';
  const nounLower = noun.toLowerCase();
  // A named discipline ("66kg") already fixes the one category every entrant is
  // in (effectiveEventSpec narrowed spec.subEvents to just it) - nothing left to
  // pick. Only "Whole sport" still mixes more than one category.
  const isNamedDiscipline = !!fixture?.tournament_disciplines?.discipline_id;
  const fixedCategory = isNamedDiscipline ? spec.subEvents[0]?.key ?? null : null;

  // Whoever's org has a team_entries row for this discipline has one registered
  // entrant on it (squad_max is 1) - shown up front instead of a phone lookup.
  const entrants: Array<{ user_id: string; name: string; phone: string | null; org_id: string | null; org: string | null }> =
    (fixture as any)?.event_entrants ?? [];
  // One row per entry: the institute is part of the id, so the same account under two
  // institutes (a data slip) can never merge two swimmers' places.
  const entrantRow = (e: (typeof entrants)[number]): ParticipantResult =>
    ({ id: e.org_id ? `e${e.user_id}-${e.org_id}` : `e${e.user_id}`, name: e.name, phone: e.phone, org: e.org, orgId: e.org_id, category: pickOne ? fixedCategory : null, marks: {} });
  // A relay is one entry per institute, with one time - its swimmers listed on the row.
  const relay = isNamedDiscipline && isRelaySubEvent(spec.subEvents[0]);
  const relayRows = (list: typeof entrants): ParticipantResult[] => {
    const byOrg = new Map<string, typeof entrants>();
    for (const e of list) {
      const k = e.org_id ?? e.org ?? e.user_id;
      byOrg.set(k, [...(byOrg.get(k) ?? []), e]);
    }
    return [...byOrg.values()].map((team) => ({
      id: `t${team[0].org_id ?? team[0].user_id}`, name: team.map((m) => m.name).join(', '), phone: null,
      org: team[0].org, orgId: team[0].org_id, category: pickOne ? fixedCategory : null, marks: {},
    }));
  };
  const seedRows = (list: typeof entrants): ParticipantResult[] => (relay ? relayRows(list) : list.map(entrantRow));

  // The roster is the registration record, not something scoring edits - no add,
  // remove or phone lookup here, only scoring whoever is actually entered.
  const [state, setState] = useState<EventState>(() => {
    const hydrated = hydrateEvent(live?.live_state?.event);
    return hydrated.participants.length === 0 && entrants.length > 0
      ? { participants: seedRows(entrants) }
      : hydrated;
  });
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !live) return;
    seeded.current = true;
    const hydrated = hydrateEvent(live.live_state?.event);
    setState(hydrated.participants.length === 0 && entrants.length > 0
      ? { participants: seedRows(entrants) }
      : hydrated);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot seed
  // Armed by the first mark an official types, never by the seeding above - see the
  // matching comment in EventRankingConsole.
  const [touched, setTouched] = useState(false);
  // Set by "Save & sign off": a draft still waiting must not land after it and undo it.
  const signedOff = useRef(false);

  // A late registration folds in automatically, matched by phone (the same
  // handle resolveFixtureParticipants uses at lock time) - never by hand.
  useEffect(() => {
    if (!entrants.length) return;
    setState((s) => {
      // A relay row is the institute's: a newly registered institute adds a row, a new swimmer does not.
      if (relay) {
        const knownOrgs = new Set(s.participants.map((p) => p.orgId ?? p.org));
        const missing = entrants.filter((e) => !knownOrgs.has(e.org_id ?? e.org));
        return missing.length ? { participants: [...s.participants, ...relayRows(missing)] } : s;
      }
      const known = new Set(s.participants.map((p) => (p.phone ?? '').replace(/\D/g, '')));
      const missing = entrants.filter((e) => !known.has((e.phone ?? '').replace(/\D/g, '')));
      return missing.length ? { participants: [...s.participants, ...missing.map(entrantRow)] } : s;
    });
  }, [entrants]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Whole sport" mixes categories on one screen: the picker is the class being entered.
  // A competitor keeps the class their result went in; only those without one follow the picker.
  const [globalCategory, setGlobalCategoryState] = useState<string | null>(
    () => (state.participants.find((p) => p.category && !hasResultIn(p, p.category))
      ?? state.participants.find((p) => p.category))?.category ?? null,
  );
  // Results typed in the class on screen since it was picked: switching away asks first.
  const [enteredHere, setEnteredHere] = useState(false);
  const moveFreeTo = (cat: string) => {
    setGlobalCategoryState(cat);
    setEnteredHere(false);
    setState((s) => moveUnplacedTo(s, cat));
  };
  const setGlobalCategory = async (cat: string) => {
    if (cat === globalCategory) return;
    const done = globalCategory ? state.participants.filter((p) => p.category === globalCategory && hasResultIn(p, globalCategory)) : [];
    if (globalCategory && enteredHere && done.length) {
      const from = spec.subEvents.find((se) => se.key === globalCategory)?.label ?? nounLower;
      const shown = done.slice(0, 6).map((p) => {
        const m = p.marks[globalCategory];
        return `${p.name || 'Unnamed'} (${resultStatusOf(p, globalCategory) ?? (typeof m === 'number' ? `${m}${spec.result.unit ? ` ${spec.result.unit}` : ''}` : '-')})`;
      }).join(', ') + (done.length > 6 ? ` and ${done.length - 6} more` : '');
      const ok = await confirmDialog({
        title: `Save the ${from} results?`,
        confirmLabel: 'Save and switch',
        message: `${shown} stay in ${from}. In the next ${nounLower} their rows are locked - switch back to ${from} to change them.`,
      });
      if (!ok) return;
      persistEvent(false);
    }
    moveFreeTo(cat);
  };
  const category = isNamedDiscipline ? fixedCategory : globalCategory;

  // "Counts towards" isn't offered any more - it came from the same registration
  // the roster already reads, so an editable copy could only go stale against it.
  // Kept defined (unused) in case a real "unattached entry" need reappears.
  const champId = eventInfo(fixture)?.id;
  const { data: parts } = useApi<{ organizations: { orgId: string; org: { id: string; name: string } | null }[] }>(
    champId ? `/championships/${champId}/participants` : null);
  const orgs = (parts?.organizations ?? [])
    .map((o) => ({ id: o.org?.id ?? o.orgId, name: o.org?.name ?? 'Unaffiliated' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const patchP = (id: string, patch: Partial<ParticipantResult>) => {
    setTouched(true);
    signedOff.current = false;
    setState((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  };
  const setOrg = (id: string, orgId: string) => patchP(id, { orgId: orgId || null, org: orgs.find((o) => o.id === orgId)?.name ?? null });
  void setOrg; // dead code - see comment above

  // The Point System's say, as the team-ranking console already takes it: its points per
  // place (the draw's ranking rule), whether only each institute's best finisher is placed,
  // and the participation floor.
  const rulePoints: number[] | null = Array.isArray((fixture as any)?.ranking_points) ? (fixture as any).ranking_points : null;
  const scoreSpec: EventSpec = rulePoints
    ? { ...spec, result: { ...spec.result, medalPoints: rulePoints }, subEvents: spec.subEvents.map(({ medalPoints: _m, ...se }) => se) }
    : spec;
  const scoringOpts: EventScoringOpts = {
    bestPerSide: !!(fixture as any)?.ranking_best_only,
    participation: Number((fixture as any)?.ranking_participation) || 0,
  };

  // DNS / DNF / DQ for one sub-event; blank clears it. The time typed beside it is kept, unranked.
  const setStatus = (id: string, key: string, status: ResultStatus | null) => {
    setTouched(true);
    signedOff.current = false;
    if (key === globalCategory) setEnteredHere(true);
    setState((s) => ({
      participants: s.participants.map((p) => {
        if (p.id !== id) return p;
        const { [key]: _old, ...rest } = p.statuses ?? {};
        const statuses = status ? { ...rest, [key]: status } : rest;
        return { ...p, statuses };
      }),
    }));
  };

  const persist = useLiveSave(fixtureId, invalidate);
  const setMark = (id: string, key: string, n: number | null) => {
    setTouched(true);
    signedOff.current = false;
    if (key === globalCategory) setEnteredHere(true);
    setState((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, marks: { ...p.marks, [key]: n } } : p)) }));
  };

  // `eventStandings` is the per-org contribution (points + medals from each sub-event's
  // top three) the standings service reads, so detailed event results feed the
  // championship table + medal tally too. `complete` signs the event off.
  const persistEvent = (complete: boolean, quiet = false) => {
    if (quiet && signedOff.current) return; // a late draft: the sign-off stands
    if (complete) signedOff.current = true;
    // Drops any "Team ranking" org-placement data - see persistRanking's matching
    // comment on why a stale key here would double up on medals.
    const { eventRanking: _staleSimple, ...restLiveState } = (live?.live_state ?? {}) as Record<string, unknown>;
    // A race counts in the standings once it is signed off, not from a half-entered draft.
    const counts = complete || fixture.status === 'completed';
    return persist.mutate(
      {
        live_state: { ...restLiveState, event: state, eventStandings: counts ? detailedContributions(scoreSpec, state, scoringOpts) : [] },
        // AN AUTOSAVE MOVES DATA, NOT THE MATCH. Saving by hand takes a scheduled
        // event live, which is right - somebody deliberately recorded a result. Two
        // seconds after a keystroke is not that, and it would fire the "match is now
        // live" notification at every entrant because an official opened a console
        // and typed one digit. The draft is kept; the status is the official's call.
        status: complete ? 'completed' : (!quiet && fixture.status === 'scheduled' ? 'live' : fixture.status),
      },
      {
        background: quiet,
        onSuccess: quiet ? undefined : () => toast.success(complete ? 'Event signed off' : 'Results saved'),
        onError: quiet ? undefined : (e: any) => toast.error(e.message),
      },
    );
  };
  const save = () => persistEvent(false);
  // Forty swimmers' times typed into React state and nothing on the server until
  // somebody found Save - the worst of the loss this whole change is about. Two
  // seconds after typing stops the draft joins everything else in the outbox,
  // silently: no toast, no spinner, no button greying out mid-entry.
  useDraftAutosave(state, () => persistEvent(false, true), touched);

  const agg = aggregateEvent(scoreSpec, state, scoringOpts);
  const blocks = subEventResults(scoreSpec, state, scoringOpts);
  // The one active category carries its OWN unit/direction - a "400m" reads as
  // seconds/fastest-wins even though the sport's other events don't share that unit.
  const activeSubEvent = category ? spec.subEvents.find((se) => se.key === category) : undefined;
  const activeMeta = markMetaFor(spec, activeSubEvent);
  const unit = activeMeta.unit ? ` (${activeMeta.unit})` : '';
  const pts = (scoreSpec.result.medalPoints ?? [5, 3, 1]).join(' / ');
  const best = (activeSubEvent?.winnerIs ?? spec.result.winnerIs) === 'min' ? 'fastest' : 'best';
  // Plain-English explanation of how marks become org points, by aggregate rule.
  const scoringText = spec.result.aggregate === 'sumBest'
    ? `Each org's points are the sum of its athletes' marks.`
    : spec.result.aggregate === 'medals'
      ? `Each ${nounLower} is ranked (${best} wins) - the top finishers earn ${pts} points for their institute${scoringOpts.bestPerSide ? ' (only its best finisher is placed)' : ''}. A ${nounLower} counts in the standings once it is signed off.`
      : `Each ${nounLower} awards placement points down the order to each finisher's org; an org's total is the sum across every ${nounLower}.`;
  const subtitle = pickOne
    ? isNamedDiscipline
      ? `Enter each competitor's total${unit} for ${spec.subEvents[0]?.label ?? noun}.`
      : `Pick a ${nounLower}, then enter its competitors' totals${unit}. Each keeps the ${nounLower} their total was entered in.`
    : isNamedDiscipline
      ? `Enter each competitor's mark${unit} for ${spec.subEvents[0]?.label ?? noun}.`
      : `Enter each competitor's mark per ${nounLower}${unit}.`;
  const markLabel = `Total${unit}`;
  // Whole sport, nothing chosen: no default any more, blocks scoring until an
  // explicit choice is made (was the "silently defaults to first category" bug).
  const blockedOnCategory = pickOne && !isNamedDiscipline && !category;
  // Exactly one mark per row for pickOne or a named discipline; only a
  // genuinely multi-category whole-sport grid sport needs per-race columns.
  const singleMark = pickOne || isNamedDiscipline;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader title="Participants & results" subtitle={subtitle} />
        <CardBody className="space-y-3">
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600 dark:bg-brand-500/10 dark:text-slate-300">{scoringText}</p>
          {pickOne && !isNamedDiscipline && (
            <Field label={noun} hint={!category ? `Choose a ${nounLower} before scoring anyone in this session.` : undefined}>
              <Select value={category ?? ''} onChange={(e) => setGlobalCategory(e.target.value)}>
                <option value="" disabled>- Choose {nounLower} -</option>
                {spec.subEvents.map((se) => <option key={se.key} value={se.key}>{se.label}</option>)}
              </Select>
            </Field>
          )}
          {state.participants.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500">No registered entrants for this discipline yet.</p>
          )}
          {/* One category applies to every row here - a named discipline, or a
              chosen global category - so the race/class name belongs once, in the
              subtitle above, not repeated on every single row. A genuinely
              multi-category "Whole sport" grid sport is the only shape that still
              needs its own column per race. */}
          {state.participants.length > 0 && (singleMark ? (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {state.participants.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  {/* The institute too: two swimmers can share a name, and a relay row is the institute's. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200" title={p.name}>{p.name || 'Unnamed'}</span>
                    {p.org && <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{p.org}</span>}
                  </span>
                  {category && (
                    <span className="hidden flex-1 truncate text-center text-xs text-slate-400 dark:text-slate-500 sm:block">
                      {spec.subEvents.find((se) => se.key === (p.category ?? category))?.label ?? noun}
                    </span>
                  )}
                  {/* Their result is in another class: shown, not editable from here. */}
                  {category && p.category && p.category !== category && hasResultIn(p, p.category) ? (
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                      title={`Switch to ${spec.subEvents.find((se) => se.key === p.category)?.label ?? 'their class'} to change this`}>
                      {spec.subEvents.find((se) => se.key === p.category)?.label ?? noun} · {resultStatusOf(p, p.category)
                        ?? `${p.marks[p.category]}${spec.result.unit ? ` ${spec.result.unit}` : ''}`}
                    </span>
                  ) : category ? (
                    <div className="flex shrink-0 items-start gap-1.5">
                      <div className="w-32">
                        <MarkInput
                          value={p.marks[category] ?? null} isTime={activeMeta.isTime} disabled={!!resultStatusOf(p, category)}
                          placeholder={activeMeta.isTime ? undefined : placeholderFor(activeMeta.unit)}
                          onChange={(n) => setMark(p.id, category, n)} ariaLabel={`${p.name || 'competitor'} ${markLabel}`}
                        />
                      </div>
                      <StatusSelect value={resultStatusOf(p, category)} onChange={(st) => setStatus(p.id, category, st)}
                        ariaLabel={`${p.name || 'competitor'} status`} />
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">Choose a {nounLower} above</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            state.participants.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <Field label="Competitor" compact>
                  <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{p.name || 'Unnamed'}{p.org ? <span className="font-normal text-slate-400 dark:text-slate-500"> · {p.org}</span> : null}</p>
                </Field>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {spec.subEvents.map((se) => {
                    const seMeta = markMetaFor(spec, se);
                    return (
                      <label key={se.key} className="block">
                        <span className="mb-1 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400" title={se.label}>{se.label}</span>
                        <MarkInput
                          value={p.marks[se.key] ?? null} isTime={seMeta.isTime} disabled={!!resultStatusOf(p, se.key)}
                          placeholder={seMeta.isTime ? undefined : placeholderFor(seMeta.unit)}
                          onChange={(n) => setMark(p.id, se.key, n)} ariaLabel={`${p.name || 'competitor'} ${se.label}`}
                        />
                        <StatusSelect value={resultStatusOf(p, se.key)} onChange={(st) => setStatus(p.id, se.key, st)}
                          ariaLabel={`${p.name || 'competitor'} ${se.label} status`} className="mt-1 w-full" />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          ))}
          {blockedOnCategory && (
            <p className="text-sm text-rose-600 dark:text-rose-400">Choose a {nounLower} above before saving.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={persist.isPending || blockedOnCategory} onClick={() => persistEvent(false)}>{persist.isPending ? 'Saving…' : 'Save results'}</Button>
            <Button size="sm" disabled={persist.isPending || blockedOnCategory} onClick={() => persistEvent(true)}>Save &amp; sign off</Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Team points" subtitle={spec.result.aggregate === 'sumBest' ? 'Sum of marks' : spec.result.aggregate === 'medals' ? `Medals ${pts}` : 'Placement points'} />
          <CardBody>
            {agg.length === 0 ? <p className="text-sm text-slate-400 dark:text-slate-500">No results yet.</p> : (
              <ul className="space-y-1.5">
                {agg.map((r, i) => (
                  <li key={r.key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{i + 1}. {r.label}</span>
                    <span className="font-bold tabular-nums">{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {blocks.length > 0 && (
          <Card>
            <CardHeader title={`Results by ${nounLower}`} subtitle="Who placed where, and the points it earned." />
            <CardBody className="space-y-3">
              {blocks.map((b) => {
                const bMeta = markMetaFor(spec, spec.subEvents.find((se) => se.key === b.key));
                return (
                <div key={b.key}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{b.label}</div>
                  <ul className="space-y-1">
                    {b.rows.map((r, i) => (
                      <li key={`${r.rank ?? r.status}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-slate-600 dark:text-slate-300">{r.rank != null ? `${r.rank}. ` : ''}{r.name}{r.org ? <span className="text-slate-400 dark:text-slate-500"> · {r.org}</span> : null}</span>
                        {r.status ? (
                          <span className="shrink-0 text-xs font-semibold text-rose-600 dark:text-rose-400" title={RESULT_STATUS_LABEL[r.status]}>{r.status}</span>
                        ) : (
                          <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{bMeta.isTime ? formatTime(r.mark!) : r.mark}{!bMeta.isTime && bMeta.unit ? ` ${bMeta.unit}` : ''} · +{r.points}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                );
              })}
            </CardBody>
          </Card>
        )}

        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CardBody className="text-xs text-slate-600 dark:text-slate-300">
            Each org's points (and 🥇/🥈/🥉 from every sub-event's top three) feed straight into the championship standings and medal tally.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// Numeric/time mark cell. Keeps the raw string the official typed (so mid-entry values
// like "1:0" aren't reformatted under the cursor) and emits the parsed number upward;
// only re-seeds from props when the stored value changes externally (e.g. live reload).
/** DNS / DNF / DQ beside a mark; blank means a result is expected. */
function StatusSelect({ value, onChange, ariaLabel, className }: { value: ResultStatus | null; onChange: (s: ResultStatus | null) => void; ariaLabel: string; className?: string }) {
  return (
    <Select value={value ?? ''} aria-label={ariaLabel} title={value ? RESULT_STATUS_LABEL[value] : 'Has a result'}
      className={cn('w-20 shrink-0 text-xs', value && 'text-rose-600 dark:text-rose-400', className)}
      onChange={(e) => onChange((e.target.value || null) as ResultStatus | null)}>
      <option value="">-</option>
      {RESULT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </Select>
  );
}

function MarkInput({ value, isTime, placeholder, onChange, ariaLabel, disabled }: { value: number | null; isTime: boolean; placeholder?: string; onChange: (n: number | null) => void; ariaLabel?: string; disabled?: boolean }) {
  const fmt = (v: number | null) => (v == null ? '' : isTime ? formatTime(v) : String(v));
  const [raw, setRaw] = useState(() => fmt(value));
  const emitted = useRef(value);
  useEffect(() => { if (value !== emitted.current) { emitted.current = value; setRaw(fmt(value)); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  // A time that is not valid keeps the last good one stored and says why, rather than
  // saving a typo as some other time ("1:75") or as the fastest swim ("0").
  const [error, setError] = useState<string | null>(null);
  const handle = (s: string) => {
    setRaw(s);
    if (isTime) {
      const t = readTimeInput(s);
      setError(t.error);
      if (t.error) return;
      emitted.current = t.value;
      onChange(t.value);
      return;
    }
    const n = s.trim() === '' ? null : Number(s);
    emitted.current = n;
    onChange(n);
  };
  return (
    <div className="grid gap-0.5">
      {/* Decimal keypad for every mark: a 182.5 kg total or a 5.42 m jump needs the point on phones. */}
      <Input
        type={isTime ? 'text' : 'number'} inputMode="decimal" step={isTime ? undefined : 'any'}
        value={raw} disabled={disabled} onChange={(e) => handle(e.target.value)} onBlur={() => { if (!error) setRaw(fmt(emitted.current)); }}
        className={cn('text-center', error && 'border-red-400 focus:ring-red-300 dark:border-red-500/60')}
        aria-label={ariaLabel} aria-invalid={!!error || undefined} placeholder={isTime ? 'mm:ss.s' : (placeholder ?? '')}
      />
      {error && <span role="alert" className="text-[10px] leading-tight text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

function SideDeck({ name, org, side, def, dispatch, disabled }: { name: string; org?: string; side: 'A' | 'B'; def: SportDef; dispatch: (a: Action) => void; disabled?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 text-center">
        <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-300">{name}</div>
        {org && <div className="truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{org}</div>}
      </div>
      <div className="grid gap-2">
        {def.pointButtons.map((p) => (
          <Button key={p} className="w-full justify-center text-base" disabled={disabled} onClick={() => dispatch({ type: 'POINT', team: side, pts: p })}>+{p}</Button>
        ))}
      </div>
    </div>
  );
}

// Configured events for a side (raid/tackle/card/…), attributed to a roster player.
// Scoring events credit the side via the engine; non-scoring events just log. Rendered
// only when the contest defines `events`.
function EventDeck({ side, name, def, team, dispatch, disabled }: { side: 'A' | 'B'; name: string; def: SportDef; team: any; dispatch: (a: Action) => void; disabled?: boolean }) {
  const players = rosterPeople(team);
  const [pid, setPid] = useState(players[0]?.id ?? '');
  if (!def.events?.length) return null;
  const fire = (ev: NonNullable<SportDef['events']>[number]) => {
    const pl = players.find((p) => p.id === pid);
    dispatch({
      type: 'EVENT', team: side, key: ev.key, label: ev.label, pts: ev.points ?? 0,
      playerId: ev.perPlayer ? (pid || undefined) : undefined,
      playerName: ev.perPlayer ? pl?.name : undefined,
    });
  };
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 text-center">
        <div className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{name} · events</div>
        {orgLabel(team) && <div className="truncate text-[11px] font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">{orgLabel(team)}</div>}
      </div>
      {def.attributePlayers && players.length > 0 && (
        <Select value={pid} onChange={(e) => setPid(e.target.value)} className="mb-2 text-sm">
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <div className="grid grid-cols-2 gap-2">
        {def.events.map((ev) => (
          <Button key={ev.key} variant="outline" size="sm" className="justify-center" disabled={disabled} onClick={() => fire(ev)}>{ev.label}</Button>
        ))}
      </div>
    </div>
  );
}

// The cricket TAP PAD that used to live here is gone. It counted runs and wickets
// and offered a "switch innings" button, with no notion of an over, a strike, or a
// bowler - so it could not tell a wide from a legal ball and credited nothing to
// anybody. Cricket now scores through features/scoring/CricketDeck against its own
// engine. Nothing reaches this file's LiveConsole with the cricket archetype any
// more: `cricket` and `box cricket` are the only two sports that carry it, and both
// route to CricketConsole above.

// Runs / wickets / overs trio for one cricket side - shared by the live quick-result
// and the manual final-score form so both read and behave identically.
function CricketSideInputs({ name, org, runs, wkt, overs, onRuns, onWkt, onOvers }:
  { name: string; org?: string; runs: string; wkt: string; overs: string;
    onRuns: (v: string) => void; onWkt: (v: string) => void; onOvers: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{name}</div>
      {org && <div className="-mt-0.5 mb-1 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{org}</div>}
      <div className="flex gap-2">
        <Input type="number" min={0} value={runs} onChange={(e) => onRuns(e.target.value)} className="text-center" aria-label={`${name} runs`} />
        <Input type="number" min={0} value={wkt} onChange={(e) => onWkt(e.target.value)} className="w-14 text-center" aria-label={`${name} wickets`} />
        <Input value={overs} onChange={(e) => onOvers(e.target.value)} className="w-16 text-center" placeholder="0.0" aria-label={`${name} overs`} />
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">runs · wkts · overs</div>
    </div>
  );
}

// Cricket-only: enter runs + wickets for both teams directly, declare the winner
// (or let it derive from runs), and write the final result text. Keyed by the live
// score upstream so it re-seeds when ball-by-ball scoring changes the totals.
function CricketQuickResult({ state, homeName, awayName, homeOrg, awayOrg, currentNotes, pending, onApply }:
  { state: MatchState; homeName: string; awayName: string; homeOrg?: string; awayOrg?: string; currentNotes: string; pending: boolean;
    onApply: (v: { runsA: number; wktA: number; runsB: number; wktB: number; oversA: string; oversB: string; winner: 'auto' | 'home' | 'away' | 'draw'; notes: string; complete: boolean }) => void }) {
  const [rA, setRA] = useState(String(state.runsA ?? 0));
  const [wA, setWA] = useState(String(state.wktA ?? 0));
  const [oA, setOA] = useState(oversStr(state.ballsA ?? 0));
  const [rB, setRB] = useState(String(state.runsB ?? 0));
  const [wB, setWB] = useState(String(state.wktB ?? 0));
  const [oB, setOB] = useState(oversStr(state.ballsB ?? 0));
  const [winner, setWinner] = useState<'auto' | 'home' | 'away' | 'draw'>('auto');
  const [notes, setNotes] = useState(currentNotes);

  const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const vals = (complete: boolean) => ({ runsA: num(rA), wktA: num(wA), runsB: num(rB), wktB: num(wB), oversA: oA, oversB: oB, winner, notes, complete });

  return (
    <Card>
      <CardHeader title="Quick result" subtitle="Enter the score directly or declare the winner." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <CricketSideInputs name={homeName} org={homeOrg} runs={rA} wkt={wA} overs={oA} onRuns={setRA} onWkt={setWA} onOvers={setOA} />
          <CricketSideInputs name={awayName} org={awayOrg} runs={rB} wkt={wB} overs={oB} onRuns={setRB} onWkt={setWB} onOvers={setOB} />
        </div>
        <Field label="Winner">
          <Select className="w-full" value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
            <option value="auto">Auto (from runs)</option>
            <option value="home">{homeName}</option>
            <option value="away">{awayName}</option>
            <option value="draw">Tie / draw</option>
          </Select>
        </Field>
        <Field label="Match result">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Home won by 25 runs" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => onApply(vals(false))}>Apply (keep live)</Button>
          <Button size="sm" disabled={pending} onClick={() => onApply(vals(true))}>Save &amp; complete</Button>
        </div>
      </CardBody>
    </Card>
  );
}

// Non-cricket fallback: type the headline result directly (points for points sports,
// segments won for sets/rally) and pick the winner, when the live deck went wrong or
// wasn't used. Keyed by the live headline upstream so it re-seeds as tapping changes it.
function DirectResult({ def, homeName, awayName, homeOrg, awayOrg, initialA, initialB, pending, onApply }:
  { def: SportDef; homeName: string; awayName: string; homeOrg?: string; awayOrg?: string; initialA: number; initialB: number; pending: boolean;
    onApply: (a: number, b: number, win: 'auto' | 'home' | 'away' | 'draw', complete: boolean) => void }) {
  const [a, setA] = useState(String(initialA));
  const [b, setB] = useState(String(initialB));
  const [winner, setWinner] = useState<'auto' | 'home' | 'away' | 'draw'>('auto');
  const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const unit = def.archetype === 'sets' || def.archetype === 'rally' ? `${def.segLabel.toLowerCase()}s won` : 'points';

  return (
    <Card>
      <CardHeader title="Enter result directly" subtitle={`Override the live tally - type the final ${unit} if scoring went wrong.`} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</div>
            {homeOrg && <div className="-mt-0.5 mb-1 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{homeOrg}</div>}
            <Input type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} className="text-center" aria-label={`${homeName} ${unit}`} />
          </div>
          <div>
            <div className="mb-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</div>
            {awayOrg && <div className="-mt-0.5 mb-1 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{awayOrg}</div>}
            <Input type="number" min={0} value={b} onChange={(e) => setB(e.target.value)} className="text-center" aria-label={`${awayName} ${unit}`} />
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{unit}</div>
        <Field label="Winner">
          <Select className="w-full" value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
            <option value="auto">Auto (from score)</option>
            <option value="home">{homeName}</option>
            <option value="away">{awayName}</option>
            <option value="draw">Tie / draw</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => onApply(num(a), num(b), winner, false)}>Apply (keep live)</Button>
          <Button size="sm" disabled={pending} onClick={() => onApply(num(a), num(b), winner, true)}>Save &amp; complete</Button>
        </div>
      </CardBody>
    </Card>
  );
}

// Walkover needs a winner and a reason - a plain status flip would leave the match
// with no result. Opens a popup to capture both, then records it via /live (which
// also advances the winner in a bracket draw).
function WalkoverButton({ fixtureId, homeName, awayName, homeOrg, awayOrg, homeTeamId, awayTeamId, invalidate, onDone, defaultScore, countsInDifference, className }:
  { fixtureId: string; homeName: string; awayName: string; homeOrg?: string; awayOrg?: string; homeTeamId: string | null; awayTeamId: string | null; invalidate: (string | null)[]; onDone: () => void;
    /** The format's walkover scoreline, winner first (e.g. 21-0). Blank = none recorded unless typed. */
    defaultScore?: [number, number] | null;
    /** The format counts the walkover score in score difference (football). Unknown = it does not. */
    countsInDifference?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState<'home' | 'away'>('home');
  const [reason, setReason] = useState('');
  const [winScore, setWinScore] = useState(defaultScore ? String(defaultScore[0]) : '');
  const [loseScore, setLoseScore] = useState(defaultScore ? String(defaultScore[1]) : '');
  const mut = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);
  const submit = () => {
    if (!reason.trim()) { toast.error('Add a walkover reason'); return; }
    const winner_team_id = winner === 'home' ? homeTeamId : awayTeamId;
    // A scoreline only when both numbers are given; it counts in score difference only where the format says so.
    const score = winScore !== '' && loseScore !== ''
      ? (winner === 'home' ? { home_score: Number(winScore), away_score: Number(loseScore) } : { home_score: Number(loseScore), away_score: Number(winScore) })
      : {};
    mut.mutate(
      { status: 'walkover', winner_team_id, notes: reason.trim(), ...score, walkover_counts: !!countsInDifference },
      { onSuccess: () => { setOpen(false); onDone(); }, onError: (e: any) => toast.error(e.message) },
    );
  };
  const digits = (v: string) => v.replace(/[^\d]/g, '').slice(0, 3);
  return (
    <>
      <Button variant="outline" className={className ?? 'w-full justify-start'} onClick={() => setOpen(true)}>Walkover</Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Record walkover</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A walkover awards the match to one side. Pick the winner and add a reason.</p>
            <div className="mt-4">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Winner</span>
              <Select value={winner} onChange={(e) => setWinner(e.target.value as 'home' | 'away')}>
                <option value="home">{homeOrg ? `${homeName} - ${homeOrg}` : homeName}</option>
                <option value="away">{awayOrg ? `${awayName} - ${awayOrg}` : awayName}</option>
              </Select>
            </div>
            <div className="mt-3">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Walkover score (optional)</span>
              <div className="flex items-center gap-2">
                <Input className="w-20 text-center" inputMode="numeric" value={winScore} onChange={(e) => setWinScore(digits(e.target.value))} placeholder="Winner" aria-label="Winner score" />
                <span className="text-slate-400">-</span>
                <Input className="w-20 text-center" inputMode="numeric" value={loseScore} onChange={(e) => setLoseScore(digits(e.target.value))} placeholder="Loser" aria-label="Loser score" />
              </div>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                The rulebook's walkover score, e.g. 2-0 in football. {countsInDifference ? 'Counts in score difference, like a played result.' : 'Left out of score difference.'}
              </p>
            </div>
            <div className="mt-3">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Reason</span>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. opponent didn't show / withdrew" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" disabled={mut.isPending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="flex-1" disabled={mut.isPending} onClick={submit}>{mut.isPending ? 'Saving…' : 'Record walkover'}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The walkover scoreline a kernel format implies, winner first. Null when the organiser enters it. */
function formatWalkoverScore(format: ScoringFormat | null | undefined): [number, number] | null {
  const rule = format?.endStates?.walkoverScoreline;
  if (!format || !rule || rule === 'organiserEnters') return null;
  if (rule === 'zeroZero') return [0, 0];
  const top = format.levels.length - 1;
  if (format.levels[top]?.decide === 'aggregate') return null;
  const lv = top > 0 && format.levels[top].target <= 1 ? format.levels[top - 1] : format.levels[top];
  return lv ? [lv.target, 0] : null;
}

/** "No-show?" row under a console that has no walkover control of its own. */
function WalkoverRow({ fixture, fixtureId, invalidate, onDone, defaultScore, countsInDifference }:
  { fixture: any; fixtureId: string; invalidate: (string | null)[]; onDone: () => void; defaultScore?: [number, number] | null; countsInDifference?: boolean }) {
  const open = !['completed', 'walkover', 'cancelled', 'bye'].includes(fixture.status) && fixture.scorecard_status !== 'locked';
  if (!open || !fixture.home_team_id || !fixture.away_team_id) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">A side didn't turn up or withdrew?</span>
      <WalkoverButton fixtureId={fixtureId} homeName={teamLabel(homeTeam(fixture))} awayName={teamLabel(awayTeam(fixture))}
        homeOrg={orgLabel(homeTeam(fixture))} awayOrg={orgLabel(awayTeam(fixture))}
        homeTeamId={fixture.home_team_id} awayTeamId={fixture.away_team_id}
        invalidate={invalidate} onDone={onDone} defaultScore={defaultScore} countsInDifference={countsInDifference} className="justify-center" />
    </div>
  );
}

/* ----------------------------- Lock scorecard (organiser sign-off) ----------------------------- */
// A locked scorecard is the permanent, official moment - it's what creates
// achievements/certificates and freezes the result forever (see lock.service.ts).
// Entering a score only gets a match to "completed"; nothing before this panel
// ever called /fixtures/:id/lock, so a played match could sit unlocked forever
// with no way to make it official. The match's assigned official may lock it, as
// can the organisers; only reopening a locked result is organiser-only.
function LockScorecardPanel({ fixtureId, scorecardStatus, invalidate }:
  { fixtureId: string; scorecardStatus: string; invalidate: (string | null)[] }) {
  const mut = useApiMutation(() => api('POST', `/fixtures/${fixtureId}/lock`, {}), invalidate);
  if (scorecardStatus === 'locked') {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-800/60">
        <span className="font-semibold text-slate-600 dark:text-slate-300">🔒 Scorecard locked</span>
        <span className="text-slate-400 dark:text-slate-500">- this result is now official and permanent.</span>
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="text-sm text-amber-800 dark:text-amber-300">
        <span className="font-semibold">Not locked yet.</span> Locking makes this result official - only an organiser can reopen it.
      </div>
      <Button disabled={mut.isPending}
        onClick={() => mut.mutate(undefined, {
          onSuccess: () => toast.success('Scorecard locked', 'This result is now official.'),
          onError: (e: any) => toast.error(e.message),
        })}>
        {mut.isPending ? 'Locking…' : 'Lock scorecard'}
      </Button>
    </div>
  );
}

function SecondaryStatus({ fixtureId, status, label, variant, invalidate, onDone }:
  { fixtureId: string; status: string; label: string; variant: 'outline' | 'danger'; invalidate: (string | null)[]; onDone: () => void }) {
  // Go through /live (assigned-official authorized), not the organiser-only /fixtures/:id.
  const mut = useApiMutation(() => api('PATCH', `/fixtures/${fixtureId}/live`, { status }), invalidate);
  return (
    <Button variant={variant} className="w-full justify-start" disabled={mut.isPending}
      onClick={() => mut.mutate(undefined, { onSuccess: onDone, onError: (e: any) => toast.error(e.message) })}>
      {label}
    </Button>
  );
}

/* ----------------------------- Manual result (time/measured sports) ----------------------------- */
function ManualResult({ fixture, fixtureId, def, live, invalidate, onDone, format }: {
  fixture: any; fixtureId: string; def: SportDef; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void;
  /** The match's racquet rules, when it has them: totals are checked against these, not the sport's fixed best-of. */
  format?: ScoringFormat | null;
}) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const homeOrg = orgLabel(homeTeam(fixture));
  const awayOrg = orgLabel(awayTeam(fixture));
  // Seed from the live detailed tally when one exists (so switching Detailed → Manual
  // keeps the score instead of resetting), else from the saved headline.
  const liveH = live?.live_state && Object.keys(live.live_state).length > 0 ? headline(def, hydrate(live.live_state)) : null;
  const seedHome = liveH ? liveH.a : fixture.home_score;
  const seedAway = liveH ? liveH.b : fixture.away_score;
  const [home, setHome] = useState(seedHome != null ? String(seedHome) : '');
  const [away, setAway] = useState(seedAway != null ? String(seedAway) : '');
  // Winner is chosen explicitly, not derived: for time events the fastest (lowest)
  // wins, so "higher score" can't be assumed. 'auto' falls back to higher-score.
  const [winner, setWinner] = useState<'auto' | 'home' | 'away' | 'draw'>('auto');
  const [notes, setNotes] = useState(fixture.notes ?? '');
  const saveResult = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/result`, body), invalidate);

  // Guidance on what the two numbers mean for this sport. `manualHint` (time/measured
  // sports) wins; otherwise derive from the archetype so manual mode reads clearly for
  // any sport (e.g. sets/games won vs raw points).
  // The match's own shape when its racquet rules are known: best of N units, or one
  // game whose points ARE the result (as the live console stores them).
  const top = format?.levels[format.levels.length - 1];
  const singleUnit = !!format && !!top && format.levels.length > 1 && top.target <= 1;
  const unitLevel = format && format.levels.length > 1 ? format.levels[format.levels.length - 2] : null;
  const unitLabel = (unitLevel?.label ?? def.segLabel).toLowerCase();
  const bestOf = top && !singleUnit ? top.target * 2 - 1 : def.segMax;
  // Carrom: a game's score stops at its target, so one game ends with the winner ON it.
  const carrom = isCarromSport(sportNameOf(fixture)) && format ? carromRulesOf(format) : null;

  const hint = def.manualHint ?? (
    carrom && singleUnit ? `Enter each side's points in the game (first to ${carrom.gameTarget}), then confirm the winner.`
    : singleUnit ? `Enter the final points of the ${unitLabel} for each side, then confirm the winner.`
    : def.archetype === 'sets' || def.archetype === 'rally' ? `Enter the number of ${unitLabel}s each side won, then confirm the winner.`
    : 'Enter the final score for each side, then confirm the winner.');

  // Digits only - a games/points tally is never negative and never fractional, so
  // there is nothing to parse later: whatever survives typing is already valid shape.
  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, '');

  const hs = home === '' ? null : Number(home);
  const as = away === '' ? null : Number(away);

  // A real result only: best of N ends with one side on the wins needed and the other
  // below ("2-3" in a best of 3 is a typo, EOS-164); play-all plays every unit; a single
  // game must be a finished score under its target, win-by and cap.
  const racquetShape = def.archetype === 'sets' || def.archetype === 'rally' || !!format;
  const winsNeeded = racquetShape && !singleUnit ? (top && format ? top.target : Math.ceil(def.segMax / 2)) : null;
  const playAll = !!unitLevel?.playAll;
  const carromGameValid = (a: number, b: number) => {
    const hi = Math.max(a, b);
    // With a board limit a game can end short of the target on the higher score.
    return a !== b && hi <= carrom!.gameTarget && (carrom!.maxBoards != null || hi === carrom!.gameTarget);
  };
  // A time cap can stop play short of the target, so any score inside the limits stands.
  // Multi-unit stays lenient on level: time up can go to the side ahead in the set in play.
  const timed = !!format?.clock;
  const timedValid = (a: number, b: number) => singleUnit && unitLevel
    ? Math.max(a, b) <= unitLevel.target && (a !== b || format!.endStates.drawsAllowed)
    : Math.max(a, b) <= winsNeeded! && !(a === winsNeeded && b === winsNeeded);
  const gamesValid = !racquetShape || hs == null || as == null ? true
    : carrom && singleUnit ? carromGameValid(hs, as)
    : timed ? timedValid(hs, as)
    : singleUnit && unitLevel ? unitWinner(unitLevel, [hs, as]) !== null
    : playAll ? hs + as === bestOf && hs !== as
    : (hs === winsNeeded && as < winsNeeded!) || (as === winsNeeded && hs < winsNeeded!);
  const gamesError = !gamesValid && hs != null && as != null
    ? carrom && singleUnit
      ? carrom.maxBoards != null
        ? `A carrom game ends on ${carrom.gameTarget}, or on the higher score after ${carrom.maxBoards} boards - nobody passes ${carrom.gameTarget} and it can't be level.`
        : `A carrom game ends when one side reaches ${carrom.gameTarget}: the winner is on ${carrom.gameTarget} and the other side on fewer - e.g. ${carrom.gameTarget}-14.`
      : timed
      ? singleUnit && unitLevel
        ? `Play stops at ${unitLevel.target} or on time - neither side can pass ${unitLevel.target}${format!.endStates.drawsAllowed ? '' : ', and it can\'t be level'}.`
        : `Neither side can have more than ${winsNeeded} ${unitLabel}s.`
      : singleUnit && unitLevel
      ? `That isn't a finished ${unitLabel}: first to ${unitLevel.target}${unitLevel.winBy > 1 ? ` by ${unitLevel.winBy}` : ''}${unitLevel.cap ? `, capped at ${unitLevel.cap}` : ''} - e.g. ${unitLevel.target}-${Math.max(0, unitLevel.target - 2)}.`
      : playAll
        ? `Every ${unitLabel} is played here: the two numbers must add up to ${bestOf}.`
        : `A best-of-${bestOf} match must end with one side on ${winsNeeded} ${unitLabel}s and the other on fewer - e.g. ${winsNeeded}-0 or ${winsNeeded}-${winsNeeded! - 1}.`
    : null;

  const autoWinnerId = hs != null && as != null && hs !== as ? (hs > as ? fixture.home_team_id : fixture.away_team_id) : null;
  const winnerId =
    winner === 'home' ? fixture.home_team_id :
    winner === 'away' ? fixture.away_team_id :
    winner === 'draw' ? null : autoWinnerId;
  const winnerLabel =
    winnerId === fixture.home_team_id ? homeName :
    winnerId === fixture.away_team_id ? awayName :
    winner === 'draw' || (hs != null && as != null) ? 'Draw' : '-';

  const submit = (status: 'live' | 'completed') => {
    saveResult.mutate({ home_score: hs, away_score: as, winner_team_id: winnerId, draw: winner === 'draw' || undefined, status, notes: notes || undefined },
      { onSuccess: status === 'completed' ? onDone : undefined, onError: (e: any) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader title="Enter result" subtitle="Record the result for this match, then confirm the winner." />
      <CardBody>
        {hint && <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600 dark:bg-brand-500/10 dark:text-slate-300">{hint}</p>}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label className="block min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <span className="mb-1.5 block h-3.5 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{homeOrg}</span>
            <Input type="number" min={0} value={home} onChange={(e) => setHome(onlyDigits(e.target.value))} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-lg font-black text-slate-400 dark:text-slate-500">:</span>
          <label className="block min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
            <span className="mb-1.5 block h-3.5 truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{awayOrg}</span>
            <Input type="number" min={0} value={away} onChange={(e) => setAway(onlyDigits(e.target.value))} className="text-center text-lg font-bold" />
          </label>
        </div>
        {gamesError && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {gamesError}
          </p>
        )}
        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Winner</span>
          <Select className="w-full" value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
            <option value="auto">Auto (higher score) - {winnerLabel}</option>
            <option value="home">{homeName}</option>
            <option value="away">{awayName}</option>
            <option value="draw">Tie / draw</option>
          </Select>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Result note</span>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="MoM, remarks, walkover reason…" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {/* Both buttons, not just complete: an impossible games tally (2-3 in a
              best-of-3) is never a valid state to save, live or final - the match
              would already be over the moment either side reached the threshold. */}
          <Button variant="outline" disabled={saveResult.isPending || (!gamesValid && winner !== 'draw')} onClick={() => submit('live')}>Save (keep live)</Button>
          <Button disabled={saveResult.isPending || (!gamesValid && winner !== 'draw')} onClick={() => submit('completed')}>{saveResult.isPending ? 'Saving…' : 'Save & complete'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ----------------------------- Manual result (cricket) ----------------------------- */
// Cricket's manual final-score form: like the generic ManualResult but with the
// runs/wickets/overs trio per side, just as cricket is actually scored. Persisted via
// /live (not /result) so wickets & overs land in live_state and the "runs/wkts (overs)"
// score renders everywhere - the bare runs alone would drop the wickets the official
// typed. inn/batting and any other live keys are preserved by spreading the snapshot.
function CricketManualResult({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const homeOrg = orgLabel(homeTeam(fixture));
  const awayOrg = orgLabel(awayTeam(fixture));
  // Seed from the saved live snapshot (the only place wickets/overs live). The live
  // query can land after mount, so re-seed once it arrives - mirrors LiveConsole.
  const seed = hydrate(live?.live_state);
  const [rA, setRA] = useState(String(seed.runsA ?? 0));
  const [wA, setWA] = useState(String(seed.wktA ?? 0));
  const [oA, setOA] = useState(oversStr(seed.ballsA ?? 0));
  const [rB, setRB] = useState(String(seed.runsB ?? 0));
  const [wB, setWB] = useState(String(seed.wktB ?? 0));
  const [oB, setOB] = useState(oversStr(seed.ballsB ?? 0));
  const [winner, setWinner] = useState<'auto' | 'home' | 'away' | 'draw'>('auto');
  const [notes, setNotes] = useState(fixture.notes ?? '');
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !live) return;
    seeded.current = true;
    const s = hydrate(live.live_state);
    setRA(String(s.runsA ?? 0)); setWA(String(s.wktA ?? 0)); setOA(oversStr(s.ballsA ?? 0));
    setRB(String(s.runsB ?? 0)); setWB(String(s.wktB ?? 0)); setOB(oversStr(s.ballsB ?? 0));
  }, [live]);

  const save = useLiveSave(fixtureId, invalidate);

  const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const runsA = num(rA), runsB = num(rB);
  // Winner is by runs (higher wins); 'auto' derives it, the rest are explicit.
  const autoWinnerId = runsA === runsB ? null : runsA > runsB ? fixture.home_team_id : fixture.away_team_id;
  const winnerId =
    winner === 'home' ? fixture.home_team_id :
    winner === 'away' ? fixture.away_team_id :
    winner === 'draw' ? null : autoWinnerId;
  const winnerLabel =
    winnerId === fixture.home_team_id ? homeName :
    winnerId === fixture.away_team_id ? awayName : 'Tie / draw';

  const submit = (status: 'live' | 'completed') => {
    const ns: MatchState = { ...hydrate(live?.live_state), runsA, wktA: num(wA), ballsA: oversToBalls(oA), runsB, wktB: num(wB), ballsB: oversToBalls(oB) };
    save.mutate(
      { live_state: { ...ns, noResult: winner === 'draw' && runsA !== runsB }, live_log: live?.live_log ?? [], home_score: runsA, away_score: runsB, status, winner_team_id: winnerId, notes: notes || null },
      { onSuccess: status === 'completed' ? onDone : undefined, onError: (e: any) => toast.error(e.message) },
    );
  };

  return (
    <Card>
      <CardHeader title="Enter result" subtitle="Record each side’s runs, wickets and overs, then confirm the winner." />
      <CardBody>
        <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600 dark:bg-brand-500/10 dark:text-slate-300">Enter the final runs, wickets and overs for each side, then confirm the winner.</p>
        <div className="grid grid-cols-2 gap-3">
          <CricketSideInputs name={homeName} org={homeOrg} runs={rA} wkt={wA} overs={oA} onRuns={setRA} onWkt={setWA} onOvers={setOA} />
          <CricketSideInputs name={awayName} org={awayOrg} runs={rB} wkt={wB} overs={oB} onRuns={setRB} onWkt={setWB} onOvers={setOB} />
        </div>
        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Winner</span>
          <Select className="w-full" value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
            <option value="auto">Auto (higher runs) - {winnerLabel}</option>
            <option value="home">{homeName}</option>
            <option value="away">{awayName}</option>
            <option value="draw">Tie / draw</option>
          </Select>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Result note</span>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="MoM, remarks, walkover reason…" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={save.isPending} onClick={() => submit('live')}>Save (keep live)</Button>
          <Button disabled={save.isPending} onClick={() => submit('completed')}>{save.isPending ? 'Saving…' : 'Save & complete'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
