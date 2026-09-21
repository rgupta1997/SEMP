import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DISMISSALS, DISMISSALS_OFF_NO_BALL, DISMISSALS_OFF_WIDE, DISMISSALS_ON_FREE_HIT,
  chaseLine, cricketHeadline, economy, extrasLine, foldCricket, inningsLine,
  oversLeft, oversOf, runRate, strikeRate,
  type CricketEvent, type CricketFormat, type CricketLog, type CricketState, type Dismissal,
} from '@semp/shared';
import { Button, Card, cn, confirmDialog } from '../../components/ui';

// ============================================================================
// The cricket console.
//
// ONE TAP IS ONE DELIVERY. Everything else - the over count, the strike, who bowls
// next, whether the innings is over - is DERIVED by folding the ball log. Nothing
// here is a counter that can drift out of step with the scorecard.
//
// Why that matters more in cricket than anywhere else: a wide does not advance the
// over, an odd run swaps the strike, the end of an over swaps it again, and a single
// off the last ball does both and so changes nothing. A console tracking those as
// mutable state gets one of them wrong within an over, and the error is invisible
// until somebody reads the scorecard hours later. Folding makes them the same
// computation the engine's tests already pin down.
//
// ---------------------------------------------------------------------------
// THE LAYOUT RULE: ONE SCREEN, NO SCROLL, NOTHING MOVES.
//
// A scorer is standing at the boundary holding a phone in one hand between
// deliveries. Every pixel of reach matters, and so does MUSCLE MEMORY - the 4 has to
// be where the 4 was last ball. The old deck grew a card at the bottom of a long
// scrolling column when you asked for an extra or a wicket, which meant the buttons
// you were about to press had just moved and were off-screen. That is how a ball
// gets scored wrong.
//
// So the deck is a FIXED-HEIGHT column measured against the viewport, and the big
// middle region hosts exactly one surface at a time - the run pad, the extras pad,
// the wicket form, the scorecard, the corrections menu. They swap IN PLACE. The
// scoreboard above and the over strip below never move, and nothing ever scrolls
// except long tables inside the scorecard surface.
//
// THE MIDDLE REGION ALSO ASKS FOR WHAT IS MISSING. If there is no bowler for this
// over, the pad is replaced by a list of bowlers who may legally bowl it, rather
// than the pad being greyed out with a warning underneath. A console whose buttons
// are all disabled and whose reason is off-screen is the same as a broken one.
//
// WHO IS ON STRIKE IS RECORDED, NOT INFERRED. Every delivery carries the striker,
// non-striker and bowler, because the alternative - inferring from the previous ball
// - means one mis-tap silently reassigns every run that follows to the wrong person.
// ============================================================================

export interface CricketPerson { id: string; name: string }

export interface CricketDeckProps {
  format: CricketFormat;
  /** Where the format came from - so "who changed the rules?" has an answer. */
  provenance?: string;
  homeName: string;
  awayName: string;
  homeOrg?: string | null;
  awayOrg?: string | null;
  /** Squads, so a batter, bowler and fielder can be named rather than typed. */
  homeSquad?: CricketPerson[];
  awaySquad?: CricketPerson[];
  log: CricketLog;
  onChange: (log: CricketLog, state: CricketState) => void;
  onSignOff: (log: CricketLog, state: CricketState) => void;
  /**
   * Leave the console for the page's admin sections (awards, the manual scorecard).
   *
   * They are hidden while the deck is live, so there has to be a way back to them
   * that is not "scroll down" - which is the thing this deck exists to remove.
   */
  onOpenAdmin?: () => void;
  disabled?: boolean;
  busy?: boolean;
}

type Innings = CricketState['innings'][number];
type Delivery = Extract<CricketEvent, { t: 'ball' }>;

/** Which surface the middle region is showing. */
type Surface = 'pad' | 'extra' | 'wicket' | 'card' | 'more' | 'finish';

const RUNS = [0, 1, 2, 3, 4, 6];

const DISMISSAL_LABEL: Record<Dismissal, string> = {
  bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', run_out: 'Run out',
  stumped: 'Stumped', hit_wicket: 'Hit wicket', caught_and_bowled: 'Caught & bowled',
  obstructing: 'Obstructing the field', timed_out: 'Timed out', retired: 'Retired',
};

/** Dismissals where somebody other than the bowler must be named. */
const NEEDS_FIELDER: Dismissal[] = ['caught', 'run_out', 'stumped', 'caught_and_bowled'];

/** Dismissals that can carry runs completed before the ball was dead. */
const CARRIES_RUNS: Dismissal[] = ['run_out', 'obstructing'];

/**
 * The element that actually scrolls above this one.
 *
 * NOT the window. The app shell puts the page inside a `<main class="overflow-auto">`
 * that scrolls independently, so `document.documentElement.scrollHeight` is always
 * exactly the viewport height and reports no overflow however far the content runs
 * past the bottom. Sizing the deck against `window.innerHeight` therefore produced a
 * deck that looked right by that measure and still left the shell scrolling by
 * several hundred pixels.
 */
