import { useEffect, useMemo, useRef, useState } from 'react';
import {
  atAdvantage, changesEndsAfterUnit, effectiveLevel, expediteAllowed, expediteConfig, foldRally, initKernel, isDecider, rallyTiming,
  resolveServer, resultEnvelope, serveCall, serveEveryNow, serveSpecFor, step, unitClock,
  type KernelState, type LevelSpec, type Pairing, type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';
import { Button, Card, cn, confirmDialog, Select, toast } from '../../components/ui';

// ============================================================================
// The racquet console.
//
// THE BUTTONS MEAN "THIS SIDE WON THE RALLY", not "this side scored". The
// distinction is invisible in badminton and decisive in squash English-9 or
// traditional pickleball, where the receiver winning a rally takes the serve and no
// point at all. Getting the label wrong here makes those formats unscoreable.
//
// The deck holds an append-only RallyLog and derives everything by folding it. Undo
// is a truncate. Nothing is a mutable counter, so undo restores the serve, the
// server number and the service court along with the two numbers.
// ============================================================================

/** Log events that only run the clock - no rally, no score, no serve. */
const CLOCK_EVENTS: ReadonlySet<string> = new Set(['clockStart', 'clockPause', 'clockAdjust']);

export interface RacquetDeckProps {
  format: ScoringFormat;
  /** Where the format came from - shown so "who changed the rules?" has an answer. */
  provenance?: string;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Named players per side, in nominated order. Drives the next-server name. */
  pairing?: Pairing;
  /** Who is actually on court, when known. Shown instead of the entry's team name. */
  homePlayers?: string[];
  awayPlayers?: string[];
  log: RallyLog;
  firstServer: Side;
  onChange: (log: RallyLog, state: KernelState) => void;
  onSignOff: (log: RallyLog, state: KernelState) => void;
  onFirstServerChange?: (side: Side) => void;
  /** Swap which partner of a pair is listed first - the first server / first receiver. */
  onSwapPair?: (side: Side) => void;
  /** Stable id for this match, to remember console-only choices across reloads. */
  matchKey?: string;
  disabled?: boolean;
  busy?: boolean;
}

export function RacquetDeck(p: RacquetDeckProps) {
  const { format, log, firstServer } = p;
  const fold = useMemo(() => foldRally(format, log, firstServer), [format, log, firstServer]);
  const state = fold.state;
  const lv = effectiveLevel(format, state, state.pointLevel);
  const serve = serveSpecFor(format, lv);
  const doubles = !!(p.pairing && (p.pairing.A.length > 1 || p.pairing.B.length > 1));
  const env = resultEnvelope(format, state);
  const [showTools, setShowTools] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Rescoring a finished match: the deck goes back to taking rallies. The score is
  // NOT cleared - the log is the history, and walking it back is what Undo is for.
  const [rescoring, setRescoring] = useState(false);
  // The switch-ends prompt is a one-shot: it fires on a single point and must not
  // re-appear on every re-render of that same state.
  const dismissed = useRef<number>(-1);
  // Mirrors the deck so the scorer's left/right matches the court after a change of ends.
  const [flipped, setFlipped] = useState(false);
  // Who serves (and, in doubles, who serves/receives first) is settled before the first
  // rally: a wrong start makes the serve, the call and the service stats wrong all match.
  const [started, setStarted] = useState(false);
  const needsSetup = !started && log.length === 0 && serve.movement !== 'none' && !!p.onFirstServerChange;

  // The organisation leads (it is who the side represents); the players sit underneath.
  // Without an org the entry's name leads; without a known lineup the entry name is the subtitle.
  const playersOf = (s: Side) => (s === 'A' ? p.homePlayers : p.awayPlayers);
  // Both sides from one organisation (an internal event) - the org tells them apart from nothing.
  const sameOrg = !!p.homeOrg && p.homeOrg === p.awayOrg;
  const orgOf = (s: Side) => (sameOrg ? null : (s === 'A' ? p.homeOrg : p.awayOrg) || null);
  const entryOf = (s: Side) => (s === 'A' ? p.homeName : p.awayName);
  const nameOf = (s: Side) => orgOf(s) ?? entryOf(s);
  const subOf = (s: Side) => {
    const players = playersOf(s);
    if (players?.length) return players.join(' / ');
    return orgOf(s) ? entryOf(s) : null;
  };
  const homeName = nameOf('A');
  const awayName = nameOf('B');

  const top = format.levels.length - 1;
  const multiUnit = top > 0 && format.levels[top].target > 1;
  const unitLabel = multiUnit ? format.levels[top - 1].label : null;
  const heading = state.ended
    ? 'Final'
    : multiUnit
      ? isDecider(format, state, top - 1)
        ? `Deciding ${unitLabel!.toLowerCase()}`
        : `${unitLabel} ${state.score[top][0] + state.score[top][1] + 1} of ${format.levels[top].target * 2 - 1}`
      : lv.label;
  // A substituted or collapsed unit (a tie-break) is named under the heading.
  const subHeading = !state.ended && multiUnit && lv.label !== format.levels[state.pointLevel].label ? lv.label : null;

  // "Serve 2 of 2" for sports where the serve changes every N points (table tennis).
  const serveTurn = (() => {
    if (state.ended || serve.movement !== 'everyN') return null;
    const every = serveEveryNow(format, serve, state);
    return every === 1 ? 'one serve each' : `serve ${state.serve.turnCount + 1} of ${every}`;
  })();

  // ── Expedite (table tennis) ──────────────────────────────────────────────
  const expedite = serve.movement === 'everyN' ? expediteConfig(format) : null;
  // The game clock pauses for towel breaks via clockPause / clockStart in the log, so a
  // reload keeps them. The umpire's watch stays authoritative; this only prompts them.
  const [now, setNow] = useState(() => Date.now());
  const gameClock = expedite && !state.expedite && !state.ended ? unitClock(format, log, firstServer, now) : null;
  const clockRunning = gameClock !== null;
  const clockPaused = !!gameClock?.paused;
  useEffect(() => {
    if (!clockRunning || clockPaused) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [clockRunning, clockPaused]);
  const gameElapsed = gameClock?.elapsedMs ?? 0;
  const expediteDue = clockRunning && gameElapsed >= expedite!.afterMinutes * 60_000;
  const pts = state.score[state.pointLevel];
  const expediteExempt = !!expedite && !expediteAllowed(format, state);
  // The scorer may decline the rule for this match. Kept per match in the browser only:
  // it hides a prompt, it changes nothing about the score.
  const dismissStore = p.matchKey ? `semp:expedite-declined:${p.matchKey}` : null;
  const [expediteDeclined, setExpediteDeclined] = useState<boolean>(() => {
    try { return !!dismissStore && window.localStorage.getItem(dismissStore) === '1'; } catch { return false; }
  });
  const declineExpedite = (declined: boolean) => {
    setExpediteDeclined(declined);
    try {
      if (!dismissStore) return;
      if (declined) window.localStorage.setItem(dismissStore, '1'); else window.localStorage.removeItem(dismissStore);
    } catch { /* private mode: the choice lasts for this visit */ }
  };
  // Receiver's good returns in the rally under way. Any logged event ends the rally.
  const [returns, setReturns] = useState(0);
  useEffect(() => { setReturns(0); }, [log.length]);
  const receiver: Side = state.serve.side === 'A' ? 'B' : 'A';
  const addReturn = () => {
    if (!expedite) return;
    if (returns + 1 >= expedite.returnsToWinPoint) {
      push({ t: 'point', side: receiver, kind: 'expedite_returns', label: `${expedite.returnsToWinPoint} returns` });
    } else {
      setReturns(returns + 1);
    }
  };

  // What winning the next rally would decide, from the kernel itself - so side-out
  // scoring (receiver can't score) and tie-breaks are handled without special cases.
  const pointCue = (side: Side): string | null => {
    if (state.ended) return null;
    const r = step(format, state, { t: 'point', side });
    if (r.state.ended && r.state.winner === side) return 'Match point';
    const won = r.effect.unitsWon;
    return won.length ? `${won[won.length - 1].label} point` : null;
  };

  const push = (ev: RallyEvent) => {
    if (p.disabled) return;
    const next = [...log, { ...ev, at: new Date().toISOString() }];
    p.onChange(next, foldRally(format, next, firstServer).state);
  };

  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    p.onChange(next, foldRally(format, next, firstServer).state);
  };

  const label = (n: number) => pointLabel(lv, n);

  const resolved = p.pairing ? resolveServer(format, state, p.pairing) : null;
  const call = serve.movement === 'none' ? null : serveCall(format, state, doubles);
  // Two kinds of change: mid-game (the decider midpoint) and after a finished game.
  // Read off the last PLAYED event, so pausing the clock does not hide the prompt.
  let playIdx = fold.trace.length - 1;
  while (playIdx >= 0 && CLOCK_EVENTS.has(fold.trace[playIdx].event.t)) playIdx -= 1;
  const lastEffect = playIdx >= 0 ? fold.trace[playIdx] : undefined;
  const afterUnit = !!lastEffect && changesEndsAfterUnit(format, state, lastEffect.unitsWon);
  const showSwitch = (!!lastEffect?.switchEnds || afterUnit) && dismissed.current !== playIdx;
  const switchText = afterUnit
    ? `Change ends before the next ${lastEffect!.unitsWon[0].label.toLowerCase()}`
    : `Change ends · midpoint of the deciding ${lv.label.toLowerCase()}`;

  const timing = useMemo(() => rallyTiming(format, log, firstServer), [format, log, firstServer]);

  const panel = (side: Side) => (
    <ScorePanel
      key={side}
      name={nameOf(side)} org={subOf(side)} side={side}
      points={label(state.score[state.pointLevel][side === 'A' ? 0 : 1])}
      serving={serve.movement !== 'none' && state.serve.side === side}
      cue={pointCue(side)}
      units={multiUnit ? { label: `${unitLabel}s`, won: state.score[top][side === 'A' ? 0 : 1] } : null}
      align={(side === 'A') !== flipped ? 'left' : 'right'}
    />
  );
  const [leftSide, rightSide]: [Side, Side] = flipped ? ['B', 'A'] : ['A', 'B'];

  return (
    <div className="grid gap-4">
      {/* ── Header: what rules are in force, and where they came from ─────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div className="text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{format.name}</span>
          {p.provenance && <span className="ml-2">· {p.provenance}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
          {!state.ended && timing.matchMs !== null && (
            <span title="Playing time: first point to the latest" className="font-mono tabular-nums">
              ⏱ {minutes(timing.matchMs)}
            </span>
          )}
          {state.expedite && <Badge tone="amber">Expedite</Badge>}
          {format.officiatingMode === 'selfScored' && <Badge tone="amber">Self-scored</Badge>}
          {format.clock && <Badge tone="slate">{format.clock.minutes} min cap</Badge>}
          {lv.startingScore && <Badge tone="slate">Handicap {lv.startingScore.join('–')}</Badge>}
        </div>
      </div>

      {showSwitch && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          <span className="mr-auto">{switchText}</span>
          <Button size="sm" variant="outline"
            onClick={() => { dismissed.current = playIdx; setShowTools(false); setFlipped((f) => !f); }}>
            Swap sides on screen
          </Button>
          <Button size="sm" variant="subtle" onClick={() => { dismissed.current = playIdx; setShowTools(false); }}>
            Dismiss
          </Button>
        </div>
      )}

      {/* ── The score ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {panel(leftSide)}
        <div className="text-center">
          <div className="font-mono text-xs uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {heading}
          </div>
          {subHeading && (
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {subHeading}
            </div>
          )}
          {/* The serving side's score is always called first - labelled rather than
              reordered, so the call reads correctly for anyone announcing it courtside. */}
          {call && !state.ended && (
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500" title="Score as called: server's score first">
              Call <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">{call}</span>
            </div>
          )}
        </div>
        {panel(rightSide)}
      </div>

      {/* The finished-unit strip: "11–7 · 9–11 · 11–6". */}
      <UnitStrip format={format} state={state} env={env} />

      {/* The expedite game clock: its own row, since the umpire watches and pauses it. */}
      {clockRunning && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Game time</span>
          <span className={cn(
            'font-mono text-base font-semibold tabular-nums text-slate-800 dark:text-slate-100',
            expediteDue && 'text-rose-600 dark:text-rose-400',
          )}>
            {clockText(gameElapsed)}
          </span>
          <span className="font-mono tabular-nums">/ {clockText(expedite!.afterMinutes * 60_000)}</span>
          {clockPaused && <Badge tone="amber">Paused</Badge>}
          <Button size="sm" variant={clockPaused ? 'outline' : 'subtle'} disabled={p.disabled}
            title="Stop the expedite clock for a towel break, timeout or interruption"
            onClick={() => push({ t: clockPaused ? 'clockStart' : 'clockPause' })}>
            {clockPaused ? 'Resume clock' : 'Pause clock'}
          </Button>
        </div>
      )}

      {/* Time limit reached: the official confirms how play stood, the kernel does the rest. */}
      {expediteDue && !expediteExempt && !expediteDeclined && (
        <div className="grid gap-2 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
          <span className="font-semibold">
            Expedite system applies: {expedite!.afterMinutes} minutes of play in this game, and fewer than{' '}
            {expedite!.exemptAtTotal} points have been scored (score {pts[0]}–{pts[1]}, {pts[0] + pts[1]} in total).
          </span>
          <span className="text-xs">
            From the next rally: one serve each, and {expedite!.returnsToWinPoint} good returns by the receiver win the point.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={p.disabled}
              onClick={() => push({ t: 'expedite', reason: 'time', inRally: true })}>
              Ball was in play — replay the rally
            </Button>
            <Button size="sm" variant="outline" disabled={p.disabled}
              onClick={() => push({ t: 'expedite', reason: 'time', inRally: false })}>
              Between rallies
            </Button>
            <Button size="sm" variant="subtle" className="ml-auto"
              title="Hide this for the rest of the match - the rule is not applied"
              onClick={() => declineExpedite(true)}>
              Dismiss — not playing expedite
            </Button>
          </div>
        </div>
      )}
      {expediteDue && !expediteExempt && expediteDeclined && (
        <div className="text-center text-[11px] text-slate-400 dark:text-slate-500">
          Expedite system not applied in this match.{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => declineExpedite(false)}>
            Show the prompt again
          </button>
        </div>
      )}
      {expediteDue && expediteExempt && !expediteDeclined && (
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {expedite!.afterMinutes} minutes of play reached, but {pts[0] + pts[1]} points have been scored
          (score {pts[0]}–{pts[1]}; {expedite!.exemptAtTotal} or more) — the expedite system does not apply in this game.
        </div>
      )}

      {serve.movement !== 'none' && !state.ended && (
        <div className="text-center text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{resolved?.server ?? nameOf(state.serve.side)}</span> to serve
          {resolved?.courtHalf ? ` from the ${resolved.courtHalf} court` : ''}
          {serve.movement === 'handOut' && doubles ? ` · server ${state.serve.serverNo}` : ''}
          {serveTurn && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{serveTurn}</span>}
        </div>
      )}

      {/* ── The two buttons that matter ───────────────────────────────────── */}
      {state.ended && !rescoring ? (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-center text-sm dark:bg-slate-800/60">
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-100">
              {state.outcome === 'draw'
                ? 'Drawn'
                : `${nameOf(state.winner ?? 'A')} wins`}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join('  ·  ') || `${env.headline[0]}–${env.headline[1]}`}
              {state.reason && state.reason !== 'normal' ? ` · ${state.reason}` : ''}
            </div>
            {timing.matchMs !== null && (
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Match time {minutes(timing.matchMs)}
                {/* Per-game split only where games are the match's units (not tennis's dozens). */}
                {format.levels.length === 2 && timing.unitMs.length > 1 && timing.unitMs.every((m) => m !== null) && (
                  <> · {timing.unitMs.map((m, i) => `${format.levels[0].label[0]}${i + 1} ${minutes(m!)}`).join(' · ')}</>
                )}
              </div>
            )}
          </div>
          {/* RESCORE. A finished match had no way back: the rally buttons were
              hidden, so a wrongly-recorded result could only be fixed by an
              organiser unlocking and re-entering it. The append-only log makes this
              cheap - reopening only has to drop a terminal `end` event (a retirement
              or an award) so the kernel stops calling the match over; Undo then walks
              the points back one at a time, restoring the serve with them. */}
          <Button
            size="sm" variant="outline" className="justify-self-center"
            disabled={p.disabled || p.busy}
            onClick={async () => {
              const terminal = log.length > 0 && log[log.length - 1].t === 'end';
              const ok = await confirmDialog({
                title: 'Rescore this match?',
                confirmLabel: 'Rescore',
                message: terminal
                  ? 'The recorded ending is removed and scoring reopens. The points already scored are kept - use Undo to walk them back.'
                  : 'Scoring reopens on the finished match. The points already scored are kept - use Undo to walk them back.',
              });
              if (!ok) return;
              setRescoring(true);
              // A terminal event is what makes the kernel call it over, so it has to
              // go before another rally can be scored.
              if (terminal) {
                const next = log.slice(0, -1);
                p.onChange(next, foldRally(format, next, firstServer).state);
              }
            }}
          >
            Rescore
          </Button>
        </div>
      ) : needsSetup ? (
        <StartPanel
          format={format} pairing={p.pairing} doubles={doubles} firstServer={firstServer}
          order={[leftSide, rightSide]} nameOf={nameOf} playersOf={(s) => playersOf(s)?.join(' / ')}
          onFirstServerChange={p.onFirstServerChange!} onSwapPair={p.onSwapPair}
          onStart={() => setStarted(true)}
        />
      ) : (
        <div className="grid gap-3">
        {state.expedite && !state.ended && expedite && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-500/10">
            <div className="mr-auto text-sm text-amber-900 dark:text-amber-200">
              <span className="font-semibold">{nameOf(receiver)}</span> returns this rally:{' '}
              <span className="font-mono text-lg font-bold tabular-nums">{returns}</span>
              <span className="text-xs"> / {expedite.returnsToWinPoint} wins the point</span>
            </div>
            <Button size="sm" variant="subtle" disabled={returns === 0} onClick={() => setReturns(returns - 1)}>−1</Button>
            <Button size="sm" disabled={p.disabled || p.busy} onClick={addReturn}>+1 return</Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {[leftSide, rightSide].map((side) => (
            <RallyButton
              key={side}
              qa={`rally-${side}`}
              label={nameOf(side)}
              players={playersOf(side)?.join(' / ')}
              hint={state.ended ? 'undo a point first' : serve.pointScoring === 'serverOnly' && state.serve.side !== side ? 'wins the serve' : 'won the rally'}
              disabled={p.disabled || p.busy || state.ended}
              onClick={() => push({ t: 'point', side })}
            />
          ))}
        </div>
        </div>
      )}

      {rescoring && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          {state.ended
            ? 'Rescoring — the score still finishes the match, so press Undo to take points back before scoring on.'
            : 'Rescoring — the result is not saved as final until you confirm it again.'}
          {' '}
          <button type="button" className="font-semibold underline underline-offset-2"
            onClick={() => setRescoring(false)}>
            Stop rescoring
          </button>
        </div>
      )}

      {/* ── Corrections ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!log.length || p.disabled} onClick={undo}>
          Undo
        </Button>
        {format.letsEnabled && (!state.ended || rescoring) && (
          <Button size="sm" variant="subtle" disabled={p.disabled} onClick={() => push({ t: 'let' })}>
            Let
          </Button>
        )}
        <Button size="sm" variant="subtle" onClick={() => setShowTools((v) => !v)}>
          {showTools ? 'Hide corrections' : 'Corrections'}
        </Button>
        <Button size="sm" variant="subtle" title="Mirror the screen to match the court after a change of ends"
          onClick={() => setFlipped((f) => !f)}>
          ⇄ Swap sides
        </Button>
        {/* SIGNING OFF ALWAYS REACHABLE - BUT NEVER SILENTLY AS A 0-0 DRAW.
            The original bug: eight points into a game to 11, Sign off published a
            `completed` fixture with a 0-0 headline and no winner, standings read it
            as a legitimate draw, and locking made it official. The first fix removed
            the button until the kernel said the match had ended, which fixed the
            data and stranded the official.
            Both, instead: the button is always here. Once the format is satisfied it
            confirms the real result in one tap. Before that it asks HOW the match
            ended and records that reason - so an outcome is always deliberate. */}
        {state.ended ? (
          <Button size="sm" className="ml-auto" disabled={p.disabled || p.busy}
            onClick={() => { setRescoring(false); p.onSignOff(log, state); }}>
            Confirm result
          </Button>
        ) : (
          <Button
            size="sm" variant="outline" className="ml-auto"
            disabled={p.disabled || p.busy}
            onClick={() => setFinishing((v) => !v)}
          >
            {finishing ? 'Keep scoring' : 'End match'}
          </Button>
        )}
      </div>

      {finishing && !state.ended && (
        <FinishPanel
          format={format} state={state}
          homeName={homeName} awayName={awayName}
          onEvent={(ev) => { setFinishing(false); push(ev); }}
          onCancel={() => setFinishing(false)}
        />
      )}

      {showTools && (
        <ToolPanel
          format={format} state={state} log={log}
          homeName={homeName} awayName={awayName}
          doubles={doubles}
          firstServer={firstServer}
          onFirstServerChange={p.onFirstServerChange}
          onEvent={push}
        />
      )}

      {/* ── Timeline ──────────────────────────────────────────────────────── */}
      <Timeline format={format} log={log} firstServer={firstServer} homeName={homeName} awayName={awayName} />
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

function Badge({ tone, children }: { tone: 'amber' | 'slate'; children: React.ReactNode }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
      tone === 'amber'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    )}>{children}</span>
  );
}

