import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, Spinner, StatusBadge, Textarea, BackButton, cn, toast } from '../../components/ui';
import { awayTeam, disciplineLabel, eventInfo, eventLabel, homeTeam, teamLabel, venueLabel } from './fixtureHelpers';
import {
  headline, hydrate, reduce, sportDef, subLine,
  type Action, type LogEntry, type MatchState, type SportDef,
} from '../../features/scoring/engine';

const SECONDARY: { status: string; label: string; variant: 'outline' | 'danger' }[] = [
  { status: 'walkover', label: 'Walkover', variant: 'outline' },
  { status: 'postponed', label: 'Postpone', variant: 'outline' },
  { status: 'cancelled', label: 'Cancel match', variant: 'danger' },
];

// Matches can only be recorded once the championship is under way (status
// "ongoing"). Before that, scoring is blocked — these explain the current state.
const NOT_STARTED_STATUS: Record<string, string> = {
  draft: 'still in draft and hasn’t opened yet',
  registration_open: 'open for registration but hasn’t started yet',
};

export function MatchConsolePage() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Where to return when done — set by whoever opened the console (host Results
  // tab passes its path); officials fall back to their matches list.
  const back = (location.state as { from?: string } | null)?.from ?? '/officiating';
  const backLabel = back === '/officiating' ? 'My matches' : 'Results';
  // Single fixture, authorized for the assigned official OR the championship host.
  const { data: fixture, isLoading } = useApi<any>(fixtureId ? `/fixtures/${fixtureId}/scoring` : null);
  const { data: live } = useApi<{ live_state: any; live_log: any[] }>(fixtureId ? `/fixtures/${fixtureId}/live` : null);

  if (isLoading) return <Spinner />;
  if (!fixture) return <EmptyState icon="⚑" title="Match not found" description="This fixture isn't available to you." action={<Button onClick={() => navigate(back)}>Back</Button>} />;

  const sportName = fixture.tournament_disciplines?.tournament_sports?.sports?.name;
  const def = sportDef(sportName);
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
  // server rule in the UI so the official sees *why* — and can't waste effort scoring.
  const champStatus = fixture.tournament_disciplines?.tournament_sports?.tournaments?.championships?.status;
  const notStarted = champStatus === 'draft' || champStatus === 'registration_open';
  // A match can't be scored until both sides are known — a TBD bracket slot (e.g. a
  // final waiting on its semis) has no teams to score. Mirror the server rule here.
  const missingTeams = !fixture.home_team_id || !fixture.away_team_id;

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
              This match still has a <b>TBD</b> slot — it can’t go live or be scored until both teams are assigned.
            </p>
            <p className="mx-auto max-w-md text-sm text-slate-500 dark:text-slate-400">
              The organiser sets the teams from the championship’s <b>Schedule → Fixtures</b> tab (edit the fixture). Once both sides are in, reopen this match to score it.
            </p>
            <div className="pt-1"><Button variant="outline" onClick={done}>Back to {backLabel.toLowerCase()}</Button></div>
          </CardBody>
        </Card>
      ) : (
        <>
          {def.archetype === 'time'
            ? <ManualResult fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} onDone={done} />
            : <LiveConsole key={fixtureId} fixture={fixture} fixtureId={fixtureId!} def={def} live={live} invalidate={invalidate} onDone={done} />}

          {fixture.point_scheme === 'custom' && (
            <div className="mt-5">
              <CustomPointsPanel fixture={fixture} fixtureId={fixtureId!} invalidate={invalidate} />
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

/* ----------------------------- Custom championship points ----------------------------- */
// Shown only when the draw's point system is "custom": the organiser awards
// championship points to each side for this result. Saved to the fixture and fed
// into standings. Current values come from the fixture's live_state.custom_points.
function CustomPointsPanel({ fixture, fixtureId, invalidate }: { fixture: any; fixtureId: string; invalidate: (string | null)[] }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
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
      <CardHeader title="Championship points" subtitle="This championship awards custom points — enter the points each side earns from this result. They feed the standings." />
      <CardBody>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <Input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-sm font-semibold text-slate-400 dark:text-slate-500">pts</span>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
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

/* ----------------------------- Awards ----------------------------- */
type AwardItem = { award_name: string; recipient_user_id: string };
type AwardRow = AwardItem & { id: string; recipient_name: string | null };

function rosterPeople(team: any): { id: string; name: string; team: string }[] {
  return (team?.team_members ?? [])
    .map((tm: any) => ({ id: tm.users?.id as string, name: tm.users?.name ?? '—', team: teamLabel(team) }))
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
      <CardHeader title="Awards" subtitle="Recognise players — e.g. Player of the Match. Multiple allowed." />
      <CardBody className="space-y-3">
        {people.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No players on the team rosters yet — add players to a team to give awards.</p>
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

  const [state, setState] = useState<MatchState>(() => hydrate(live?.live_state));
  const [log, setLog] = useState<LogEntry[]>(() => (Array.isArray(live?.live_log) ? live!.live_log : []));
  const [history, setHistory] = useState<{ state: MatchState; log: LogEntry[] }[]>([]);
  const [status, setStatus] = useState<string>(fixture.status);
  const [confirming, setConfirming] = useState(false);
  // Terminal actions (go live / sign off) track their own in-flight state so the
  // per-tap score autosave (`persist.isPending`) never disables the match controls.
  const [submitting, setSubmitting] = useState(false);
  // Re-open a completed match for corrections. Revealing the scorer doesn't touch
  // the server — the first scoring action (or re-sign-off) flips it back to live.
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
  // winner — used by the cricket quick-result panel to declare a winner directly.
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
    // Scoring is frozen once the final period is ended — ignore point taps until reopened.
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
  // cache invalidation mark /fixtures stale before the Results page remounts —
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
  const applyQuick = (v: { runsA: number; wktA: number; runsB: number; wktB: number; winner: 'auto' | 'home' | 'away' | 'draw'; notes: string; complete: boolean }) => {
    const ns: MatchState = { ...state, runsA: v.runsA, wktA: v.wktA, runsB: v.runsB, wktB: v.wktB };
    setState(ns);
    const st = v.complete ? 'completed' : status === 'scheduled' ? 'live' : status;
    setStatus(st);
    const opts: { winner?: string | null; notes?: string } = { notes: v.notes };
    if (v.winner === 'home') opts.winner = fixture.home_team_id;
    else if (v.winner === 'away') opts.winner = fixture.away_team_id;
    else if (v.winner === 'draw') opts.winner = null;
    save(ns, log, st, v.complete, v.complete ? () => { setStatus('completed'); onDone(); } : undefined, opts);
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
            <div className="flex-1 text-right text-lg font-bold">{homeName}</div>
            <div className="flex items-center gap-3 text-5xl font-black tabular-nums">
              <span>{h.a}</span><span className="text-slate-600">:</span><span>{h.b}</span>
            </div>
            <div className="flex-1 text-left text-lg font-bold">{awayName}</div>
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
                  <SideDeck name={homeName} side="A" def={def} dispatch={dispatch} disabled={state.ended} />
                  <SideDeck name={awayName} side="B" def={def} dispatch={dispatch} disabled={state.ended} />
                </div>
              )}

              {(def.archetype === 'sets' || def.archetype === 'rally') && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'NEXT_SEG' })}>
                  End {def.segLabel.toLowerCase()} {state.seg} (award to leader)
                </Button>
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
              <CardHeader title="Championship log" action={<Button size="sm" variant="ghost" disabled={history.length === 0} onClick={undo}>↶ Undo</Button>} />
              <CardBody>
                {log.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No championships yet — start scoring.</p>
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
                {SECONDARY.map((s) => (
                  <SecondaryStatus key={s.status} fixtureId={fixtureId} status={s.status} label={s.label} variant={s.variant} invalidate={invalidate} onDone={onDone} />
                ))}
              </CardBody>
            </Card>

            {def.archetype === 'cricket' && (
              <CricketQuickResult key={`${state.runsA}-${state.wktA}-${state.runsB}-${state.wktB}`}
                state={state} homeName={homeName} awayName={awayName}
                currentNotes={fixture.notes ?? ''} pending={persist.isPending} onApply={applyQuick} />
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
            <div className="my-4 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{h.a} – {h.b}</div>
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

function SideDeck({ name, side, def, dispatch, disabled }: { name: string; side: 'A' | 'B'; def: SportDef; dispatch: (a: Action) => void; disabled?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 truncate text-center text-sm font-semibold text-slate-700 dark:text-slate-300">{name}</div>
      <div className="grid gap-2">
        {def.pointButtons.map((p) => (
          <Button key={p} className="w-full justify-center text-base" disabled={disabled} onClick={() => dispatch({ type: 'POINT', team: side, pts: p })}>+{p}</Button>
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

// Cricket-only: enter runs + wickets for both teams directly, declare the winner
// (or let it derive from runs), and write the final result text. Keyed by the live
// score upstream so it re-seeds when ball-by-ball scoring changes the totals.
function CricketQuickResult({ state, homeName, awayName, currentNotes, pending, onApply }:
  { state: MatchState; homeName: string; awayName: string; currentNotes: string; pending: boolean;
    onApply: (v: { runsA: number; wktA: number; runsB: number; wktB: number; winner: 'auto' | 'home' | 'away' | 'draw'; notes: string; complete: boolean }) => void }) {
  const [rA, setRA] = useState(String(state.runsA ?? 0));
  const [wA, setWA] = useState(String(state.wktA ?? 0));
  const [rB, setRB] = useState(String(state.runsB ?? 0));
  const [wB, setWB] = useState(String(state.wktB ?? 0));
  const [winner, setWinner] = useState<'auto' | 'home' | 'away' | 'draw'>('auto');
  const [notes, setNotes] = useState(currentNotes);

  const num = (s: string) => Math.max(0, Math.floor(Number(s) || 0));
  const vals = (complete: boolean) => ({ runsA: num(rA), wktA: num(wA), runsB: num(rB), wktB: num(wB), winner, notes, complete });

  return (
    <Card>
      <CardHeader title="Quick result" subtitle="Enter the score directly or declare the winner." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</div>
            <div className="flex gap-2">
              <Input type="number" min={0} value={rA} onChange={(e) => setRA(e.target.value)} className="text-center" aria-label={`${homeName} runs`} />
              <Input type="number" min={0} value={wA} onChange={(e) => setWA(e.target.value)} className="w-16 text-center" aria-label={`${homeName} wickets`} />
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">runs · wkts</div>
          </div>
          <div>
            <div className="mb-1 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</div>
            <div className="flex gap-2">
              <Input type="number" min={0} value={rB} onChange={(e) => setRB(e.target.value)} className="text-center" aria-label={`${awayName} runs`} />
              <Input type="number" min={0} value={wB} onChange={(e) => setWB(e.target.value)} className="w-16 text-center" aria-label={`${awayName} wickets`} />
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">runs · wkts</div>
          </div>
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
function ManualResult({ fixture, fixtureId, invalidate, onDone }: { fixture: any; fixtureId: string; invalidate: (string | null)[]; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const [home, setHome] = useState(fixture.home_score != null ? String(fixture.home_score) : '');
  const [away, setAway] = useState(fixture.away_score != null ? String(fixture.away_score) : '');
  const [notes, setNotes] = useState(fixture.notes ?? '');
  const saveResult = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/result`, body), invalidate);

  const hs = home === '' ? null : Number(home);
  const as = away === '' ? null : Number(away);
  const winnerLabel = hs == null || as == null ? '—' : hs > as ? homeName : as > hs ? awayName : 'Draw';

  const submit = (status: 'live' | 'completed') => {
    const winner_team_id = hs != null && as != null && hs !== as ? (hs > as ? fixture.home_team_id : fixture.away_team_id) : null;
    saveResult.mutate({ home_score: hs, away_score: as, winner_team_id, status, notes: notes || undefined },
      { onSuccess: status === 'completed' ? onDone : undefined, onError: (e: any) => toast.error(e.message) });
  };

  return (
    <Card>
      <CardHeader title="Enter result" subtitle="Record the score — the winner is derived automatically." />
      <CardBody>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{homeName}</span>
            <Input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="text-center text-lg font-bold" />
          </label>
          <span className="pb-2 text-lg font-black text-slate-400 dark:text-slate-500">:</span>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{awayName}</span>
            <Input type="number" min={0} value={away} onChange={(e) => setAway(e.target.value)} className="text-center text-lg font-bold" />
          </label>
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">Winner: </span><span className="font-semibold text-slate-800 dark:text-slate-200">{winnerLabel}</span>
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