function scrollHost(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * How tall the deck may be.
 *
 * Measured rather than guessed, because the chrome above it differs by route and by
 * whether the structure tabs are showing. The deck claims everything from its own
 * top edge to the bottom of whatever scrolls it, so nothing scrolls - and falls back
 * to a sensible minimum on a very short window, where a little scrolling beats
 * squashing the buttons below the size of a thumb.
 */
function useViewportHeight(ref: React.RefObject<HTMLElement>): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  // Re-measured after EVERY render, and whenever anything above changes size.
  //
  // Measuring once is not enough: the chrome above the deck changes height during a
  // match without the deck re-rendering - a status badge going from "scheduled" to
  // "live", a banner appearing, a tab bar resolving. Measured once at mount, the
  // deck kept the height it had when the page was tallest and left a strip of dead
  // space under the buttons for the rest of the innings.
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const host = scrollHost(el);
      // BOTH edges read from the same coordinate space, so the difference between
      // them does not move when anything scrolls. Mixing a viewport-relative top
      // with a document-relative bottom is a runaway: the deck grows, the container
      // grows, it scrolls, the top goes negative, and the deck grows again.
      const top = el.getBoundingClientRect().top;
      const bottom = host ? host.getBoundingClientRect().bottom : window.innerHeight;
      // The container's own bottom padding is inside its scroll height, so it has to
      // come off or the deck overruns by exactly that much.
      const pad = host ? parseFloat(getComputedStyle(host).paddingBottom) || 0 : 12;
      // FLOOR, and a pixel in hand. Rounding up a fractional layout leaves the deck
      // a hair taller than the space it was measured into, and a hair is enough for
      // the container to report itself scrollable and grow a scrollbar.
      const available = bottom - top - pad - 1;
      const ceiling = host ? host.clientHeight : window.innerHeight;
      const next = Math.min(ceiling, Math.max(560, Math.floor(available)));
      // Only when it actually moved, or the render loop never settles.
      setHeight((prev) => (prev === next ? prev : next));
    };
    measure();

    // Deferred a frame, so a resize this effect itself causes is measured against
    // the settled layout rather than the half-applied one.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(later);
    ro.observe(document.body);
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    // The chrome above can settle a frame late (fonts, a tab bar appearing).
    const t = window.setTimeout(measure, 120);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      window.removeEventListener('orientationchange', later);
      window.clearTimeout(t);
    };
  });

  return height;
}