function ScorePanel({ name, org, points, serving, cue, units, align = 'left' }: {
  name: string; org?: string | null; side: Side; points: string; serving: boolean;
  cue: string | null; units: { label: string; won: number } | null; align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="flex items-center gap-1.5" style={align === 'right' ? { justifyContent: 'flex-end' } : undefined}>
        {serving && align === 'left' && <ServeDot />}
        <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{name}</span>
        {serving && align === 'right' && <ServeDot />}
      </div>
      {org && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{org}</div>}
      {/* Units won sits on the inner side of the points, as on a courtside flip board. */}
      <div className={cn('mt-1 flex items-end gap-3', align === 'right' && 'flex-row-reverse')}>
        <div className={cn(
          'font-mono text-4xl font-bold tabular-nums',
          cue ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50',
        )}>
          {points}
        </div>
        {units && (
          <div className="mb-1 rounded-md bg-slate-100 px-2 py-0.5 text-center dark:bg-slate-800">
            <div className="font-mono text-xl font-bold tabular-nums text-slate-800 dark:text-slate-100">{units.won}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{units.label}</div>
          </div>
        )}
      </div>
      {cue && (
        <div className={cn(
          'text-[10px] font-semibold uppercase tracking-wide',
          cue === 'Match point' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
        )}>
          {cue}
        </div>
      )}
    </div>
  );
}

