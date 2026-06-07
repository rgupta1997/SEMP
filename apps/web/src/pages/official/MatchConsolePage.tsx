import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi, useApiMutation, fmtDateTime } from '../../lib/hooks';
import { Button, Card, CardBody, CardHeader, EmptyState, Input, Spinner, StatusBadge, Textarea, BackButton, cn } from '../../components/ui';
import { awayTeam, disciplineLabel, eventLabel, homeTeam, teamLabel, venueLabel } from './fixtureHelpers';
import {
  headline, hydrate, reduce, sportDef, subLine,
  type Action, type LogEntry, type MatchState, type SportDef,
} from '../../features/scoring/engine';

const SECONDARY: { status: string; label: string; variant: 'outline' | 'danger' }[] = [
  { status: 'walkover', label: 'Walkover', variant: 'outline' },
  { status: 'postponed', label: 'Postpone', variant: 'outline' },
  { status: 'cancelled', label: 'Cancel match', variant: 'danger' },
];

export function MatchConsolePage() {
  const { fixtureId } = useParams();
  const navigate = useNavigate();
  const { data: fixtures = [], isLoading } = useApi<any[]>('/me/officiating');
  const { data: live } = useApi<{ live_state: any; live_log: any[] }>(fixtureId ? `/fixtures/${fixtureId}/live` : null);
  const fixture = fixtures.find((f) => f.id === fixtureId);

  if (isLoading) return <Spinner />;
  if (!fixture) return <EmptyState icon="⚑" title="Match not found" description="This fixture is not assigned to you." action={<Button onClick={() => navigate('/official')}>Back to matches</Button>} />;

  const sportName = fixture.tournament_disciplines?.tournament_sports?.sports?.name;
  const def = sportDef(sportName);

  return (
    <div>
      <BackButton onClick={() => navigate('/official')}>My matches</BackButton>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{disciplineLabel(fixture)} {fixture.round ? `· ${fixture.round}` : ''}</span>
        <StatusBadge status={fixture.status} />
      </div>
      <div className="mb-4 text-sm text-slate-500 dark:text-slate-400">{eventLabel(fixture)} · {venueLabel(fixture)} · {fmtDateTime(fixture.scheduled_at)}</div>

      {def.archetype === 'time'
        ? <ManualResult fixture={fixture} fixtureId={fixtureId!} onDone={() => navigate('/official')} />
        : <LiveConsole key={fixtureId} fixture={fixture} fixtureId={fixtureId!} def={def} live={live} onDone={() => navigate('/official')} />}
    </div>
  );
}

