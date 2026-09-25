import { ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  aggregateScore, effectiveLevel, foldRally, isAggregate, periodsPlayed, resultEnvelope,
  clockReading, formatClock, minuteLabel, tieProgress, shootoutState, shootoutLine, shootoutEnd,
  type ClockReading, type ShootoutState,
  statSpecFor, type EventTone, type KernelState, type RallyEvent, type RallyLog, type ScoringFormat,
  type Side, type StatEventSpec,
} from '@semp/shared';
import { Button, Card, Input, cn, confirmDialog, toast } from '../../components/ui';

// ============================================================================
// The console for everything that is not a racquet sport.
//
// Same kernel, same append-only log, same undo-is-a-truncate. What differs is what
// a tap MEANS and when a unit ends:
//
//   racquet    every tap is a rally; the score ends the game
//   invasion   a tap is a goal or a basket; the WHISTLE ends the period
//   board      a tap is a point on a board; the score ends the board
//
// And the thing a rally log can never supply: WHICH PERSON. A score cannot be folded
// into "who scored", so the attributable actions are declared per sport in the stat
// registry and offered here.
//
// ---------------------------------------------------------------------------
// ATTRIBUTION IS THE PRIMARY PATH, NOT A PANEL BESIDE IT.
//
// This deck used to put two big "+1" buttons at the top and the attributed actions
// in two stacked panels below the fold. On a phone an official saw the +1, tapped
// it, and scored a goal that belonged to nobody - so the scoreline was right and
// every player's record was empty, which is the failure nobody notices until the
// season is over. The quick path has to be the RIGHT path.
//
// So: pick the side, pick the person, tap what they did. The unattributed point is
// still there, because a scorer who does not know who scored must be able to keep
// the scoreline honest - but it is the small button now, and it says what it costs.
//
// ONE SCREEN, NO SCROLL. The scoreboard and the period never move; the middle
// region swaps between the actions, the timeline and the corrections. A console
// whose buttons move between taps is one that gets tapped wrong.
// ============================================================================

export interface TeamDeckProps {
  format: ScoringFormat;
  provenance?: string;
  sportName?: string | null;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Roster for each side, so an action can be attributed to a person. */
  roster?: { A: Array<{ id: string; name: string }>; B: Array<{ id: string; name: string }> };
  log: RallyLog;
  onChange: (log: RallyLog, state: KernelState) => void;
  onSignOff: (log: RallyLog, state: KernelState) => void;
  disabled?: boolean;
  busy?: boolean;
  /** Has the confirmed result actually been written to the fixture yet? */
  recorded?: boolean;
  /**
   * What follows a recorded result - the award and the lock. Passed in rather than
   * built here: the deck knows the match is over, and the page knows what the
   * product does about it. Rendered inside the end-of-match card, because the end
   * of the match is the only moment anybody is looking at it.
   */
  afterResult?: React.ReactNode;
}

type Surface = 'act' | 'log' | 'more' | 'clock' | 'shootout';

/** The element that actually scrolls above this one - the app shell's `<main>`. */
function scrollHost(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/** Claim everything from this element's top edge to the bottom of what scrolls it. */
function useDeckHeight(ref: React.RefObject<HTMLElement>): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const host = scrollHost(el);
      const top = el.getBoundingClientRect().top;
      const bottom = host ? host.getBoundingClientRect().bottom : window.innerHeight;
      const pad = host ? parseFloat(getComputedStyle(host).paddingBottom) || 0 : 12;
      const ceiling = host ? host.clientHeight : window.innerHeight;
      const next = Math.min(ceiling, Math.max(520, Math.floor(bottom - top - pad - 1)));
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(later);
    ro.observe(document.body);
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    const t = window.setTimeout(measure, 120);
    return () => {
      ro.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(t);
      window.removeEventListener('resize', later);
      window.removeEventListener('orientationchange', later);
    };
  });
  return height;
}