const ServeDot = () => (
  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="serving" />
);

/**
 * The tap that scores the match. Deliberately large - this is used courtside, on a
 * phone, one-handed - and deliberately labelled "won the rally", because under
 * serverOnly scoring a receiver's rally win is a side-out and scores nothing.
 */
function RallyButton({ label, players, hint, disabled, onClick, qa }:
  { label: string; players?: string; hint: string; disabled?: boolean; onClick: () => void; qa?: string }) {
  return (
    <button
      type="button"
      data-qa={qa}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-4 transition',
        'border-slate-300 bg-white text-slate-800 active:scale-[.98]',
        'hover:border-emerald-500 hover:bg-emerald-50',
        'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-emerald-500 dark:hover:bg-emerald-500/10',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <span className="line-clamp-2 text-center text-sm font-semibold">{label}</span>
      {players && <span className="line-clamp-1 text-center text-xs text-slate-500 dark:text-slate-400">{players}</span>}
      <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{hint}</span>
    </button>
  );
}

/** "7:42" - a running game clock. */
function clockText(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "<1 min" or "24 min". */
function minutes(ms: number): string {
  return ms < 60_000 ? '<1 min' : `${Math.round(ms / 60_000)} min`;
}

/**
 * Settles the serve before the first rally. Each serve resolver treats a pair's first
 * listed player as its first server (or first receiver), so choosing a partner here
 * just reorders the pair.
 */
function StartPanel({ format, pairing, doubles, firstServer, order, nameOf, playersOf, onFirstServerChange, onSwapPair, onStart }: {
  format: ScoringFormat; pairing?: Pairing; doubles: boolean; firstServer: Side; order: [Side, Side];
  nameOf: (s: Side) => string; playersOf: (s: Side) => string | undefined;
  onFirstServerChange: (s: Side) => void; onSwapPair?: (s: Side) => void; onStart: () => void;
}) {
  const receiving: Side = firstServer === 'A' ? 'B' : 'A';
  // Tennis rotates servers by game, so the other pair's first player serves THEIR first game.
  const tennis = serveSpecFor(format, format.levels[0]).resolver === 'tennisGameLocked';
  const choice = (selected: boolean) => cn(
    'rounded-lg border-2 px-3 py-2 text-sm font-semibold transition',
    selected
      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
      : 'border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200',
  );
  const pairPicker = (side: Side, question: string) => {
    const people = pairing?.[side] ?? [];
    if (people.length < 2 || !onSwapPair) return null;
    // Choosing reorders the pair (first = first server), but the buttons stay put:
    // shown alphabetically, with only the highlight moving to the one picked.
    const shown = [...people].sort((a, b) => a.localeCompare(b));
    return (
      <div className="grid gap-1.5">
        <div className="text-xs text-slate-500 dark:text-slate-400">{question}</div>
        <div className="grid grid-cols-2 gap-2">
          {shown.map((name) => (
            <button key={name} type="button" className={choice(name === people[0])}
              onClick={() => { if (name !== people[0]) onSwapPair(side); }}>
              {name}
            </button>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Card className="grid gap-3 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Before the first point
      </div>
      <div className="grid gap-1.5">
        <div className="text-xs text-slate-500 dark:text-slate-400">Who serves first? (after the toss)</div>
        <div className="grid grid-cols-2 gap-2">
          {order.map((side) => (
            <button key={side} type="button" className={choice(firstServer === side)}
              onClick={() => onFirstServerChange(side)}>
              {nameOf(side)}
              {playersOf(side) && (
                <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                  {/* Alphabetical, like the partner buttons below, so picking a server moves nothing. */}
                  {playersOf(side)!.split(' / ').sort((a, b) => a.localeCompare(b)).join(' / ')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {doubles && pairPicker(firstServer, `Who serves first for ${nameOf(firstServer)}?`)}
      {doubles && pairPicker(receiving, tennis
        ? `Who serves first for ${nameOf(receiving)} (their first service game)?`
        : `Who receives first for ${nameOf(receiving)}?`)}
      <Button onClick={onStart}>Start match</Button>
    </Card>
  );
}

function UnitStrip({ format, state, env }:
  { format: ScoringFormat; state: KernelState; env: ReturnType<typeof resultEnvelope> }) {
  // Units won now sits beside each side's points; this strip carries the history.
  const top = format.levels.length - 1;
  const setLevel = format.levels.findIndex((l) => l.key === 'set');
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {setLevel > 0 && setLevel < top && (
        <span className="font-mono tabular-nums">
          Games: {state.score[setLevel][0]}–{state.score[setLevel][1]}
        </span>
      )}
      {env.unitScores.length > 0 && (
        <span className="font-mono tabular-nums">
          {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join('  ·  ')}
        </span>
      )}
    </div>
  );
}

function ToolPanel({ format, state, log, homeName, awayName, doubles, firstServer, onFirstServerChange, onEvent }: {
  format: ScoringFormat; state: KernelState; log: RallyLog;
  homeName: string; awayName: string; doubles: boolean;
  firstServer: Side; onFirstServerChange?: (s: Side) => void;
  onEvent: (e: RallyEvent) => void;
}) {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const serve = serveSpecFor(format, lv);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);

  const retire = async (side: Side) => {
    const ok = await confirmDialog({
      title: `${nameOf(side)} retires?`,
      message: `The match is awarded to ${nameOf(side === 'A' ? 'B' : 'A')}. The score so far is kept on the record.`,
      confirmLabel: 'Record retirement',
    });
    if (ok) onEvent({ t: 'end', outcome: 'win', reason: 'retired', winner: side === 'A' ? 'B' : 'A' });
  };

  const walkover = async (side: Side) => {
    const ok = await confirmDialog({
      title: `Walkover to ${nameOf(side)}?`,
      message: 'No play is recorded. The scoreline is completed from the format’s walkover policy.',
      confirmLabel: 'Record walkover',
    });
    if (ok) onEvent({ t: 'end', outcome: 'win', reason: 'walkover', winner: side });
  };

  const awardUnit = async (side: Side) => {
    const ok = await confirmDialog({
      title: `Award this ${lv.label.toLowerCase()} to ${nameOf(side)}?`,
      message: 'The tally is overridden. This is recorded as awarded, not played.',
      confirmLabel: 'Award',
    });
    if (ok) onEvent({ t: 'awardUnit', side, reason: 'awarded by official' });
  };

  return (
    <Card className="grid gap-3 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Corrections — the court outranks the engine
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'adjust', side: 'A', delta: -1, reason: 'minus one' })}>
          −1 {homeName}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'adjust', side: 'B', delta: -1, reason: 'minus one' })}>
          −1 {awayName}
        </Button>
      </div>

      {serve.movement !== 'none' && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Serve is wrong:</span>
          <Button size="sm" variant="subtle"
            onClick={() => onEvent({ t: 'setServe', side: state.serve.side === 'A' ? 'B' : 'A', reason: 'serve corrected' })}>
            Hand serve to {nameOf(state.serve.side === 'A' ? 'B' : 'A')}
          </Button>
          {serve.movement === 'handOut' && doubles && (
            <Button size="sm" variant="subtle"
              onClick={() => onEvent({ t: 'setServe', side: state.serve.side, serverNo: state.serve.serverNo === 1 ? 2 : 1, reason: 'server number corrected' })}>
              Server {state.serve.serverNo === 1 ? 2 : 1}
            </Button>
          )}
        </div>
      )}

      {format.penaltyEvents !== 'off' && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Conduct point to:</span>
          <Button size="sm" variant="subtle" onClick={() => onEvent({ t: 'penalty', side: 'A', reason: 'conduct' })}>{homeName}</Button>
          <Button size="sm" variant="subtle" onClick={() => onEvent({ t: 'penalty', side: 'B', reason: 'conduct' })}>{awayName}</Button>
        </div>
      )}

      {!state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Award {lv.label.toLowerCase()}:</span>
          <Button size="sm" variant="subtle" onClick={() => awardUnit('A')}>{homeName}</Button>
          <Button size="sm" variant="subtle" onClick={() => awardUnit('B')}>{awayName}</Button>
        </div>
      )}

      {format.clock && !state.ended && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Time is up ({format.clock.minutes} min):
          </span>
          <Button size="sm" variant="outline" onClick={() => onEvent({ t: 'capFired' })}>
            Buzzer
          </Button>
        </div>
      )}

      {/* Both players may ask for it before the clock runs out - but not once 18 points are scored. */}
      {serve.movement === 'everyN' && expediteAllowed(format, state) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Expedite system:</span>
          <Button size="sm" variant="subtle"
            onClick={() => onEvent({ t: 'expedite', reason: 'request', inRally: false })}>
            Start — both players asked
          </Button>
        </div>
      )}

      {log.length === 0 && onFirstServerChange && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">First serve:</span>
          <Select
            className="w-auto text-sm"
            value={firstServer}
            onChange={(e) => onFirstServerChange(e.target.value as Side)}
          >
            <option value="A">{homeName}</option>
            <option value="B">{awayName}</option>
          </Select>
        </div>
      )}

      {!state.ended && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400">Match cannot finish:</span>
          <Button size="sm" variant="outline" onClick={() => retire('A')}>{homeName} retires</Button>
          <Button size="sm" variant="outline" onClick={() => retire('B')}>{awayName} retires</Button>
          {log.length === 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => walkover('A')}>W/O to {homeName}</Button>
              <Button size="sm" variant="outline" onClick={() => walkover('B')}>W/O to {awayName}</Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Score in the level's own display labels (tennis 15/30/40). */
function pointLabel(lv: LevelSpec, n: number): string {
  const labels = lv.pointLabels;
  return labels ? (labels[Math.min(n, labels.length - 1)] ?? String(n)) : String(n);
}

/** The point log, newest first, with the score after each point and who served it. */
function Timeline({ format, log, firstServer, homeName, awayName }:
  { format: ScoringFormat; log: RallyLog; firstServer: Side; homeName: string; awayName: string }) {
  // Stepped by hand rather than folded, to keep the score as it stood after each event.
  const steps = useMemo(() => {
    let s = initKernel(format, firstServer);
    return log.map((ev) => {
      const r = step(format, s, ev);
      s = r.state;
      const lvl = effectiveLevel(format, s, s.pointLevel);
      const sc = s.score[s.pointLevel];
      return { t: r.effect, score: `${pointLabel(lvl, sc[0])}–${pointLabel(lvl, sc[1])}` };
    });
  }, [format, log, firstServer]);
  if (!log.length) return null;
  const rows = steps.map((x, i) => ({ ...x, i })).reverse().slice(0, 40);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
        {rows.map(({ t, i, score }) => (
          <li key={i} className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="w-8 shrink-0 font-mono tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>
            <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
              {describe(t, nameOf)}
              {t.event.t === 'point' && t.serverSide && (
                <span className="ml-1.5 text-slate-400 dark:text-slate-500">· {nameOf(t.serverSide)} served</span>
              )}
            </span>
            {/* A unit-winning point resets the score, so its row shows the unit tag instead. */}
            {!t.unitsWon.length && ['point', 'penalty', 'adjust'].includes(t.event.t) && (
              <span className="shrink-0 font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-200">{score}</span>
            )}
            {t.atDeuce && <span className="shrink-0 text-[10px] uppercase text-amber-600 dark:text-amber-400">deuce</span>}
            {t.unitsWon.map((u) => (
              <span key={u.level} className="shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                {u.label} {u.score[0]}–{u.score[1]}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describe(t: ReturnType<typeof foldRally>['trace'][number], nameOf: (s: Side) => string): string {
  const ev = t.event;
  switch (ev.t) {
    case 'point':
      // Under serverOnly scoring a receiver win is a side-out, not a point - and the
      // timeline has to say so or the log reads as a scoring error.
      return t.scored
        ? `Point to ${nameOf(t.scored)}${ev.kind === 'expedite_returns' ? ` · ${ev.label ?? 'expedite returns'}` : ''}`
        : `${nameOf(ev.side)} won the rally — side-out, no point`;
    case 'expedite':
      return `Expedite system in — ${ev.reason === 'request' ? 'both players asked' : 'time limit'}${ev.inRally ? ' · rally replayed' : ''}`;
    case 'clockPause': return 'Game clock paused';
    case 'clockStart': return 'Game clock resumed';
    case 'let': return 'Let — rally replayed';
    case 'fault': return `Fault · ${nameOf(ev.side)}`;
    case 'penalty': return `Conduct point to ${nameOf(ev.side)}`;
    case 'awardServe': return `Serve awarded to ${nameOf(ev.side)}`;
    case 'awardUnit': return `Unit awarded to ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'adjust': return `${ev.delta > 0 ? '+' : ''}${ev.delta} ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'setServe': return `Serve corrected to ${nameOf(ev.side)}${ev.serverNo ? ` (server ${ev.serverNo})` : ''}`;
    case 'capFired': return 'Time up';
    case 'end': return `${ev.reason}${ev.winner ? ` — ${nameOf(ev.winner)}` : ''}`;
    default: return '';
  }
}

/**
 * How did this match end, when the score alone does not say?
 *
 * Every option here names a WINNER and a REASON, which is the whole point: the
 * outcome is recorded because somebody chose it, not inferred from a scoreline that
 * was never reached. The current score is shown so the choice is made with the
 * actual state in view rather than from memory.
 */
function FinishPanel({ format, state, homeName, awayName, onEvent, onCancel }: {
  format: ScoringFormat; state: KernelState;
  homeName: string; awayName: string;
  onEvent: (e: RallyEvent) => void;
  onCancel: () => void;
}) {
  const lv = effectiveLevel(format, state, state.pointLevel);
  const env = resultEnvelope(format, state);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  const pts = state.score[state.pointLevel];
  const level = pts[0] === pts[1];
  const leader: Side | null = pts[0] === pts[1] ? null : pts[0] > pts[1] ? 'A' : 'B';

  const end = async (winner: Side | null, reason: 'retired' | 'walkover' | 'conceded' | 'cap' | 'abandoned', title: string, message: string) => {
    const ok = await confirmDialog({ title, message, confirmLabel: 'Record it' });
    if (!ok) return;
    onEvent(winner === null
      ? { t: 'end', outcome: 'draw', reason, winner: null }
      : { t: 'end', outcome: 'win', reason, winner });
  };

  return (
    <Card className="grid gap-3 p-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          End this match
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Not finished yet — {lv.label.toLowerCase()} at{' '}
          <span className="font-mono tabular-nums">{pts[0]}–{pts[1]}</span>
          {env.unitScores.length > 0 && (
            <> · {env.unitScores.map((u) => `${u[0]}–${u[1]}`).join(', ')}</>
          )}
          . Pick how it ended and it is recorded with that reason.
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button size="sm" variant="outline"
          onClick={() => end('B', 'retired', `${homeName} retires?`,
            `The match goes to ${awayName}. The score so far is kept on the record.`)}>
          {homeName} retires
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('A', 'retired', `${awayName} retires?`,
            `The match goes to ${homeName}. The score so far is kept on the record.`)}>
          {awayName} retires
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('A', 'conceded', `Award the match to ${homeName}?`,
            'Recorded as awarded by the official, not as a played result.')}>
          Award to {homeName}
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => end('B', 'conceded', `Award the match to ${awayName}?`,
            'Recorded as awarded by the official, not as a played result.')}>
          Award to {awayName}
        </Button>
      </div>

      {/* Stopped on time. The leader takes it; a level score is a draw only where the
          format allows one, otherwise the next point has to settle it. */}
      {format.clock && (
        <Button size="sm" variant="subtle"
          onClick={() => {
            if (level && !format.endStates.drawsAllowed) {
              toast.error('Scores are level and this format does not allow a draw — play the next point.');
              return;
            }
            end(level ? null : leader, 'cap',
              level ? 'Record a draw?' : `Time up — ${nameOf(leader!)} leads?`,
              level ? 'The match is recorded as drawn.' : `${nameOf(leader!)} takes the match on the score at the buzzer.`);
          }}>
          Time up ({format.clock.minutes} min) — {level ? 'record a draw' : `${nameOf(leader ?? 'A')} leads`}
        </Button>
      )}

      <Button size="sm" variant="subtle"
        onClick={() => end(null, 'abandoned', 'Abandon this match?',
          'No winner is recorded. The organiser decides what happens to the fixture.')}>
        Abandoned — no result
      </Button>

      <button type="button" className="text-left text-xs text-slate-400 underline underline-offset-2 dark:text-slate-500"
        onClick={onCancel}>
        Cancel — go back to scoring
      </button>
    </Card>
  );
}

/** Read a persisted rally log out of live_state, tolerating anything malformed. */
export function hydrateRally(raw: unknown): RallyLog {
  const arr = (raw as { rally?: unknown } | null)?.rally;
  if (!Array.isArray(arr)) return [];
  return arr.filter((e): e is RallyEvent => !!e && typeof e === 'object' && typeof (e as RallyEvent).t === 'string');
}

export function hydrateFirstServer(raw: unknown): Side {
  const v = (raw as { firstServer?: unknown } | null)?.firstServer;
  return v === 'B' ? 'B' : 'A';
}

export function hydratePairSwap(raw: unknown): { A: boolean; B: boolean } {
  const v = (raw as { pairSwap?: { A?: unknown; B?: unknown } } | null)?.pairSwap;
  return { A: v?.A === true, B: v?.B === true };
}

export { atAdvantage, toast };