/* ----------------------------- Live console ----------------------------- */
function LiveConsole({ fixture, fixtureId, def, live, onDone }:
  { fixture: any; fixtureId: string; def: SportDef; live?: { live_state: any; live_log: any[] }; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));

  const [state, setState] = useState<MatchState>(() => hydrate(live?.live_state));
  const [log, setLog] = useState<LogEntry[]>(() => (Array.isArray(live?.live_log) ? live!.live_log : []));
  const [history, setHistory] = useState<{ state: MatchState; log: LogEntry[] }[]>([]);
  const [status, setStatus] = useState<string>(fixture.status);
  const [confirming, setConfirming] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current && live) {
      setState(hydrate(live.live_state));
      setLog(Array.isArray(live.live_log) ? live.live_log : []);
      seeded.current = true;
    }
  }, [live]);

  const persist = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/live`, body), ['/me/officiating']);

  const save = (s: MatchState, l: LogEntry[], st: string, done = false) => {
    const h = headline(def, s);
    const winner_team_id = !done || h.a === h.b ? null : h.a > h.b ? fixture.home_team_id : fixture.away_team_id;
    persist.mutate({ live_state: s, live_log: l, home_score: h.a, away_score: h.b, status: st, winner_team_id },
      { onError: (e: any) => alert(e.message) });
  };

  const dispatch = (action: Action) => {
    const { state: ns, entry } = reduce(def, state, action);
    setHistory((hh) => [...hh, { state, log }].slice(-50));
    const nlog = entry ? [entry, ...log].slice(0, 80) : log;
    const st = status === 'scheduled' ? 'live' : status;
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

  const goLive = () => { setStatus('live'); save(state, log, 'live'); };
  const signOff = () => { setStatus('completed'); save(state, log, 'completed', true); setConfirming(false); onDone(); };

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

      {!completed && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader title="Scoring" subtitle={`${def.segLabel} ${def.archetype === 'cricket' ? state.inn : state.seg}${def.archetype !== 'cricket' ? ` of ${def.segMax}` : ''}`} />
            <CardBody className="space-y-4">
              {def.archetype === 'cricket' ? (
                <CricketDeck def={def} dispatch={dispatch} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <SideDeck name={homeName} side="A" def={def} dispatch={dispatch} />
                  <SideDeck name={awayName} side="B" def={def} dispatch={dispatch} />
                </div>
              )}

              {(def.archetype === 'sets' || def.archetype === 'rally') && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'NEXT_SEG' })}>
                  End {def.segLabel.toLowerCase()} {state.seg} (award to leader)
                </Button>
              )}
              {def.archetype === 'points' && state.seg < def.segMax && (
                <Button variant="outline" className="w-full" onClick={() => dispatch({ type: 'NEXT_SEG' })}>
                  Advance to {def.segLabel} {state.seg + 1}
                </Button>
              )}
            </CardBody>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Event log" action={<Button size="sm" variant="ghost" disabled={history.length === 0} onClick={undo}>↶ Undo</Button>} />
              <CardBody>
                {log.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No events yet — start scoring.</p>
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
                {!live_ && <Button className="w-full justify-start" disabled={persist.isPending} onClick={goLive}>Start match (go live)</Button>}
                <Button className="w-full justify-start" disabled={persist.isPending} onClick={() => setConfirming(true)}>✍ End match &amp; sign off</Button>
                {SECONDARY.map((s) => (
                  <SecondaryStatus key={s.status} fixtureId={fixtureId} status={s.status} label={s.label} variant={s.variant} onDone={onDone} />
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {completed && (
        <Card><CardBody className="py-8 text-center">
          <div className="text-sm text-slate-500 dark:text-slate-400">Result recorded.</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{homeName} {h.a} – {h.b} {awayName}</div>
          <Button className="mt-4" onClick={onDone}>Back to matches</Button>
        </CardBody></Card>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Confirm final result</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">This completes the match and updates standings.</p>
            <div className="my-4 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{h.a} – {h.b}</div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button className="flex-1" disabled={persist.isPending} onClick={signOff}>Sign off</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SideDeck({ name, side, def, dispatch }: { name: string; side: 'A' | 'B'; def: SportDef; dispatch: (a: Action) => void }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 truncate text-center text-sm font-semibold text-slate-700 dark:text-slate-300">{name}</div>
      <div className="grid gap-2">
        {def.pointButtons.map((p) => (
          <Button key={p} className="w-full justify-center text-base" onClick={() => dispatch({ type: 'POINT', team: side, pts: p })}>+{p}</Button>
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

function SecondaryStatus({ fixtureId, status, label, variant, onDone }:
  { fixtureId: string; status: string; label: string; variant: 'outline' | 'danger'; onDone: () => void }) {
  // Go through /live (assigned-official authorized), not the organiser-only /fixtures/:id.
  const mut = useApiMutation(() => api('PATCH', `/fixtures/${fixtureId}/live`, { status }), ['/me/officiating']);
  return (
    <Button variant={variant} className="w-full justify-start" disabled={mut.isPending}
      onClick={() => mut.mutate(undefined, { onSuccess: onDone, onError: (e: any) => alert(e.message) })}>
      {label}
    </Button>
  );
}

/* ----------------------------- Manual result (time/measured sports) ----------------------------- */
function ManualResult({ fixture, fixtureId, onDone }: { fixture: any; fixtureId: string; onDone: () => void }) {
  const homeName = teamLabel(homeTeam(fixture));
  const awayName = teamLabel(awayTeam(fixture));
  const [home, setHome] = useState(fixture.home_score != null ? String(fixture.home_score) : '');
  const [away, setAway] = useState(fixture.away_score != null ? String(fixture.away_score) : '');
  const [notes, setNotes] = useState(fixture.notes ?? '');
  const saveResult = useApiMutation((body: any) => api('PATCH', `/fixtures/${fixtureId}/result`, body), ['/me/officiating']);

  const hs = home === '' ? null : Number(home);
  const as = away === '' ? null : Number(away);
  const winnerLabel = hs == null || as == null ? '—' : hs > as ? homeName : as > hs ? awayName : 'Draw';

  const submit = (status: 'live' | 'completed') => {
    const winner_team_id = hs != null && as != null && hs !== as ? (hs > as ? fixture.home_team_id : fixture.away_team_id) : null;
    saveResult.mutate({ home_score: hs, away_score: as, winner_team_id, status, notes: notes || undefined },
      { onSuccess: status === 'completed' ? onDone : undefined, onError: (e: any) => alert(e.message) });
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