export function TeamDeck(p: TeamDeckProps) {
  const { format, log } = p;
  const state = useMemo(() => foldRally(format, log, 'A').state, [format, log]);
  const lv = effectiveLevel(format, state, state.pointLevel);
  const env = resultEnvelope(format, state);
  const aggregate = isAggregate(format);
  const clockPeriods = lv.terminator === 'clock';
  const spec = statSpecFor(p.sportName);

  const [surface, setSurface] = useState<Surface>('act');
  const [side, setSide] = useState<Side>('A');
  const [actor, setActor] = useState('');
  const [second, setSecond] = useState('');
  // The assist grid is a SECOND squad of the same size, and side by side with the
  // first it pushed the scorer's own bottom row under the fold. It is also optional
  // - most taps are recorded without one - so it starts shut and costs the officials
  // who never touch it nothing.
  const [assistOpen, setAssistOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const height = useDeckHeight(root);

  /**
   * THE MATCH CLOCK.
   *
   * The reading is computed from the log, so this state holds nothing but "what
   * time is it now" - a tick to re-render against. Nothing about the clock is
   * stored here, which is why closing the tab mid-half loses none of it.
   */
  // The number on the board, and what every tie-break decision is taken against.
  const shown = aggregate ? aggregateScore(state) : state.score[state.pointLevel];

  /**
   * HOW LONG THE PERIOD IN PROGRESS RUNS.
   *
   * Not `format.clock.minutes` - that is the WHOLE MATCH total (90 for two halves
   * of 45), so using it directly meant a half never reached full time and never
   * went into stoppage. `tieProgress` divides it down, and switches to the
   * tie-break's own length once extra time starts, which is the whole point: a
   * regulation half here is 10 minutes and an extra-time half is 5.
   */
  const progress = tieProgress(format, state, shown);
  const fullMs = progress.periodMs;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const clock = clockReading(log, fullMs, nowMs);
  useEffect(() => {
    if (!clock.running) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [clock.running]);

  const push = (ev: RallyEvent) => {
    if (p.disabled) return;
    // WHERE IN THE MATCH, stamped once, here. Every event that is not itself a clock
    // control carries the time it happened at, so the log can cite a goal as 23'
    // however the clock is corrected afterwards.
    const stamped = ev.t === 'clockStart' || ev.t === 'clockPause' || ev.t === 'clockAdjust'
      ? ev
      : { ...ev, ...(clock.started ? { clockMs: clock.elapsedMs } : {}) };
    const next = [...log, { ...stamped, at: new Date().toISOString() }];
    p.onChange(next, foldRally(format, next, 'A').state);
  };

  // Starting and stopping is a log entry like any other, so it survives a reload and
  // the other official's device sees it too.
  const toggleClock = () => {
    setNowMs(Date.now());
    push({ t: clock.running ? 'clockPause' : 'clockStart' });
  };
  const adjustClock = (toMs: number) => {
    setNowMs(Date.now());
    push({ t: 'clockAdjust', toMs: Math.max(0, Math.round(toMs)), fromMs: clock.elapsedMs });
  };
  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    p.onChange(next, foldRally(format, next, 'A').state);
  };

  const nameOf = (s: Side) => (s === 'A' ? p.homeName : p.awayName);
  const played = periodsPlayed(state);
  const totalPeriods = format.levels[format.levels.length - 1].target;

  const players = p.roster?.[side] ?? [];
  const nameFor = (id: string) =>
    [...(p.roster?.A ?? []), ...(p.roster?.B ?? [])].find((x) => x.id === id)?.name;
  const events = spec?.events ?? [];

  /**
   * WHAT HAS BEEN BOOKED, per side.
   *
   * Read off the log rather than counted by hand, and keyed on the TONE declared in
   * the registry rather than on the literal key 'yellow' - so football shows yellows
   * and reds, basketball shows fouls, and a sport that books nobody shows nothing at
   * all instead of two empty boxes.
   */
  const cards = useMemo(() => {
    const toneByKind = new Map(events.map((e) => [e.key, e.tone]));
    const tally = { A: { caution: 0, dismissal: 0 }, B: { caution: 0, dismissal: 0 } };
    for (const ev of log) {
      if (ev.t !== 'point' || !ev.kind) continue;
      const tone = toneByKind.get(ev.kind);
      if (tone === 'caution' || tone === 'dismissal') tally[ev.side][tone] += 1;
    }
    return tally;
  }, [log, events]);
  const canAttribute = events.length > 0 && players.length > 0;
  // Only a goal-shaped action offers a second person; nothing else does.
  const wantsSecond = events.some((e) => e.secondPlayer);

  /**
   * Fire one declared action.
   *
   * ONE event carries the magnitude AND the people: a three-pointer is a single
   * action worth three, not three taps, and the person rides along so the fact
   * table can name them. A non-scoring action (a card, an empty raid) is the same
   * event with pts 0 - it changes no score and is still a fact worth keeping.
   */
  const fire = (ev: StatEventSpec) => {
    push({
      t: 'point',
      // AN OWN GOAL IS SCORED FOR THE OTHER SIDE. The tap is made on the panel of
      // the team that conceded it, because that is whose player put it in - but the
      // goal belongs to their opponents, and `side` is who the score goes to. The
      // player rides along and is filed back on their own side by the stat fold.
      side: ev.forOpponent ? (side === 'A' ? 'B' : 'A') : side,
      pts: ev.points && ev.points > 0 ? ev.points : 0,
      kind: ev.key,
      label: ev.label,
      ...(actor ? { playerId: actor, playerName: nameFor(actor) } : {}),
      ...(ev.secondPlayer && second ? { secondId: second, secondName: nameFor(second) } : {}),
      ...(ev.value ? { value: 1 } : {}),
    });
    // The assist is per goal; the scorer usually is not, so only the second clears.
    setSecond('');
  };

  /**
   * WHAT THE PERIOD IN PROGRESS IS CALLED.
   *
   * Extra time is played through the same period machinery, so without this the
   * board would carry on counting "Half 3 of 2" - which is not a thing, and is
   * exactly the sort of nonsense an official stops trusting a console over.
   */
  const inExtra = progress.phase === 'extraTime';
  const periodName = inExtra ? 'Extra time' : lv.label;
  const periodNo = inExtra ? progress.extraPlayed + 1 : Math.min(played + 1, totalPeriods);
  const periodOf = inExtra ? progress.extraTotal : totalPeriods;

  const shoot = useMemo(
    () => shootoutState(log, format.tieBreak?.penalties?.kicks ?? 5),
    [log, format.tieBreak?.penalties?.kicks],
  );

  const endPeriod = async () => {
    const last = periodNo >= periodOf;
    const level = shown[0] === shown[1];
    const ok = await confirmDialog({
      title: `End ${periodName.toLowerCase()} ${periodNo}?`,
      confirmLabel: `End ${periodName.toLowerCase()}`,
      message: !last
        ? `The score so far is banked and the next ${periodName.toLowerCase()} starts level.`
        // What happens after the LAST period depends entirely on whether the scores
        // are level, and an official about to blow the final whistle should be told
        // which it is before they do it, not after.
        : level && inExtra && format.tieBreak?.penalties
          ? `Still ${shown[0]}–${shown[1]} after extra time. This goes to a penalty shoot-out.`
          : level && !inExtra && format.tieBreak?.extraTime
            ? `Level at ${shown[0]}–${shown[1]}. This goes to extra time.`
            : `This is the last ${periodName.toLowerCase()}. The match is decided on the total, currently ${shown[0]}–${shown[1]}.`,
    });
    if (ok) push({ t: 'endPeriod' });
  };

  return (
    <div
      ref={root}
      data-qa="team-deck"
      style={height ? { height } : undefined}
      className="flex flex-col gap-2 overflow-hidden"
    >
      {/* ── The scoreboard: never moves ──────────────────────────────────
          A SCOREBOARD, not a form header. Dark ground, big numerals, the clock in
          the middle between the two sides - the arrangement every board in every
          hall already uses, so an official reads it without being taught.

          The ground is brand-900 rather than a fixed navy, so a tenant whose colour
          is maroon gets a maroon board instead of somebody else's blue.

          What it does NOT carry is the basketball furniture: no shot clock, no
          possession arrow, no team-foul bonus, no timeouts. Football has none of
          them, and a board with dead controls on it teaches an official to distrust
          the live ones. Every figure here is read from the log. */}
      {/* A plain element, not <Card>: `cn` here is a join rather than a
          tailwind-merge, so Card's own `bg-white` and this board's `bg-brand-900`
          both survive into the class list and the stylesheet's order decides. The
          board lost, silently, and rendered white on white. */}
      <div data-qa="team-scoreboard"
        className="shrink-0 overflow-hidden rounded-xl bg-brand-900 px-3 py-2 text-white shadow-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <ScoreSide name={p.homeName} org={p.homeOrg} score={shown[0]} side="home" />

          <div className="flex flex-col items-center gap-1">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-on-brand">
              {progress.phase === 'penalties'
                ? 'Penalties'
                : aggregate ? `${periodName} ${periodNo} of ${periodOf}` : lv.label}
            </div>

            {/* THE CLOCK. Tapping the reading opens the correction panel - an
                official who has just noticed the clock is two minutes fast should
                not have to go hunting for where to fix it. */}
            {/* No clock in a shoot-out - kicks are not timed, and a running clock
                with a KICK OFF button under it invites an official to start one. */}
            {clockPeriods && !state.ended && progress.phase !== 'penalties' ? (
              <>
                <button type="button" data-qa="clock-face"
                  onClick={() => setSurface(surface === 'clock' ? 'act' : 'clock')}
                  className="font-mono text-[28px] font-bold leading-none tabular-nums text-white transition hover:opacity-80">
                  {formatClock(clock.elapsedMs)}
                </button>
                {/* Stoppage is called out rather than folded into the total: past
                    45:00 a football clock reads 45+2, never 47. */}
                {clock.overrun && (
                  <div className="rounded bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">
                    {formatClock(clock.fullMs)}+{formatClock(clock.stoppageMs)}
                  </div>
                )}
                <button type="button" data-qa="clock-toggle" onClick={toggleClock}
                  disabled={p.disabled || p.busy}
                  className={cn(
                    'rounded px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide transition disabled:opacity-40',
                    clock.running
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600',
                  )}>
                  {clock.running ? 'Stop' : clock.started ? 'Start' : 'Kick off'}
                </button>
              </>
            ) : (
              <div className="font-mono text-[10px] uppercase tracking-wider text-on-brand">
                {progress.phase === 'penalties' ? 'Level' : aggregate ? 'Total' : lv.label}
              </div>
            )}
          </div>

          <ScoreSide name={p.awayName} org={p.awayOrg} score={shown[1]} side="away" align="right" />
        </div>

        {/* The strip: what has been booked, and how each period finished. */}
        {/* Three columns rather than space-between, so the period boxes stay on the
            centre line whether or not either side has been booked. */}
        <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/15 pt-1.5">
          <Discipline counts={cards.A} />
          <div className="flex min-w-0 items-center justify-center gap-1 overflow-x-auto">
            {Array.from({ length: totalPeriods }, (_, i) => {
              const u = env.unitScores[i];
              const current = i === played && !state.ended;
              return (
                <div key={i} className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-center leading-tight',
                  current ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5',
                )}>
                  <div className="text-[8px] font-bold uppercase tracking-wide text-on-brand">
                    {lv.label[0]}{i + 1}
                  </div>
                  <div className="font-mono text-[10px] font-semibold tabular-nums text-white">
                    {u ? `${u[0]}–${u[1]}` : '–'}
                  </div>
                </div>
              );
            })}
          </div>
          <Discipline counts={cards.B} align="right" />
        </div>

        {format.officiatingMode === 'selfScored' && (
          <div className="mt-1 text-center text-[9px] font-semibold uppercase tracking-wide text-amber-300">
            Self-scored
          </div>
        )}
      </div>

      {/* ── The working region: everything swaps HERE ────────────────────── */}
      <div data-qa="team-region" className="relative min-h-0 flex-1">
        {state.ended ? (
          // TWO STAGES, NOT ONE. Confirming writes the score; it does not make the
          // result official and it does not say who won it for their side. While
          // this card offered "Confirm result" and nothing else, an official who
          // confirmed saw the same button again and reasonably concluded they were
          // finished - and the scorecard stayed unlocked and the award ungiven.
          <Card className={cn(SURFACE, 'min-h-0 items-center gap-3 overflow-y-auto p-4',
            p.recorded ? 'justify-start' : 'justify-center')}>
            <p className="text-center text-lg font-semibold">
              {state.outcome === 'draw' ? 'Drawn' : `${nameOf(state.winner ?? 'A')} wins`}
            </p>
            <p className="text-center text-sm text-muted">
              {env.headline[0]}–{env.headline[1]}
              {state.reason && state.reason !== 'normal' ? ` · ${state.reason}` : ''}
            </p>
            {p.recorded ? (
              <>
                <p data-qa="team-recorded"
                  className="text-center text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  ✓ Result recorded
                </p>
                {p.afterResult}
              </>
            ) : (
              <Button size="lg" data-qa="team-signoff" disabled={p.disabled || p.busy}
                onClick={() => p.onSignOff(log, state)}>
                {p.busy ? 'Saving…' : 'Confirm result'}
              </Button>
            )}
            {/* Still reachable after the result is WRITTEN: undoing re-opens the
                match, which is the only way to correct a mis-tapped final action.
                Not after it is LOCKED - `disabled` carries that, and this button
                was the one place in the deck that did not consult it. */}
            <Button variant="subtle" size="sm" disabled={!log.length || p.disabled || p.busy} onClick={undo}>
              Undo the last action
            </Button>
          </Card>
        ) : surface === 'log' ? (
          <Timeline log={log} nameOf={nameOf} nameFor={nameFor} fullMs={fullMs}
            onClose={() => setSurface('act')} />
        ) : progress.phase === 'penalties' ? (
          <Shootout
            shoot={shoot} nameOf={nameOf} kicksEach={format.tieBreak?.penalties?.kicks ?? 5}
            busy={!!p.disabled || !!p.busy} score={shown}
            onKick={(side, scored) => push({ t: 'penaltyKick', side, scored })}
            onUndo={undo}
            // SIGN-OFF, not an ordinary change. The host only writes a completed
            // fixture when it is told the match is DONE - pushing the terminal event
            // through onChange left a decided shoot-out sitting on status 'live'
            // with no winner, which is the one thing the whole chain exists to
            // produce.
            onSettle={(winner) => {
              const next = [...log, { ...shootoutEnd(winner), at: new Date().toISOString() }];
              p.onSignOff(next, foldRally(format, next, 'A').state);
            }}
          />
        ) : surface === 'clock' ? (
          <ClockPanel
            clock={clock} periodLabel={lv.label} period={played + 1}
            busy={!!p.disabled || !!p.busy}
            onAdjust={adjustClock} onToggle={toggleClock} onClose={() => setSurface('act')}
          />
        ) : surface === 'more' ? (
          <MorePanel
            format={format} nameOf={nameOf} shown={shown} played={played}
            totalPeriods={totalPeriods} periodLabel={lv.label} finishing={finishing}
            onFinishing={setFinishing} onEvent={push} onClose={() => setSurface('act')}
          />
        ) : (
          <Card className={cn(SURFACE, 'gap-2 p-2.5')}>
            {/* WHOSE ACTION. Two big tabs, so the next question is about one team. */}
            <div className="grid shrink-0 grid-cols-2 gap-1.5">
              {(['A', 'B'] as Side[]).map((s) => (
                <button key={s} type="button" data-qa={`team-side-${s}`}
                  onClick={() => { setSide(s); setActor(''); setSecond(''); setAssistOpen(false); }}
                  className={cn(
                    'min-h-[2.5rem] truncate rounded-lg px-2 text-sm font-semibold transition',
                    side === s
                      ? 'bg-brand-600 text-white'
                      : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200',
                  )}>
                  {nameOf(s)}
                </button>
              ))}
            </div>

            {/* GROW-0, SHRINK-1 on the picker below. On a phone there is no slack
                and it scrolls exactly as before; on a laptop the squad no longer
                stretches to fill the deck, which left a hand-sized void between the
                last name chip and the Goal button. The slack is collected by a
                spacer at the BOTTOM of the card instead. */}
            {canAttribute ? (
              <div className="min-h-0 shrink grow-0 space-y-1.5 overflow-y-auto">
                <Group label="Who">
                  <PeopleGrid
                    value={actor} qa={`actor-${side}`}
                    options={players.map((x) => [x.id, x.name] as [string, string])}
                    onChange={(v) => { setActor(v); if (v === second) setSecond(''); setAssistOpen(false); }}
                  />
                </Group>

                {wantsSecond && actor && (
                  <div>
                    {/* Shut, this is one line that still SAYS who is credited, so an
                        official can see an assist was recorded without opening it. */}
                    <button type="button" data-qa={`second-toggle-${side}`}
                      onClick={() => setAssistOpen((v) => !v)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border border-line px-2.5 py-1 text-left transition',
                        assistOpen ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white hover:bg-slate-50 dark:bg-slate-800/60',
                      )}>
                      <span className="text-[10px] uppercase tracking-wide text-muted">Assisted by</span>
                      <span className="flex items-center gap-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {second ? nameFor(second) ?? 'Someone' : 'Nobody'}
                        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted transition', assistOpen && 'rotate-180')} />
                      </span>
                    </button>
                    {assistOpen && (
                      <div className="mt-1.5">
                        <PeopleGrid
                          value={second} qa={`second-${side}`}
                          options={[['', 'Nobody'] as [string, string],
                            ...players.filter((x) => x.id !== actor).map((x) => [x.id, x.name] as [string, string])]}
                          onChange={(v) => { setSecond(v); setAssistOpen(false); }}
                        />
                        <p className="mt-1 text-[10px] text-muted">Optional — recorded on the same tap as the goal.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="min-h-0 flex-1 text-sm text-muted">
                {players.length === 0
                  ? 'No team sheet for this side, so actions cannot be attributed. The score can still be kept below.'
                  : 'This sport records no individual actions — the result is the record.'}
              </p>
            )}

            {/* WHAT THEY DID. Scoring actions first, and bigger. */}
            {canAttribute && (
              <div className="shrink-0 space-y-1.5">
                {/* Three across, not two. Football declares three scoring actions, and
                    at two columns the third one opened a row whose other half was
                    EMPTY - fifty-four pixels of nothing, taken straight out of the
                    squad grid above it. Goal still reads as the primary: it is first,
                    and it is the only one on brand fill. */}
                <div className="grid grid-cols-3 gap-1.5">
                  {events.filter((e) => (e.points ?? 0) > 0).map((ev) => (
                    <button key={ev.key} type="button" data-qa={`act-${side}-${ev.key}`}
                      disabled={p.disabled || p.busy || !actor}
                      onClick={() => fire(ev)}
                      className={cn(
                        'flex h-12 flex-col items-center justify-center rounded-lg px-1 text-center text-sm font-bold leading-tight transition',
                        'active:scale-[0.97] disabled:opacity-40',
                        toneOf(ev),
                      )}>
                      <span>{ev.label}</span>
                      {ev.forOpponent && (
                        <span className="text-[9px] font-normal opacity-80">
                          scores for {nameOf(side === 'A' ? 'B' : 'A')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {events.filter((e) => !(e.points ?? 0)).map((ev) => (
                    <button key={ev.key} type="button" data-qa={`act-${side}-${ev.key}`}
                      disabled={p.disabled || p.busy || !actor}
                      onClick={() => fire(ev)}
                      className={cn(
                        'flex h-9 items-center justify-center rounded-lg px-1 text-center text-[11px] font-semibold leading-tight transition',
                        'active:scale-[0.97] disabled:opacity-40',
                        toneOf(ev),
                      )}>
                      {ev.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The escape hatch: a point nobody is named for. Small, and honest. */}
            <div className="grid shrink-0 grid-cols-2 gap-1.5 border-t border-line pt-1.5">
              {(['A', 'B'] as Side[]).map((s) => (
                <Button key={s} size="sm" variant="outline" data-qa={`team-score-${s}-1`}
                  disabled={p.disabled || p.busy}
                  onClick={() => push({ t: 'point', side: s })}>
                  +1 {nameOf(s)}{canAttribute ? ' · no player' : ''}
                </Button>
              ))}
            </div>
            <div className="min-h-0 flex-1" />
          </Card>
        )}
      </div>

      {/* ── The footer: never moves ──────────────────────────────────────── */}
      <Card className="shrink-0 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          {/* THE WHISTLE IS THE ONLY FILLED BUTTON DOWN HERE.
              It was one small button in a row of four identically sized ones, and
              two of the others turned brand-filled whenever their panel was open -
              so the control that ENDS THE HALF competed with a log toggle for the
              official's eye. It now takes the width it deserves and stands alone in
              solid brand; the panel toggles say they are open with a tint and a
              ring instead of stealing the fill. */}
          {clockPeriods && !state.ended && progress.phase !== 'penalties' && (
            <Button size="sm" variant="primary" data-qa="end-period"
              className={cn('h-9 flex-1 text-sm font-bold',
                // Past full time the whistle is OVERDUE, and the button says so. It
                // still does not blow itself - stoppage time is the official's call,
                // and a clock that ended halves would end them mid-added-time.
                clock.overrun && 'animate-pulse ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-slate-900')}
              disabled={p.disabled || p.busy} onClick={endPeriod}>
              End {periodName.toLowerCase()} {periodNo}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-9 shrink-0"
            disabled={!log.length || p.disabled || p.busy} onClick={undo}>
            Undo
          </Button>
          <Button size="sm" variant="outline"
            className={cn('h-9 shrink-0', surface === 'log' && PANEL_OPEN)}
            onClick={() => setSurface(surface === 'log' ? 'act' : 'log')}>
            Log{log.length ? ` · ${log.length}` : ''}
          </Button>
          <Button size="sm" variant="outline"
            className={cn('h-9 shrink-0', surface === 'more' && PANEL_OPEN)}
            onClick={() => setSurface(surface === 'more' ? 'act' : 'more')}>
            More
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

const SURFACE = 'absolute inset-0 flex flex-col overflow-hidden';

/** A panel toggle that is currently open - readable as "on" without going solid. */
const PANEL_OPEN = 'border-brand-300 bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/30';

/**
 * THE PALETTE, one entry per declared tone.
 *
 * Meaning lives in the registry; the colours live here, so a tenant's brand ramp can
 * move without the sport definitions knowing. Cards are the exception that proves
 * it - a yellow card is yellow because it IS yellow, not because yellow happened to
 * be free.
 *
 * Yellow takes near-black text rather than white: yellow-400 under white text is
 * about 1.8:1, which is not a contrast ratio so much as a rumour.
 */
const TONE: Record<EventTone, string> = {
  score: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
  // An own goal must not read as "your team scored" - it is outlined rather than
  // filled, so it is legible as a goal that went the wrong way at a glance.
  ownGoal: 'border-2 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/70 dark:bg-amber-500/15 dark:text-amber-100',
  good: 'border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200',
  caution: 'bg-yellow-400 text-yellow-950 hover:bg-yellow-500 shadow-sm dark:bg-yellow-400 dark:text-yellow-950',
  dismissal: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  error: 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200',
};

/** A tone was declared, or one is inferred from whether the action scores. */
function toneOf(ev: StatEventSpec): string {
  if (ev.tone) return TONE[ev.tone];
  if (ev.forOpponent) return TONE.ownGoal;
  return (ev.points ?? 0) > 0 ? TONE.score : TONE.error;
}

/**
 * CORRECTING THE CLOCK.
 *
 * Two ways, because there are two mistakes. The clock drifting a few seconds off the
 * referee's watch is a nudge; the clock never having been started at kick-off is
 * twelve minutes out, and nudging there is absurd - that one wants a number typed
 * in. Both write a `clockAdjust` into the log, so the correction is part of the
 * record rather than something that quietly happened.
 *
 * What a correction does NOT do is rewrite history. Events already logged keep the
 * minute they were stamped with: a goal entered at what the console said was 23' is
 * a 23rd-minute goal, and the fix applies from now on.
 */
function ClockPanel({ clock, periodLabel, period, busy, onAdjust, onToggle, onClose }: {
  clock: ClockReading;
  periodLabel: string;
  period: number;
  busy: boolean;
  onAdjust: (toMs: number) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [mm, setMm] = useState('');
  const [ss, setSs] = useState('');

  const setExact = () => {
    const m = Number(mm || '0');
    const sec = Number(ss || '0');
    if (!Number.isFinite(m) || !Number.isFinite(sec) || m < 0 || sec < 0 || sec > 59) {
      toast.error('Enter a time like 21 minutes 00 seconds.');
      return;
    }
    onAdjust((m * 60 + sec) * 1000);
    setMm(''); setSs('');
  };

  const NUDGES: Array<[string, number]> = [
    ['-1m', -60_000], ['-10s', -10_000], ['+10s', 10_000], ['+1m', 60_000],
  ];

  return (
    <Card className={cn(SURFACE, 'gap-3 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted">
          {periodLabel} {period} · match clock
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3">
        <div className="font-mono text-4xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
          {formatClock(clock.elapsedMs)}
        </div>
        <Button size="sm" variant={clock.running ? 'outline' : 'primary'}
          disabled={busy} onClick={onToggle}>
          {clock.running ? 'Pause' : clock.started ? 'Resume' : 'Start'}
        </Button>
      </div>
      <p className="shrink-0 text-center text-[11px] text-muted">
        {clock.overrun
          ? `Past ${formatClock(clock.fullMs)} — ${formatClock(clock.stoppageMs)} of added time.`
          : clock.fullMs > 0 ? `of ${formatClock(clock.fullMs)}` : 'No fixed length.'}
      </p>

      <div className="shrink-0">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Nudge</div>
        <div className="grid grid-cols-4 gap-1.5">
          {NUDGES.map(([label, delta]) => (
            <Button key={label} size="sm" variant="outline" data-qa={`clock-nudge-${label}`}
              disabled={busy} onClick={() => onAdjust(clock.elapsedMs + delta)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="shrink-0">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Or set it exactly</div>
        <div className="flex items-center gap-1.5">
          <Input value={mm} onChange={(e) => setMm(e.target.value)} inputMode="numeric"
            data-qa="clock-mm" placeholder="min" className="w-16 text-center" />
          <span className="font-mono text-sm text-muted">:</span>
          <Input value={ss} onChange={(e) => setSs(e.target.value)} inputMode="numeric"
            data-qa="clock-ss" placeholder="sec" className="w-16 text-center" />
          <Button size="sm" variant="primary" data-qa="clock-set" disabled={busy} onClick={setExact}>
            Set
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted">
          Corrections are written to the log. Events already recorded keep the minute
          they were entered at.
        </p>
      </div>
    </Card>
  );
}

/**
 * THE SHOOT-OUT.
 *
 * Two buttons, and the console decides everything else. The official never picks
 * whose kick it is - alternation is a function of how many kicks have been taken,
 * so it survives an undo, which is precisely where a hand-driven "whose turn" flag
 * goes wrong.
 *
 * The scoreline is NOT touched. A 2-2 settled on kicks is recorded 2-2, won on
 * penalties, and the terminal `end` event carries that reason so a record can say
 * so rather than presenting it as a win in normal time.
 */
function Shootout({ shoot, nameOf, kicksEach, busy, score, onKick, onUndo, onSettle }: {
  shoot: ShootoutState;
  nameOf: (s: Side) => string;
  kicksEach: number;
  busy: boolean;
  score: readonly [number, number];
  onKick: (side: Side, scored: boolean) => void;
  onUndo: () => void;
  onSettle: (winner: Side) => void;
}) {
  const rounds = Math.max(kicksEach, shoot.taken[0], shoot.taken[1]);
  const kicksOf = (side: Side) => shoot.kicks.filter((k) => k.side === side);

  return (
    <Card className={cn(SURFACE, 'gap-3 p-3')} data-qa="shootout">
      <div className="shrink-0 text-center">
        <div className="text-[10px] uppercase tracking-wide text-muted">
          {shoot.suddenDeath ? 'Sudden death' : `Penalties · ${kicksEach} kicks each`}
        </div>
        <div className="mt-0.5 font-mono text-3xl font-bold tabular-nums">
          {shoot.scored[0]}–{shoot.scored[1]}
        </div>
        <div className="text-[11px] text-muted">
          match level at {score[0]}–{score[1]}
        </div>
      </div>

      {/* The grid an official actually reads: a row per side, a mark per kick. */}
      <div className="shrink-0 space-y-1">
        {(['A', 'B'] as Side[]).map((side) => (
          <div key={side} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate text-[11px] font-semibold">{nameOf(side)}</span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {Array.from({ length: rounds }, (_, i) => {
                const k = kicksOf(side)[i];
                return (
                  <span key={i} className={cn(
                    'grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold',
                    !k ? 'border border-dashed border-line text-transparent'
                      : k.scored ? 'bg-emerald-600 text-white'
                        : 'bg-slate-300 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                  )}>
                    {k ? (k.scored ? '✓' : '✗') : '·'}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1" />

      {shoot.decided && shoot.winner ? (
        <div className="shrink-0 space-y-2">
          <p className="text-center text-sm font-semibold">
            {shootoutLine(shoot, nameOf)}
          </p>
          <Button className="w-full" variant="primary" data-qa="shootout-settle"
            disabled={busy} onClick={() => onSettle(shoot.winner as Side)}>
            Record the result
          </Button>
          <Button className="w-full" size="sm" variant="outline" disabled={busy} onClick={onUndo}>
            Undo the last kick
          </Button>
        </div>
      ) : (
        <div className="shrink-0 space-y-2">
          <div className="text-center text-[11px] text-muted">
            Next: <span className="font-semibold text-slate-700 dark:text-slate-200">{nameOf(shoot.next)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12 text-sm font-bold" variant="primary" data-qa="shootout-scored"
              disabled={busy} onClick={() => onKick(shoot.next, true)}>
              Scored
            </Button>
            <Button className="h-12 text-sm font-bold" variant="outline" data-qa="shootout-missed"
              disabled={busy} onClick={() => onKick(shoot.next, false)}>
              Missed
            </Button>
          </div>
          <Button className="w-full" size="sm" variant="outline"
            disabled={busy || !shoot.kicks.length} onClick={onUndo}>
            Undo the last kick
          </Button>
        </div>
      )}
    </Card>
  );
}

/** One side of the board: who they are, and their number. */
function ScoreSide({ name, org, score, side, align = 'left' }: {
  name: string; org?: string | null; score: number; side: 'home' | 'away'; align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className="truncate text-[13px] font-bold leading-tight text-white">{name}</div>
      <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-on-brand">
        {org ? `${org} · ` : ''}{side}
      </div>
      <div className="font-mono text-[34px] font-bold leading-none tabular-nums text-white">
        {score}
      </div>
    </div>
  );
}

/**
 * Cards booked against a side.
 *
 * Rendered as the colours themselves - a yellow square and a red one - because that
 * is how a card is recorded on every team sheet ever printed, and it needs no key.
 * Hidden entirely when nothing has been booked, so the board stays quiet.
 */
function Discipline({ counts, align = 'left' }: {
  counts: { caution: number; dismissal: number }; align?: 'left' | 'right';
}) {
  if (!counts.caution && !counts.dismissal) return <div aria-hidden />;
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5',
      align === 'right' ? 'justify-end' : 'justify-start')}>
      {counts.caution > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="h-3 w-2 rounded-[1px] bg-yellow-400" />
          <span className="font-mono text-[11px] font-bold tabular-nums text-white">{counts.caution}</span>
        </span>
      )}
      {counts.dismissal > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="h-3 w-2 rounded-[1px] bg-red-500" />
          <span className="font-mono text-[11px] font-bold tabular-nums text-white">{counts.dismissal}</span>
        </span>
      )}
    </div>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">{label}</div>
      {children}
      {hint ? <p className="mt-1 text-[10px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * The squad as a grid of NAME CHIPS.
 *
 * It began as a wrapped row of pills, and a pill is as wide as the name inside it -
 * so a full sixteen-player squad wrapped to five or six ragged rows, pushed the
 * action buttons off the bottom, and RE-FLOWED whenever the roster differed. The
 * same player sat somewhere different on every match, which breaks this deck's own
 * rule that a button must not move between taps.
 *
 * A grid of equal cells fixes both at once: rows are regular, and a player's
 * position is a function of roster order alone.
 *
 * It briefly carried an avatar circle above each name. On a phone that was fine; on
 * a laptop it was a 32-pixel circle adrift in a 300-pixel cell, and the extra line
 * cost the grid a row it could not spare. The name on its own is what an official
 * reads anyway, so that is all the chip is now - and being one line tall, it fits
 * far more of the squad in the same space.
 *
 * A native `<select>` is still the wrong answer here - on a phone it opens a
 * full-screen wheel that covers the score, and dismissing it is a second tap that
 * an official pays before nearly every action.
 */

/**
 * The longest full name the chip prints before it starts abbreviating. The chips
 * are laid out three to a row on the narrowest handset, so this is roughly what
 * fits there without truncating.
 */
const NAME_BUDGET = 14;

/**
 * What to print on the chip. The surname alone is the shortest thing that still
 * reads as a person - but two Nairs on one team sheet is common enough that a bare
 * surname would be a coin flip, so a repeated one picks up its first initial.
 *
 * TWO RULES THAT WERE MISSING, both found on a real roll.
 *
 * 1. ABBREVIATE ONLY WHAT DOES NOT FIT. Shortening buys space, and space that is
 *    already there is not worth a name for. "ARS Player 1" fits the chip whole, so
 *    it is printed whole.
 *
 * 2. THE LAST TOKEN IS A SURNAME ONLY WHEN IT IS A NAME. A squad imported from a
 *    sheet is very often numbered - "ARS Player 1" through "ARS Player 6" - and
 *    taking the last token gave six chips reading 1 2 3 4 5 6: every distinguishing
 *    part of the name dropped, and the part that distinguishes nobody kept. So a
 *    trailing token that is not a word (a number, an initial, a suffix) stays
 *    attached to the last real word before it, and a name with no word-like token
 *    at all is printed whole.
 *
 * The chip truncates and carries the full name as its tooltip either way, so
 * printing too much costs a hover and printing too little costs a wrong scorer.
 */
function shortNames(names: string[]): string[] {
  const full = names.map((n) => n.trim());

  /** Two letters or more - enough to read as a name rather than as a marker. */
  const isWord = (t: string) => t.replace(/[^\p{L}]/gu, '').length >= 2;

  const surname = (n: string) => {
    const parts = n.split(/\s+/).filter(Boolean);
    if (!parts.length) return n;
    let i = parts.length - 1;
    while (i > 0 && !isWord(parts[i])) i--;
    // Everything from the last real word onwards, so "Player 1" survives intact.
    return isWord(parts[i]) ? parts.slice(i).join(' ') : n;
  };

  const seen = new Map<string, number>();
  for (const n of full) {
    const k = surname(n).toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  return full.map((n) => {
    if (n.length <= NAME_BUDGET) return n;
    const sn = surname(n);
    if ((seen.get(sn.toLowerCase()) ?? 0) < 2) return sn;
    const first = n.split(/\s+/)[0] ?? '';
    return first ? `${first[0]}. ${sn}` : sn;
  });
}

function PeopleGrid({ value, options, onChange, qa }: {
  value: string; options: Array<[string, string]>; onChange: (v: string) => void; qa?: string;
}) {
  const labels = shortNames(options.map(([, label]) => label));
  return (
    // Three across on the narrowest phone, and more as there is room - a squad that
    // is four rows on a handset is one row on a laptop, rather than four columns of
    // mostly whitespace. The harness reads these positionally, so the order stays
    // the roster order it was given.
    <div data-qa={qa} className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {options.map(([v, label], i) => {
        const on = value === v;
        return (
          <button key={v || '_none'} type="button" data-qa-value={v} title={label}
            onClick={() => onChange(v)}
            className={cn(
              'h-8 truncate rounded-full px-2 text-center text-xs font-semibold transition active:scale-[0.97]',
              on
                ? 'bg-brand-600 text-white shadow-sm'
                : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200',
            )}>
            {v === '' ? label : labels[i]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * WHAT HAS BEEN RECORDED, in order.
 *
 * An official cannot check a scoreline they cannot see the working for. Without
 * this the only way to know whether a goal went in with the right scorer was to
 * undo it and do it again.
 */
function Timeline({ log, nameOf, nameFor, fullMs, onClose }: {
  log: RallyLog;
  nameOf: (s: Side) => string;
  nameFor: (id: string) => string | undefined;
  /** The period's length, so stoppage prints as 45+2' rather than 47'. */
  fullMs: number;
  onClose: () => void;
}) {
  const rows = [...log.entries()].reverse();
  return (
    <Card className={cn(SURFACE, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">What has been recorded</h3>
        <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto text-sm">
          {rows.map(([i, ev]) => (
            <li key={i} className="flex items-baseline gap-2 py-1.5">
              {/* THE MINUTE, where the event carries one. This is the column an
                  official scans for - "when was the second goal?" - so it leads the
                  row, and the bare entry number steps aside for it. */}
              <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
                {typeof (ev as { clockMs?: number }).clockMs === 'number'
                  ? minuteLabel((ev as { clockMs: number }).clockMs, fullMs)
                  : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {ev.t === 'endPeriod' ? (
                  <span className="font-semibold">— end of the period —</span>
                ) : ev.t === 'point' ? (
                  <>
                    <span className="font-medium">{ev.label ?? 'Point'}</span>
                    {ev.playerId && <span> · {ev.playerName ?? nameFor(ev.playerId) ?? 'unknown'}</span>}
                    {ev.secondId && (
                      <span className="text-muted"> (assist {ev.secondName ?? nameFor(ev.secondId) ?? '—'})</span>
                    )}
                    <span className="text-muted"> · {nameOf(ev.side)}</span>
                    {typeof ev.pts === 'number' && ev.pts > 0 && (
                      <span className="ml-1 font-mono text-xs text-brand-600">+{ev.pts}</span>
                    )}
                  </>
                ) : ev.t === 'clockStart' ? (
                  <span className="text-muted">Clock started</span>
                ) : ev.t === 'clockPause' ? (
                  <span className="text-muted">Clock paused</span>
                ) : ev.t === 'clockAdjust' ? (
                  <span className="text-amber-700 dark:text-amber-300">
                    Clock corrected to {formatClock(ev.toMs)}
                    {typeof ev.fromMs === 'number' && (
                      <span className="text-muted"> (was {formatClock(ev.fromMs)})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted">{ev.t}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Corrections and the ways a match ends that the rules did not produce. */
function MorePanel({
  format, nameOf, shown, played, totalPeriods, periodLabel, finishing, onFinishing, onEvent, onClose,
}: {
  format: ScoringFormat;
  nameOf: (s: Side) => string;
  shown: readonly [number, number] | number[];
  played: number;
  totalPeriods: number;
  periodLabel: string;
  finishing: boolean;
  onFinishing: (v: boolean) => void;
  onEvent: (ev: RallyEvent) => void;
  onClose: () => void;
}) {
  return (
    <Card className={cn(SURFACE, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">Corrections and endings</h3>
        <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
            The pitch outranks the engine
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['A', 'B'] as Side[]).map((side) => (
              <Button key={side} size="sm" variant="outline"
                onClick={() => onEvent({ t: 'adjust', side, delta: -1, reason: 'minus one' })}>
                −1 {nameOf(side)}
              </Button>
            ))}
          </div>
        </div>

        {format.penaltyEvents !== 'off' && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Penalty point to</div>
            <div className="flex flex-wrap gap-1.5">
              {(['A', 'B'] as Side[]).map((side) => (
                <Button key={side} size="sm" variant="subtle"
                  onClick={() => onEvent({ t: 'penalty', side, reason: 'conduct' })}>
                  {nameOf(side)}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">End this match early</div>
          <p className="mb-1.5 text-xs text-muted">
            {played} of {totalPeriods} {periodLabel.toLowerCase()}s played, currently{' '}
            <span className="font-mono tabular-nums">{shown[0]}–{shown[1]}</span>. Pick how it ended
            and it is recorded with that reason.
          </p>
          {!finishing ? (
            <Button size="sm" variant="danger" onClick={() => onFinishing(true)}>
              End the match early…
            </Button>
          ) : (
            <div className="grid gap-1.5">
              {(['A', 'B'] as Side[]).map((side) => (
                <Button key={side} size="sm" variant="outline"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: `Award the match to ${nameOf(side)}?`,
                      confirmLabel: 'Record it',
                      message: 'Recorded as awarded by the official, not as a played result.',
                    });
                    if (ok) { onFinishing(false); onEvent({ t: 'end', outcome: 'win', reason: 'conceded', winner: side }); }
                  }}>
                  Award to {nameOf(side)}
                </Button>
              ))}
              {format.endStates.drawsAllowed && shown[0] === shown[1] && (
                <Button size="sm" variant="subtle"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Record a draw?', confirmLabel: 'Record it',
                      message: 'The match is recorded as drawn.',
                    });
                    if (ok) { onFinishing(false); onEvent({ t: 'end', outcome: 'draw', reason: 'normal', winner: null }); }
                  }}>
                  Record a draw
                </Button>
              )}
              <Button size="sm" variant="subtle"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Abandon this match?', confirmLabel: 'Record it',
                    message: 'No winner is recorded. The organiser decides what happens to the fixture.',
                  });
                  if (ok) { onFinishing(false); onEvent({ t: 'end', outcome: 'void', reason: 'abandoned', winner: null }); }
                }}>
                Abandoned — no result
              </Button>
              <Button size="sm" variant="subtle" onClick={() => onFinishing(false)}>Keep scoring</Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
