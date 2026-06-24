import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Spinner, StatusBadge, Textarea, BackButton, cn, confirmDialog, toast } from '../../components/ui';
import { awayTeam, disciplineLabel, eventInfo, eventLabel, homeTeam, orgLabel, sportName as sportNameOf, teamLabel, venueLabel } from './fixtureHelpers';
import {
  cricketScore, headline, hydrate, oversStr, oversToBalls, reduce, sportDef, subLine,
  type Action, type LogEntry, type MatchState, type SportDef,
} from '../../features/scoring/engine';
import { resolveTemplate, tieTemplateFor, eventTemplateFor } from '../../features/scoring/templates';
import {
  hydrateTie, rubbersWon, tieWinner, tieTarget, rubberDef, decideRubber as decideRubberFn, reopenRubber as reopenRubberFn,
  type TieState, type RubberInstance,
} from '../../features/scoring/tie';
import { hydrateEvent, aggregateEvent, subEventResults, parseTimeInput, formatTime, placementPoints, type EventState, type ParticipantResult } from '../../features/scoring/event';
import type { TieSpec, EventSpec, ScoringMode } from '@semp/shared';

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

export function MatchConsolePage() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Where to return when done - set by whoever opened the console (host Results
  // tab passes its path); officials fall back to their matches list.
  const back = (location.state as { from?: string } | null)?.from ?? '/officiating';
  const backLabel = back === '/officiating' ? 'My matches' : 'Results';
  // Single fixture, authorized for the assigned official OR the championship host.
  const { data: fixture, isLoading } = useApi<any>(fixtureId ? `/fixtures/${fixtureId}/scoring` : null);
  const { data: live } = useApi<{ live_state: any; live_log: any[] }>(fixtureId ? `/fixtures/${fixtureId}/live` : null);

  if (isLoading) return <Spinner />;
  if (!fixture) return <EmptyState icon="⚑" title="Match not found" description="This fixture isn't available to you." action={<Button onClick={() => navigate(back)}>Back</Button>} />;

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
  const done = () => navigate(back);

  // The championship must have started before any match can be recorded. Mirror the
  // server rule in the UI so the official sees *why* - and can't waste effort scoring.
  const champStatus = fixture.tournament_disciplines?.tournament_sports?.tournaments?.championships?.status;
  const notStarted = champStatus === 'draft' || champStatus === 'registration_open';
  // A match can't be scored until both sides are known - a TBD bracket slot (e.g. a
  // final waiting on its semis) has no teams to score. Mirror the server rule here.
  // Sports that can be scored as a multi-competitor event have no two teams, so the
  // check doesn't apply to them.
  const missingTeams = !canBeEvent && (!fixture.home_team_id || !fixture.away_team_id);

  return (
    <div>
      <BackButton onClick={done}>{backLabel}</BackButton>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{disciplineLabel(fixture)} {fixture.round ? `· ${fixture.round}` : ''}</span>
        <StatusBadge status={fixture.status} />
      </div>
      <div className="mb-4 text-sm text-slate-500 dark:text-slate-400">{eventLabel(fixture)} · {venueLabel(fixture)} · {fmtDateTime(fixture.scheduled_at)}</div>

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
        <>
          <ScoringTabs fixture={fixture} fixtureId={fixtureId!} live={live} invalidate={invalidate} onDone={done} />

          {fixture.point_scheme === 'custom' && (
            <div className="mt-5">
              <CustomPointsPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
            </div>
          )}

          {sportDef(sportNameOf(fixture)).archetype === 'cricket' && (
            <div className="mt-5">
              <ScorecardPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
            </div>
          )}

          <div className="mt-5">
            <AwardsPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Scoring tabs (structure + depth) ----------------------------- */
type Structure = 'single' | 'tie' | 'event';

// A pill toggle for picking among a few options (structure / scoring depth).
function TabBar<T extends string>({ value, onChange, options, label }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  if (options.length < 2) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/60">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={cn('rounded-lg px-3 py-1.5 text-sm font-medium transition',
              o.value === value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Officials pick how to score this match here, not the organiser: the structure
// (single / team tie / multi-competitor event - only those the sport supports) and the
// depth (live point-by-point vs final score). Defaults to the sport's natural format
// (and to whatever has already been scored on reload); switching tabs is non-destructive
// since each structure keeps its own slice of live_state.
function ScoringTabs({ fixture, fixtureId, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
  const sportName = sportNameOf(fixture);
  const template = resolveTemplate(fixture);
  const singleDef: SportDef = template.single ?? sportDef(sportName);
  const tieSpec = (template.fixtureType === 'tie' && template.tie) ? template.tie : tieTemplateFor(sportName)?.tie;
  const eventSpec = (template.fixtureType === 'event' && template.event) ? template.event : eventTemplateFor(sportName)?.event;

  const structures: Structure[] = ['single', ...(tieSpec ? ['tie' as const] : []), ...(eventSpec ? ['event' as const] : [])];
  // Default structure: an explicit stored config wins; otherwise the sport's natural
  // format (event/tie sports default to those, everything else to a single match).
  const storedType = fixture?.tournament_disciplines?.format_config?.scoring?.fixtureType as Structure | undefined;
  const naturalDefault: Structure = eventSpec ? 'event' : tieSpec ? 'tie' : 'single';
  const baseDefault: Structure = storedType && structures.includes(storedType) ? storedType : naturalDefault;

  const [structure, setStructure] = useState<Structure>(baseDefault);
  // Once the live snapshot arrives, snap to whatever's already been scored (so a
  // half-finished tie/event reopens on the right tab).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !live) return;
    seeded.current = true;
    if (live.live_state?.tie && tieSpec) setStructure('tie');
    else if (live.live_state?.event && eventSpec) setStructure('event');
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot seed

  // Measured/time single sports have no per-tick scoring, so they're manual-only.
  const forcedManual = structure === 'single' && singleDef.archetype === 'time';
  const storedMode = fixture?.tournament_disciplines?.format_config?.scoring?.scoringMode as ScoringMode | undefined;
  const [mode, setMode] = useState<ScoringMode>(storedMode ?? (singleDef.archetype === 'time' ? 'manual' : 'detailed'));
  const effectiveMode: ScoringMode = forcedManual ? 'manual' : mode;
  const showDepth = structure !== 'event' && !forcedManual;
  // Multi-competitor events default to a simple team ranking (which team did well); the
  // detailed per-athlete console is kept available behind this toggle.
  const [eventMode, setEventMode] = useState<'ranking' | 'detailed'>('ranking');

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

  // Each structure signs off its own result, so moving to another one abandons whatever
  // was scored under the current one. Confirm the switch once the match has any scoring
  // recorded so the official can't lose a part-scored tie/match by tapping the wrong tab.
  const switchStructure = async (next: Structure) => {
    if (next === structure) return;
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

  return (
    <>
      {(structures.length > 1 || showDepth || structure === 'event') && (
        <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
          <TabBar label="Match structure" value={structure} onChange={switchStructure}
            options={structures.map((s) => ({ value: s, label: structureLabel(s) }))} />
          {structure === 'event' ? (
            <TabBar label="Scoring" value={eventMode} onChange={setEventMode}
              options={[{ value: 'ranking', label: 'Ranking' }, { value: 'detailed', label: 'Detailed · per athlete' }]} />
          ) : showDepth ? (
            <TabBar label="Scoring" value={mode} onChange={switchMode}
              options={[{ value: 'detailed', label: 'Detailed · live' }, { value: 'manual', label: 'Manual · final score' }]} />
          ) : null}
        </div>
      )}

      {structure === 'event' && eventSpec
        ? eventMode === 'ranking'
          ? <EventRankingConsole key={`evr-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={eventSpec} live={live} invalidate={invalidate} />
          : <EventConsole key={`ev-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={eventSpec} live={live} invalidate={invalidate} />
        : structure === 'tie' && tieSpec
          ? <TieConsole key={`tie-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} spec={tieSpec} mode={effectiveMode} live={live} invalidate={invalidate} onDone={onDone} />
          : effectiveMode === 'manual'
            ? singleDef.archetype === 'cricket'
              ? <CricketManualResult key={`cman-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} live={live} invalidate={invalidate} onDone={onDone} />
              : <ManualResult key={`man-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} def={singleDef} live={live} invalidate={invalidate} onDone={onDone} />
            : <LiveConsole key={`live-${fixtureId}`} fixture={fixture} fixtureId={fixtureId} def={singleDef} live={live} invalidate={invalidate} onDone={onDone} />}
    </>
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
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <span className="mb-1.5 block h-3.5 text-[11px] font-normal text-slate-400 dark:text-slate-500">{homeOrg}</span>
            <Input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-sm font-semibold text-slate-400 dark:text-slate-500">pts</span>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
            <span className="mb-1.5 block h-3.5 text-[11px] font-normal text-slate-400 dark:text-slate-500">{awayOrg}</span>
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
type AwardItem = { award_name: string; recipient_user_id: string };
type AwardRow = AwardItem & { id: string; recipient_name: string | null };

function rosterPeople(team: any): { id: string; name: string; team: string }[] {
  return (team?.team_members ?? [])
    .map((tm: any) => ({ id: tm.users?.id as string, name: tm.users?.name ?? '-', team: teamLabel(team) }))
    .filter((p: { id?: string }) => !!p.id);
}

// Free-text awards with a recipient picked from the two teams' rosters. Replace-all
// save; these surface as the recipient's achievements on their dashboard.
function AwardsPanel({ fixture, fixtureId, invalidate }: { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const people = [...rosterPeople(homeTeam(fixture)), ...rosterPeople(awayTeam(fixture))];
  const { data: existing } = useApi<AwardRow[]>(`/fixtures/${fixtureId}/awards`);
  const [rows, setRows] = useState<AwardItem[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && existing) {
      setRows(existing.map((a) => ({ award_name: a.award_name, recipient_user_id: a.recipient_user_id })));
      seeded.current = true;
    }
  }, [existing]);

  const saveAwards = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/awards`, body), [`/fixtures/${fixtureId}/awards`, ...invalidate]);

  const addRow = () => setRows((r) => [...r, { award_name: '', recipient_user_id: people[0]?.id ?? '' }]);
  const update = (i: number, patch: Partial<AwardItem>) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const save = () => {
    const awards = rows
      .filter((r) => r.award_name.trim() && r.recipient_user_id)
      .map((r) => ({ award_name: r.award_name.trim(), recipient_user_id: r.recipient_user_id }));
    saveAwards.mutate({ awards }, { onSuccess: () => toast.success('Awards saved'), onError: (e: any) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader title="Awards" subtitle="Recognise players - e.g. Player of the Match. Multiple allowed." />
      <CardBody className="space-y-3">
        {people.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No players on the team rosters yet - add players to a team to give awards.</p>
        ) : (
          <>
            {rows.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No awards yet.</p>}
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Award">
                  <Input value={row.award_name} onChange={(e) => update(i, { award_name: e.target.value })} placeholder="Player of the Match" />
                </Field>
                <Field label="Recipient">
                  <Select value={row.recipient_user_id} onChange={(e) => update(i, { recipient_user_id: e.target.value })}>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.team}</option>)}
                  </Select>
                </Field>
                <Button variant="ghost" size="sm" className="mb-1" onClick={() => remove(i)}>Remove</Button>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" size="sm" onClick={addRow}>+ Add award</Button>
              <Button size="sm" disabled={saveAwards.isPending} onClick={save}>{saveAwards.isPending ? 'Saving…' : 'Save awards'}</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
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

  const persist = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);

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
              {def.archetype === 'cricket' ? (
                <CricketDeck def={def} dispatch={dispatch} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <SideDeck name={homeName} org={homeOrg} side="A" def={def} dispatch={dispatch} disabled={state.ended} />
                  <SideDeck name={awayName} org={awayOrg} side="B" def={def} dispatch={dispatch} disabled={state.ended} />
                </div>
              )}

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
function TieConsole({ fixture, fixtureId, spec, mode, live, invalidate, onDone }:
  { fixture: any; fixtureId: string; spec: TieSpec; mode: ScoringMode; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
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

  const persist = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);

  // Public ticker log: one line per decided rubber.
  const buildLog = (s: TieState): LogEntry[] =>
    s.rubbers.filter((r) => r.winner).map((r) => ({ t: '', team: r.winner ?? undefined, txt: `${r.label}: ${r.winner === 'A' ? homeName : awayName} won` }));

  const save = (next: TieState, st: string, done = false, onSuccess?: () => void, onErr?: () => void) => {
    const { a, b } = rubbersWon(next);
    const w = tieWinner(spec, next);
    const winner_team_id = done ? (w === 'A' ? fixture.home_team_id : w === 'B' ? fixture.away_team_id : null) : null;
    persist.mutate(
      { live_state: { tie: next }, live_log: buildLog(next), home_score: a, away_score: b, status: st, winner_team_id },
      { onSuccess, onError: (e: any) => { onErr?.(); toast.error(e.message); } },
    );
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

  const decide = (i: number, winner: 'A' | 'B') => {
    const next = decideRubberFn(spec, state, i, winner);
    const st = liveStatusFor(status);
    setState(next); setStatus(st); save(next, st);
  };

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

  const w = tieWinner(spec, state);
  const decided = w !== null;
  const target = tieTarget(spec);
  const signOff = async () => {
    if (!decided) { toast.error(`The tie isn’t decided yet - record rubber results until one side reaches ${target}.`); return; }
    const { a, b } = rubbersWon(state);
    const ok = await confirmDialog({ title: 'Confirm final result', confirmLabel: 'Sign off', message: `${homeName} ${a} - ${b} ${awayName}. This completes the tie and updates standings.` });
    if (!ok) return;
    setSubmitting(true);
    save(state, 'completed', true, () => { setStatus('completed'); setSubmitting(false); onDone(); }, () => setSubmitting(false));
  };

  const { a, b } = rubbersWon(state);
  const live_ = status === 'live';
  const completed = status === 'completed' || status === 'confirmed';
  const active = state.rubbers[state.activeRubber];
  const rdef = rubberDef(spec, state.activeRubber);

  const rubberScore = (r: RubberInstance, i: number): string => {
    if (r.status === 'dead') return 'not played';
    if (r.winner) return `${r.winner === 'A' ? homeName : awayName} won`;
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
            <span>Tie · first to {target} rubbers</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-5">
            <div className="flex-1 text-right">
              <div className="text-lg font-bold">{homeName}</div>
              {orgLabel(homeTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(homeTeam(fixture))}</div>}
            </div>
            <div className="flex items-center gap-3 text-5xl font-black tabular-nums"><span>{a}</span><span className="text-slate-600">:</span><span>{b}</span></div>
            <div className="flex-1 text-left">
              <div className="text-lg font-bold">{awayName}</div>
              {orgLabel(awayTeam(fixture)) && <div className="text-xs font-normal text-slate-400">{orgLabel(awayTeam(fixture))}</div>}
            </div>
          </div>
          <div className="mt-2 text-center text-sm text-slate-400">{decided ? `${w === 'A' ? homeName : awayName} win the tie` : `${a + b} of ${spec.rubbers.length} rubbers played`}</div>
        </div>
      </Card>

      {(!completed || editing) && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Rubbers" subtitle="Tap a rubber to score it (or to reopen and correct one). The tie is won by taking the majority." />
              <CardBody className="space-y-1.5">
                {state.rubbers.map((r, i) => {
                  const isActive = i === state.activeRubber;
                  const dead = r.status === 'dead';
                  return (
                    <button key={r.key} type="button" onClick={() => setActive(i)}
                      className={cn('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition',
                        isActive ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                          : dead ? 'border-slate-200 opacity-60 hover:opacity-100 dark:border-slate-800'
                            : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                      <span className="font-medium text-slate-700 dark:text-slate-200">{r.label}</span>
                      <span className={cn('text-xs font-semibold', r.winner ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')}>{rubberScore(r, i)}</span>
                    </button>
                  );
                })}
              </CardBody>
            </Card>

            {active && (
              <Card>
                <CardHeader title={active.label} subtitle={active.status === 'dead' ? 'Skipped (dead rubber)' : active.winner ? `${active.winner === 'A' ? homeName : awayName} won this rubber` : rdef.archetype === 'time' ? 'Pick the winner of this rubber.' : `${rdef.segLabel} ${Math.min(active.state.seg, rdef.segMax)} of ${rdef.segMax}`} />
                <CardBody className="space-y-4">
                  {active.status === 'dead' ? (
                    <div className="space-y-3 text-center">
                      <p className="text-sm text-slate-500 dark:text-slate-400">This rubber was skipped because the tie was already decided. Reopen it to record or correct a result.</p>
                      <Button variant="outline" className="w-full" onClick={() => reopen(state.activeRubber)}>↺ Reopen this rubber</Button>
                    </div>
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
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant={active.winner === 'A' ? 'primary' : 'outline'} onClick={() => decide(state.activeRubber, 'A')}>
                          <span className="flex flex-col items-center leading-tight">
                            <span>{homeName} won</span>
                            {homeOrg && <span className="text-[11px] font-normal opacity-75">{homeOrg}</span>}
                          </span>
                        </Button>
                        <Button variant={active.winner === 'B' ? 'primary' : 'outline'} onClick={() => decide(state.activeRubber, 'B')}>
                          <span className="flex flex-col items-center leading-tight">
                            <span>{awayName} won</span>
                            {awayOrg && <span className="text-[11px] font-normal opacity-75">{awayOrg}</span>}
                          </span>
                        </Button>
                      </div>
                      {active.winner && mode === 'detailed' && rdef.archetype !== 'time' && (
                        <Button variant="ghost" className="w-full" onClick={() => reopen(state.activeRubber, true)}>↺ Reopen &amp; clear to re-score</Button>
                      )}
                    </>
                  )}
                </CardBody>
              </Card>
            )}
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Tie control" />
              <CardBody className="space-y-2">
                {!live_ && !editing && <Button className="w-full justify-start" disabled={submitting} onClick={goLive}>Start tie (go live)</Button>}
                <Button className="w-full justify-start" disabled={submitting} onClick={signOff}>✍ End tie &amp; sign off</Button>
                {!decided && <p className="px-1 text-xs text-slate-400 dark:text-slate-500">Record rubber results until one side reaches {target}.</p>}
                <WalkoverButton fixtureId={fixtureId} homeName={homeName} awayName={awayName} homeOrg={homeOrg} awayOrg={awayOrg} homeTeamId={fixture.home_team_id} awayTeamId={fixture.away_team_id} invalidate={invalidate} onDone={onDone} />
                {SECONDARY.map((s) => (
                  <SecondaryStatus key={s.status} fixtureId={fixtureId} status={s.status} label={s.label} variant={s.variant} invalidate={invalidate} onDone={onDone} />
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {completed && !editing && (
        <Card><CardBody className="py-8 text-center">
          <div className="text-sm text-slate-500 dark:text-slate-400">Tie recorded.</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{homeName} {a} – {b} {awayName}</div>
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
  const champId = eventInfo(fixture)?.id;
  const { data: parts } = useApi<{ organizations: { orgId: string; org: { id: string; name: string } | null }[] }>(
    champId ? `/championships/${champId}/participants` : null);
  const orgs = (parts?.organizations ?? [])
    .map((o) => ({ id: o.org?.id ?? o.orgId, name: o.org?.name ?? 'Unaffiliated' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const medalPoints = spec.result.medalPoints ?? [5, 3, 1];

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

  const persist = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);
  const setPlace = (orgId: string, place: number | null) => setPlaces((p) => {
    const n = { ...p }; if (place) n[orgId] = place; else delete n[orgId]; return n;
  });

  const save = () => {
    const rows = orgs.map((o) => ({ orgId: o.id, org: o.name, place: places[o.id] ?? null }));
    persist.mutate(
      { live_state: { ...(live?.live_state ?? {}), eventRanking: { rows } }, status: fixture.status === 'scheduled' ? 'live' : fixture.status },
      { onSuccess: () => toast.success('Ranking saved'), onError: (e: any) => toast.error(e.message) },
    );
  };

  const n = orgs.length;
  const ranked = orgs
    .map((o) => ({ ...o, place: places[o.id] ?? null, points: placementPoints(places[o.id], medalPoints) }))
    .filter((r) => r.place != null)
    .sort((a, b) => b.points - a.points || (a.place! - b.place!) || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader title="Team ranking" subtitle={`Set each team's finishing place — points are awarded by placement (${medalPoints.join(' / ')}).`} />
        <CardBody className="space-y-2">
          {orgs.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No teams have joined this championship yet.</p>
          ) : orgs.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{o.name}</span>
              <div className="flex items-center gap-2">
                <Select value={places[o.id] ?? ''} onChange={(e) => setPlace(o.id, e.target.value ? Number(e.target.value) : null)} className="w-28">
                  <option value="">— place —</option>
                  {Array.from({ length: n }, (_, i) => i + 1).map((pl) => <option key={pl} value={pl}>{ordinal(pl)}</option>)}
                </Select>
                <span className="w-8 text-right text-sm font-bold tabular-nums text-slate-500 dark:text-slate-400">{placementPoints(places[o.id], medalPoints)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <Button size="sm" disabled={persist.isPending} onClick={save}>{persist.isPending ? 'Saving…' : 'Save ranking'}</Button>
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
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardBody className="text-xs text-slate-600 dark:text-slate-300">
            Saved here as the team ranking. Feeding these points into championship standings is the remaining backend step for events.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- Event console (multi-competitor) ----------------------------- */
// Swimming heats / powerlifting categories: many participants, each recording a mark per
// sub-event, aggregated into team (org) points. Stores EventState in live_state.event.
// NOTE: final completion + feeding points into standings is the remaining backend track
// for events (see plan); results save and aggregate live here.
function EventConsole({ fixture, fixtureId, spec, live, invalidate }:
  { fixture: any; fixtureId: string; spec: EventSpec; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[] }) {
  const [state, setState] = useState<EventState>(() => hydrateEvent(live?.live_state?.event));
  const seeded = useRef(false);
  useEffect(() => { if (!seeded.current && live) { setState(hydrateEvent(live.live_state?.event)); seeded.current = true; } }, [live]);

  // Orgs entered in this championship drive the "counts towards" picker (standings
  // aggregate by org). Free of a champ id we simply offer no orgs (the field still
  // allows an individual entry).
  const champId = eventInfo(fixture)?.id;
  const { data: parts } = useApi<{ organizations: { orgId: string; org: { id: string; name: string } | null }[] }>(
    champId ? `/championships/${champId}/participants` : null);
  const orgs = (parts?.organizations ?? [])
    .map((o) => ({ id: o.org?.id ?? o.orgId, name: o.org?.name ?? 'Unaffiliated' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Map a stored row to its dropdown value: prefer the stored orgId, else match the
  // legacy free-text name to an org so older rows still show their selection.
  const orgValue = (p: ParticipantResult) => p.orgId ?? orgs.find((o) => o.name === (p.org ?? ''))?.id ?? '';

  const persist = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);

  const isTime = spec.result.resultType === 'time';
  const pickOne = !!spec.pickOne;
  const noun = spec.subEventNoun ?? 'sub-event';
  const nounLower = noun.toLowerCase();
  const firstKey = spec.subEvents[0]?.key;

  const addP = () => setState((s) => ({ participants: [...s.participants, { id: `p${Date.now()}`, name: '', org: null, orgId: null, category: pickOne ? firstKey : null, marks: {} }] }));
  const removeP = (id: string) => setState((s) => ({ participants: s.participants.filter((p) => p.id !== id) }));
  const patchP = (id: string, patch: Partial<ParticipantResult>) => setState((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setOrg = (id: string, orgId: string) => patchP(id, { orgId: orgId || null, org: orgs.find((o) => o.id === orgId)?.name ?? null });
  const setMark = (id: string, key: string, n: number | null) => setState((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, marks: { ...p.marks, [key]: n } } : p)) }));
  // Switching weight class carries the mark over to the new key (and drops the old).
  const setCategory = (id: string, cat: string) => setState((s) => ({ participants: s.participants.map((p) => {
    if (p.id !== id) return p;
    const prev = p.category ?? firstKey;
    return { ...p, category: cat, marks: { [cat]: p.marks[prev] ?? null } };
  }) }));

  const save = () => persist.mutate(
    { live_state: { ...(live?.live_state ?? {}), event: state }, status: fixture.status === 'scheduled' ? 'live' : fixture.status },
    { onSuccess: () => toast.success('Results saved'), onError: (e: any) => toast.error(e.message) },
  );

  const agg = aggregateEvent(spec, state);
  const blocks = subEventResults(spec, state);
  const unit = spec.result.unit ? ` (${spec.result.unit})` : '';
  const pts = (spec.result.medalPoints ?? [5, 3, 1]).join(' / ');
  const best = spec.result.winnerIs === 'min' ? 'fastest' : 'best';
  // Plain-English explanation of how marks become org points, by aggregate rule.
  const scoringText = spec.result.aggregate === 'sumBest'
    ? `Each org's points are the sum of its athletes' marks.`
    : spec.result.aggregate === 'medals'
      ? `Each ${nounLower} is ranked (${best} wins) — the top finishers earn ${pts} points for their org. An org's total is the sum across every ${nounLower}.`
      : `Each ${nounLower} awards placement points down the order to each finisher's org; an org's total is the sum across every ${nounLower}.`;
  const subtitle = pickOne
    ? `Pick each competitor's ${nounLower} and enter their total${unit}.`
    : `Enter each competitor's mark per ${nounLower}${unit}.`;
  const markLabel = `Total${unit}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader title="Participants & results" subtitle={subtitle} />
        <CardBody className="space-y-3">
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600 dark:bg-brand-500/10 dark:text-slate-300">{scoringText}</p>
          {state.participants.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">No participants yet - add one below.</p>}
          {state.participants.map((p) => {
            const cat = p.category ?? firstKey;
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label="Name"><Input value={p.name} onChange={(e) => patchP(p.id, { name: e.target.value })} placeholder="Competitor" /></Field>
                  <Field label="Counts towards">
                    <Select value={orgValue(p)} onChange={(e) => setOrg(p.id, e.target.value)}>
                      <option value="">— Individual —</option>
                      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                  </Field>
                  <Button variant="ghost" size="sm" className="mb-1" onClick={() => removeP(p.id)}>Remove</Button>
                </div>
                {pickOne ? (
                  <div className="mt-2 grid grid-cols-[1fr_140px] items-end gap-2">
                    <Field label={noun}>
                      <Select value={cat} onChange={(e) => setCategory(p.id, e.target.value)}>
                        {spec.subEvents.map((se) => <option key={se.key} value={se.key}>{se.label}</option>)}
                      </Select>
                    </Field>
                    <Field label={markLabel}>
                      <MarkInput value={p.marks[cat] ?? null} isTime={isTime} onChange={(n) => setMark(p.id, cat, n)} ariaLabel={`${p.name || 'competitor'} ${markLabel}`} />
                    </Field>
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {spec.subEvents.map((se) => (
                      <label key={se.key} className="block">
                        <span className="mb-1 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400" title={se.label}>{se.label}</span>
                        <MarkInput value={p.marks[se.key] ?? null} isTime={isTime} onChange={(n) => setMark(p.id, se.key, n)} ariaLabel={`${p.name || 'competitor'} ${se.label}`} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addP}>+ Add participant</Button>
            <Button size="sm" disabled={persist.isPending} onClick={save}>{persist.isPending ? 'Saving…' : 'Save results'}</Button>
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
              {blocks.map((b) => (
                <div key={b.key}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{b.label}</div>
                  <ul className="space-y-1">
                    {b.rows.map((r) => (
                      <li key={r.rank} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-slate-600 dark:text-slate-300">{r.rank}. {r.name}{r.org ? <span className="text-slate-400 dark:text-slate-500"> · {r.org}</span> : null}</span>
                        <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{isTime ? formatTime(r.mark) : r.mark}{!isTime && spec.result.unit ? ` ${spec.result.unit}` : ''} · +{r.points}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardBody className="text-xs text-slate-600 dark:text-slate-300">
            Event results save live and aggregate here. Final sign-off and feeding these points into championship standings is the remaining backend step for multi-competitor events.
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// Numeric/time mark cell. Keeps the raw string the official typed (so mid-entry values
// like "1:0" aren't reformatted under the cursor) and emits the parsed number upward;
// only re-seeds from props when the stored value changes externally (e.g. live reload).
function MarkInput({ value, isTime, onChange, ariaLabel }: { value: number | null; isTime: boolean; onChange: (n: number | null) => void; ariaLabel?: string }) {
  const fmt = (v: number | null) => (v == null ? '' : isTime ? formatTime(v) : String(v));
  const [raw, setRaw] = useState(() => fmt(value));
  const emitted = useRef(value);
  useEffect(() => { if (value !== emitted.current) { emitted.current = value; setRaw(fmt(value)); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const handle = (s: string) => {
    setRaw(s);
    const n = isTime ? parseTimeInput(s) : (s.trim() === '' ? null : Number(s));
    emitted.current = n;
    onChange(n);
  };
  return (
    <Input
      type={isTime ? 'text' : 'number'} inputMode={isTime ? 'decimal' : 'numeric'}
      value={raw} onChange={(e) => handle(e.target.value)} onBlur={() => setRaw(fmt(emitted.current))}
      className="text-center" aria-label={ariaLabel} placeholder={isTime ? 'mm:ss.s' : ''}
    />
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

function CricketDeck({ def, dispatch }: { def: SportDef; dispatch: (a: Action) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Runs off the bat</div>
      <div className="grid grid-cols-6 gap-2">
        {def.pointButtons.map((r) => (
          <Button key={r} variant={r === 4 || r === 6 ? 'primary' : 'outline'} className="justify-center text-base" onClick={() => dispatch({ type: 'POINT', pts: r })}>{r}</Button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="danger" onClick={() => dispatch({ type: 'WICKET' })}>Wicket</Button>
        <Button variant="outline" onClick={() => dispatch({ type: 'SWITCH_INNINGS' })}>Switch innings</Button>
      </div>
    </div>
  );
}

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
          <Select value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
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
          <Select value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
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
function WalkoverButton({ fixtureId, homeName, awayName, homeOrg, awayOrg, homeTeamId, awayTeamId, invalidate, onDone }:
  { fixtureId: string; homeName: string; awayName: string; homeOrg?: string; awayOrg?: string; homeTeamId: string | null; awayTeamId: string | null; invalidate: (string | null)[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState<'home' | 'away'>('home');
  const [reason, setReason] = useState('');
  const mut = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);
  const submit = () => {
    if (!reason.trim()) { toast.error('Add a walkover reason'); return; }
    const winner_team_id = winner === 'home' ? homeTeamId : awayTeamId;
    mut.mutate(
      { status: 'walkover', winner_team_id, notes: reason.trim() },
      { onSuccess: () => { setOpen(false); onDone(); }, onError: (e: any) => toast.error(e.message) },
    );
  };
  return (
    <>
      <Button variant="outline" className="w-full justify-start" onClick={() => setOpen(true)}>Walkover</Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Record walkover</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A walkover awards the match to one side. Pick the winner and add a reason.</p>
            <div className="mt-4">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Winner</span>
              <Select value={winner} onChange={(e) => setWinner(e.target.value as 'home' | 'away')}>
                <option value="home">{homeOrg ? `${homeName} — ${homeOrg}` : homeName}</option>
                <option value="away">{awayOrg ? `${awayName} — ${awayOrg}` : awayName}</option>
              </Select>
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
function ManualResult({ fixture, fixtureId, def, live, invalidate, onDone }: { fixture: any; fixtureId: string; def: SportDef; live?: { live_state: any; live_log: any[] }; invalidate: (string | null)[]; onDone: () => void }) {
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
  const hint = def.manualHint ?? (
    def.archetype === 'sets' || def.archetype === 'rally' ? `Enter the number of ${def.segLabel.toLowerCase()}s each side won, then confirm the winner.`
    : 'Enter the final score for each side, then confirm the winner.');

  const hs = home === '' ? null : Number(home);
  const as = away === '' ? null : Number(away);
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
    saveResult.mutate({ home_score: hs, away_score: as, winner_team_id: winnerId, status, notes: notes || undefined },
      { onSuccess: status === 'completed' ? onDone : undefined, onError: (e: any) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader title="Enter result" subtitle="Record the result for this match, then confirm the winner." />
      <CardBody>
        {hint && <p className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600 dark:bg-brand-500/10 dark:text-slate-300">{hint}</p>}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <span className="mb-1.5 block h-3.5 text-[11px] font-normal text-slate-400 dark:text-slate-500">{homeOrg}</span>
            <Input type="number" value={home} onChange={(e) => setHome(e.target.value)} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-lg font-black text-slate-400 dark:text-slate-500">:</span>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
            <span className="mb-1.5 block h-3.5 text-[11px] font-normal text-slate-400 dark:text-slate-500">{awayOrg}</span>
            <Input type="number" value={away} onChange={(e) => setAway(e.target.value)} className="text-center text-lg font-bold" />
          </label>
        </div>
        <div className="mt-3">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Winner</span>
          <Select value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
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
          <Button variant="outline" disabled={saveResult.isPending} onClick={() => submit('live')}>Save (keep live)</Button>
          <Button disabled={saveResult.isPending} onClick={() => submit('completed')}>{saveResult.isPending ? 'Saving…' : 'Save & complete'}</Button>
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

  const save = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), invalidate);

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
      { live_state: ns, live_log: live?.live_log ?? [], home_score: runsA, away_score: runsB, status, winner_team_id: winnerId, notes: notes || null },
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
          <Select value={winner} onChange={(e) => setWinner(e.target.value as 'auto' | 'home' | 'away' | 'draw')}>
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
