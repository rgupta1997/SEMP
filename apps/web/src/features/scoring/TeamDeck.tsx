import { ChevronDown, Undo2 } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  aggregateScore, capLeader, changesEndsAfterUnit, effectiveLevel, foldRally, isDecider, isAggregate, periodsPlayed, resultEnvelope,
  clockReading, formatClock, minuteLabel, tieProgress, shootoutState, shootoutLine, shootoutEnd, shootoutTerms, type ShootoutTerms,
  isKhoKhoFormat, khoStatus, khoTurnLines, minChaseState, minChaseEnd, inningsEnd, formatChaseTime, parseChaseTime, KHO_END_LABEL, MIN_CHASE_GRACE_MS,
  isKabaddiFormat, kabaddiStatus, canonicalTeamSport, goldenTossEnd, GOLDEN_RAIDS, isHockeySport, penaltyCorners,
  activeSuspensions, cardRulesFor, escalatedCard,
  type ClockReading, type ShootoutState, type MinChaseState,
  statSpecFor, type EventTone, type KernelState, type RallyEvent, type RallyLog, type ScoringFormat,
  type Side, type StatEventSpec,
} from '@semp/shared';
import { Button, Card, Input, cn, confirmDialog, toast } from '../../components/ui';
import { FitName } from '../../components/FitName';

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
  /** Short codes for tight spots on a phone (own-goal note, +1 buttons). Default: the name. */
  homeShort?: string;
  awayShort?: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Roster for each side, so an action can be attributed to a person - those on the field when there is a team sheet. */
  roster?: { A: Array<{ id: string; name: string }>; B: Array<{ id: string; name: string }> };
  /** Team-sheet substitutes, one tap away behind "Select from subs". */
  bench?: { A: Array<{ id: string; name: string }>; B: Array<{ id: string; name: string }> };
  /** A substitute was credited and came on for `offId`. */
  onSubstitute?: (side: Side, onId: string, offId: string) => void;
  log: RallyLog;
  onChange: (log: RallyLog, state: KernelState) => void;
  onSignOff: (log: RallyLog, state: KernelState) => void;
  disabled?: boolean;
  busy?: boolean;
  /** Has the confirmed result actually been written to the fixture yet? */
  recorded?: boolean;
  /** A knockout fixture needs a winner, so a rain draw is not offered. */
  knockout?: boolean;
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
  const fold = useMemo(() => foldRally(format, log, 'A'), [format, log]);
  const state = fold.state;
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
  // Substitutes sit behind a tap: most actions belong to someone on the field.
  const [subsOpen, setSubsOpen] = useState(false);
  const [secondSubsOpen, setSecondSubsOpen] = useState(false);
  // Substitutes just credited with something, each waiting for "who went off for them?".
  const [cameOn, setCameOn] = useState<Array<{ side: Side; id: string }>>([]);
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
  const shortOf = (s: Side) => (s === 'A' ? p.homeShort : p.awayShort) || nameOf(s);
  const played = periodsPlayed(state);
  const totalPeriods = format.levels[format.levels.length - 1].target;
  // A sets match's target is sets to WIN: best of 5 is first to 3, so up to 5 are played.
  const unitPlayAll = !!format.levels[format.levels.length - 2]?.playAll;
  const maxUnits = aggregate || unitPlayAll ? totalPeriods : totalPeriods * 2 - 1;

  // Volleyball and throwball only: the rally winner serves, and ends change between sets.
  const rallyServe = format.serve.movement === 'rallyWinner';
  const serving: Side | null = rallyServe && !state.ended ? state.serve.side : null;
  const noRallyYet = !log.some((e) => e.t === 'point' || e.t === 'penalty');
  let playIdx = fold.trace.length - 1;
  while (playIdx >= 0 && PASSIVE.has(fold.trace[playIdx].event.t)) playIdx -= 1;
  const lastEffect = playIdx >= 0 ? fold.trace[playIdx] : undefined;
  const afterUnit = rallyServe && !!lastEffect && changesEndsAfterUnit(format, state, lastEffect.unitsWon);
  // FIVB 18.2: no change before the deciding set - there is a fresh toss instead.
  const nextIsDecider = afterUnit && isDecider(format, state, 0);
  const [switchDismissed, setSwitchDismissed] = useState(-1);
  const showSwitch = rallyServe && !state.ended && (!!lastEffect?.switchEnds || afterUnit) && switchDismissed !== playIdx;
  const switchText = nextIsDecider
    ? `Deciding ${lv.label.toLowerCase()} next: toss again for serve and ends`
    : afterUnit
      ? `Change ends before the next ${lv.label.toLowerCase()}`
      : `Change ends · ${state.score[0][0]}–${state.score[0][1]} in the deciding ${lv.label.toLowerCase()}`;

  const players = p.roster?.[side] ?? [];
  const subs = p.bench?.[side] ?? [];
  const isSub = (id: string) => subs.some((x) => x.id === id);
  const nameFor = (id: string) =>
    [...(p.roster?.A ?? []), ...(p.roster?.B ?? []), ...(p.bench?.A ?? []), ...(p.bench?.B ?? [])].find((x) => x.id === id)?.name;
  const events = spec?.events ?? [];

  // Kho kho: only the chasing side scores, so who is chasing decides whose buttons
  // apply - the defending side records how its defender went out, the chasing side
  // records its fouls. The chaser credited with an out comes from the OTHER roster.
  const kho = isKhoKhoFormat(format);
  const khoNow = kho ? khoStatus(format, log, state) : null;
  const chasing = khoNow?.chaser ?? null;
  // Kabaddi works the same way: the raiding side records the raid, the other side its tackles.
  const kab = isKabaddiFormat(format);
  const kabNow = kab ? kabaddiStatus(log, state) : null;
  const attacking = chasing ?? kabNow?.raider ?? null;
  const roleOf = (s: Side) => (attacking ? (s === attacking ? 'attack' : 'defend') : null);
  const attackWord = kab ? 'raiding' : 'chasing';
  const sideEvents = attacking
    ? events.filter((e) => (!e.role || e.role === roleOf(side))
      // Do-or-die: an empty raid is no longer an option - the raider is out instead.
      && (!kab || (kabNow?.doOrDie ? e.key !== 'empty_raid' : e.key !== 'dod_failed')))
    : events;
  // A raid of n points: one tap per value.
  const valueEvents = sideEvents.filter((e) => e.value && e.scoresValue);
  const tapEvents = sideEvents.filter((e) => !(e.value && e.scoresValue));
  const secondSpec = sideEvents.find((e) => e.secondPlayer)?.secondPlayer;
  const fromOpponent = !!secondSpec?.fromOpponent;
  const otherOf = (s: Side): Side => (s === 'A' ? 'B' : 'A');
  const secondPool = fromOpponent ? (p.roster?.[otherOf(side)] ?? []) : players;
  const secondSubs = fromOpponent ? (p.bench?.[otherOf(side)] ?? []) : subs;
  // A new kho kho turn opens on the defending side (most taps are a defender going
  // out); a new kabaddi raid on the raiding side (most taps are how the raid ended).
  useEffect(() => {
    if (!attacking) return;
    setSide(kab ? attacking : otherOf(attacking)); setActor(''); setSecond(''); setAssistOpen(false);
  }, [attacking]); // eslint-disable-line react-hooks/exhaustive-deps
  const [followOnDismissed, setFollowOnDismissed] = useState(false);
  const minChase = useMemo(() => (kho ? minChaseState(log, khoNow?.firstChaser ?? null) : null), [kho, log, khoNow?.firstChaser]);
  const tossOpen = kho && !state.ended && periodsPlayed(state) === 0 && !log.some((e) => e.t === 'point');
  const raidTossOpen = kab && !state.ended && periodsPlayed(state) === 0 && !!kabNow?.beforeFirstRaid;

  /**
   * WHAT HAS BEEN BOOKED, per side.
   *
   * Read off the log rather than counted by hand, and keyed on the TONE declared in
   * the registry rather than on the literal key 'yellow' - so football shows yellows
   * and reds, basketball shows fouls, and a sport that books nobody shows nothing at
   * all instead of two empty boxes.
   */
  const corners = useMemo(() => (isHockeySport(format.sport) ? penaltyCorners(log) : null), [format.sport, log]);
  const cards = useMemo(() => {
    const toneByKind = new Map(events.map((e) => [e.key, e.tone]));
    const tally = { A: { warning: 0, caution: 0, dismissal: 0 }, B: { warning: 0, caution: 0, dismissal: 0 } };
    for (const ev of log) {
      if (ev.t !== 'point' || !ev.kind) continue;
      const tone = toneByKind.get(ev.kind);
      if (tone === 'warning' || tone === 'caution' || tone === 'dismissal') tally[ev.side][tone] += 1;
    }
    return tally;
  }, [log, events]);

  /**
   * WHAT HAS BEEN BOOKED, per PERSON.
   *
   * The tally above answers "how many cards has this team got", which is what the
   * scoreboard needs. It is not what the official about to book somebody needs,
   * and that question - is this one already on a yellow? - is the one the console
   * was silent on. Getting it wrong is not a cosmetic error: a second caution is a
   * sending-off, and the only way to check was to open the timeline and read back
   * through the half.
   *
   * Keyed on the declared TONE, exactly like the team tally, so this is football's
   * yellows and reds, basketball's fouls, and nothing at all for a sport that books
   * nobody - rather than a hardcoded pair of card colours every sport carries.
   */
  const playerCards = useMemo(() => {
    const toneByKind = new Map(events.map((e) => [e.key, e.tone]));
    const tally = new Map<string, CardCounts>();
    for (const ev of log) {
      if (ev.t !== 'point' || !ev.kind || !ev.playerId) continue;
      const tone = toneByKind.get(ev.kind);
      if (tone !== 'warning' && tone !== 'caution' && tone !== 'dismissal') continue;
      const cur = tally.get(ev.playerId) ?? { warning: 0, caution: 0, dismissal: 0 };
      tally.set(ev.playerId, { ...cur, [tone]: cur[tone] + 1 });
    }
    return tally;
  }, [log, events]);

  // Basketball's foul-out: at this many personal fouls a player must leave (FIBA 5).
  const foulLimit = Number(format.rulesSheet?.foulsToDisqualify) || 0;
  const actorFouls = foulLimit && actor ? playerCards.get(actor)?.caution ?? 0 : 0;

  const canAttribute = events.length > 0 && players.length > 0;
  // Only a goal-shaped action offers a second person; nothing else does.
  const wantsSecond = sideEvents.some((e) => e.secondPlayer);
  // A required second person (kho kho's chaser on an out): asked on every such tap,
  // with "Not sure" so a scorer is never blocked - it records the out, credits nobody.
  const needsSecond = (ev: StatEventSpec) => !!ev.secondPlayer && !ev.secondPlayer.optional;
  const secondRequired = sideEvents.some(needsSecond);

  /**
   * Fire one declared action.
   *
   * ONE event carries the magnitude AND the people: a three-pointer is a single
   * action worth three, not three taps, and the person rides along so the fact
   * table can name them. A non-scoring action (a card, an empty raid) is the same
   * event with pts 0 - it changes no score and is still a fact worth keeping.
   */
  // Card rules (hockey): who is serving a suspension, and whether a repeat card escalates.
  const cardRules = useMemo(() => cardRulesFor(format), [format]);
  const suspended = cardRules && !state.ended ? activeSuspensions(log, cardRules, nowMs) : [];
  const cardName = (key: string) => events.find((e) => e.key === key)?.label ?? key;

  /** A tap, with the escalation question first when a repeat card should become the next one up. */
  const fire = (ev: StatEventSpec, value?: number) => {
    const up = cardRules && actor ? escalatedCard(log, cardRules, actor, ev.key) : ev.key;
    const upSpec = up !== ev.key ? events.find((e) => e.key === up) : undefined;
    if (!upSpec) { record(ev, value); return; }
    void confirmDialog({
      title: `${nameFor(actor) ?? 'This player'} already has a ${cardName(ev.key).toLowerCase()}`,
      message: `A second ${cardName(ev.key).toLowerCase()} becomes a ${upSpec.label.toLowerCase()} under this format's rules.`,
      confirmLabel: `Record ${upSpec.label.toLowerCase()}`,
      cancelLabel: `Keep ${cardName(ev.key).toLowerCase()}`,
    }).then((ok) => record(ok ? upSpec : ev, value));
  };

  const record = (ev: StatEventSpec, value?: number) => {
    // A team action (kabaddi's all-out, technical point) names nobody.
    const teamAction = ev.perPlayer === false;
    const n = ev.value ? (value ?? 1) : undefined;
    push({
      t: 'point',
      // AN OWN GOAL IS SCORED FOR THE OTHER SIDE. The tap is made on the panel of
      // the team that conceded it, because that is whose player put it in - but the
      // goal belongs to their opponents, and `side` is who the score goes to. The
      // player rides along and is filed back on their own side by the stat fold.
      side: ev.forOpponent ? (side === 'A' ? 'B' : 'A') : side,
      // A raid's points ARE its value: a 3-point raid puts 3 on the board.
      pts: ev.scoresValue && n ? n : ev.points && ev.points > 0 ? ev.points : 0,
      kind: ev.key,
      label: ev.scoresValue && n ? `${ev.label} +${n}` : ev.label,
      ...(actor && !teamAction ? { playerId: actor, playerName: nameFor(actor) } : {}),
      ...(ev.secondPlayer && second && second !== UNSURE && !teamAction ? { secondId: second, secondName: nameFor(second) } : {}),
      ...(n !== undefined ? { value: n } : {}),
      // Scored in a do-or-die: the raider's do-or-die wins key on this.
      ...(kabNow?.doOrDie && (ev.key === 'raid' || ev.key === 'bonus_raid') ? { flags: ['dod'] } : {}),
    });
    // A substitute credited with something has come on - ask who they replaced.
    // A chaser or raider is on the other team, so their swap is asked for that side.
    const secondSide = ev.secondPlayer?.fromOpponent ? otherOf(side) : side;
    const fromBench = [
      ...(actor && !teamAction && isSub(actor) ? [{ side, id: actor }] : []),
      ...(ev.secondPlayer && second && second !== UNSURE && !teamAction && secondSubs.some((x) => x.id === second)
        ? [{ side: secondSide, id: second }] : []),
    ];
    if (fromBench.length && p.onSubstitute) setCameOn(fromBench);
    // The assist is per goal; the scorer usually is not, so only the second clears.
    // A Kho Kho out is different: that defender has left the field, so start over.
    setSecond('');
    if (needsSecond(ev)) setActor('');
  };

  /** Answer "who went off for them?" - or nobody, for a card shown on the bench. */
  const settleSub = (offId: string | null) => {
    const [next, ...rest] = cameOn;
    if (next && offId) p.onSubstitute?.(next.side, next.id, offId);
    setCameOn(rest);
    setSubsOpen(false);
    setSecondSubsOpen(false);
  };

  /**
   * WHAT THE PERIOD IN PROGRESS IS CALLED.
   *
   * Extra time is played through the same period machinery, so without this the
   * board would carry on counting "Half 3 of 2" - which is not a thing, and is
   * exactly the sort of nonsense an official stops trusting a console over.
   */
  const inExtra = progress.phase === 'extraTime';
  const extraSpec = format.tieBreak?.extraTime;
  // Basketball overtime repeats while level, so it has no "of N" - each one may be the last.
  const repeatingExtra = inExtra && !!extraSpec?.repeat;
  const periodName = inExtra ? (extraSpec?.label ?? 'Extra time') : lv.label;
  const periodNo = inExtra ? progress.extraPlayed + 1 : Math.min(played + 1, totalPeriods);
  const periodOf = repeatingExtra ? periodNo : inExtra ? progress.extraTotal : totalPeriods;

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
        : level && repeatingExtra
          ? `Still ${shown[0]}–${shown[1]}. Another ${periodName.toLowerCase()} of ${extraSpec!.minutes} minutes is played.`
          : level && inExtra && format.tieBreak?.penalties
          ? `Still ${shown[0]}–${shown[1]} after extra time. This goes to a penalty shoot-out.`
          : level && !inExtra && format.tieBreak?.extraTime
            ? `Level at ${shown[0]}–${shown[1]}. This goes to ${(extraSpec?.label ?? 'extra time').toLowerCase()}${extraSpec?.repeat ? ` (${extraSpec.minutes} min, repeated until someone leads)` : ''}.`
            : level && format.tieBreak?.universalPoint
              ? `Level at ${shown[0]}-${shown[1]}. Universal point: the next goal wins the match.`
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
          <ScoreSide name={p.homeName} org={p.homeOrg} score={shown[0]} side="home" serving={serving === 'A'} />

          <div className="flex flex-col items-center gap-1">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-on-brand">
              {progress.phase === 'penalties'
                ? 'Penalties'
                : progress.phase === 'minimumChase' ? 'Minimum chase'
                : progress.phase === 'universalPoint' ? 'Universal point'
                : progress.phase === 'goldenRaid' ? 'Golden raid'
                : aggregate ? (repeatingExtra ? `${periodName} ${periodNo}` : `${periodName} ${periodNo} of ${periodOf}`) : lv.label}
            </div>

            {/* THE CLOCK. Tapping the reading opens the correction panel - an
                official who has just noticed the clock is two minutes fast should
                not have to go hunting for where to fix it. */}
            {/* No clock in a shoot-out - kicks are not timed, and a running clock
                with a KICK OFF button under it invites an official to start one. */}
            {clockPeriods && !state.ended && progress.phase !== 'penalties' && progress.phase !== 'minimumChase'
              && progress.phase !== 'universalPoint' && progress.phase !== 'goldenRaid' && !khoNow?.wonByInnings ? (
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
                  {clock.running ? 'Stop' : clock.started ? 'Start' : kho ? 'Start turn'
                    : kab || canonicalTeamSport(format.sport) === 'frisbee' ? 'Start half'
                    : canonicalTeamSport(format.sport) === 'hockey' ? `Start ${periodName.toLowerCase()}` : 'Kick off'}
                </button>
              </>
            ) : (
              <div className="font-mono text-[10px] uppercase tracking-wider text-on-brand">
                {progress.phase === 'universalPoint' ? 'Next goal wins'
                  : progress.phase === 'goldenRaid' ? 'First point wins'
                  : progress.phase === 'penalties' || progress.phase === 'minimumChase' ? 'Level' : aggregate ? 'Total' : lv.label}
              </div>
            )}
            {!aggregate && maxUnits > 1 && (
              <div data-qa="units-won" className="font-mono text-[11px] font-bold tabular-nums text-white">
                {lv.label}s {env.unitsFor[0]}–{env.unitsFor[1]}
              </div>
            )}
          </div>

          <ScoreSide name={p.awayName} org={p.awayOrg} score={shown[1]} side="away" align="right" serving={serving === 'B'} />
        </div>

        {/* The strip: what has been booked, and how each period finished. */}
        {/* Three columns rather than space-between, so the period boxes stay on the
            centre line whether or not either side has been booked. */}
        <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/15 pt-1.5">
          <Discipline counts={cards.A} />
          <div className="flex min-w-0 items-center justify-center gap-1 overflow-x-auto">
            {Array.from({ length: maxUnits }, (_, i) => {
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

        {/* Hockey: penalty corners won, and scored from, per side. */}
        {corners && (corners.A.won > 0 || corners.B.won > 0) && (
          <div data-qa="penalty-corners" className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[10px] tabular-nums text-white">
            <span>{corners.A.won}{corners.A.scored ? ` (${corners.A.scored} scored)` : ''}</span>
            <span className="text-[8px] font-bold uppercase tracking-wide text-on-brand">Penalty corners</span>
            <span className="text-right">{corners.B.won}{corners.B.scored ? ` (${corners.B.scored} scored)` : ''}</span>
          </div>
        )}

        {format.officiatingMode === 'selfScored' && (
          <div className="mt-1 text-center text-[9px] font-semibold uppercase tracking-wide text-amber-300">
            Self-scored
          </div>
        )}
      </div>

      {/* At 0-0 of any set the server can be set: the toss, or FIVB's alternation. */}
      {serving && state.score[0][0] === 0 && state.score[0][1] === 0 && (
        <div data-qa="serve-picker" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 text-[11px]">
          <span className="mr-auto font-semibold text-muted">
            {noRallyYet ? 'Who serves first?' : `Who serves first in ${lv.label.toLowerCase()} ${played + 1}?`}
          </span>
          {(['A', 'B'] as Side[]).map((s) => (
            <Button key={s} size="sm" variant={serving === s ? 'primary' : 'outline'} className="h-6 max-w-[40%] truncate px-2 text-[11px]"
              disabled={p.disabled || p.busy}
              onClick={() => { if (serving !== s) push({ t: 'setServe', side: s, reason: 'toss' }); }}>
              {nameOf(s)}
            </Button>
          ))}
        </div>
      )}

      {/* Kho kho: the toss decides who chases first. Changeable until the first out. */}
      {tossOpen && (
        <div data-qa="kho-toss" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 text-[11px]">
          <span className="mr-auto font-semibold text-muted">Who chases first? (the toss)</span>
          {(['A', 'B'] as Side[]).map((s) => (
            <Button key={s} size="sm" variant={khoNow?.firstChaser === s ? 'primary' : 'outline'} className="h-6 max-w-[40%] truncate px-2 text-[11px]"
              disabled={p.disabled || p.busy}
              onClick={() => { if (khoNow?.firstChaser !== s) push({ t: 'chaseFirst', side: s }); }}>
              {nameOf(s)}
            </Button>
          ))}
        </div>
      )}

      {/* Kabaddi: the toss decides who raids first. Changeable until the first raid ends. */}
      {raidTossOpen && (
        <div data-qa="kab-toss" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 text-[11px]">
          <span className="mr-auto font-semibold text-muted">Who raids first? (the toss)</span>
          {(['A', 'B'] as Side[]).map((s) => (
            <Button key={s} size="sm" variant={kabNow?.firstRaider === s ? 'primary' : 'outline'} className="h-6 max-w-[40%] truncate px-2 text-[11px]"
              disabled={p.disabled || p.busy}
              onClick={() => { if (kabNow?.firstRaider !== s) push({ t: 'raidFirst', side: s }); }}>
              {nameOf(s)}
            </Button>
          ))}
        </div>
      )}

      {/* Whose raid, and the do-or-die. Switch is for the official's correction. */}
      {kabNow?.raider && !raidTossOpen && (
        <div data-qa="kab-raid" role="status"
          className={cn('flex shrink-0 items-center gap-2 rounded-lg px-3 py-1 text-[12px] font-semibold',
            kabNow.doOrDie
              ? 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300'
              : 'border border-line text-slate-700 dark:text-slate-200')}>
          <span className="mr-auto truncate">
            {kabNow.goldenStarted
              ? `Golden raid ${Math.min(kabNow.goldenRaids + 1, GOLDEN_RAIDS)} of ${GOLDEN_RAIDS}: ${nameOf(kabNow.raider)} raiding · the first point wins`
              : kabNow.doOrDie
              ? `Do-or-die raid: ${nameOf(kabNow.raider)} must score, or the raider is out`
              : `${nameOf(kabNow.raider)} raiding${kabNow.emptyStreak ? ` · ${kabNow.emptyStreak} empty in a row` : ''}`}
          </span>
          <Button size="sm" variant="subtle" className="h-6 px-2 text-[11px]" disabled={p.disabled || p.busy}
            onClick={() => push({ t: 'raidTurn', side: otherOf(kabNow.raider!) })}>
            Switch
          </Button>
        </div>
      )}

      {/* Hockey: players serving a card suspension, counting down in match time. */}
      {suspended.length > 0 && (
        <div data-qa="suspensions" role="status"
          className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px]">
          <span className="font-semibold uppercase tracking-wide text-muted">Off</span>
          {suspended.map((s) => (
            <span key={s.playerId} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
              s.card === 'green' ? 'bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300'
                : s.card === 'yellow' ? 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300'
                : 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300')}>
              <span className="max-w-[9rem] truncate">{s.playerName ?? nameFor(s.playerId) ?? 'Player'}</span>
              <span className="text-[10px] opacity-75">{nameOf(s.side)}</span>
              <span className="font-mono tabular-nums">{s.remainingMs === Infinity ? 'sent off' : formatClock(s.remainingMs)}</span>
            </span>
          ))}
        </div>
      )}

      {khoNow?.followOnOffer && !followOnDismissed && (
        <div data-qa="kho-follow-on" role="status"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          <span className="mr-auto">
            {nameOf(khoNow.followOnOffer.leader)} lead by {khoNow.followOnOffer.lead} after the first innings - follow-on?
          </span>
          <Button size="sm" className="h-7" disabled={p.disabled || p.busy}
            onClick={() => push({ t: 'followOn', side: khoNow.followOnOffer!.leader })}>
            {nameOf(otherOf(khoNow.followOnOffer.leader))} chase again
          </Button>
          <Button size="sm" variant="subtle" className="h-7" onClick={() => setFollowOnDismissed(true)}>No follow-on</Button>
        </div>
      )}

      {showSwitch && (
        <div data-qa="change-ends" role="status"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          <span className="mr-auto">{switchText}</span>
          <Button size="sm" variant="subtle" className="h-7" onClick={() => setSwitchDismissed(playIdx)}>Dismiss</Button>
        </div>
      )}

      {/* ── The working region: everything swaps HERE ────────────────────── */}
      <div data-qa="team-region" className="relative min-h-0 flex-1">
        {/* A substitute was just credited: who did they replace? Answered before the next tap. */}
        {cameOn.length > 0 ? (
          <Card className={cn(SURFACE, 'gap-2 p-2.5')} data-qa="sub-swap">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Who went off for {nameFor(cameOn[0].id) ?? 'the substitute'}?
            </div>
            <p className="text-[11px] text-muted">They move to the substitutes; {nameFor(cameOn[0].id) ?? 'the substitute'} joins the players on the field.</p>
            <div className="min-h-0 shrink overflow-y-auto">
              <PeopleGrid
                value="" qa="sub-off"
                options={(p.roster?.[cameOn[0].side] ?? []).map((x) => [x.id, x.name] as [string, string])}
                cards={playerCards}
                onChange={(v) => settleSub(v)}
              />
            </div>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => settleSub(null)}>
              Still on the bench (a card from the bench)
            </Button>
          </Card>
        ) : /* The log first: after full time it is how the result gets checked before
            confirming. With the result card first, Log did nothing once a match ended. */
        surface === 'log' ? (
          <Timeline log={log} nameOf={nameOf} nameFor={nameFor} fullMs={fullMs}
            onClose={() => setSurface('act')} />
        ) : state.ended ? (
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
            {state.reason === 'penalties' ? (
              // Two labelled lines, so the match score and the kicks can't be mixed up.
              <div className="grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="text-right text-muted">Match</span>
                <span className="font-semibold tabular-nums">{env.headline[0]}–{env.headline[1]}</span>
                <span className="text-right text-muted">Penalties</span>
                <span className="font-semibold tabular-nums">{shoot.scored[0]}–{shoot.scored[1]}</span>
              </div>
            ) : (
              <p className="text-center text-sm text-muted">
                {env.headline[0]}–{env.headline[1]}
                {state.reason && state.reason !== 'normal'
                  ? ` · ${KHO_END_LABEL[state.reason as keyof typeof KHO_END_LABEL] ?? state.reason}` : ''}
              </p>
            )}
            {/* Kho kho's record per turn - what organisers work time-based rankings out from. */}
            {kho && <KhoTurns lines={khoTurnLines(format, log, state)} nameOf={nameOf} minChase={minChase} />}
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
            {/* Hidden once locked: undo can no longer do anything. shrink-0, or the
                flex card squeezes it thinner than its own text. */}
            {!p.disabled && (
              <Button variant="outline" className="h-10 shrink-0 gap-1.5 self-center px-5" data-qa="team-undo-final"
                disabled={!log.length || p.busy} onClick={undo}>
                <Undo2 className="h-4 w-4" /> Undo the last action
              </Button>
            )}
          </Card>
        ) : khoNow?.wonByInnings ? (
          // The follow-on side is still behind after chasing twice: the leader does
          // not need its second chase. Signed off like a shoot-out, through the host.
          <Card className={cn(SURFACE, 'items-center justify-center gap-3 p-4')} data-qa="kho-innings">
            <p className="text-center text-lg font-semibold">{nameOf(khoNow.wonByInnings)} win by an innings</p>
            <p className="text-center text-sm text-muted">
              {shown[0]}–{shown[1]} · {nameOf(otherOf(khoNow.wonByInnings))} are still behind after the follow-on.
            </p>
            <Button size="lg" data-qa="kho-innings-confirm" disabled={p.disabled || p.busy}
              onClick={() => {
                const next = [...log, { ...inningsEnd(khoNow.wonByInnings!), at: new Date().toISOString() }];
                p.onSignOff(next, foldRally(format, next, 'A').state);
              }}>
              {p.busy ? 'Saving…' : 'Confirm result'}
            </Button>
            {!p.disabled && (
              <Button variant="outline" className="h-10 shrink-0 gap-1.5 self-center px-5"
                disabled={!log.length || p.busy} onClick={undo}>
                <Undo2 className="h-4 w-4" /> Undo the last action
              </Button>
            )}
          </Card>
        ) : progress.phase === 'goldenRaid' && kabNow && (!kabNow.goldenStarted || kabNow.goldenTossDue) ? (
          <GoldenRaidToss
            nameOf={nameOf} busy={!!p.disabled || !!p.busy} score={shown} final={kabNow.goldenTossDue}
            onToss={(s) => push({ t: 'goldenRaid', side: s })}
            onUndo={undo}
            // Sign-off, as the shoot-out does: the toss decides the match.
            onSettle={(winner) => {
              const next = [...log, { ...goldenTossEnd(winner), at: new Date().toISOString() }];
              p.onSignOff(next, foldRally(format, next, 'A').state);
            }}
          />
        ) : progress.phase === 'minimumChase' && minChase ? (
          <MinimumChase
            mc={minChase} nameOf={nameOf} busy={!!p.disabled || !!p.busy} score={shown}
            onRecord={(s, ms) => push({ t: 'minChase', side: s, ms })}
            onUndo={undo}
            onSettle={(winner) => {
              const next = [...log, { ...minChaseEnd(winner), at: new Date().toISOString() }];
              p.onSignOff(next, foldRally(format, next, 'A').state);
            }}
          />
        ) : progress.phase === 'penalties' ? (
          <Shootout
            shoot={shoot} nameOf={nameOf} kicksEach={format.tieBreak?.penalties?.kicks ?? 5} terms={shootoutTerms(format.sport)}
            busy={!!p.disabled || !!p.busy} score={shown} roster={p.roster}
            onKick={(side, scored, kicker) => push({
              t: 'penaltyKick', side, scored,
              ...(kicker ? { playerId: kicker.id, playerName: kicker.name } : {}),
            })}
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
            format={format} state={state} nameOf={nameOf} shown={shown} played={played}
            totalPeriods={totalPeriods} bestOf={maxUnits !== totalPeriods ? maxUnits : undefined}
            periodLabel={lv.label} finishing={finishing} knockout={p.knockout}
            onFinishing={setFinishing} onEvent={push} onClose={() => setSurface('act')}
          />
        ) : (
          // Scrolls as a last resort, so a short screen never clips the bottom buttons.
          <Card className={cn(SURFACE, 'gap-2 overflow-y-auto p-2.5')}>
            {/* WHOSE ACTION. Two big tabs, so the next question is about one team. */}
            <div className="grid shrink-0 grid-cols-2 gap-1.5">
              {(['A', 'B'] as Side[]).map((s) => (
                <button key={s} type="button" data-qa={`team-side-${s}`}
                  onClick={() => { setSide(s); setActor(''); setSecond(''); setAssistOpen(false); setSubsOpen(false); setSecondSubsOpen(false); }}
                  className={cn(
                    'min-h-[2.5rem] truncate rounded-lg px-2 text-sm font-semibold transition',
                    side === s
                      ? 'bg-brand-600 text-white'
                      : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                  )}>
                  {nameOf(s)}
                  {roleOf(s) && (
                    <span className="block text-[10px] font-normal uppercase tracking-wide opacity-80">
                      {roleOf(s) === 'attack' ? attackWord : 'defending'}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* GROW-0, SHRINK-1 on the picker below. On a phone there is no slack
                and it scrolls exactly as before; on a laptop the squad no longer
                stretches to fill the deck, which left a hand-sized void between the
                last name chip and the Goal button. The slack is collected by a
                spacer at the BOTTOM of the card instead. */}
            {canAttribute ? (
              // The floor is the "Who" label plus one whole row of chips: below that the
              // names were sliced in half when a banner above took the height.
              // While picking a chaser the box keeps its full height: the folded defender
              // line plus the chaser rows are short, and slicing them made names unreadable.
              <div className={cn('min-h-[3.25rem] grow-0 space-y-1.5 overflow-y-auto',
                secondRequired && actor ? 'shrink-0' : 'shrink')}>
                {/* Once the defender is picked their grid folds into the chaser header
                    below, so the chaser list gets the room instead of a sliver. */}
                {secondRequired && actor ? null : (
                <Group label="Who">
                  <PeopleGrid
                    value={actor} qa={`actor-${side}`}
                    options={players.map((x) => [x.id, x.name] as [string, string])}
                    cards={playerCards} foulLimit={foulLimit}
                    onChange={(v) => { setActor(v); if (v === second) setSecond(''); setAssistOpen(false); }}
                  />
                  {subs.length > 0 && (
                    <div className="mt-1.5">
                      <button type="button" data-qa={`subs-toggle-${side}`}
                        onClick={() => setSubsOpen((v) => !v)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300">
                        {subsOpen ? 'Hide subs' : `Select from subs (${subs.length})`}
                        <ChevronDown className={cn('h-3.5 w-3.5 transition', subsOpen && 'rotate-180')} />
                      </button>
                      {subsOpen && (
                        <div className="mt-1">
                          <PeopleGrid
                            value={actor} qa={`actor-sub-${side}`}
                            options={subs.map((x) => [x.id, x.name] as [string, string])}
                            cards={playerCards} foulLimit={foulLimit}
                            onChange={(v) => { setActor(v); if (v === second) setSecond(''); setAssistOpen(false); }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {foulLimit > 0 && actorFouls >= foulLimit - 1 && (
                    <p data-qa="foul-out-warning" role="status"
                      className={cn('mt-1 text-[11px] font-semibold',
                        actorFouls >= foulLimit ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                      {actorFouls >= foulLimit
                        ? `Fouled out - ${actorFouls} fouls. They must be substituted.`
                        : `${actorFouls} fouls - one more and they foul out.`}
                    </p>
                  )}
                </Group>
                )}

                {secondRequired && actor ? (
                  <div>
                    <div data-qa={`actor-picked-${side}`} className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted">{secondSpec?.label ?? 'Second player'}</span>
                      <span className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="truncate">
                          <span className="text-muted">Who: </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{nameFor(actor)}</span>
                        </span>
                        <button type="button" data-qa={`actor-change-${side}`}
                          onClick={() => { setActor(''); setSecond(''); }}
                          className="shrink-0 font-semibold text-brand-600 hover:underline dark:text-brand-300">
                          Change
                        </button>
                      </span>
                    </div>
                    <PeopleGrid
                      value={second} qa={`second-${side}`}
                      options={[[UNSURE, 'Not sure'] as [string, string],
                        ...secondPool.map((x) => [x.id, x.name] as [string, string])]}
                      cards={playerCards}
                      onChange={(v) => setSecond(v)}
                    />
                    {/* Same as the defender picker: a chaser off the bench is the rare case. */}
                    {secondSubs.length > 0 && (
                      <div className="mt-1.5">
                        <button type="button" data-qa={`second-subs-toggle-${side}`}
                          onClick={() => setSecondSubsOpen((v) => !v)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300">
                          {secondSubsOpen ? 'Hide subs' : `Select from subs (${secondSubs.length})`}
                          <ChevronDown className={cn('h-3.5 w-3.5 transition', secondSubsOpen && 'rotate-180')} />
                        </button>
                        {secondSubsOpen && (
                          <div className="mt-1">
                            <PeopleGrid
                              value={second} qa={`second-sub-${side}`}
                              options={secondSubs.map((x) => [x.id, x.name] as [string, string])}
                              cards={playerCards}
                              onChange={(v) => setSecond(v)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : wantsSecond && actor && (
                  <div>
                    {/* Shut, this is one line that still SAYS who is credited, so an
                        official can see an assist was recorded without opening it. */}
                    <button type="button" data-qa={`second-toggle-${side}`}
                      onClick={() => setAssistOpen((v) => !v)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border border-line px-2.5 py-1 text-left transition',
                        assistOpen ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white hover:bg-slate-50 dark:bg-slate-800/60 dark:hover:bg-slate-700',
                      )}>
                      <span className="text-[10px] uppercase tracking-wide text-muted">{fromOpponent ? secondSpec?.label : 'Assisted by'}</span>
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
                            ...secondPool.filter((x) => x.id !== actor).map((x) => [x.id, x.name] as [string, string]),
                            // Substitutes last, marked - an assist from someone just on is rare but real.
                            ...secondSubs.filter((x) => x.id !== actor).map((x) => [x.id, `${x.name} (sub)`] as [string, string])]}
                          cards={playerCards}
                          onChange={(v) => { setSecond(v); setAssistOpen(false); }}
                        />
                        <p className="mt-1 text-[10px] text-muted">
                          {fromOpponent ? 'Optional - the chaser who made the out, on the same tap.' : 'Optional - recorded on the same tap as the goal.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="min-h-0 flex-1 text-sm text-muted">
                {players.length === 0
                  ? 'No team sheet for this side, so actions cannot be attributed. The score can still be kept below.'
                  : 'This sport records no individual actions - the result is the record.'}
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
                {/* A raid is worth what it scored: one row, one tap per value. */}
                {valueEvents.map((ev) => (
                  <div key={ev.key} className="flex items-center gap-1" data-qa={`act-${side}-${ev.key}`}>
                    <span className="w-12 shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">{ev.label}</span>
                    <div className="grid min-w-0 flex-1 grid-flow-col gap-1">
                      {Array.from({ length: (ev.value?.max ?? 1) - (ev.value?.min ?? 1) + 1 }, (_, i) => (ev.value?.min ?? 1) + i).map((n) => (
                        <button key={n} type="button" data-qa={`act-${side}-${ev.key}-${n}`}
                          disabled={p.disabled || p.busy || !actor}
                          onClick={() => fire(ev, n)}
                          className={cn('h-10 rounded-lg text-sm font-bold transition active:scale-[0.97] disabled:opacity-40', toneOf(ev))}>
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-1.5">
                  {tapEvents.filter((e) => (e.points ?? 0) > 0).map((ev) => (
                    <button key={ev.key} type="button" data-qa={`act-${side}-${ev.key}`}
                      disabled={p.disabled || p.busy || (!actor && ev.perPlayer !== false) || (needsSecond(ev) && !second)}
                      onClick={() => fire(ev)}
                      className={cn(
                        'flex h-12 min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg px-1 text-center text-sm font-bold leading-tight transition',
                        'active:scale-[0.97] disabled:opacity-40',
                        toneOf(ev),
                      )}>
                      <span className="max-w-full truncate">{ev.label}</span>
                      {/* Full name when it fits the button, the short code when it would overrun. */}
                      {ev.forOpponent && (
                        <FitName prefix="scores for " full={nameOf(side === 'A' ? 'B' : 'A')} short={shortOf(side === 'A' ? 'B' : 'A')}
                          fullBelow belowClassName="mt-0.5 text-[7px]" className="text-[9px] font-normal leading-none opacity-80" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {tapEvents.filter((e) => !(e.points ?? 0)).map((ev) => (
                    <button key={ev.key} type="button" data-qa={`act-${side}-${ev.key}`}
                      disabled={p.disabled || p.busy || (!actor && ev.perPlayer !== false) || (needsSecond(ev) && !second)}
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
            <div className={cn('grid shrink-0 gap-1.5 border-t border-line pt-1.5', chasing ? 'grid-cols-1' : 'grid-cols-2')}>
              {/* Kho kho: only the chasing side can score. */}
              {(chasing ? [chasing] : ['A', 'B'] as Side[]).map((s) => (
                // Full name when it fits, the short code when it would overrun the button.
                <Button key={s} size="sm" variant="outline" data-qa={`team-score-${s}-1`}
                  className="min-w-0 flex-col !gap-0 overflow-hidden py-1"
                  disabled={p.disabled || p.busy}
                  onClick={() => push({ t: 'point', side: s })}>
                  <FitName prefix="+1 " full={nameOf(s)} short={shortOf(s)} fullBelow
                    sub={canAttribute ? 'no player' : undefined} />
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
              disabled={p.disabled || p.busy || progress.phase === 'universalPoint' || progress.phase === 'goldenRaid'} onClick={endPeriod}>
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
          {/* Corrections and early endings - nothing to do once the match is over. Hidden
              in a shoot-out too: that panel always shows, so More could never open. */}
          {!state.ended && progress.phase !== 'penalties' && (
            <Button size="sm" variant="outline"
              className={cn('h-9 shrink-0', surface === 'more' && PANEL_OPEN)}
              onClick={() => setSurface(surface === 'more' ? 'act' : 'more')}>
              More
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- pieces -------------------------------- */

const SURFACE = 'absolute inset-0 flex flex-col overflow-hidden';

/** Events that are not play, so a change-ends prompt reads past them. */
/** The "Not sure" choice for a required second person: records the action, credits nobody. */
const UNSURE = '?';

const PASSIVE: ReadonlySet<string> = new Set(['clockStart', 'clockPause', 'clockAdjust', 'timeout', 'setServe', 'chaseFirst', 'followOn', 'minChase', 'raidFirst', 'raidTurn', 'goldenRaid']);

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
  ownGoal: 'border-2 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/70 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25',
  good: 'border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/20',
  warning: 'bg-green-600 text-white hover:bg-green-700 shadow-sm',
  caution: 'bg-yellow-400 text-yellow-950 hover:bg-yellow-500 shadow-sm dark:bg-yellow-400 dark:text-yellow-950',
  dismissal: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  error: 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
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
          ? `Past ${formatClock(clock.fullMs)} - ${formatClock(clock.stoppageMs)} of added time.`
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
function Shootout({ shoot, nameOf, kicksEach, terms, busy, score, roster, onKick, onUndo, onSettle }: {
  /** Hockey says shoot-out and shooter; football penalties and kicker. */
  terms: ShootoutTerms;
  shoot: ShootoutState;
  nameOf: (s: Side) => string;
  kicksEach: number;
  busy: boolean;
  score: readonly [number, number];
  roster?: { A: Array<{ id: string; name: string }>; B: Array<{ id: string; name: string }> };
  /** `kicker` is optional: an unnamed kick still counts, it just credits nobody. */
  onKick: (side: Side, scored: boolean, kicker?: { id: string; name: string }) => void;
  onUndo: () => void;
  onSettle: (winner: Side) => void;
}) {
  // In sudden death, a level pair still shows the next empty slot - so it never looks over.
  const taken = Math.max(shoot.taken[0], shoot.taken[1]);
  const nextPair = !shoot.decided && shoot.taken[0] === shoot.taken[1] && taken >= kicksEach ? 1 : 0;
  const rounds = Math.max(kicksEach, taken) + nextPair;
  const kicksOf = (side: Side) => shoot.kicks.filter((k) => k.side === side);
  // The kicker is picked per kick; a new kick (or an undo) starts unpicked.
  const squad = roster?.[shoot.next] ?? [];
  const [kickerId, setKickerId] = useState('');
  useEffect(() => setKickerId(''), [shoot.kicks.length]);
  const kick = (scored: boolean) => onKick(shoot.next, scored, squad.find((x) => x.id === kickerId));

  return (
    <Card className={cn(SURFACE, 'gap-3 p-3')} data-qa="shootout">
      <div className="shrink-0 text-center">
        <div className="text-[10px] uppercase tracking-wide text-muted">
          {shoot.suddenDeath ? 'Sudden death' : `${terms.title} · ${kicksEach} ${terms.each}`}
        </div>
        <div className="mt-0.5 font-mono text-3xl font-bold tabular-nums">
          {shoot.scored[0]}–{shoot.scored[1]}
        </div>
        <div className="text-[11px] text-muted">
          match level at {score[0]}–{score[1]}
        </div>
      </div>

      {/* The grid an official actually reads: a row per side, a mark per kick. */}
      {/* Name column as wide as the longer name, shrinking (then "…") only when the
          kick marks would otherwise lose their room. */}
      <div className="grid shrink-0 grid-cols-[minmax(0,auto)_minmax(7.5rem,1fr)] items-center gap-x-3 gap-y-1">
        {(['A', 'B'] as Side[]).map((side) => (
          <Fragment key={side}>
            <span className="truncate text-[11px] font-semibold" title={nameOf(side)}>{nameOf(side)}</span>
            <div className="flex min-w-0 flex-wrap gap-1">
              {Array.from({ length: rounds }, (_, i) => {
                const k = kicksOf(side)[i];
                return (
                  <span key={i} className={cn(
                    'grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold',
                    !k ? 'border border-dashed border-slate-300 text-transparent dark:border-slate-600'
                      : k.scored ? 'bg-emerald-600 text-white'
                        : 'bg-slate-300 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                  )}>
                    {k ? (k.scored ? '✓' : '✗') : '·'}
                  </span>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>

      <div className="min-h-0 flex-1" />

      {shoot.decided && shoot.winner ? (
        <div className="shrink-0 space-y-2">
          <p className="text-center text-sm font-semibold">
            {shootoutLine(shoot, nameOf, terms.title === 'Shoot-out' ? 'hockey' : null)}
          </p>
          <Button className="w-full" variant="primary" data-qa="shootout-settle"
            disabled={busy} onClick={() => onSettle(shoot.winner as Side)}>
            Record the result
          </Button>
          <Button className="w-full" size="sm" variant="outline" disabled={busy} onClick={onUndo}>
            Undo the last {terms.attempt}
          </Button>
        </div>
      ) : (
        <div className="shrink-0 space-y-2">
          <div className="text-center text-[11px] text-muted">
            Next: <span className="font-semibold text-slate-700 dark:text-slate-200">{nameOf(shoot.next)}</span>
          </div>
          {squad.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted">{terms.taker} (optional)</div>
              <PeopleGrid qa="shootout-kicker" value={kickerId}
                options={[['', 'Not named'], ...squad.map((x): [string, string] => [x.id, x.name])]}
                onChange={setKickerId} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12 text-sm font-bold" variant="primary" data-qa="shootout-scored"
              disabled={busy} onClick={() => kick(true)}>
              Scored
            </Button>
            <Button className="h-12 text-sm font-bold" variant="outline" data-qa="shootout-missed"
              disabled={busy} onClick={() => kick(false)}>
              Missed
            </Button>
          </div>
          <Button className="w-full" size="sm" variant="outline"
            disabled={busy || !shoot.kicks.length} onClick={onUndo}>
            Undo the last {terms.attempt}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Kho kho's minimum chase: each side chases once more, the faster first out wins.
 * The referee times it on a stopwatch; the scorer types the time. Repeats while level.
 */
/**
 * Kabaddi golden raid tosses: the fresh toss for who raids first, then - when both
 * golden raids were empty - the toss that decides the match. The raids themselves are
 * tapped on the usual buttons; the first point wins.
 */
function GoldenRaidToss({ nameOf, busy, score, final, onToss, onUndo, onSettle }: {
  nameOf: (s: Side) => string;
  busy: boolean;
  score: readonly [number, number] | number[];
  /** Both golden raids were empty: this toss decides the match. */
  final: boolean;
  onToss: (side: Side) => void;
  onUndo: () => void;
  onSettle: (winner: Side) => void;
}) {
  const settle = async (s: Side) => {
    const ok = await confirmDialog({
      title: `${nameOf(s)} won the toss?`,
      confirmLabel: 'Record result',
      message: `Still ${score[0]}-${score[1]} after both golden raids. ${nameOf(s)} win the match on the toss.`,
    });
    if (ok) onSettle(s);
  };
  return (
    <Card data-qa="kab-golden-raid" className={cn(SURFACE, 'gap-3 p-3')}>
      <div>
        <h3 className="text-sm font-semibold">{final ? 'Still level after both golden raids' : `Level ${score[0]}-${score[1]} after extra time: golden raid`}</h3>
        <p className="mt-1 text-xs text-muted">
          {final
            ? 'A toss decides the match. Pick the team that won it.'
            : 'Fresh toss: the winner raids first. Baulk line counts as the bonus line. The first point wins; an empty raid passes the golden raid to the other team.'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['A', 'B'] as Side[]).map((s) => (
          <Button key={s} variant="outline" className="h-12 truncate" disabled={busy}
            onClick={() => (final ? void settle(s) : onToss(s))}>
            {final ? `${nameOf(s)} won the toss` : `${nameOf(s)} raid first`}
          </Button>
        ))}
      </div>
      <Button variant="subtle" size="sm" className="self-start" disabled={busy} onClick={onUndo}>
        <Undo2 className="mr-1 h-4 w-4" /> Undo the last action
      </Button>
    </Card>
  );
}

function MinimumChase({ mc, nameOf, busy, score, onRecord, onUndo, onSettle }: {
  mc: MinChaseState;
  nameOf: (s: Side) => string;
  busy: boolean;
  score: readonly [number, number];
  onRecord: (side: Side, ms: number | null) => void;
  onUndo: () => void;
  onSettle: (winner: Side) => void;
}) {
  const [text, setText] = useState('');
  const ms = parseChaseTime(text);
  const recorded = mc.rounds.some((r) => r.A !== undefined || r.B !== undefined);
  // An optional stopwatch on the console; the referee's own watch can be typed in instead.
  // Local only: a reload loses a running chase, so the typed time stays the fallback.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const elapsed = startedAt == null ? 0 : Math.max(0, now - startedAt);
  const overLimit = mc.limitMs != null && elapsed >= mc.limitMs;

  const record = (value: number | null) => { onRecord(mc.next, value); setText(''); setStartedAt(null); };
  const timeOf = (v: number | null | undefined) => (v === undefined ? '-' : formatChaseTime(v));

  const round = mc.rounds[mc.rounds.length - 1];
  // The round on show: the open one, or a fresh one when the last round was tied.
  const current = round && !(mc.winner == null && round.A !== undefined && round.B !== undefined) ? round : {};
  const roundNo = mc.rounds.length + (round && current !== round ? 1 : 0) || 1;
  const earlier = mc.rounds.slice(0, current === round ? -1 : undefined);
  const beat = mc.limitMs != null ? mc.limitMs - MIN_CHASE_GRACE_MS : null;

  const tile = (s: Side) => {
    const t = current[s];
    const chasing = !mc.winner && mc.next === s;
    const won = mc.winner === s;
    return (
      <div key={s} data-qa={`kho-min-chase-tile-${s}`}
        className={cn('rounded-xl border p-3 text-center transition',
          won ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400/60 dark:bg-emerald-500/10'
            : chasing ? 'border-brand-500 bg-brand-50 dark:border-brand-400/60 dark:bg-brand-500/10'
            : 'border-line')}>
        <div className="truncate text-sm font-semibold">{nameOf(s)}</div>
        <div className={cn('mt-1 font-mono text-2xl font-bold tabular-nums',
          t === undefined && 'text-muted', t === null && 'text-base text-red-600 dark:text-red-400')}>
          {t === undefined ? '-:--.-' : formatChaseTime(t)}
        </div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
          {won ? <span className="text-emerald-600 dark:text-emerald-400">Winner</span>
            : chasing ? <span className="text-brand-600 dark:text-brand-300">Chasing now</span>
            : t === undefined ? <span className="text-muted">Waiting</span>
            : <span className="text-muted">Done</span>}
        </div>
      </div>
    );
  };

  return (
    <Card className={cn(SURFACE, 'gap-3 overflow-y-auto p-3')} data-qa="kho-min-chase">
      <div className="shrink-0 text-center">
        <div className="text-sm font-bold uppercase tracking-wide">Minimum chase{roundNo > 1 ? ` · Round ${roundNo}` : ''}</div>
        <div className="text-xs text-muted">Level at {score[0]}–{score[1]}. Each side chases once - the fastest first out wins.</div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2">{(['A', 'B'] as Side[]).map(tile)}</div>

      {earlier.length > 0 && (
        <div className="shrink-0 space-y-0.5 text-center text-[11px] text-muted">
          {earlier.map((r, i) => (
            <div key={i}>Round {i + 1}: {timeOf(r.A)} vs {timeOf(r.B)} - level, chased again</div>
          ))}
        </div>
      )}

      {mc.winner ? (
        <div className="shrink-0 space-y-2">
          <p className="text-center text-sm">
            <span className="font-semibold">{nameOf(mc.winner)}</span> win on minimum chase
          </p>
          <Button className="h-11 w-full font-bold" data-qa="kho-min-chase-settle" disabled={busy} onClick={() => onSettle(mc.winner as Side)}>
            Record the result
          </Button>
          <Button className="h-10 w-full gap-1.5" variant="outline" disabled={busy} onClick={onUndo}>
            <Undo2 className="h-4 w-4" /> Undo the last time
          </Button>
        </div>
      ) : (
        <div className="shrink-0 space-y-3">
          <div className="text-center text-sm">
            <span className="font-semibold">{nameOf(mc.next)}</span> chasing
            {beat != null && (
              <span className="block text-xs text-muted">
                Time to beat <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{formatChaseTime(beat)}</span>
                {' '}· stop at {formatChaseTime(mc.limitMs)} if there is no out
              </span>
            )}
          </div>

          {/* Stopwatch */}
          <div className="rounded-xl border border-line p-3">
            <div className={cn('text-center font-mono text-4xl font-bold tabular-nums',
              overLimit ? 'text-red-600 dark:text-red-400' : startedAt == null && 'text-muted')}>
              {formatChaseTime(elapsed)}
            </div>
            {overLimit && <p className="text-center text-xs font-semibold text-red-600 dark:text-red-400">Time up - stop the chase</p>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {startedAt == null ? (
                <Button className="col-span-2 h-11 font-bold" data-qa="kho-min-chase-start" disabled={busy}
                  onClick={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
                  Start chase
                </Button>
              ) : (
                <>
                  <Button className="h-11 font-bold" data-qa="kho-min-chase-out" disabled={busy}
                    onClick={() => record(Date.now() - startedAt)}>
                    First out
                  </Button>
                  <Button className="h-11" variant="outline" disabled={busy} onClick={() => setStartedAt(null)}>
                    Reset
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Or the referee's time, typed */}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Or type the referee's time</div>
            <div className="flex gap-2">
              <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter' && ms != null && !busy) record(ms); }}
                placeholder="e.g. 1:23.4 or 83" data-qa="kho-min-chase-time" className="flex-1" />
              <Button className="h-10 shrink-0 px-4" variant="outline" disabled={busy || ms == null} onClick={() => record(ms)}>
                Record
              </Button>
            </div>
            {text.trim() !== '' && (
              <p className={cn('mt-1 text-[11px]', ms == null ? 'text-red-600 dark:text-red-400' : 'text-muted')}>
                {ms == null ? 'Not a time - use minutes:seconds (1:23.4) or seconds (83).' : `Reads as ${formatChaseTime(ms)}`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button className="h-10" variant="outline" disabled={busy} onClick={() => record(null)}>No out (stopped)</Button>
            <Button className="h-10 gap-1.5" variant="outline" disabled={busy || !recorded} onClick={onUndo}>
              <Undo2 className="h-4 w-4" /> Undo last time
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Each kho kho turn as the score sheet lists it: who chased, points, time used. */
function KhoTurns({ lines, nameOf, minChase }: {
  lines: ReturnType<typeof khoTurnLines>;
  nameOf: (s: Side) => string;
  minChase: MinChaseState | null;
}) {
  if (!lines.length) return null;
  return (
    <div className="w-full max-w-sm text-xs" data-qa="kho-turns">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Turns</div>
      {lines.map((l) => (
        <div key={l.turn} className="flex items-baseline justify-between gap-2 border-b border-line py-0.5 last:border-0">
          <span className="text-muted">Turn {l.turn}</span>
          <span className="min-w-0 flex-1 truncate">{l.chaser ? `${nameOf(l.chaser)} chased` : 'Turn'}</span>
          <span className="font-mono tabular-nums">{l.points} pts</span>
          <span className="w-12 text-right font-mono tabular-nums text-muted">{l.ms != null ? formatClock(l.ms) : '-'}</span>
        </div>
      ))}
      {minChase && minChase.rounds.length > 0 && minChase.rounds.map((r, i) => (
        <div key={`mc${i}`} className="flex items-baseline justify-between gap-2 py-0.5 text-muted">
          <span>Min. chase {i + 1}</span>
          <span className="font-mono tabular-nums">{formatChaseTime(r.A)} / {formatChaseTime(r.B)}</span>
        </div>
      ))}
    </div>
  );
}

/** One side of the board: who they are, and their number. */
function ScoreSide({ name, org, score, side, align = 'left', serving = false }: {
  serving?: boolean;
  name: string; org?: string | null; score: number; side: 'home' | 'away'; align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className={cn('flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {serving && <span data-qa="serving-dot" title="Serving" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />}
        <span className="truncate text-[13px] font-bold leading-tight text-white">{name}</span>
      </div>
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
/** Cards per side or player: green (hockey), yellow or foul, red. */
type CardCounts = { warning: number; caution: number; dismissal: number };

function Discipline({ counts, align = 'left' }: {
  counts: CardCounts; align?: 'left' | 'right';
}) {
  if (!counts.warning && !counts.caution && !counts.dismissal) return <div aria-hidden />;
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5',
      align === 'right' ? 'justify-end' : 'justify-start')}>
      {counts.warning > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="h-3 w-2 rounded-[1px] bg-green-500" />
          <span className="font-mono text-[11px] font-bold tabular-nums text-white">{counts.warning}</span>
        </span>
      )}
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
  // A trailing tag like "(sub)" is not a surname: set it aside, shorten, put it back.
  const tagOf = (n: string) => / \([^)]*\)$/.exec(n)?.[0] ?? '';
  const tags = names.map((n) => tagOf(n.trim()));
  const full = names.map((n, i) => n.trim().slice(0, n.trim().length - tags[i].length));

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

  return full.map((n, i) => {
    if (n.length + tags[i].length <= NAME_BUDGET) return n + tags[i];
    const sn = surname(n);
    if ((seen.get(sn.toLowerCase()) ?? 0) < 2) return sn + tags[i];
    const first = n.split(/\s+/)[0] ?? '';
    return (first ? `${first[0]}. ${sn}` : sn) + tags[i];
  });
}

/**
 * HOW BIG THE NAME IS PRINTED, from how long it is.
 *
 * Three chips across a 390px phone leaves about seven ems at 12px, and every squad
 * has somebody who does not fit: `truncate` then cut "Shaurya Sharma" to "Shaurya
 * Sha…", which is the half of the name that distinguishes nobody. Dropping a step
 * or two of type is a far smaller cost than losing the surname, and at 9px a chip
 * is still a tap target with a readable label - it is read at arm's length, once,
 * to check the right person is selected.
 *
 * Stepped rather than measured on purpose. Measuring means a layout read per chip,
 * and this grid re-renders on every single tap of a live match; the budget is the
 * chip's own width, which is known, so the steps are just that division done once.
 *
 * `extra` is the room the card pips take when a player has been booked - counted in
 * characters, because it comes out of the same line the name is on.
 */
function chipFont(label: string, extra: number): string {
  const n = label.length + extra;
  if (n <= 9) return 'text-xs';
  if (n <= 12) return 'text-[11px]';
  if (n <= 15) return 'text-[10px]';
  return 'text-[9px]';
}

/**
 * The cards a player is carrying, on their own chip.
 *
 * Small, because it must not cost the name more width than it has to, and to the
 * RIGHT of the name rather than over it - a badge floated on the corner of a 32px
 * pill either clips or overlaps the chip above. The count is printed only from two
 * upwards: "1" next to a single yellow is noise on a grid of sixteen, and one card
 * is what a bare pip already means.
 */
function CardPips({ counts, on }: { counts: CardCounts; on: boolean }) {
  const pip = (n: number, cls: string, label: string) => n > 0 && (
    <span className="flex items-center gap-px" title={`${n} ${label}${n > 1 ? 's' : ''}`}>
      <span className={cn('h-2.5 w-[6px] rounded-[1px] shadow-sm', cls)} />
      {n > 1 && (
        <span className={cn('font-mono text-[9px] font-bold leading-none tabular-nums',
          on ? 'text-white' : 'text-slate-500 dark:text-slate-400')}>{n}</span>
      )}
    </span>
  );
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
      {pip(counts.warning, 'bg-green-500', 'green card')}
      {pip(counts.caution, 'bg-yellow-400', 'caution')}
      {pip(counts.dismissal, 'bg-red-500', 'dismissal')}
    </span>
  );
}

function PeopleGrid({ value, options, onChange, qa, cards, foulLimit = 0 }: {
  value: string; options: Array<[string, string]>; onChange: (v: string) => void; qa?: string;
  /** Cards booked per player id, so a chip can say who is already on a yellow. */
  cards?: Map<string, CardCounts>;
  /** Fouls that put a player out (basketball); 0 when the sport has no foul-out. */
  foulLimit?: number;
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
        const shown = v === '' ? label : labels[i];
        const booked = v ? cards?.get(v) : undefined;
        const marks = booked && (booked.warning || booked.caution || booked.dismissal) ? booked : null;
        // Each pip is about two characters of the line, and a count is one more.
        const extra = marks
          ? (marks.warning ? 2 + (marks.warning > 1 ? 1 : 0) : 0)
            + (marks.caution ? 2 + (marks.caution > 1 ? 1 : 0) : 0)
            + (marks.dismissal ? 2 + (marks.dismissal > 1 ? 1 : 0) : 0)
          : 0;
        const fouledOut = foulLimit > 0 && (marks?.caution ?? 0) >= foulLimit;
        const onLastFoul = foulLimit > 0 && !fouledOut && (marks?.caution ?? 0) === foulLimit - 1;
        return (
          <button key={v || '_none'} type="button" data-qa-value={v}
            data-fouled-out={fouledOut || undefined}
            // The tooltip is the only place the name is guaranteed whole, so it now
            // carries the booking too rather than just repeating the label.
            title={fouledOut ? `${label} - fouled out (${marks!.caution} fouls)`
              : marks
              ? `${label} - ${[marks.warning && `${marks.warning} green card${marks.warning > 1 ? 's' : ''}`,
                  marks.caution && `${marks.caution} ${foulLimit ? 'foul' : 'caution'}${marks.caution > 1 ? 's' : ''}`,
                  marks.dismissal && `${marks.dismissal} dismissal${marks.dismissal > 1 ? 's' : ''}`]
                  .filter(Boolean).join(', ')}${onLastFoul ? ', one from fouling out' : ''}`
              : label}
            onClick={() => onChange(v)}
            className={cn(
              'flex h-8 items-center justify-center gap-1 overflow-hidden rounded-full px-2 text-center font-semibold transition active:scale-[0.97]',
              chipFont(shown, extra),
              on
                ? 'bg-brand-600 text-white shadow-sm'
                : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
              // A sending-off is not a footnote on the chip - the player is off, and
              // an official about to attribute a goal to them should see it first.
              (!!marks?.dismissal || fouledOut) && !on && 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10',
              onLastFoul && !on && 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10',
            )}>
            <span className="truncate">{shown}</span>
            {marks && <CardPips counts={marks} on={on} />}
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
  // Shoot-out kicks scored up to and including each entry.
  const tally: Array<[number, number]> = [];
  log.reduce<[number, number]>((acc, ev, i) => {
    const next: [number, number] = ev.t === 'penaltyKick' && ev.scored
      ? (ev.side === 'A' ? [acc[0] + 1, acc[1]] : [acc[0], acc[1] + 1]) : acc;
    tally[i] = next;
    return next;
  }, [0, 0]);
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
                  <span className="font-semibold">- end of the period -</span>
                ) : ev.t === 'point' ? (
                  <>
                    <span className="font-medium">{ev.label ?? 'Point'}</span>
                    {ev.flags?.includes('dod') && <span className="ml-1 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">do-or-die</span>}
                    {ev.playerId && <span> · {ev.playerName ?? nameFor(ev.playerId) ?? 'unknown'}</span>}
                    {ev.secondId && (
                      <span className="text-muted"> ({ev.kind?.startsWith('kho_') ? 'by' : 'assist'} {ev.secondName ?? nameFor(ev.secondId) ?? '-'})</span>
                    )}
                    <span className="text-muted"> · {nameOf(ev.side)}</span>
                    {typeof ev.pts === 'number' && ev.pts > 0 && (
                      <span className="ml-1 font-mono text-xs text-brand-600">+{ev.pts}</span>
                    )}
                  </>
                ) : ev.t === 'setServe' ? (
                  <span className="text-muted">{nameOf(ev.side)} to serve</span>
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
                ) : ev.t === 'penaltyKick' ? (
                  <>
                    <span className="font-medium">Shoot-out kick {ev.scored ? 'scored' : 'missed'}</span>
                    {ev.playerId && <span> · {ev.playerName ?? nameFor(ev.playerId) ?? 'unknown'}</span>}
                    <span className="text-muted"> · {nameOf(ev.side)} · {tally[i][0]}–{tally[i][1]}</span>
                  </>
                ) : ev.t === 'end' && ev.reason === 'penalties' && ev.winner ? (
                  <span className="font-semibold">
                    {nameOf(ev.winner)} won {ev.winner === 'A' ? `${tally[i][0]}–${tally[i][1]}` : `${tally[i][1]}–${tally[i][0]}`} on penalties
                  </span>
                ) : ev.t === 'raidFirst' ? (
                  <span className="text-muted">{nameOf(ev.side)} raid first (toss)</span>
                ) : ev.t === 'raidTurn' ? (
                  <span className="text-amber-700 dark:text-amber-300">Raid switched: {nameOf(ev.side)} to raid</span>
                ) : ev.t === 'goldenRaid' ? (
                  <span className="text-amber-700 dark:text-amber-300">Golden raid toss: {nameOf(ev.side)} raid first</span>
                ) : ev.t === 'chaseFirst' ? (
                  <span className="text-muted">{nameOf(ev.side)} chase first (toss)</span>
                ) : ev.t === 'followOn' ? (
                  <span className="font-medium">Follow-on: {nameOf(ev.side === 'A' ? 'B' : 'A')} chase again</span>
                ) : ev.t === 'minChase' ? (
                  <span>Minimum chase · {nameOf(ev.side)} · <span className="font-mono">{formatChaseTime(ev.ms)}</span></span>
                ) : ev.t === 'end' && (ev.reason === 'minimum_chase' || ev.reason === 'innings') && ev.winner ? (
                  <span className="font-semibold">{nameOf(ev.winner)} {KHO_END_LABEL[ev.reason]}</span>
                ) : ev.t === 'end' ? (
                  <span className="font-semibold">- match ended -</span>
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
  format, state, nameOf, shown, played, totalPeriods, bestOf, periodLabel, finishing, onFinishing, onEvent, onClose, knockout,
}: {
  format: ScoringFormat;
  knockout?: boolean;
  state: KernelState;
  /** Set for a sets match ("best of 5"); absent when every period is played. */
  bestOf?: number;
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
  // Optional detail for a rain decision: "led by 2 when called off", "pull contest 52m-47m".
  const [rainNote, setRainNote] = useState('');
  const rain = async (winner: Side | null) => {
    const note = rainNote.trim();
    const ok = await confirmDialog({
      title: winner ? `Called off for rain - ${nameOf(winner)} win?` : 'Called off for rain - record a draw?',
      confirmLabel: 'Record it',
      message: (winner ? `${nameOf(winner)} take the match under the weather rule.` : 'The match is recorded as drawn.')
        + ` Results show it as rain, not a concession.${note ? ` Note: ${note}` : ''}`,
    });
    if (!ok) return;
    onFinishing(false);
    setRainNote('');
    onEvent({ t: 'end', outcome: winner ? 'win' : 'draw', reason: 'weather', winner, ...(note ? { note } : {}) });
  };
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
            {bestOf
              ? `${played} ${periodLabel.toLowerCase()}${played === 1 ? '' : 's'} played (best of ${bestOf}), currently `
              : `${played} of ${totalPeriods} ${periodLabel.toLowerCase()}s played, currently `}
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
              {/* Time-capped (volleyball's 15-minute set): the side ahead at the buzzer takes it. */}
              {format.clock && format.levels[0].terminator !== 'clock' && (() => {
                const leader = capLeader(format, state);
                const drawOnTime = format.clock!.tieRule === 'draw' && format.endStates.drawsAllowed;
                return (
                  <Button size="sm" variant="outline" data-qa="time-up"
                    onClick={async () => {
                      if (leader === null && !drawOnTime) {
                        toast.error('Scores are level and this format does not allow a draw - play the next point.');
                        return;
                      }
                      const ok = await confirmDialog({
                        title: leader ? `Time up - ${nameOf(leader)} leads?` : 'Time up - record a draw?',
                        confirmLabel: 'Record it',
                        message: leader ? `${nameOf(leader)} takes the match on the score at the buzzer.` : 'The match is recorded as drawn.',
                      });
                      if (!ok) return;
                      onFinishing(false);
                      onEvent(leader ? { t: 'end', outcome: 'win', reason: 'cap', winner: leader }
                        : { t: 'end', outcome: 'draw', reason: 'cap', winner: null });
                    }}>
                    Time up ({format.clock!.minutes} min) - {leader ? `${nameOf(leader)} leads` : 'level'}
                  </Button>
                );
              })()}
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
              {/* Rain: awarded under the rulebook's weather rule (lead, pull contest), or drawn. */}
              <div className="mt-1 grid gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <div className="text-[10px] uppercase tracking-wide text-muted">Called off for rain</div>
                <Input value={rainNote} maxLength={120} onChange={(e) => setRainNote(e.target.value)}
                  placeholder="Note, optional - e.g. led by 2, or pull contest 52m-47m" aria-label="Rain note" />
                <div className="flex flex-wrap gap-1.5">
                  {(['A', 'B'] as Side[]).map((side) => (
                    <Button key={side} size="sm" variant="outline" onClick={() => void rain(side)}>{nameOf(side)} win</Button>
                  ))}
                  {!knockout && <Button size="sm" variant="outline" onClick={() => void rain(null)}>Draw</Button>}
                </div>
              </div>
              <Button size="sm" variant="subtle"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Abandon this match?', confirmLabel: 'Record it',
                    message: 'No winner is recorded. The organiser decides what happens to the fixture.',
                  });
                  if (ok) { onFinishing(false); onEvent({ t: 'end', outcome: 'void', reason: 'abandoned', winner: null }); }
                }}>
                Abandoned - no result
              </Button>
              <Button size="sm" variant="subtle" onClick={() => onFinishing(false)}>Keep scoring</Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