export function CricketDeck(p: CricketDeckProps) {
  const { format, log } = p;
  const fold = useMemo(() => foldCricket(format, log), [format, log]);
  const state = fold.state;
  const inn = state.innings[state.current];

  const [surface, setSurface] = useState<Surface>('pad');
  const root = useRef<HTMLDivElement>(null);
  const height = useViewportHeight(root);

  // The batting side's squad supplies batters; the other supplies the bowler and the
  // fielders. It swaps with the innings, so it is read from the fold rather than
  // fixed at mount.
  const batting = (inn?.battingSide === 'A' ? p.homeSquad : p.awaySquad) ?? [];
  const bowlingSide = (inn?.battingSide === 'A' ? p.awaySquad : p.homeSquad) ?? [];
  const battingName = inn?.battingSide === 'A' ? p.homeName : p.awayName;

  const nameOf = (id?: string | null) => {
    if (!id) return null;
    return [...(p.homeSquad ?? []), ...(p.awaySquad ?? [])].find((x) => x.id === id)?.name ?? null;
  };

  const out = new Set(inn?.batting.filter((b) => b.out).map((b) => b.playerId) ?? []);
  const atCrease = [inn?.strikerId, inn?.nonStrikerId].filter(Boolean) as string[];
  const availableBatters = batting.filter((x) => !out.has(x.id) && !atCrease.includes(x.id));

  // Who may bowl THIS over. Two rules, both of which the engine also enforces, so a
  // button that cannot work is never offered: an allocation that is used up, and the
  // person who bowled the over just gone.
  const availableBowlers = bowlingSide.filter((x) => {
    if (inn?.lastOverBowlerId === x.id) return false;
    const line = inn?.bowling.find((b) => b.playerId === x.id);
    if (!line) return true;
    const left = oversLeft(format, line);
    return left === null || left > 0;
  });

  /**
   * Is the innings over because there is nobody left to bat?
   *
   * The ENGINE ends an innings on `wicketsToEndInnings`, which assumes the side has
   * that many batters. A format is picked from a shelf and a squad is picked from a
   * team sheet, and they do not have to agree - an eight-a-side box format put on a
   * six-player squad runs out of batters after five wickets, two short of the seven
   * the format is waiting for. The engine cannot see that; only the console knows
   * who is on the team sheet.
   *
   * Left unhandled it is the worst bug this deck can have: the innings is neither
   * scoreable nor closeable, and a real match stops. So the console closes it, which
   * is also what the rule says - you are all out when you have nobody left to bat.
   */
  const strandedAllOut = (s: CricketState): boolean => {
    const i = s.innings[s.current];
    if (!i || i.ended || s.ended) return false;
    const gone = new Set(i.batting.filter((b) => b.out).map((b) => b.playerId));
    const there = [i.strikerId, i.nonStrikerId].filter(Boolean) as string[];
    const bench = ((i.battingSide === 'A' ? p.homeSquad : p.awaySquad) ?? [])
      .filter((x) => !gone.has(x.id) && !there.includes(x.id));
    if (bench.length) return false;
    return format.lastManStands ? there.length === 0 : there.length < 2;
  };

  const push = (ev: CricketEvent) => {
    if (p.disabled) return;
    const stamped = { ...ev, at: new Date().toISOString() } as CricketEvent;
    let next = [...log, stamped];
    let state2 = foldCricket(format, next).state;
    if (strandedAllOut(state2)) {
      next = [...next, { t: 'endInnings', reason: 'all_out', at: new Date().toISOString() }];
      state2 = foldCricket(format, next).state;
    }
    setSurface('pad');
    p.onChange(next, state2);
  };

  const undo = () => {
    if (!log.length) return;
    const next = log.slice(0, -1);
    setSurface('pad');
    p.onChange(next, foldCricket(format, next).state);
  };

  // Every delivery carries the three people involved, so a later correction to the
  // team sheet cannot silently reattribute runs already scored. Typed to the
  // delivery alone: the other events have no strike to record, and widening it to
  // the union would let a `retire` be stamped with a bowler.
  const withPeople = (ev: Delivery): Delivery => ({
    ...ev,
    strikerId: inn?.strikerId,
    nonStrikerId: inn?.nonStrikerId,
    bowlerId: inn?.bowlerId,
  });

  if (!inn) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">This match has no innings to score.</p>
      </Card>
    );
  }

  const headline = cricketHeadline(state);
  // The last batter of a last-man-stands innings bats alone, so one end is empty by
  // design rather than by mistake.
  const lone = format.lastManStands && !!inn.strikerId && !inn.nonStrikerId
    && inn.wickets >= format.wicketsToEndInnings - 1;
  const needsStriker = !inn.strikerId && !inn.ended && !state.ended;
  const needsNonStriker = !inn.nonStrikerId && !inn.ended && !state.ended && !lone;
  const needsBowler = !inn.bowlerId && !inn.ended && !state.ended;

  // What the middle region must show, whatever the scorer last asked for: a missing
  // bowler or batter outranks the pad, because no ball can be recorded without them.
  const required: Surface | 'needStriker' | 'needNonStriker' | 'needBowler' | null =
    state.ended || inn.ended ? null
      : needsStriker ? 'needStriker'
        : needsNonStriker ? 'needNonStriker'
          : needsBowler ? 'needBowler'
            : null;

  // A surface the scorer opened deliberately still wins over the pad - but never over
  // something the rules require first.
  const showing: Surface | 'needStriker' | 'needNonStriker' | 'needBowler' =
    surface === 'card' || surface === 'more' || surface === 'finish'
      ? surface
      : required ?? surface;

  return (
    <div
      ref={root}
      data-qa="cricket-deck"
      style={height ? { height } : undefined}
      className="flex flex-col gap-2 overflow-hidden"
    >
      {/* ---------------- the scoreboard: never moves ---------------- */}
      <Card data-qa="cricket-scoreboard" className="shrink-0 px-3 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] uppercase tracking-wide text-muted">
              {battingName} batting
            </div>
            <div data-qa="cricket-innings-line"
              className="text-2xl font-semibold leading-tight tabular-nums sm:text-3xl">
              {inningsLine(inn, format.ballsPerOver)}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs leading-tight text-muted">
            <div className="tabular-nums">RR {runRate(inn, format.ballsPerOver).toFixed(2)}</div>
            {format.oversPerInnings !== null && <div>of {format.oversPerInnings} ov</div>}
            {/* Extras belong beside the score, not in the line of small print below:
                clipped to "Ex 1 (" it was worse than useless. */}
            <div className="tabular-nums">Ex {extrasLine(inn)}</div>
          </div>
        </div>

        {chaseLine(state) && (
          <div className="mt-1.5 rounded bg-accent-soft px-2 py-1 text-sm font-semibold">
            {chaseLine(state)}
          </div>
        )}

        {/* One line, truncated. Three wrapped lines of context cost more of the
            screen than the run pad could spare. */}
        <div className="mt-1 flex items-center gap-x-3 overflow-hidden whitespace-nowrap text-[11px] text-muted">
          <span className="shrink-0 tabular-nums">{p.homeName} {headline[0]}</span>
          <span className="shrink-0 tabular-nums">{p.awayName} {headline[1]}</span>
          <span className="truncate">{format.name}</span>
        </div>
      </Card>

      {/* ---------------- who is at the crease: never moves ----------------
           Dropped once the innings is shut: three rows of "not named" is not
           information, and the space is worth more to the result below. */}
      {!inn.ended && !state.ended && (
      <Card className="shrink-0 divide-y divide-line">
        <CreaseRow
          mark="*" label="Striker" name={nameOf(inn.strikerId)}
          detail={battingLine(inn, inn.strikerId)}
          onPick={() => setSurface(surface === 'pad' ? 'pad' : 'pad')}
        />
        {!lone && (
          <CreaseRow
            label="Non-striker" name={nameOf(inn.nonStrikerId)}
            detail={battingLine(inn, inn.nonStrikerId)}
          />
        )}
        <CreaseRow
          label="Bowler" name={nameOf(inn.bowlerId)}
          detail={bowlingFigures(inn, inn.bowlerId, format.ballsPerOver)}
        />
      </Card>
      )}

      {inn.freeHit && (
        <div className="shrink-0 rounded bg-warning-soft px-2 py-1 text-center text-xs font-semibold">
          FREE HIT — only a run-out can take a wicket off this delivery.
        </div>
      )}

      {/* A format and a team sheet are picked in different places and need not agree.
          Said before the first ball rather than discovered at the fall of a wicket. */}
      {squadWarning(format, p.homeSquad, p.awaySquad, p.homeName, p.awayName) && (
        <div className="shrink-0 rounded bg-warning-soft px-2 py-1 text-center text-[11px] font-medium">
          {squadWarning(format, p.homeSquad, p.awaySquad, p.homeName, p.awayName)}
        </div>
      )}

      {/* ---------------- the working surface: everything swaps HERE ---------------- */}
      <div data-qa="cricket-region" className="relative min-h-0 flex-1">
        {showing === 'needStriker' && (
          <PickPanel
            title="Who is on strike?"
            people={availableBatters}
            empty={format.lastManStands
              ? 'Nobody left to come in — the last batter carries on alone.'
              : 'Nobody left to bat.'}
            onPick={(id) => push({ t: 'setBatter', end: 'striker', batterId: id })}
          />
        )}
        {showing === 'needNonStriker' && (
          <PickPanel
            title="Who is at the other end?"
            people={availableBatters}
            empty="Nobody left to come in."
            onPick={(id) => push({ t: 'setBatter', end: 'nonStriker', batterId: id })}
          />
        )}
        {showing === 'needBowler' && (
          <PickPanel
            title={inn.balls === 0 ? 'Who opens the bowling?' : 'Who bowls this over?'}
            note={inn.lastOverBowlerId
              ? `${nameOf(inn.lastOverBowlerId) ?? 'The last bowler'} bowled the over just gone and cannot bowl this one.`
              : undefined}
            people={availableBowlers}
            detailOf={(id) => bowlingFigures(inn, id, format.ballsPerOver)}
            empty="Nobody on the team sheet has overs left to bowl."
            onPick={(id) => push({ t: 'setBowler', bowlerId: id })}
          />
        )}

        {showing === 'pad' && (
          <RunPad
            busy={p.busy}
            ended={inn.ended || state.ended}
            result={state.ended
              ? (state.winner
                ? `${state.winner === 'A' ? p.homeName : p.awayName} ${state.margin ?? 'won'}`
                : state.margin ?? 'No result')
              : null}
            onSignOff={state.ended ? () => p.onSignOff(log, state) : undefined}
            canUndo={log.length > 0}
            freeHit={inn.freeHit}
            wideRuns={format.wideRuns}
            noBallRuns={format.noBallRuns}
            onRuns={(r) => push(withPeople({ t: 'ball', runs: r }))}
            onWide={() => push(withPeople({ t: 'ball', runs: 0, extra: 'wide', extraRuns: 0 }))}
            onNoBall={() => push(withPeople({ t: 'ball', runs: 0, extra: 'noball', extraRuns: 0 }))}
            onExtra={() => setSurface('extra')}
            onWicket={() => setSurface('wicket')}
            onUndo={undo}
            onCard={() => setSurface('card')}
          />
        )}

        {showing === 'extra' && (
          <ExtraPanel
            format={format}
            freeHit={inn.freeHit}
            onCancel={() => setSurface('pad')}
            onConfirm={(ev) => push(withPeople(ev))}
          />
        )}

        {showing === 'wicket' && (
          <WicketPanel
            format={format}
            freeHit={inn.freeHit}
            fielders={bowlingSide}
            nextBatters={availableBatters}
            strikerName={nameOf(inn.strikerId) ?? 'the striker'}
            nonStrikerName={nameOf(inn.nonStrikerId) ?? 'the non-striker'}
            lone={lone}
            onCancel={() => setSurface('pad')}
            onConfirm={(ev) => push(withPeople(ev))}
          />
        )}

        {showing === 'card' && (
          <Scorecard
            state={state} nameOf={nameOf} ballsPerOver={format.ballsPerOver}
            onClose={() => setSurface('pad')}
          />
        )}

        {showing === 'more' && (
          <MorePanel
            state={state}
            inn={inn}
            format={format}
            busy={p.busy}
            homeName={p.homeName}
            awayName={p.awayName}
            lone={lone}
            onClose={() => setSurface('pad')}
            onEvent={push}
            onFinish={() => setSurface('finish')}
            onSignOff={() => p.onSignOff(log, state)}
            onOpenAdmin={p.onOpenAdmin}
          />
        )}

        {showing === 'finish' && (
          <FinishPanel
            drawsAllowed={format.drawsAllowed}
            homeName={p.homeName}
            awayName={p.awayName}
            onCancel={() => setSurface('more')}
            onEnd={(ev) => {
              const next = [...log, ev];
              setSurface('pad');
              p.onSignOff(next, foldCricket(format, next).state);
            }}
          />
        )}
      </div>

      {/* ---------------- the over strip: never moves ---------------- */}
      <Card className="shrink-0 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted">This over</div>
            <OverStrip format={format} log={log} inn={inn} />
          </div>
          <Button size="sm" variant={showing === 'card' ? 'primary' : 'outline'}
            onClick={() => setSurface(showing === 'card' ? 'pad' : 'card')}>
            Card
          </Button>
          <Button size="sm" variant={showing === 'more' || showing === 'finish' ? 'primary' : 'outline'}
            onClick={() => setSurface(showing === 'more' || showing === 'finish' ? 'pad' : 'more')}>
            More
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------- the fixed strips ----------------------------- */

function CreaseRow({ mark, label, name, detail }: {
  mark?: string; label: string; name: string | null; detail?: string | null; onPick?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-[4.5rem] shrink-0 text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', name ? 'font-medium' : 'text-muted')}>
        {name ?? 'not named'}{name && mark ? <span className="text-brand-600"> {mark}</span> : null}
      </span>
      {detail ? <span className="shrink-0 text-xs tabular-nums text-muted">{detail}</span> : null}
    </div>
  );
}

/**
 * The over so far, as the balls it actually contained.
 *
 * Read off the tail of the LOG rather than kept as a counter, for the same reason
 * everything else here is: a wide that did not advance the over has to show up in
 * the strip without moving the ball count, and the only thing that knows both is
 * the log.
 */
function OverStrip({ format, log, inn }: { format: CricketFormat; log: CricketLog; inn: Innings }) {
  const marks: string[] = [];
  let legal = 0;
  for (let i = log.length - 1; i >= 0 && legal < inn.overBalls + 6; i -= 1) {
    const ev = log[i];
    if (ev.t === 'setBowler') break;          // the over began here
    if (ev.t !== 'ball') continue;
    const illegal = ev.extra === 'wide' || ev.extra === 'noball';
    if (!illegal) {
      if (legal >= inn.overBalls) break;      // we have walked past this over
      legal += 1;
    }
    marks.unshift(markOf(ev));
  }
  if (!marks.length) return <div className="text-sm text-muted">—</div>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {marks.map((m, i) => (
        <span key={i}
          className={cn(
            'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded px-1 text-xs font-semibold tabular-nums',
            m === 'W' ? 'bg-rose-600 text-white'
              : m === '•' ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                : /[a-z]/.test(m) ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                  : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
          )}>
          {m}
        </span>
      ))}
      <span className="ml-1 text-[11px] text-muted tabular-nums">
        {inn.overBalls}/{format.ballsPerOver} · {inn.overRuns} run{inn.overRuns === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function markOf(ev: Extract<CricketEvent, { t: 'ball' }>): string {
  if (ev.wicket) return 'W';
  const extra = ev.extra;
  const ran = ev.extraRuns ?? 0;
  if (extra === 'wide') return ran ? `${ran}wd` : 'wd';
  if (extra === 'noball') return `${(ev.runs ?? 0) + ran || ''}nb`;
  if (extra === 'bye') return `${ran}b`;
  if (extra === 'legbye') return `${ran}lb`;
  return ev.runs ? String(ev.runs) : '•';
}

/* ----------------------------- the swapping surfaces ----------------------------- */

/** Every surface fills the region exactly, so switching between them moves nothing. */
const SURFACE_BOX = 'absolute inset-0 flex flex-col overflow-hidden';

/**
 * The run pad.
 *
 * Six runs, the two extras that are one tap in real life, the wicket, and undo.
 * Sized by the region rather than by padding, so the buttons are as big as the
 * screen allows and stay where they were last ball.
 */
function RunPad({ busy, ended, result, canUndo, freeHit, wideRuns, noBallRuns, onRuns, onWide, onNoBall, onExtra, onWicket, onUndo, onSignOff, onCard }: {
  busy?: boolean; ended: boolean; result?: string | null; canUndo: boolean; freeHit: boolean;
  wideRuns: number; noBallRuns: number;
  onRuns: (r: number) => void; onWide: () => void; onNoBall: () => void;
  onExtra: () => void; onWicket: () => void; onUndo: () => void;
  onSignOff?: () => void; onCard?: () => void;
}) {
  if (ended) {
    // The match being over is the moment the sign-off matters most, so it is HERE
    // rather than behind More - and undo stays reachable, because "the last ball was
    // wrong and it ended the match" is exactly when you need it.
    return (
      <Card className={cn(SURFACE_BOX, 'items-center justify-center gap-3 p-4')}>
        {result ? (
          <>
            <p className="text-center text-lg font-semibold">{result}</p>
            <Button size="lg" disabled={busy} onClick={onSignOff}>
              {busy ? 'Saving…' : 'Sign off the result'}
            </Button>
          </>
        ) : (
          <p className="text-center text-sm text-muted">
            This innings is closed. The next one opens as soon as its batters are named.
          </p>
        )}
        <div className="flex gap-2">
          {onCard && <Button variant="outline" size="sm" onClick={onCard}>Scorecard</Button>}
          <Button variant="subtle" size="sm" disabled={!canUndo || busy} onClick={onUndo}>
            Undo the last ball
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card className={cn(SURFACE_BOX, 'gap-1.5 p-1.5')}>
      {/* runs off the bat — the two rows a thumb knows by heart */}
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-1.5">
        {RUNS.map((r) => (
          <button key={r} type="button" disabled={busy} data-qa={`run-${r}`}
            onClick={() => onRuns(r)}
            className={cn(
              'flex items-center justify-center rounded-lg text-3xl font-bold tabular-nums transition',
              'active:scale-[0.97] disabled:opacity-50',
              r === 4 || r === 6
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'border border-line bg-white text-slate-800 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
            )}>
            {r}
          </button>
        ))}
      </div>

      {/* the extras that are genuinely one tap, and the door to the rest */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <PadButton tone="amber" disabled={busy} onClick={onWide}
          label="Wide" sub={`+${wideRuns}`} />
        <PadButton tone="amber" disabled={busy} onClick={onNoBall}
          label="No-ball" sub={freeHit ? 'free hit again' : `+${noBallRuns}`} />
        <PadButton tone="plain" disabled={busy} onClick={onExtra}
          label="Bye / more…" sub="runs off an extra" />
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <button type="button" disabled={busy} onClick={onWicket}
          className="col-span-2 flex h-14 items-center justify-center rounded-lg bg-rose-600 text-lg font-bold text-white transition hover:bg-rose-700 active:scale-[0.97] disabled:opacity-50">
          WICKET
        </button>
        <PadButton tone="plain" disabled={busy || !canUndo} onClick={onUndo}
          label="Undo" sub="last ball" />
      </div>
    </Card>
  );
}

function PadButton({ label, sub, tone, disabled, onClick }: {
  label: string; sub?: string; tone: 'amber' | 'plain'; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cn(
        'flex h-14 flex-col items-center justify-center rounded-lg text-sm font-semibold leading-tight transition',
        'active:scale-[0.97] disabled:opacity-50',
        tone === 'amber'
          ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:hover:bg-amber-500/30'
          : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
      )}>
      <span>{label}</span>
      {sub ? <span className="text-[10px] font-normal opacity-70">{sub}</span> : null}
    </button>
  );
}

/**
 * Naming somebody, as big buttons rather than a dropdown.
 *
 * A select is two taps and a scroll on a phone, and this is asked at the end of
 * every single over. It is also where a stuck console announces itself, so it says
 * plainly why the list is short.
 */
function PickPanel({ title, note, people, empty, detailOf, onPick }: {
  title: string; note?: string; people: CricketPerson[]; empty: string;
  detailOf?: (id: string) => string | null; onPick: (id: string) => void;
}) {
  return (
    <Card data-qa="pick-panel" className={cn(SURFACE_BOX, 'p-3')}>
      <h3 data-qa="pick-title" className="shrink-0 text-sm font-semibold">{title}</h3>
      {note ? <p className="mt-0.5 shrink-0 text-xs text-muted">{note}</p> : null}
      {people.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <div className="mt-2 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
          {people.map((x) => {
            const detail = detailOf?.(x.id);
            return (
              <button key={x.id} type="button" onClick={() => onPick(x.id)}
                className="flex min-h-[3rem] flex-col items-center justify-center rounded-lg border border-line bg-white px-2 py-1.5 text-center text-sm font-medium leading-tight transition hover:bg-slate-50 active:scale-[0.98] dark:bg-slate-800 dark:hover:bg-slate-700">
                <span className="line-clamp-2">{x.name}</span>
                {detail ? <span className="mt-0.5 text-[10px] font-normal tabular-nums text-muted">{detail}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * "The format wants eleven, the team sheet has six."
 *
 * Worth saying out loud before a ball is bowled, because the consequence only shows
 * up at the fall of a wicket, by which time the match is under way and changing the
 * format means re-scoring.
 */
function squadWarning(
  format: CricketFormat,
  home: CricketPerson[] | undefined,
  away: CricketPerson[] | undefined,
  homeName: string,
  awayName: string,
): string | null {
  const short: string[] = [];
  for (const [name, squad] of [[homeName, home], [awayName, away]] as const) {
    const n = squad?.length ?? 0;
    if (n > 0 && n < format.playersPerSide) short.push(`${name} has ${n}`);
  }
  if (!short.length) return null;
  return `${format.name} is played ${format.playersPerSide} a side — ${short.join(', ')}. `
    + 'The innings will close when a side runs out of batters.';
}

function battingLine(inn: Innings, id?: string): string | null {
  if (!id) return null;
  const line = inn.batting.find((b) => b.playerId === id);
  if (!line) return null;
  // A batter yet to face a ball has no strike rate worth printing; 0.0 reads as bad
  // rather than as absent.
  return `${line.runs} (${line.ballsFaced})`
    + (line.ballsFaced ? ` · SR ${strikeRate(line).toFixed(0)}` : '');
}

function bowlingFigures(inn: Innings, id?: string, ballsPerOver = 6): string | null {
  if (!id) return null;
  const line = inn.bowling.find((b) => b.playerId === id);
  if (!line) return null;
  return `${oversOf(line.ballsBowled, ballsPerOver)}-${line.maidens}-${line.runsConceded}-${line.wickets}`
    + (line.ballsBowled ? ` · Econ ${economy(line, ballsPerOver).toFixed(2)}` : '');
}

/**
 * The wicket form.
 *
 * The dismissal list is FILTERED BY THE DELIVERY, not merely validated afterwards:
 * off a free hit only a run-out is possible, off a wide the bat never touched the
 * ball so a catch is not, and the engine drops an impossible one anyway. Offering a
 * choice that will be silently discarded is worse than not offering it, because the
 * scorer walks away believing a wicket was recorded.
 */
function WicketPanel({ format, freeHit, fielders, nextBatters, strikerName, nonStrikerName, lone, onCancel, onConfirm }: {
  format: CricketFormat;
  freeHit: boolean;
  fielders: CricketPerson[];
  nextBatters: CricketPerson[];
  strikerName: string;
  nonStrikerName: string;
  lone: boolean;
  onCancel: () => void;
  onConfirm: (ev: Delivery) => void;
}) {
  const [extra, setExtra] = useState<'' | 'wide' | 'noball'>('');
  const allowed: Dismissal[] = useMemo(() => {
    const base = DISMISSALS.filter((d) => d !== 'retired' && d !== 'timed_out') as Dismissal[];
    if (extra === 'noball') return base.filter((d) => DISMISSALS_OFF_NO_BALL.includes(d));
    if (extra === 'wide') return base.filter((d) => DISMISSALS_OFF_WIDE.includes(d));
    if (freeHit) return base.filter((d) => DISMISSALS_ON_FREE_HIT.includes(d));
    return base;
  }, [extra, freeHit]);

  const [how, setHow] = useState<Dismissal>('bowled');
  const [end, setEnd] = useState<'striker' | 'nonStriker'>('striker');
  const [fielderId, setFielderId] = useState('');
  const [nextId, setNextId] = useState('');
  const [runs, setRuns] = useState(0);

  // Keep the choice legal when the delivery changes under it, rather than letting a
  // now-impossible dismissal sit selected.
  useEffect(() => {
    if (!allowed.includes(how)) setHow(allowed[0]);
  }, [allowed, how]);

  const needsFielder = NEEDS_FIELDER.includes(how);
  // Only a run-out can take the batter at the other end - the rest are all about the
  // person facing. With one batter left there is no other end at all.
  const canPickEnd = how === 'run_out' && !lone;
  // Runs are cleared whenever the dismissal cannot carry them, so a value typed for a
  // run-out cannot survive a change to "caught" and award runs nobody made.
  const carriesRuns = CARRIES_RUNS.includes(how);
  const effectiveRuns = carriesRuns ? runs : 0;

  return (
    <Card className={cn(SURFACE_BOX, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">How was the batter out?</h3>
        <Button size="sm" variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto">
        {freeHit && !extra && (
          <p className="rounded bg-warning-soft px-2 py-1 text-xs font-medium">
            Free hit — only a run-out or obstruction can take a wicket.
          </p>
        )}

        <Group label="Dismissal">
          <Chips
            value={how}
            options={allowed.map((d) => [d, DISMISSAL_LABEL[d]] as [string, string])}
            onChange={(v) => setHow(v as Dismissal)}
          />
        </Group>

        {canPickEnd && (
          <Group label="Which batter" hint="A run-out can take either batter, and is not credited to the bowler.">
            <Chips
              value={end}
              options={[['striker', `${strikerName} (striker)`], ['nonStriker', `${nonStrikerName} (non-striker)`]]}
              onChange={(v) => setEnd(v as typeof end)}
            />
          </Group>
        )}

        {needsFielder && (
          <Group label={how === 'stumped' ? 'Wicketkeeper' : 'Fielder'}>
            <Chips
              value={fielderId}
              options={fielders.map((x) => [x.id, x.name] as [string, string])}
              onChange={setFielderId}
            />
          </Group>
        )}

        {carriesRuns && (
          <Group label="Runs completed first">
            <Chips
              value={String(runs)}
              options={[0, 1, 2, 3].map((r) => [String(r), String(r)] as [string, string])}
              onChange={(v) => setRuns(Number(v))}
            />
          </Group>
        )}

        <Group label="Next batter" qa="wicket-next">
          {nextBatters.length ? (
            <Chips
              value={nextId}
              options={nextBatters.map((x) => [x.id, x.name] as [string, string])}
              onChange={setNextId}
            />
          ) : (
            <p className="text-xs text-muted">
              {format.lastManStands
                ? 'Nobody left to come in — the last batter carries on alone.'
                : 'Nobody left to come in — this ends the innings.'}
            </p>
          )}
        </Group>

        {/* Last, because a wicket off an illegal delivery is the rare case, and
            putting it first pushed the dismissal and the incoming batter - which
            every wicket needs - off the bottom of a phone. */}
        <Group label="Was the delivery legal?">
          <Chips
            value={extra}
            options={[['', 'Fair ball'], ['wide', 'Wide'], ['noball', 'No-ball']]}
            onChange={(v) => setExtra(v as typeof extra)}
          />
        </Group>
      </div>

      <Button variant="danger" className="shrink-0"
        disabled={needsFielder && !fielderId}
        onClick={() => onConfirm({
          t: 'ball',
          runs: effectiveRuns,
          ...(extra ? { extra } : {}),
          wicket: { how, end: lone ? 'striker' : end, ...(fielderId ? { fielderId } : {}) },
          ...(nextId ? { nextBatterId: nextId } : {}),
        })}>
        Record the wicket
      </Button>
    </Card>
  );
}

/** The rest of the extras - the ones that need a number before they mean anything. */
function ExtraPanel({ format, freeHit, onCancel, onConfirm }: {
  format: CricketFormat; freeHit: boolean; onCancel: () => void; onConfirm: (ev: Delivery) => void;
}) {
  const [kind, setKind] = useState<'wide' | 'noball' | 'bye' | 'legbye'>('bye');
  const [extraRuns, setExtraRuns] = useState(1);
  const [offBat, setOffBat] = useState(0);

  const illegal = kind === 'wide' || kind === 'noball';
  const penalty = kind === 'wide' ? format.wideRuns : kind === 'noball' ? format.noBallRuns : 0;
  const total = penalty + extraRuns + (kind === 'noball' ? offBat : 0);

  return (
    <Card className={cn(SURFACE_BOX, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">Extra</h3>
        <Button size="sm" variant="subtle" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto">
        <Group label="What kind">
          <Chips
            value={kind}
            options={[['bye', 'Bye'], ['legbye', 'Leg-bye'], ['wide', 'Wide'], ['noball', 'No-ball']]}
            onChange={(v) => setKind(v as typeof kind)}
          />
        </Group>

        {kind === 'noball' && (
          <Group label="Runs off the bat">
            <Chips
              value={String(offBat)}
              options={RUNS.map((r) => [String(r), String(r)] as [string, string])}
              onChange={(v) => setOffBat(Number(v))}
            />
          </Group>
        )}

        <Group label={illegal ? 'Extra runs run or overthrown' : 'Runs run'}>
          <Chips
            value={String(extraRuns)}
            options={[0, 1, 2, 3, 4].map((r) => [String(r), String(r)] as [string, string])}
            onChange={(v) => setExtraRuns(Number(v))}
          />
        </Group>

        <p className="text-xs text-muted">
          {illegal
            ? `Does not count as a ball of the over, and is charged to the bowler.${freeHit && kind === 'wide' ? ' The free hit survives it.' : ''}`
            : 'Counts as a legal ball, and is charged to the team rather than to the bowler.'}
          {' '}Worth <span className="font-semibold tabular-nums">{total}</span> to the side.
        </p>
      </div>

      <Button className="shrink-0"
        onClick={() => onConfirm({
          t: 'ball', runs: kind === 'noball' ? offBat : 0, extra: kind, extraRuns,
        })}>
        Record it
      </Button>
    </Card>
  );
}

/** Corrections and the things that end something - kept off the pad, one tap away. */
function MorePanel({ state, inn, format, busy, homeName, awayName, lone, onClose, onEvent, onFinish, onSignOff, onOpenAdmin }: {
  state: CricketState; inn: Innings; format: CricketFormat; busy?: boolean;
  homeName: string; awayName: string; lone: boolean;
  onClose: () => void; onEvent: (ev: CricketEvent) => void;
  onFinish: () => void; onSignOff: () => void; onOpenAdmin?: () => void;
}) {
  return (
    <Card className={cn(SURFACE_BOX, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">Corrections and endings</h3>
        <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {state.ended ? (
          <div className="rounded border border-line p-3">
            <p className="text-sm font-medium">
              {state.winner
                ? `${state.winner === 'A' ? homeName : awayName} ${state.margin ?? 'won'}`
                : state.margin ?? 'No result'}
            </p>
            <Button className="mt-2" disabled={busy} onClick={onSignOff}>
              {busy ? 'Saving…' : 'Sign off the result'}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">
            The result is signed off automatically once the match ends — a chase
            completed, or the last innings closed.
          </p>
        )}

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {!lone && !inn.ended && (
            <Button variant="outline" disabled={busy}
              onClick={() => onEvent({ t: 'swapEnds' })}>
              Swap the strike
            </Button>
          )}
          {!inn.ended && (
            <Button variant="outline" disabled={busy}
              onClick={async () => {
                if (!await confirmDialog({
                  title: 'Penalty runs to the batting side',
                  message: 'Five penalty runs are awarded to the batting side. This is the usual amount.',
                  confirmLabel: 'Award 5 runs',
                })) return;
                onEvent({ t: 'penalty', side: inn.battingSide, runs: 5, reason: 'awarded by the umpire' });
              }}>
              Penalty runs to {inn.battingSide === 'A' ? homeName : awayName}
            </Button>
          )}
          {!inn.ended && (
            <Button variant="outline" disabled={busy}
              onClick={async () => {
                if (!await confirmDialog({
                  title: 'Penalty runs against the batting side',
                  message: 'Five penalty runs are awarded to the FIELDING side. They are added to that side’s total.',
                  confirmLabel: 'Award 5 runs',
                })) return;
                onEvent({ t: 'penalty', side: inn.battingSide === 'A' ? 'B' : 'A', runs: 5, reason: 'awarded by the umpire' });
              }}>
              Penalty runs to {inn.battingSide === 'A' ? awayName : homeName}
            </Button>
          )}
          {!inn.ended && (
            <Button variant="outline" disabled={busy}
              onClick={async () => {
                if (!await confirmDialog({
                  title: 'Retire the striker?',
                  message: 'A retirement is not a dismissal and costs no wicket. The batter may come back later in the innings.',
                  confirmLabel: 'Retire',
                })) return;
                onEvent({ t: 'retire', batterId: inn.strikerId, reason: 'retired' });
              }}>
              Retire the striker
            </Button>
          )}
          {!inn.ended && (
            <Button variant="outline" disabled={busy}
              onClick={async () => {
                if (!await confirmDialog({
                  title: 'End this innings?',
                  message: 'Use this for a declaration, rain, or a conceded innings. The overs remaining are not bowled.',
                  confirmLabel: 'End the innings',
                })) return;
                onEvent({ t: 'endInnings', reason: 'declared' });
              }}>
              End the innings
            </Button>
          )}
          {!state.ended && (
            <Button variant="danger" disabled={busy} onClick={onFinish}>
              End the match early…
            </Button>
          )}
          {onOpenAdmin && (
            <Button variant="outline" onClick={onOpenAdmin}>
              Awards and the manual scorecard…
            </Button>
          )}
        </div>

        <p className="text-[11px] text-muted">
          Rules in force: {format.name}
          {format.lastManStands ? ' · last batter stands alone' : ''}
          {format.maxOversPerBowler ? ` · max ${format.maxOversPerBowler} overs a bowler` : ''}
        </p>
      </div>
    </Card>
  );
}

/**
 * Ending a match that the rules have not ended.
 *
 * Deliberately demands a REASON rather than offering a bare "sign off": the racquet
 * deck once allowed a sign-off part-way through, which wrote a completed 0-0 with no
 * winner, and standings read it as a legitimate draw. A cricket match abandoned in
 * the twelfth over is a real thing that needs recording - but it must be recorded as
 * that, not as a result.
 */
function FinishPanel({ drawsAllowed, homeName, awayName, onCancel, onEnd }: {
  drawsAllowed: boolean; homeName: string; awayName: string;
  onCancel: () => void; onEnd: (ev: CricketEvent) => void;
}) {
  const [why, setWhy] = useState<'abandoned' | 'conceded_A' | 'conceded_B' | 'draw'>('abandoned');
  return (
    <Card className={cn(SURFACE_BOX, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">Why is the match ending?</h3>
        <Button size="sm" variant="subtle" onClick={onCancel}>Back</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Chips
          value={why}
          stacked
          options={[
            ['abandoned', 'Abandoned — no result'],
            ['conceded_A', `${awayName} conceded — ${homeName} win`],
            ['conceded_B', `${homeName} conceded — ${awayName} win`],
            ...(drawsAllowed ? [['draw', 'Drawn — time ran out'] as [string, string]] : []),
          ]}
          onChange={(v) => setWhy(v as typeof why)}
        />
      </div>
      <Button variant="danger" className="shrink-0" onClick={() => onEnd(
        // A null winner is a DRAW unless the reason says the match was washed out or
        // abandoned, in which case it is void. The engine draws that line, so the
        // reason is the only thing this panel has to get right.
        why === 'abandoned' ? { t: 'end', reason: 'abandoned', winner: null }
          : why === 'draw' ? { t: 'end', reason: 'override', winner: null }
            : { t: 'end', reason: 'conceded', winner: why === 'conceded_A' ? 'A' : 'B' })}>
        End the match
      </Button>
    </Card>
  );
}

/** The scorecard, read straight off the fold. Nothing here is stored. */
function Scorecard({ state, nameOf, ballsPerOver, onClose }: {
  state: CricketState; nameOf: (id?: string | null) => string | null;
  ballsPerOver: number; onClose: () => void;
}) {
  return (
    <Card className={cn(SURFACE_BOX, 'gap-2 p-3')}>
      <div className="flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">Scorecard</h3>
        <Button size="sm" variant="subtle" onClick={onClose}>Close</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {state.innings.map((inn) => (
          <div key={inn.innings} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide">
              Innings {inn.innings} — {inningsLine(inn, ballsPerOver)}
              {inn.endedBy ? <span className="font-normal text-muted"> ({inn.endedBy.replace('_', ' ')})</span> : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-xs tabular-nums">
                <thead className="text-muted">
                  <tr><th className="text-left font-normal">Batting</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th className="text-left font-normal">How out</th></tr>
                </thead>
                <tbody>
                  {inn.batting.map((b) => (
                    <tr key={b.playerId} className="border-t border-line">
                      <td className="py-1 text-left">{nameOf(b.playerId) ?? b.playerId}</td>
                      <td className={cn('text-center', !b.out && 'font-semibold')}>{b.runs}{!b.out ? '*' : ''}</td>
                      <td className="text-center">{b.ballsFaced}</td>
                      <td className="text-center">{b.fours}</td>
                      <td className="text-center">{b.sixes}</td>
                      <td className="text-left text-muted">
                        {b.out ? DISMISSAL_LABEL[b.dismissal as Dismissal] ?? b.dismissal : 'not out'}
                        {b.fielderId ? ` (${nameOf(b.fielderId) ?? ''})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-muted">Extras {extrasLine(inn)}</div>

            {inn.bowling.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] text-xs tabular-nums">
                  <thead className="text-muted">
                    <tr><th className="text-left font-normal">Bowling</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
                  </thead>
                  <tbody>
                    {inn.bowling.map((b) => (
                      <tr key={b.playerId} className="border-t border-line">
                        <td className="py-1 text-left">{nameOf(b.playerId) ?? b.playerId}</td>
                        <td className="text-center">{oversOf(b.ballsBowled, ballsPerOver)}</td>
                        <td className="text-center">{b.maidens}</td>
                        <td className="text-center">{b.runsConceded}</td>
                        <td className="text-center font-semibold">{b.wickets}</td>
                        <td className="text-center">{b.ballsBowled ? economy(b, ballsPerOver).toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------- small pieces ----------------------------- */

function Group({ label, hint, qa, children }: {
  label: string; hint?: string; qa?: string; children: React.ReactNode;
}) {
  return (
    <div data-qa={qa}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">{label}</div>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A row of choices as chips rather than a `<select>`.
 *
 * A native select on a phone opens a full-screen wheel, which is exactly the thing
 * this deck exists to avoid: it covers the score, and dismissing it is a second tap.
 * Chips stay in place and are one tap.
 */
function Chips({ value, options, onChange, stacked }: {
  value: string; options: Array<[string, string]>; onChange: (v: string) => void; stacked?: boolean;
}) {
  return (
    <div className={cn('flex gap-1.5', stacked ? 'flex-col' : 'flex-wrap')}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={cn(
            'min-h-[2.25rem] rounded-full px-3 py-1 text-xs font-semibold transition active:scale-[0.97]',
            stacked && 'text-left',
            value === v
              ? 'bg-brand-600 text-white'
              : 'border border-line bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}
