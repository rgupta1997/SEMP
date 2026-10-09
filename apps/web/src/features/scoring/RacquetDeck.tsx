import { useEffect, useMemo, useRef, useState } from 'react';
import {
  atAdvantage, changesEndsAfterUnit, effectiveLevel, expediteAllowed, expediteConfig, foldRally, formatForPairing, initKernel, isDecider, rallyTiming,
  resolveServer, resultEnvelope, serveCall, serveEveryNow, serveSpecFor, setChoiceDue, step, misconductTerms, timeoutRules, timeoutsLeft, unitClock,
  type KernelState, type LevelSpec, type Pairing, type RallyEvent, type RallyLog, type ScoringFormat, type Side,
} from '@semp/shared';
import { ArrowLeftRight, CheckCircle2, Flag, RotateCcw, SlidersHorizontal, Timer, Undo2 } from 'lucide-react';
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
/** Events that pause play rather than play it: prompts read past them. */
const PASSIVE_EVENTS: ReadonlySet<string> = new Set([...CLOCK_EVENTS, 'timeout']);

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
  const { log, firstServer } = p;
  // Singles plays a side-out format with one server per turn (keyed on the pair sizes,
  // so an inline pairing object does not refold the log on every render).
  const sizes = p.pairing ? `${p.pairing.A.length}/${p.pairing.B.length}` : '';
  const format = useMemo(() => formatForPairing(p.format, p.pairing), [p.format, sizes]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Same one-shot for the interval reminder (a reminder only - nothing is recorded).
  const [intervalDismissed, setIntervalDismissed] = useState(-1);
  // The timeout banner, ended by hand (log index of the timeout it belongs to).
  const [timeoutEnded, setTimeoutEnded] = useState(-1);
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
    // A tennis tie-break opens with a single serve, then two each: say so, or the
    // opening point reads as "one serve each" for the whole tie-break.
    if (state.serve.openingTurn && serve.firstTurnEvery !== undefined && serve.firstTurnEvery !== serve.every) {
      return `${serve.firstTurnEvery === 1 ? 'one serve' : `${serve.firstTurnEvery} serves`} - then ${serve.every} each`;
    }
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
  // At the time limit the clock has done its job: it stops ticking there.
  const limitReached = clockRunning && gameClock!.elapsedMs >= expedite!.afterMinutes * 60_000;
  useEffect(() => {
    if (!clockRunning || clockPaused || limitReached) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [clockRunning, clockPaused, limitReached]);
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

  // What the rally button shows. Counted scores read "+1"; a labelled score (tennis
  // 15/30/40) reads what the tap makes it - "+1" on a love-15 point is wrong.
  const tapShows = (side: Side): string => {
    if (!lv.pointLabels || state.ended) return '+1';
    const r = step(format, state, { t: 'point', side });
    const won = r.effect.unitsWon;
    if (won.length) return won[won.length - 1].label;
    const sc = r.state.score[r.state.pointLevel];
    const mine = sc[side === 'A' ? 0 : 1];
    // 40-40: deuce, or under no-ad scoring the deciding point.
    if (sc[0] === sc[1] && mine >= lv.pointLabels.length - 2) return lv.winBy > 1 ? 'Deuce' : `→ ${label(mine)}`;
    return `→ ${label(mine)}`;
  };

  // Tennis doubles deuce-court picks in the start panel, by name. Held here, not in the
  // log, until Start match - but the serve line previews them so it names the right receiver.
  const [setupDeuce, setSetupDeuce] = useState<Partial<Record<Side, string>>>({});
  const setupFlips = (['A', 'B'] as Side[]).filter((s) => {
    const people = p.pairing?.[s];
    return !!people && people.length > 1 && !!setupDeuce[s] && setupDeuce[s] !== people[0];
  });
  // Squash: the first server picks a box before the first serve (WSF 5.7). Same idea -
  // held until Start match, previewed on the serve line meanwhile.
  const [setupBox, setSetupBox] = useState<'right' | 'left'>('right');
  const boxChoice = serve.courtModel === 'handAlternate';
  let previewState: KernelState = needsSetup && setupFlips.length
    ? { ...state, serve: { ...state.serve, receiveFlip: Object.fromEntries(setupFlips.map((s) => [s, true])) } }
    : state;
  if (needsSetup && boxChoice && setupBox === 'left') previewState = step(format, previewState, { t: 'switchBox' }).state;
  const resolved = p.pairing ? resolveServer(format, previewState, p.pairing) : null;
  const pairCycle = serve.resolver === 'ttPairCycle';
  // Tennis: first and second serve.
  const twoServes = serve.resolver === 'tennisGameLocked' && serve.movement !== 'none';
  const secondServe = twoServes && !!state.serve.faults;
  // Receivers keeping a position: tennis doubles at the start of each set (the deuce court),
  // squash doubles at the start of each game (the right side).
  const setGames = state.score[1] ?? [0, 0];
  const gameStart = state.unitPoints === 0 && state.serve.turns === 0 && state.serve.turnCount === 0;
  // Tennis: the first set is asked in the start panel, so this prompt covers sets 2+ -
  // and set 1 too when the start panel is not shown.
  const firstSet = serve.resolver === 'tennisGameLocked' && !state.finished.some((u) => u.level === 1);
  const chooseReceivers = doubles && !!p.pairing && !state.ended && !(firstSet && p.onFirstServerChange) && (
    // A set's first point - or a deciding match tie-break's, which runs a level up.
    (serve.resolver === 'tennisGameLocked' && state.unitPoints === 0
      && (state.pointLevel === 0 ? setGames[0] + setGames[1] === 0 : state.serve.turns === 0 && state.serve.turnCount === 0))
    || (serve.resolver === 'squashHandOut' && gameStart));
  // Pairs that hold courts and swap on scoring their own serve: badminton and pickleball.
  const bwfPairs = serve.resolver === 'bwfSingleServer' || serve.resolver === 'pickleballTwoServer';
  // Squash doubles: four servers in rotation, receivers keeping a side.
  const squashPairs = serve.resolver === 'squashHandOut';
  // Game 1's order is set in the start panel; later games are picked at 0-0.
  const choosePairServer = (pairCycle || bwfPairs || squashPairs) && doubles && !!p.pairing && !state.ended
    && state.finished.some((u) => u.level === 0)
    && state.unitPoints === 0 && state.serve.turns === 0 && state.serve.turnCount === 0;
  // The between-games choices close on "Start set / game", like the start panel, or on
  // the first point. Keyed by units finished, so the next set or game asks afresh.
  const [choicesClosedAt, setChoicesClosedAt] = useState<number | null>(null);
  const choicesOpen = choicesClosedAt !== state.finished.length;
  const closeChoices = () => setChoicesClosedAt(state.finished.length);
  // "Start set 2" / "Start game 3": the unit about to begin, counted from the level above.
  const startLabel = (unitLevel: number) => {
    // A deciding match tie-break is played in place of the set - say which.
    if (state.pointLevel > 0) return 'Start the match tie-break';
    const above = state.score[unitLevel + 1] ?? [0, 0];
    return `Start ${format.levels[unitLevel]?.label.toLowerCase() ?? 'game'} ${above[0] + above[1] + 1}`;
  };
  const call = serve.movement === 'none' ? null : serveCall(format, state, doubles);
  // Two kinds of change: mid-game (the decider midpoint) and after a finished game.
  // Read off the last PLAYED event, so pausing the clock does not hide the prompt.
  let playIdx = fold.trace.length - 1;
  while (playIdx >= 0 && PASSIVE_EVENTS.has(fold.trace[playIdx].event.t)) playIdx -= 1;
  const lastEffect = playIdx >= 0 ? fold.trace[playIdx] : undefined;
  const afterUnit = !!lastEffect && changesEndsAfterUnit(format, state, lastEffect.unitsWon);
  const showSwitch = (!!lastEffect?.switchEnds || afterUnit) && dismissed.current !== playIdx;
  const switchText = afterUnit
    ? `Change ends before the next ${lastEffect!.unitsWon[0].label.toLowerCase()}`
    : `Change ends · midpoint of the deciding ${lv.label.toLowerCase()}`
      // ITTF 2.13.6: the receiving pair also switches order here.
      + (pairCycle && doubles && resolved?.receiver ? ` · receivers switch: ${resolved.receiver} now receives` : '');

  // Interval reminders, where the format's rules sheet sets them (BWF: 60s when the
  // leader reaches 11, 120s between games). Nothing is recorded.
  const interval = intervalDue(format, state, lastEffect);
  const showInterval = !!interval && intervalDismissed !== playIdx;

  // Timeouts: the allowance left, and the one just called (the latest event).
  const toRules = timeoutRules(format);
  const toLeft = useMemo(() => timeoutsLeft(format, log, firstServer), [format, log, firstServer]);
  // The timeout just called: the latest event, or the one right before the clock pause it brought.
  const toIdx = (() => {
    let i = log.length - 1;
    if (log[i]?.t === 'clockPause') i -= 1;
    return log[i]?.t === 'timeout' ? i : -1;
  })();
  const activeTimeout = toIdx >= 0 && timeoutEnded !== toIdx ? (log[toIdx] as Extract<RallyEvent, { t: 'timeout' }>) : null;
  const callTimeout = async (side: Side) => {
    if (toLeft && toLeft[side] === 0) {
      const ok = await confirmDialog({
        title: `${nameOf(side)} has no timeouts left`,
        message: 'Calling another one is a technical warning under the rules. Record it anyway?',
        confirmLabel: 'Record timeout',
      });
      if (!ok) return;
    }
    // A timeout is not playing time: the expedite clock stops with it (ITTF 2.15.1,
    // "10 minutes' play"). It restarts on End timeout, or on its own at the next rally.
    if (p.disabled) return;
    const at = new Date().toISOString();
    const added: RallyEvent[] = [{ t: 'timeout', side, at }];
    if (clockRunning && !clockPaused) added.push({ t: 'clockPause', at });
    const next = [...log, ...added];
    p.onChange(next, foldRally(format, next, firstServer).state);
  };
  const endTimeout = () => {
    setTimeoutEnded(toIdx);
    if (clockRunning && clockPaused) push({ t: 'clockStart' });
  };

  const timing = useMemo(() => rallyTiming(format, log, firstServer), [format, log, firstServer]);
  const cards = useMemo(() => cardTally(log, format.sport), [log, format.sport]);

  const [leftSide, rightSide]: [Side, Side] = flipped ? ['B', 'A'] : ['A', 'B'];
  // A team keeps its colour wherever it sits, so after "Swap sides" it is still found by colour.
  const accentOf = (side: Side) => (side === 'A' ? ACCENT.left : ACCENT.right);
  const panel = (side: Side) => (
    <ScoreSide
      key={side}
      name={nameOf(side)} org={subOf(side)}
      points={pointPair(lv, state.score[state.pointLevel])[side === 'A' ? 0 : 1]}
      serving={serve.movement !== 'none' && !state.ended && state.serve.side === side}
      cue={pointCue(side)}
      units={multiUnit ? { label: `${unitLabel}s`, won: state.score[top][side === 'A' ? 0 : 1], needed: format.levels[top].target } : null}
      cards={cards[side]}
      align={side === leftSide ? 'left' : 'right'}
      accent={accentOf(side)}
    />
  );

  return (
    <div className="grid gap-4">
      {/* ── Header: what rules are in force, and where they came from ─────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-100">{format.name}</span>
          {p.provenance && <span className="ml-2 text-xs">· {p.provenance}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!state.ended && timing.matchMs !== null && (
            <span title="Playing time: first point to the latest"
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Timer className="h-3.5 w-3.5" /> {minutes(timing.matchMs)}
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
          <span className="mr-auto">
            {switchText}
            {/* Same moment as an interval (between games, or 11 in the decider): one banner. */}
            {showInterval && <> · {interval!.label} <Countdown from={lastEffect?.event.at} seconds={interval!.seconds} /></>}
          </span>
          <Button size="sm" variant="outline"
            onClick={() => { dismissed.current = playIdx; setIntervalDismissed(playIdx); setShowTools(false); setFlipped((f) => !f); }}>
            Swap sides on screen
          </Button>
          <Button size="sm" variant="subtle" onClick={() => { dismissed.current = playIdx; setIntervalDismissed(playIdx); setShowTools(false); }}>
            Dismiss
          </Button>
        </div>
      )}
      {!showSwitch && showInterval && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
          <span className="mr-auto">
            {interval!.label} <Countdown from={lastEffect?.event.at} seconds={interval!.seconds} />
          </span>
          <Button size="sm" variant="subtle" onClick={() => setIntervalDismissed(playIdx)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* ── The scoreboard ────────────────────────────────────────────────────
          A courtside board in the page's theme. Each side wears its own colour; the
          serving side is outlined in it. */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-b from-slate-50 to-slate-100 p-3 text-slate-900 ring-1 ring-slate-200 sm:p-4 dark:from-slate-900 dark:to-slate-950 dark:text-white dark:ring-white/10">
        {/* Phones: the heading and call run across the top and the two sides share the
            row below, so neither side is squeezed by the middle column. */}
        <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          {panel(leftSide)}
          <div className="order-first col-span-2 flex flex-col items-center justify-center gap-2 text-center sm:order-none sm:col-span-1 sm:min-w-[6.5rem]">
            <div className="rounded-full bg-slate-200 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-slate-700 dark:bg-white/10 dark:text-slate-200">
              {heading}
            </div>
            {subHeading && (
              <div className="text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-300">{subHeading}</div>
            )}
            {/* The serving side's score is always called first - labelled rather than
                reordered, so the call reads correctly for anyone announcing it courtside. */}
            {call && !state.ended && (
              <div title="Score as called: server's score first">
                <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Call</div>
                {/* Read aloud before every serve, so it is sized to be read from arm's length. */}
                <div className="font-mono text-3xl font-black tabular-nums text-amber-600 sm:text-4xl dark:text-amber-300">{call}</div>
              </div>
            )}
            {/* Games already played: "21-15", "18-21". */}
            <UnitStrip format={format} state={state} env={env} order={[leftSide, rightSide]} accentOf={accentOf} />
          </div>
          {panel(rightSide)}
        </div>

        {/* Who serves, to whom, from where - the line an umpire reads before every rally. */}
        {serve.movement !== 'none' && !state.ended && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-xl bg-white px-3 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 sm:text-base dark:bg-white/5 dark:text-slate-300 dark:ring-0">
            <span>
              <span className="font-bold text-slate-900 dark:text-white">{resolved?.server ?? nameOf(state.serve.side)}</span> to serve
              {(pairCycle || bwfPairs || twoServes || squashPairs) && doubles && resolved?.receiver && (
                <> to <span className="font-bold text-slate-900 dark:text-white">{resolved.receiver}</span></>
              )}
            </span>
            {/* Squash: the server picks the box at the start of each hand, then alternates -
                so at a hand's first serve the box is a two-way switch, otherwise a label. */}
            {resolved?.courtHalf && !pairCycle && (squashPairs && state.serve.turnCount === 0 && !needsSetup ? (
              <span className="inline-flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700" role="group" aria-label="Service box">
                {(['left', 'right'] as const).map((b) => (
                  <button key={b} type="button" disabled={p.disabled}
                    aria-pressed={resolved.courtHalf === b}
                    onClick={() => { if (resolved.courtHalf !== b) push({ t: 'switchBox' }); }}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition',
                      resolved.courtHalf === b
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10',
                    )}>
                    {b} box
                  </button>
                ))}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <CourtHalf half={resolved.courtHalf} /> {resolved.courtHalf} {squashPairs ? 'box' : 'court'}
              </span>
            ))}
            {serve.movement === 'handOut' && doubles && (
              <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-800 dark:bg-white/10 dark:text-white">Server {state.serve.serverNo}</span>
            )}
            {serveTurn && (
              <span className="rounded-md bg-amber-400 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-slate-950">{serveTurn}</span>
            )}
            {secondServe && (
              <span className="rounded-md bg-amber-400 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-slate-950">2nd serve</span>
            )}
          </div>
        )}
      </div>

      {/* The expedite game clock: its own row, since the umpire watches and pauses it.
          Its only job is to reach the time limit, so it stops there - and it is not shown
          at all once the scorer has said expedite is not being played in this match. */}
      {clockRunning && !expediteDeclined && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Game time</span>
          {expediteDue ? (
            <span className="font-mono text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
              {clockText(expedite!.afterMinutes * 60_000)} · time limit reached
            </span>
          ) : (
            <>
              <span className="font-mono text-base font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {clockText(gameElapsed)}
              </span>
              <span className="font-mono tabular-nums">/ {clockText(expedite!.afterMinutes * 60_000)}</span>
              {clockPaused && <Badge tone="amber">Paused</Badge>}
              <Button size="sm" variant={clockPaused ? 'outline' : 'subtle'} disabled={p.disabled}
                title="Stop the expedite clock for a towel break, timeout or interruption"
                onClick={() => push({ t: clockPaused ? 'clockStart' : 'clockPause' })}>
                {clockPaused ? 'Resume clock' : 'Pause clock'}
              </Button>
            </>
          )}
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

      {/* English squash at 8-8: the receiver elects how far the game goes. */}
      {setChoiceDue(format, state) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          <span className="mr-auto">
            {lv.target - 1}-all: {nameOf(state.serve.side === 'A' ? 'B' : 'A')} (receiving) chooses how far the game goes
          </span>
          <Button size="sm" variant="outline" disabled={p.disabled}
            onClick={() => push({ t: 'setChoice', choice: 'one' })}>
            Set one · first to {lv.target}
          </Button>
          <Button size="sm" variant="outline" disabled={p.disabled}
            onClick={() => push({ t: 'setChoice', choice: 'two' })}>
            Set two · first to {lv.target + 1}
          </Button>
        </div>
      )}

      {/* Tennis doubles, at the start of each set: each pair names its first server (ITF
          rule 14) and keeps one player in the deuce court for the whole set. Squash doubles,
          each game: who receives on the right. */}
      {chooseReceivers && choicesOpen && !needsSetup && (() => {
        const pairs = ([leftSide, rightSide] as Side[]).filter((side) => (p.pairing![side]?.length ?? 0) > 1);
        const tennisSet = serve.resolver === 'tennisGameLocked';
        return (
          <ChoicePanel title={tennisSet ? 'Start of the set' : `Start of the ${lv.label.toLowerCase()}`}
            note={tennisSet ? 'pairs can change these at the start of each set' : undefined}
            action={choosePairServer ? undefined : { label: startLabel(tennisSet ? 1 : 0), onClick: closeChoices }}>
            {tennisSet && <ChoiceHeading>Serves first</ChoiceHeading>}
            {tennisSet && pairs.map((side) => (
              <PickRow key={`srv-${side}`} label={nameOf(side)} options={p.pairing![side]} disabled={p.disabled}
                current={p.pairing![side][state.serve.pairFlip?.[side] ? 1 : 0]}
                onPick={() => push({ t: 'switchPairServer', side })} />
            ))}
            <ChoiceHeading>{tennisSet ? 'Returns from the deuce (right) court' : 'Receives on the right side'}</ChoiceHeading>
            {pairs.map((side) => (
              <PickRow key={`rcv-${side}`} label={nameOf(side)} options={p.pairing![side]} disabled={p.disabled}
                current={p.pairing![side][state.serve.receiveFlip?.[side] ? 1 : 0]}
                onPick={() => push({ t: 'switchReceiver', side })} />
            ))}
          </ChoicePanel>
        );
      })()}

      {/* Games 2+, at 0-0. Table tennis: the serving pair picks, the receiver follows
          (ITTF 2.13.5). Badminton: each pair picks who starts in the right court. */}
      {choosePairServer && choicesOpen && (() => {
        const servingSide = state.serve.side;
        const receivingSide: Side = servingSide === 'A' ? 'B' : 'A';
        return (
          <ChoicePanel title={`Start of the ${lv.label.toLowerCase()}`}
            action={{ label: startLabel(0), onClick: closeChoices }}>
            <PickRow label={`${nameOf(servingSide)} - serves first`} options={p.pairing![servingSide]} disabled={p.disabled}
              current={resolved?.server}
              onPick={() => push(bwfPairs || squashPairs ? { t: 'switchPairServer', side: servingSide } : { t: 'switchPairServer' })} />
            {bwfPairs && p.pairing![receivingSide].length > 1 && (
              <PickRow label={`${nameOf(receivingSide)} - receives first`} options={p.pairing![receivingSide]} disabled={p.disabled}
                current={resolved?.receiver}
                onPick={() => push({ t: 'switchPairServer', side: receivingSide })} />
            )}
          </ChoicePanel>
        );
      })()}

      {/* Timeouts: the allowance per side, and a 1-minute banner for the one just called. */}
      {activeTimeout && toRules && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-900 dark:bg-violet-500/15 dark:text-violet-200">
          <span className="mr-auto">
            Timeout — {nameOf(activeTimeout.side)} <Countdown from={activeTimeout.at} seconds={toRules.seconds} />
          </span>
          <Button size="sm" variant="subtle" onClick={endTimeout}>End timeout</Button>
        </div>
      )}
      {/* One card per side, under that side's score panel: dots for what is left, then the button. */}
      {toLeft && toRules && !state.ended && !needsSetup && (() => {
        const allowed = (toRules.perGame ?? toRules.perMatch)!;
        const per = toRules.perGame != null ? lv.label.toLowerCase() : 'match';
        return (
          <div className="grid grid-cols-2 gap-2">
            {([leftSide, rightSide] as Side[]).map((side) => {
              const left = toLeft[side];
              return (
                <div key={side} className={cn(
                  'flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800',
                  side === rightSide && 'flex-row-reverse text-right',
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Timeouts · {nameOf(side)}
                    </div>
                    <div className={cn('mt-1 flex items-center gap-1.5', side === rightSide && 'justify-end')}
                      aria-label={`${left} of ${allowed} timeouts left this ${per}`}>
                      {Array.from({ length: allowed }, (_, i) => (
                        <span key={i} className={cn(
                          'inline-block h-3.5 w-3.5 rounded-full border-2',
                          i < left
                            ? 'border-violet-500 bg-violet-500'
                            : 'border-slate-300 bg-transparent dark:border-slate-600',
                        )} />
                      ))}
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        {left} left{left === 0 ? '' : ` this ${per}`}
                      </span>
                    </div>
                  </div>
                  <Button size="sm" variant={left === 0 ? 'subtle' : 'outline'} disabled={p.disabled}
                    title={left === 0 ? 'None left - another would be a technical warning' : undefined}
                    className={cn('shrink-0', left === 0 && 'opacity-50')}
                    onClick={() => callTimeout(side)}>
                    Timeout
                  </Button>
                </div>
              );
            })}
          </div>
        );
      })()}

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
          deuce={setupDeuce} onDeuceChange={(side, name) => setSetupDeuce((d) => ({ ...d, [side]: name }))}
          box={boxChoice ? setupBox : undefined} onBoxChange={setSetupBox}
          onStart={() => {
            setStarted(true);
            const swapReceivers = setupFlips.filter(() => serve.resolver === 'tennisGameLocked' && doubles);
            const leftBox = boxChoice && setupBox === 'left';
            if ((!swapReceivers.length && !leftBox) || p.disabled) return;
            const at = new Date().toISOString();
            const next = [
              ...log,
              ...swapReceivers.map((side) => ({ t: 'switchReceiver', side, at }) as RallyEvent),
              ...(leftBox ? [{ t: 'switchBox', at } as RallyEvent] : []),
            ];
            p.onChange(next, foldRally(format, next, firstServer).state);
          }}
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
        {/* Tennis has two serves: a fault sets up the second, a second fault is a double
            fault (the point to the receiver). An ace is a point won off the serve. Tapping
            these, rather than only who won the rally, is what fills the serve stats. */}
        {twoServes && !state.ended && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
            <span className={cn(
              'rounded-md px-2 py-0.5 text-xs font-black uppercase tracking-wider',
              secondServe ? 'bg-amber-400 text-slate-950' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
            )}>
              {secondServe ? '2nd serve' : '1st serve'}
            </span>
            <span className="mr-auto text-sm text-slate-600 dark:text-slate-300">{resolved?.server ?? nameOf(state.serve.side)}</span>
            <Button variant="outline" disabled={p.disabled || p.busy}
              title={secondServe ? 'Second serve missed - the point goes to the receiver' : 'First serve missed - a second serve follows'}
              onClick={() => push({ t: 'fault', side: state.serve.side })}>
              {secondServe ? 'Double fault' : 'Fault'}
            </Button>
            <Button variant="outline" disabled={p.disabled || p.busy}
              title="A serve the receiver could not touch - the point to the server"
              onClick={() => push({ t: 'point', side: state.serve.side, kind: 'ace' })}>
              Ace
            </Button>
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
              accent={accentOf(side)}
              big={tapShows(side)}
              serving={serve.movement !== 'none' && state.serve.side === side}
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
      {/* Phones: a 2x2 grid of equal buttons, the match-ending one across the bottom. */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:flex sm:flex-wrap sm:items-center dark:border-slate-800 dark:bg-slate-900/60">
        <Button variant="outline" disabled={!log.length || p.disabled} onClick={undo} className="w-full gap-1.5 sm:w-auto">
          <Undo2 className="h-4 w-4" /> Undo
        </Button>
        {format.letsEnabled && (!state.ended || rescoring) && (
          <Button variant="subtle" disabled={p.disabled} onClick={() => push({ t: 'let' })} className="w-full gap-1.5 sm:w-auto"
            title="Replay the rally - no point to anyone">
            <RotateCcw className="h-4 w-4" /> Let
          </Button>
        )}
        <Button variant={showTools ? 'outline' : 'subtle'} onClick={() => setShowTools((v) => !v)} className="w-full gap-1.5 sm:w-auto">
          <SlidersHorizontal className="h-4 w-4" /> {showTools ? 'Hide corrections' : 'Corrections'}
        </Button>
        <Button variant="subtle" title="Mirror the screen to match the court after a change of ends"
          onClick={() => setFlipped((f) => !f)}
          // Without Let there are three buttons; Swap sides fills its row rather than leave a gap.
          className={cn('w-full gap-1.5 sm:w-auto', !(format.letsEnabled && (!state.ended || rescoring)) && 'col-span-2')}>
          <ArrowLeftRight className="h-4 w-4" /> Swap sides
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
          <Button className="col-span-2 w-full gap-1.5 sm:ml-auto sm:w-auto" disabled={p.disabled || p.busy}
            onClick={() => { setRescoring(false); p.onSignOff(log, state); }}>
            <CheckCircle2 className="h-4 w-4" /> Confirm result
          </Button>
        ) : (
          <Button
            variant="outline" className="col-span-2 w-full gap-1.5 sm:ml-auto sm:w-auto"
            disabled={p.disabled || p.busy}
            onClick={() => setFinishing((v) => !v)}
          >
            <Flag className="h-4 w-4" /> {finishing ? 'Keep scoring' : 'End match'}
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

/**
 * Each side keeps one colour everywhere on the console - its half of the scoreboard,
 * its rally button - so a scorer glancing up finds "their" side by colour, not text.
 * Static class strings, so Tailwind keeps them.
 */
const ACCENT = {
  left: {
    text: 'text-sky-600 dark:text-sky-300', pip: 'bg-sky-500 dark:bg-sky-400', pipOff: 'border-sky-500/40 dark:border-sky-400/40',
    border: 'border-sky-500 dark:border-sky-400', bar: 'bg-sky-500 dark:bg-sky-400',
    button: 'bg-gradient-to-br from-sky-500 to-sky-700 hover:from-sky-400 hover:to-sky-600 ring-sky-300/40',
  },
  right: {
    text: 'text-orange-600 dark:text-orange-300', pip: 'bg-orange-500 dark:bg-orange-400', pipOff: 'border-orange-500/40 dark:border-orange-400/40',
    border: 'border-orange-500 dark:border-orange-400', bar: 'bg-orange-500 dark:bg-orange-400',
    button: 'bg-gradient-to-br from-orange-500 to-orange-700 hover:from-orange-400 hover:to-orange-600 ring-orange-300/40',
  },
} as const;
type Accent = (typeof ACCENT)[keyof typeof ACCENT];

/** One half of the scoreboard: who, how many points, how many games, and what is at stake. */
function ScoreSide({ name, org, points, serving, cue, units, cards, align, accent }: {
  name: string; org?: string | null; points: string; serving: boolean; cue: string | null;
  units: { label: string; won: number; needed: number } | null; cards?: CardTally;
  align: 'left' | 'right'; accent: Accent;
}) {
  const right = align === 'right';
  return (
    // The serving side is outlined in its own colour - plain, no glow.
    <div className={cn(
      'relative min-w-0 rounded-xl border-2 bg-white px-3 py-3 transition sm:px-4 dark:bg-white/[0.03]',
      serving ? accent.border : 'border-slate-200 dark:border-transparent',
      right && 'text-right',
    )}>
      {/* The side's colour bar, on its outer edge. */}
      <span className={cn('absolute inset-y-3 w-1 rounded-full', accent.bar, right ? 'right-0' : 'left-0')} />
      <div className={cn('flex items-center gap-2', right && 'flex-row-reverse')}>
        <span className="truncate text-base font-bold text-slate-900 sm:text-lg dark:text-white">{name}</span>
        {cards && <CardBadges cards={cards} />}
      </div>
      {org && <div className="truncate text-xs text-slate-500 sm:text-sm dark:text-slate-400">{org}</div>}

      <div className={cn('mt-2 flex flex-wrap items-end gap-x-3 gap-y-1', right && 'flex-row-reverse')}>
        <div className={cn(
          'font-mono text-6xl font-black leading-none tabular-nums sm:text-7xl',
          cue ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-900 dark:text-white',
        )}>
          {points}
        </div>
        <div className={cn('mb-1 flex flex-col gap-1.5', right ? 'items-end' : 'items-start')}>
          {serving && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-950">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-950" /> Serving
            </span>
          )}
          {units && (
            <div className={cn('flex items-center gap-1', right && 'flex-row-reverse')} aria-label={`${units.won} ${units.label} won`}>
              {/* One pip per game needed to win: filled as they are won. */}
              {Array.from({ length: units.needed }, (_, i) => (
                <span key={i} className={cn('h-3 w-3 rounded-full border-2', i < units.won ? `${accent.pip} border-transparent` : `${accent.pipOff} bg-transparent`)} />
              ))}
              <span className={cn('px-1 text-[10px] font-semibold uppercase tracking-wider', accent.text)}>{units.label}</span>
            </div>
          )}
        </div>
      </div>

      {cue && (
        <div className={cn(
          'mt-2 inline-block rounded-md px-2 py-0.5 text-xs font-black uppercase tracking-wider',
          cue === 'Match point' ? 'animate-pulse bg-rose-500 text-white' : 'bg-emerald-400 text-slate-950',
        )}>
          {cue}
        </div>
      )}
    </div>
  );
}

/** Which half of the court the serve goes from: a tiny court with that half lit. */
function CourtHalf({ half }: { half: 'right' | 'left' }) {
  return (
    <span className="inline-flex h-6 w-10 overflow-hidden rounded border border-slate-300 dark:border-white/30" aria-label={`${half} court`}>
      <span className={cn('flex-1 border-r border-slate-300 dark:border-white/30', half === 'left' ? 'bg-amber-400' : 'bg-slate-100 dark:bg-white/5')} />
      <span className={cn('flex-1', half === 'right' ? 'bg-amber-400' : 'bg-slate-100 dark:bg-white/5')} />
    </span>
  );
}

/** Misconduct a side has received this match, in the sport's own words. */
interface CardTally { warnings: number; fouls: number; terms: { warning: string; foul: string } }

/** Warnings and point penalties so far, from the log - so Undo takes a card back too. */
export function cardTally(log: RallyLog, sport?: string): Record<Side, CardTally> {
  const terms = misconductTerms(sport);
  const out: Record<Side, CardTally> = { A: { warnings: 0, fouls: 0, terms }, B: { warnings: 0, fouls: 0, terms } };
  for (const ev of log) {
    if (ev.t === 'card') out[ev.against].warnings += 1;
    if (ev.t === 'penalty' && ev.card === 'red') out[ev.side === 'A' ? 'B' : 'A'].fouls += 1;
  }
  return out;
}

/** Small card chips beside a name: yellow for a warning, red for a point penalty. */
function CardBadges({ cards }: { cards: CardTally }) {
  const chip = (n: number, colour: string, label: string) => n > 0 && (
    <span title={`${label}${n > 1 ? ` ×${n}` : ''}`} aria-label={`${n} ${label}`} className="flex shrink-0 items-center gap-0.5">
      <span className={cn('inline-block h-3.5 w-2.5 rounded-[2px]', colour)} />
      {n > 1 && <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">×{n}</span>}
    </span>
  );
  if (!cards.warnings && !cards.fouls) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chip(cards.warnings, 'bg-yellow-400', cards.terms.warning)}
      {chip(cards.fouls, 'bg-rose-500', cards.terms.foul)}
    </span>
  );
}

/**
 * The tap that scores the match. Deliberately large - this is used courtside, on a
 * phone, one-handed - and deliberately labelled "won the rally", because under
 * serverOnly scoring a receiver's rally win is a side-out and scores nothing.
 */
function RallyButton({ label, players, hint, big, accent, serving, disabled, onClick, qa }:
  { label: string; players?: string; hint: string; big: string; accent: Accent; serving: boolean; disabled?: boolean; onClick: () => void; qa?: string }) {
  return (
    <button
      type="button"
      data-qa={qa}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex min-h-32 flex-col items-center justify-center gap-1 rounded-2xl px-3 py-5 text-white shadow-lg ring-1 transition',
        'active:scale-[.97] active:shadow-md',
        accent.button,
        disabled && 'pointer-events-none opacity-40 saturate-50',
      )}
    >
      {serving && (
        <span className="absolute right-2 top-2 rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-950">
          Serving
        </span>
      )}
      {/* Under side-out scoring the receiver's rally wins the serve, not a point. */}
      <span className="text-3xl font-black leading-none">{hint === 'wins the serve' ? 'Side-out' : big}</span>
      <span className="line-clamp-2 text-center text-base font-bold sm:text-lg">{label}</span>
      {players && <span className="line-clamp-1 text-center text-xs text-white/80 sm:text-sm">{players}</span>}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{hint}</span>
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
function StartPanel({ format, pairing, doubles, firstServer, order, nameOf, playersOf, onFirstServerChange, onSwapPair, deuce, onDeuceChange, box, onBoxChange, onStart }: {
  format: ScoringFormat; pairing?: Pairing; doubles: boolean; firstServer: Side; order: [Side, Side];
  nameOf: (s: Side) => string; playersOf: (s: Side) => string | undefined;
  onFirstServerChange: (s: Side) => void; onSwapPair?: (s: Side) => void;
  /** Tennis doubles: who receives in the deuce court in set 1, by name. */
  deuce: Partial<Record<Side, string>>; onDeuceChange: (side: Side, name: string) => void;
  /** Squash: the box the first serve goes from. Absent for sports without a box choice. */
  box?: 'right' | 'left'; onBoxChange: (b: 'right' | 'left') => void;
  onStart: () => void;
}) {
  const receiving: Side = firstServer === 'A' ? 'B' : 'A';
  // Tennis rotates servers by game, so the other pair's first player serves THEIR first game.
  const tennis = serveSpecFor(format, format.levels[0]).resolver === 'tennisGameLocked';
  // By name, so reordering a pair's servers above does not move a pick. Unset = the
  // default (the first server).
  const deuceOf = (side: Side) => deuce[side] ?? pairing?.[side]?.[0];
  // Compact on purpose: every choice has to fit on one screen, so a scorer settles the
  // serve without scrolling. One row per question - label left, two buttons right.
  const choice = (selected: boolean) => cn(
    'min-w-0 rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition',
    selected
      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
      : 'border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200',
  );
  const row = (key: string, label: React.ReactNode, buttons: React.ReactNode) => (
    <div key={key} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:items-center sm:gap-4">
      <div className="text-sm text-slate-600 dark:text-slate-300">{label}</div>
      <div className="grid grid-cols-2 gap-2">{buttons}</div>
    </div>
  );
  // Choosing reorders or marks a player, but the buttons stay put: shown alphabetically,
  // with only the highlight moving to the one picked.
  const partners = (side: Side, picked: string | undefined, pick: (name: string) => void) =>
    [...(pairing?.[side] ?? [])].sort((a, b) => a.localeCompare(b)).map((name) => (
      <button key={name} type="button" className={cn(choice(name === picked), 'truncate')} onClick={() => pick(name)}>
        {name}
      </button>
    ));
  const pairs = doubles && !!onSwapPair && order.every((s) => (pairing?.[s]?.length ?? 0) > 1);
  const heading = (text: string, note?: string) => (
    <div className="flex flex-wrap items-baseline gap-x-2 border-t border-slate-200 pt-3 dark:border-slate-800">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text}</span>
      {note && <span className="text-xs text-slate-400 dark:text-slate-500">{note}</span>}
    </div>
  );
  const serverOf = (side: Side) => (side === firstServer ? `${nameOf(side)} serves first` : `${nameOf(side)}'s first server`);

  return (
    <Card className="grid gap-3 p-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">Before the first point</div>
        <div className="text-base font-bold text-slate-900 dark:text-slate-50">Set up the serve</div>
      </div>

      {row('first', 'Who serves first? (after the toss)', order.map((side) => (
        <button key={side} type="button" className={cn(choice(firstServer === side), 'text-left')}
          onClick={() => onFirstServerChange(side)}>
          <span className="block truncate">{nameOf(side)}</span>
          {playersOf(side) && (
            <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
              {/* Alphabetical, like the partner buttons, so picking a server moves nothing. */}
              {playersOf(side)!.split(' / ').sort((a, b) => a.localeCompare(b)).join(' / ')}
            </span>
          )}
        </button>
      )))}

      {box && row('box', 'Serves from', (['left', 'right'] as const).map((b) => (
        <button key={b} type="button" className={cn(choice(box === b), 'inline-flex items-center justify-center gap-2')}
          onClick={() => onBoxChange(b)}>
          <CourtHalf half={b} /> {b === 'right' ? 'Right box' : 'Left box'}
        </button>
      )))}

      {pairs && (
        <>
          {heading('Serving order', tennis ? 'who serves each pair\'s first service game' : undefined)}
          {[firstServer, receiving].map((side) => row(`srv-${side}`,
            tennis || side === firstServer ? serverOf(side) : `${nameOf(side)} receives first`,
            partners(side, pairing![side][0], (name) => { if (name !== pairing![side][0]) onSwapPair!(side); })))}
        </>
      )}

      {pairs && tennis && (
        <>
          {heading('Returns from the deuce (right) court', 'pairs can change this each set')}
          {order.map((side) => row(`rcv-${side}`, nameOf(side),
            partners(side, deuceOf(side), (name) => onDeuceChange(side, name))))}
        </>
      )}

      <Button
        onClick={onStart}
        className="mt-1 h-11 text-base font-bold">Start match</Button>
    </Card>
  );
}

/** A between-games choice box: labels in one column, buttons lined up in the other. */
function ChoicePanel({ title, note, action, children }: {
  title: string; note?: string; action?: { label: string; onClick: () => void }; children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</span>
        {note && <span className="text-xs text-slate-500 dark:text-slate-400">{note}</span>}
      </div>
      {children}
      {/* Says the choices are done - the first point would close the panel too. */}
      {action && <Button onClick={action.onClick} className="mt-1 h-11 text-base font-bold">{action.label}</Button>}
    </div>
  );
}

function ChoiceHeading({ children }: { children: React.ReactNode }) {
  return <div className="pt-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</div>;
}

/** One pair's choice: its name, then its two players as equal buttons. */
function PickRow({ label, options, current, disabled, onPick }: {
  label: string; options: string[]; current: string | null | undefined; disabled?: boolean; onPick: () => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:items-center sm:gap-4">
      <div className="truncate text-sm text-slate-600 dark:text-slate-300">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {/* Alphabetical, so picking moves only the highlight. */}
        {[...options].sort((a, b) => a.localeCompare(b)).map((name) => (
          <button key={name} type="button" disabled={disabled}
            className={cn(
              'min-w-0 truncate rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition',
              name === current
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-transparent dark:text-slate-200',
            )}
            onClick={() => { if (name !== current) onPick(); }}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}


function UnitStrip({ format, state, env, order, accentOf }: {
  format: ScoringFormat; state: KernelState; env: ReturnType<typeof resultEnvelope>;
  order: [Side, Side]; accentOf: (s: Side) => Accent;
}) {
  // Read in board order and in each side's colour, so "4-2" says who has the 4 even
  // after the ends change.
  const pair = (u: readonly number[]) => (
    <>
      <span className={accentOf(order[0]).text}>{u[order[0] === 'A' ? 0 : 1]}</span>
      –
      <span className={accentOf(order[1]).text}>{u[order[1] === 'A' ? 0 : 1]}</span>
    </>
  );
  // Units won now sits beside each side's points; this strip carries the history.
  const top = format.levels.length - 1;
  const setLevel = format.levels.findIndex((l) => l.key === 'set');
  const hasSets = setLevel > 0 && setLevel < top;
  // One chip per finished unit. With sets (tennis) that is each set's games - the
  // points of every game would be a dozen chips a set and squeeze the board.
  const done = hasSets ? state.finished.filter((u) => u.level === setLevel).map((u) => u.score) : env.unitScores;
  if (!hasSets && done.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {hasSets && (
        <span className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-800 dark:bg-white/10 dark:text-slate-100">
          Games {pair(state.score[setLevel])}
        </span>
      )}
      {done.map((u, i) => (
        <span key={i} className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-slate-800 dark:bg-white/10 dark:text-slate-100">
          {pair(u)}
        </span>
      ))}
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

  const terms = misconductTerms(format.sport);
  const disqualify = async (side: Side) => {
    const ok = await confirmDialog({
      title: `${terms.removal} — disqualify ${nameOf(side)}?`,
      message: `The match is awarded to ${nameOf(side === 'A' ? 'B' : 'A')}. The score so far is kept on the record.`,
      confirmLabel: 'Disqualify',
    });
    if (ok) onEvent({ t: 'end', outcome: 'win', reason: 'disqualified', winner: side === 'A' ? 'B' : 'A' });
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

      {/* Misconduct: a warning, a point to the opponent, removal - in the sport's own
          words (cards in badminton and table tennis, technicals in pickleball). Off for
          self-scored formats. */}
      {format.penaltyEvents !== 'off' && !state.ended && (['A', 'B'] as Side[]).map((side) => {
        const opp: Side = side === 'A' ? 'B' : 'A';
        return (
          <div key={side} className="flex flex-wrap items-center gap-2">
            {/* Named as the OFFENDER, so the card and the point are never read the wrong way round. */}
            <span className="text-xs text-slate-500 dark:text-slate-400">Penalise {nameOf(side)}:</span>
            <Button size="sm" variant="subtle" className="border-l-4 border-l-yellow-400"
              onClick={() => onEvent({ t: 'card', card: 'yellow', against: side, reason: 'warning' })}>
              {terms.warning}
            </Button>
            <Button size="sm" variant="subtle" className="border-l-4 border-l-rose-500"
              onClick={() => onEvent({ t: 'penalty', side: opp, card: 'red', reason: 'misconduct' })}>
              {terms.foul} (point to {nameOf(opp)})
            </Button>
            <Button size="sm" variant="subtle" className="border-l-4 border-l-slate-900 dark:border-l-slate-100"
              onClick={() => disqualify(side)}>
              {terms.removal}
            </Button>
          </div>
        );
      })}

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

interface IntervalRules { intervalAt?: number; intervalSeconds?: number; betweenGamesSeconds?: number }

/**
 * The break the last point earned, if any: mid-game when the side that just scored
 * first reaches `intervalAt` (once - the other side is still below it), or between games.
 */
function intervalDue(
  format: ScoringFormat, state: KernelState, last: ReturnType<typeof foldRally>['trace'][number] | undefined,
): { label: string; seconds: number } | null {
  const rules = (format.rulesSheet ?? {}) as IntervalRules;
  if (!last || state.ended || (last.event.t !== 'point' && last.event.t !== 'penalty')) return null;
  if (last.unitsWon.some((u) => u.level === 0)) {
    const s = rules.betweenGamesSeconds;
    return s ? { label: `${Math.round(s / 60)}-minute break`, seconds: s } : null;
  }
  if (!rules.intervalAt || !last.scored || state.pointLevel !== 0) return null;
  const sc = state.score[0];
  const mine = sc[last.scored === 'A' ? 0 : 1];
  const theirs = sc[last.scored === 'A' ? 1 : 0];
  if (mine !== rules.intervalAt || theirs >= rules.intervalAt) return null;
  const s = rules.intervalSeconds ?? 60;
  return { label: `Interval · ${s} seconds`, seconds: s };
}

/** Time left in a break, counted from the point that started it. */
function Countdown({ from, seconds }: { from?: string; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // Keyed in without times: no countdown, just the length.
  if (!from) return null;
  const left = Math.max(0, seconds - Math.floor((now - Date.parse(from)) / 1000));
  return left > 0
    ? <span className="font-mono tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>
    : <span>- time is up, resume play</span>;
}

/** Score in the level's own display labels (tennis 15/30/40). */
function pointLabel(lv: LevelSpec, n: number): string {
  const labels = lv.pointLabels;
  return labels ? (labels[Math.min(n, labels.length - 1)] ?? String(n)) : String(n);
}

/**
 * Both sides' points as shown. Past deuce the kernel keeps counting (4-4, 5-4), so a
 * labelled score reads relative: level is 40-40, one ahead is AD-40 - never AD-AD.
 */
function pointPair(lv: LevelSpec, sc: readonly number[]): [string, string] {
  const labels = lv.pointLabels;
  const forty = labels ? labels.length - 2 : 0;
  if (labels && sc[0] >= forty && sc[1] >= forty && sc[0] + sc[1] > forty * 2) {
    if (sc[0] === sc[1]) return [labels[forty], labels[forty]];
    return sc[0] > sc[1] ? [labels[forty + 1], labels[forty]] : [labels[forty], labels[forty + 1]];
  }
  return [pointLabel(lv, sc[0]), pointLabel(lv, sc[1])];
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
      const [a, b] = pointPair(lvl, s.score[s.pointLevel]);
      return { t: r.effect, score: `${a}–${b}` };
    });
  }, [format, log, firstServer]);
  if (!log.length) return null;
  const rows = steps.map((x, i) => ({ ...x, i })).reverse().slice(0, 40);
  const nameOf = (s: Side) => (s === 'A' ? homeName : awayName);
  // Laid out like the team-sport and cricket logs: a titled card, the entry number in a
  // narrow muted column, the event in medium weight, the detail muted beside it.
  return (
    <Card className="grid gap-2 p-3">
      <h3 className="text-sm font-semibold">What has been recorded</h3>
      <ol className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
        {rows.map(({ t, i, score }) => (
          <li key={i} className="flex items-baseline gap-2 py-1.5">
            <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-800 dark:text-slate-100">{describe(t, nameOf, format.sport)}</span>
              {t.event.t === 'point' && t.serverSide && (
                <span className="text-slate-400 dark:text-slate-500"> · {nameOf(t.serverSide)} served</span>
              )}
            </span>
            {/* Deuce and advantage are what a scorer checks the log for - amber, as on the board. */}
            {t.atDeuce && (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Deuce</span>
            )}
            {/* A unit-winning point resets the score, so its row shows the unit won instead. */}
            {!t.unitsWon.length && (['point', 'penalty', 'adjust'].includes(t.event.t) || (t.event.t === 'fault' && t.scored)) && (
              <span className={cn(
                'shrink-0 font-mono text-xs font-semibold tabular-nums',
                /AD/.test(score) || t.atDeuce ? 'text-amber-600 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200',
              )}>{score}</span>
            )}
            {t.unitsWon.length > 0 && (
              <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                {t.unitsWon.map((u) => `${u.label} ${u.score[0]}–${u.score[1]}`).join(' · ')}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function describe(t: ReturnType<typeof foldRally>['trace'][number], nameOf: (s: Side) => string, sport?: string): string {
  const ev = t.event;
  switch (ev.t) {
    case 'point':
      // Under serverOnly scoring a receiver win is a side-out, not a point - and the
      // timeline has to say so or the log reads as a scoring error.
      return t.scored
        ? `${ev.kind === 'ace' ? 'Ace — point' : 'Point'} to ${nameOf(t.scored)}${ev.kind === 'expedite_returns' ? ` · ${ev.label ?? 'expedite returns'}` : ''}`
        : `${nameOf(ev.side)} won the rally — side-out, no point`;
    case 'expedite':
      return `Expedite system in — ${ev.reason === 'request' ? 'both players asked' : 'time limit'}${ev.inRally ? ' · rally replayed' : ''}`;
    case 'switchPairServer':
      return ev.side ? `${nameOf(ev.side)}: partners swap starting courts` : 'Other partner serves first this game';
    case 'switchReceiver': return `${nameOf(ev.side)}: partners swap receiving sides`;
    case 'setChoice': return ev.choice === 'one' ? 'Set one chosen at 8-all - first to 9' : 'Set two chosen at 8-all - first to 10';
    case 'switchBox': return 'Server switched service box';
    case 'clockPause': return 'Game clock paused';
    case 'clockStart': return 'Game clock resumed';
    case 'let': return 'Let — rally replayed';
    case 'fault':
      // The kernel scores a second fault for the receiver: that is a double fault.
      return t.scored ? `Double fault · ${nameOf(ev.side)} — point to ${nameOf(t.scored)}` : `Fault · ${nameOf(ev.side)} — second serve`;
    case 'penalty':
      return ev.card === 'red'
        ? `${misconductTerms(sport).foul} to ${nameOf(ev.side === 'A' ? 'B' : 'A')} — point to ${nameOf(ev.side)}`
        : `Conduct point to ${nameOf(ev.side)}`;
    case 'card': return `${misconductTerms(sport).warning} to ${nameOf(ev.against)}`;
    case 'timeout': return `Timeout — ${nameOf(ev.side)}`;
    case 'awardServe': return `Serve awarded to ${nameOf(ev.side)}`;
    case 'awardUnit': return `Unit awarded to ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'adjust': return `${ev.delta > 0 ? '+' : ''}${ev.delta} ${nameOf(ev.side)}${ev.reason ? ` · ${ev.reason}` : ''}`;
    case 'setServe': return `Serve corrected to ${nameOf(ev.side)}${ev.serverNo ? ` (server ${ev.serverNo})` : ''}`;
    case 'capFired': return 'Time up';
    case 'end':
      return ev.reason === 'disqualified' && ev.winner
        ? `${nameOf(ev.winner === 'A' ? 'B' : 'A')} disqualified — match to ${nameOf(ev.winner)}`
        : `${ev.reason}${ev.winner ? ` — ${nameOf(ev.winner)}` : ''}`;
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
