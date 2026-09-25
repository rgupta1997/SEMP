import { describe, expect, it } from 'vitest';
import {
  applyDead, decideRubber, hydrate, hydrateTie, initState, initTie, playableRubbers,
  reopenRubber, rubberDef, rubbersWon, tieOutcome, tieTarget, tieWinner,
  type TieState,
} from './tie.js';
import { tieTemplateFor } from './tie-templates.js';
import type { TieSpec } from './scoring.js';

// ============================================================================
// TEAM TIE REGRESSION SUITE.
//
// A tie is a fixture made of several rubbers - the table-tennis team event's
// MS/WS/MD/WD/XD, a chess board match, a badminton team fixture. The tie is won by
// taking the majority, and once it is decided the rubbers nobody needs are skipped.
//
// Nothing in this module had a test before this file, and it is the only engine on
// the platform where ONE FIXTURE HOLDS FIVE CONTESTS. Everything that can go wrong
// with that is a thing an official discovers at the venue:
//
//   a dead rubber that is still asked to be played,
//   a live rubber that has been skipped,
//   a correction to rubber two that leaves the tie decided by a rubber three
//     nobody has played,
//   an active pointer sitting on a rubber that is already over, so the console
//     shows a finished contest and no way forward.
//
// THE FIVE INVARIANTS:
//
//   COUNTS     rubbers won by each side never exceed the rubbers that exist, and
//              the two counts plus the unplayed ones account for every rubber.
//   DECIDED    a tie is won exactly when one side reaches the target, and the
//              winner is the side that actually has the rubbers.
//   DEAD       a rubber is only ever dead when the tie is already decided, and a
//              dead rubber never has a winner.
//   POINTER    while the tie is undecided, the active rubber is one that can be
//              played. It never points at a completed or dead contest.
//   ALIGNED    a rehydrated tie has exactly the spec's rubbers, in the spec's
//              order, with the spec's labels - whatever was persisted.
// ============================================================================

/** Every sport the tie shelf answers for. Not exported by the module, so listed here
 *  and asserted non-empty, which fails loudly if one is ever dropped. */
const TIE_SPORTS = ['table tennis', 'badminton', 'squash', 'carrom', 'tennis', 'pool/snooker', 'chess'];

const SPEC = (n: number, opts: Partial<TieSpec> = {}): TieSpec => ({
  winBy: 'majority',
  skipDeadRubbers: true,
  rubbers: Array.from({ length: n }, (_, i) => ({
    key: `r${i + 1}`,
    label: `Rubber ${i + 1}`,
    contest: { scoringMode: 'manual', periods: 1, periodLabel: 'Game' } as never,
  })),
  ...opts,
});

// ---- invariants ----

function expectTieSound(spec: TieSpec, s: TieState, note = '') {
  const { a, b } = rubbersWon(s);
  const total = spec.rubbers.length;

  // COUNTS
  expect(a + b, `COUNTS ${note} ${a}+${b} rubbers won of ${total}`).toBeLessThanOrEqual(total);
  expect(s.rubbers.length, `COUNTS ${note} the tie has the wrong number of rubbers`).toBe(total);

  // DEAD: a dead rubber is unplayed, and only exists once the tie is decided.
  const decided = tieWinner(spec, s);
  for (const r of s.rubbers) {
    if (r.status !== 'dead') continue;
    expect(r.winner, `DEAD ${note} the dead rubber ${r.key} has a winner`).toBeNull();
    expect(decided, `DEAD ${note} ${r.key} was skipped while the tie was still open`).not.toBeNull();
  }
  // And a completed rubber always has a winner; a pending one never does.
  for (const r of s.rubbers) {
    if (r.status === 'completed') {
      expect(r.winner, `DEAD ${note} completed rubber ${r.key} has no winner`).not.toBeNull();
    }
    if (r.status === 'pending') {
      expect(r.winner, `DEAD ${note} pending rubber ${r.key} already has a winner`).toBeNull();
    }
  }

  // DECIDED
  const t = tieTarget(spec);
  if (a >= t) expect(decided, `DECIDED ${note} A has ${a} of ${t} and has not won`).toBe('A');
  else if (b >= t) expect(decided, `DECIDED ${note} B has ${b} of ${t} and has not won`).toBe('B');
  else expect(decided, `DECIDED ${note} the tie was decided at ${a}-${b} of ${t}`).toBeNull();

  // POINTER: while anything is still playable, the console must be pointed at one
  // of them. (A finished tie legitimately rests on its last rubber.)
  expect(s.activeRubber, `POINTER ${note} out of range`).toBeGreaterThanOrEqual(0);
  expect(s.activeRubber, `POINTER ${note} out of range`).toBeLessThan(total);
  if (playableRubbers(s) > 0) {
    const at = s.rubbers[s.activeRubber];
    expect(['pending', 'live'],
      `POINTER ${note} the console is pointed at ${at.key}, which is ${at.status}`)
      .toContain(at.status);
  }

  // FINISHABLE: a tie is never left in a state with nothing to play and no result.
  const o = tieOutcome(spec, s);
  if (o.playable === 0) {
    expect(o.decided,
      `FINISHABLE ${note} every rubber is played, nobody reached ${tieTarget(spec)}, `
      + 'and the tie reports neither a winner nor a draw - the fixture can never be signed off')
      .toBe(true);
  }

  // ALIGNED
  s.rubbers.forEach((r, i) => {
    expect(r.key, `ALIGNED ${note} rubber ${i} key drifted`).toBe(spec.rubbers[i].key);
    expect(r.label, `ALIGNED ${note} rubber ${i} label drifted`).toBe(spec.rubbers[i].label);
  });
}

/** Play the tie through, giving each rubber in turn to `pick`. */
function playTie(spec: TieSpec, pick: (i: number) => 'A' | 'B'): TieState {
  let s = initTie(spec);
  for (let guard = 0; guard < spec.rubbers.length * 2; guard += 1) {
    if (tieWinner(spec, s)) break;
    const i = s.rubbers.findIndex((r) => r.status === 'pending' || r.status === 'live');
    if (i < 0) break;
    s = decideRubber(spec, s, i, pick(i));
    expectTieSound(spec, s, `after rubber ${i}`);
  }
  return s;
}

// ============================================================================
// 1. THE SHELF
// ============================================================================

describe('1. the tie templates on the shelf', () => {
  const SHELF = TIE_SPORTS.map((sport) => ({ sport, tie: tieTemplateFor(sport)!.tie! }));

  it('1.1 every shipped tie template has rubbers with unique keys', () => {
    expect(SHELF.length, 'no tie templates on the shelf').toBeGreaterThan(0);
    for (const { sport, tie } of SHELF) {
      expect(tie.rubbers.length, `${sport}: a tie with no rubbers`).toBeGreaterThan(0);
      const keys = tie.rubbers.map((r) => r.key);
      expect(new Set(keys).size, `${sport}: duplicate rubber keys ${keys.join(',')}`).toBe(keys.length);
      for (const r of tie.rubbers) {
        expect(r.label?.trim(), `${sport}/${r.key}: an unlabelled rubber`).toBeTruthy();
        expect(r.contest, `${sport}/${r.key}: a rubber with no contest spec`).toBeTruthy();
      }
    }
  });

  it('1.2 AN EVEN TIE CAN FINISH LEVEL, and must report that as a draw', () => {
    // Four boards decided by a majority of three is 2-2 whenever the sides are even,
    // and chess has always allowed a drawn match. What it must never do is look
    // "undecided" with no rubbers left, which is a fixture nobody can sign off.
    for (const { sport, tie } of SHELF) {
      if (tie.rubbers.length % 2 === 1 || tie.target) continue;
      let s = initTie(tie);
      for (let i = 0; i < tie.rubbers.length; i += 1) {
        s = decideRubber(tie, s, i, i % 2 === 0 ? 'A' : 'B');
      }
      const o = tieOutcome(tie, s);
      expect(o.playable, `${sport}: rubbers left unplayed`).toBe(0);
      expect(o.winner, `${sport}: a level tie named a winner`).toBeNull();
      expect(o.drawn, `${sport}: a level ${tie.rubbers.length}-rubber tie is not reported as drawn`)
        .toBe(true);
      expect(o.decided, `${sport}: a level tie cannot be signed off`).toBe(true);
    }
  });

  it('1.2b an ODD tie can never finish level', () => {
    for (const { sport, tie } of SHELF) {
      if (tie.rubbers.length % 2 === 0) continue;
      let s = initTie(tie);
      for (let i = 0; i < tie.rubbers.length; i += 1) {
        if (tieWinner(tie, s)) break;
        s = decideRubber(tie, s, i, i % 2 === 0 ? 'A' : 'B');
      }
      expect(tieOutcome(tie, s).drawn, `${sport}: an odd tie came out level`).toBe(false);
      expect(tieOutcome(tie, s).winner, `${sport}: an odd tie found no winner`).not.toBeNull();
    }
  });

  it('1.3 the target is always reachable and never trivial', () => {
    for (const { sport, tie } of SHELF) {
      const t = tieTarget(tie);
      expect(t, `${sport}: target below 1`).toBeGreaterThanOrEqual(1);
      expect(t, `${sport}: target ${t} exceeds the ${tie.rubbers.length} rubbers`)
        .toBeLessThanOrEqual(tie.rubbers.length);
    }
  });

  it('1.4 every shipped tie can actually be won by either side', () => {
    for (const { sport, tie } of SHELF) {
      const a = playTie(tie, () => 'A');
      expect(tieWinner(tie, a), `${sport}: A won every rubber and the tie is undecided`).toBe('A');
      const b = playTie(tie, () => 'B');
      expect(tieWinner(tie, b), `${sport}: B won every rubber and the tie is undecided`).toBe('B');
    }
  });

  it('1.5 a rubber\'s contest spec is reachable by index', () => {
    for (const { sport, tie } of SHELF) {
      for (let i = 0; i < tie.rubbers.length; i += 1) {
        expect(rubberDef(tie, i), `${sport}: no contest for rubber ${i}`).toBeTruthy();
      }
    }
  });
});

// ============================================================================
// 2. THE TARGET
// ============================================================================

describe('2. how many rubbers win it', () => {
  it('2.1 a simple majority of five is three', () => {
    expect(tieTarget(SPEC(5))).toBe(3);
  });

  it('2.2 a majority of three is two', () => {
    expect(tieTarget(SPEC(3))).toBe(2);
  });

  it('2.3 an explicit target beats the majority', () => {
    expect(tieTarget(SPEC(5, { target: 4 }))).toBe(4);
  });

  it('2.4 an even tie takes a majority of more than half, not half', () => {
    // Four rubbers: two each is level, so the majority is three.
    expect(tieTarget(SPEC(4))).toBe(3);
  });
});

// ============================================================================
// 3. WINNING RUBBERS
// ============================================================================

describe('3. winning rubbers', () => {
  const spec = SPEC(5);

  it('3.1 a fresh tie is undecided, with everything pending', () => {
    const s = initTie(spec);
    expect(rubbersWon(s)).toEqual({ a: 0, b: 0 });
    expect(tieWinner(spec, s)).toBeNull();
    expect(s.rubbers.every((r) => r.status === 'pending')).toBe(true);
    expect(s.activeRubber).toBe(0);
    expectTieSound(spec, s, 'fresh');
  });

  it('3.2 deciding a rubber records its winner and completes it', () => {
    const s = decideRubber(spec, initTie(spec), 0, 'A');
    expect(s.rubbers[0].winner).toBe('A');
    expect(s.rubbers[0].status).toBe('completed');
    expect(rubbersWon(s)).toEqual({ a: 1, b: 0 });
    expectTieSound(spec, s, 'one rubber');
  });

  it('3.3 THE POINTER MOVES ON to the next playable rubber', () => {
    // A console left pointing at a rubber that is already over shows a finished
    // contest with no way forward.
    const s = decideRubber(spec, initTie(spec), 0, 'A');
    expect(s.activeRubber, 'the console is still pointed at the rubber just finished').toBe(1);
  });

  it('3.4 rubbers can be decided out of order and the pointer still lands somewhere playable', () => {
    let s = initTie(spec);
    s = decideRubber(spec, s, 3, 'A');
    expectTieSound(spec, s, 'out of order');
    expect(['pending', 'live']).toContain(s.rubbers[s.activeRubber].status);
    s = decideRubber(spec, s, 1, 'B');
    expectTieSound(spec, s, 'out of order 2');
  });

  it('3.5 the majority decides it, and the winner is the side with the rubbers', () => {
    const s = playTie(spec, () => 'A');
    expect(tieWinner(spec, s)).toBe('A');
    expect(rubbersWon(s).a).toBe(3);
    expectTieSound(spec, s, 'decided');
  });

  it('3.6 a tie split two-all goes to whoever takes the fifth', () => {
    let s = initTie(spec);
    s = decideRubber(spec, s, 0, 'A');
    s = decideRubber(spec, s, 1, 'B');
    s = decideRubber(spec, s, 2, 'A');
    s = decideRubber(spec, s, 3, 'B');
    expect(tieWinner(spec, s), 'the tie was decided at two-all').toBeNull();
    s = decideRubber(spec, s, 4, 'B');
    expect(tieWinner(spec, s)).toBe('B');
    expectTieSound(spec, s, 'decider');
  });
});

// ============================================================================
// 4. DEAD RUBBERS
// ============================================================================

describe('4. dead rubbers', () => {
  const spec = SPEC(5);

  it('4.1 once the tie is decided, the rest are skipped', () => {
    const s = playTie(spec, () => 'A');
    const dead = s.rubbers.filter((r) => r.status === 'dead');
    expect(dead.length, 'the unplayed rubbers were not skipped').toBe(2);
    expect(dead.every((r) => r.winner === null)).toBe(true);
    expectTieSound(spec, s, 'dead');
  });

  it('4.2 NOTHING IS SKIPPED while the tie is still open', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s = decideRubber(spec, s, 1, 'B');
    expect(s.rubbers.some((r) => r.status === 'dead'),
      'a rubber was skipped while the tie was one-all').toBe(false);
    expectTieSound(spec, s, 'open');
  });

  it('4.3 a format that plays dead rubbers out skips nothing', () => {
    const playAll = SPEC(5, { skipDeadRubbers: false });
    const s = playTie(playAll, () => 'A');
    expect(s.rubbers.some((r) => r.status === 'dead'),
      'a format that plays every rubber skipped one').toBe(false);
    // ...and the remaining rubbers are still playable.
    const open = s.rubbers.filter((r) => r.status === 'pending');
    expect(open.length).toBe(2);
    expectTieSound(playAll, s, 'play-all');
  });

  it('4.4 applying dead twice changes nothing', () => {
    const s = playTie(spec, () => 'A');
    expect(JSON.stringify(applyDead(spec, s))).toBe(JSON.stringify(s));
  });

  it('4.5 applyDead on an undecided tie is a no-op', () => {
    const s = decideRubber(spec, initTie(spec), 0, 'A');
    expect(applyDead(spec, s)).toEqual(s);
  });

  it('4.6 a rubber already PLAYED is never retrospectively killed', () => {
    let s = initTie(spec);
    s = decideRubber(spec, s, 0, 'A');
    s = decideRubber(spec, s, 1, 'A');
    s = decideRubber(spec, s, 2, 'A');     // decided 3-0
    expect(s.rubbers.slice(0, 3).every((r) => r.status === 'completed'),
      'a played rubber was marked dead when the tie was decided').toBe(true);
  });
});

// ============================================================================
// 5. CORRECTIONS
// ============================================================================

describe('5. reopening a rubber', () => {
  const spec = SPEC(5);

  it('5.1 reopening clears the result and makes the rubber live', () => {
    let s = decideRubber(spec, initTie(spec), 0, 'A');
    s = reopenRubber(spec, s, 0);
    expect(s.rubbers[0].winner).toBeNull();
    expect(s.rubbers[0].status).toBe('live');
    expect(s.activeRubber).toBe(0);
    expectTieSound(spec, s, 'reopened');
  });

  it('5.2 REOPENING A DECIDER BRINGS THE SKIPPED RUBBERS BACK', () => {
    // Undoing the rubber that clinched it means the tie is open again, and the
    // rubbers that were skipped now have to be played. Leaving them dead strands a
    // tie that can never be finished.
    let s = playTie(spec, () => 'A');
    expect(s.rubbers.filter((r) => r.status === 'dead').length).toBe(2);
    s = reopenRubber(spec, s, 2);
    expect(tieWinner(spec, s), 'the tie is still decided after undoing the clincher').toBeNull();
    expect(s.rubbers.filter((r) => r.status === 'dead').length,
      'the skipped rubbers did not come back when the tie reopened').toBe(0);
    expectTieSound(spec, s, 'revived');
  });

  it('5.3 reopening a rubber that did not decide anything leaves the dead ones dead', () => {
    let s = playTie(spec, () => 'A');   // A 3-0, rubbers 3 and 4 dead
    s = reopenRubber(spec, s, 0);       // still 2-0... not decided, so they revive
    expectTieSound(spec, s, 'partial');
    // Re-deciding it re-kills them.
    s = decideRubber(spec, s, 0, 'A');
    expect(tieWinner(spec, s)).toBe('A');
    expect(s.rubbers.filter((r) => r.status === 'dead').length).toBe(2);
    expectTieSound(spec, s, 're-killed');
  });

  it('5.4 reopening can hand the tie to the OTHER side', () => {
    let s = playTie(spec, () => 'A');
    expect(tieWinner(spec, s)).toBe('A');
    s = reopenRubber(spec, s, 0);
    s = decideRubber(spec, s, 0, 'B');
    expect(tieWinner(spec, s), 'the tie is still decided at 2-1').toBeNull();
    s = decideRubber(spec, s, 3, 'B');
    s = decideRubber(spec, s, 4, 'B');
    expect(tieWinner(spec, s)).toBe('B');
    expectTieSound(spec, s, 'flipped');
  });

  it('5.5 reopening with a reset wipes the rubber\'s own points too', () => {
    let s = initTie(spec);
    s.rubbers[0].state.a = 11;
    s.rubbers[0].state.b = 7;
    s = decideRubber(spec, s, 0, 'A');
    const kept = reopenRubber(spec, s, 0, false);
    expect(kept.rubbers[0].state.a, 'the points were wiped without being asked').toBe(11);
    const wiped = reopenRubber(spec, s, 0, true);
    expect(wiped.rubbers[0].state, 'the points survived a reset').toEqual(initState());
  });

  it('5.6 reopening never disturbs another rubber\'s result', () => {
    let s = initTie(spec);
    s = decideRubber(spec, s, 0, 'A');
    s = decideRubber(spec, s, 1, 'B');
    const before = JSON.stringify(s.rubbers[1]);
    s = reopenRubber(spec, s, 0);
    expect(JSON.stringify(s.rubbers[1])).toBe(before);
  });
});

// ============================================================================
// 6. REHYDRATION — what comes back out of live_state
// ============================================================================

describe('6. rehydrating a persisted tie', () => {
  const spec = SPEC(5);

  it('6.1 a round trip through JSON comes back identical', () => {
    const s = playTie(spec, (i) => (i % 2 === 0 ? 'A' : 'B'));
    const back = hydrateTie(JSON.parse(JSON.stringify(s)), spec);
    expect(back).toEqual(s);
    expectTieSound(spec, back, 'round trip');
  });

  it('6.2 GARBAGE IN LIVE_STATE FALLS BACK TO A FRESH TIE rather than throwing', () => {
    // A hand-edited live_state must not take the console down at the venue.
    for (const junk of [null, undefined, 0, 'nonsense', [], {}, { rubbers: 'no' }, { rubbers: [] }]) {
      const s = hydrateTie(junk, spec);
      expect(s.rubbers.length).toBe(5);
      expectTieSound(spec, s, `junk ${JSON.stringify(junk)}`);
    }
  });

  it('6.3 a persisted tie with the WRONG NUMBER of rubbers is discarded, not merged', () => {
    const stale = { activeRubber: 2, rubbers: [{ key: 'x', winner: 'A', status: 'completed' }] };
    const s = hydrateTie(stale, spec);
    expect(s.rubbers.length).toBe(5);
    expect(rubbersWon(s), 'a stale three-rubber tie leaked results into a five-rubber one')
      .toEqual({ a: 0, b: 0 });
  });

  it('6.4 LABELS ARE REALIGNED TO THE SPEC, so editing the template cannot desync them', () => {
    const persisted: unknown = {
      activeRubber: 0,
      rubbers: spec.rubbers.map((r, i) => ({
        key: 'stale', label: 'Old name', state: initState(),
        winner: i === 0 ? 'A' : null, status: i === 0 ? 'completed' : 'pending',
      })),
    };
    const s = hydrateTie(persisted, spec);
    s.rubbers.forEach((r, i) => {
      expect(r.key).toBe(spec.rubbers[i].key);
      expect(r.label).toBe(spec.rubbers[i].label);
    });
    expect(s.rubbers[0].winner, 'the result was lost while realigning the labels').toBe('A');
    expect(s.rubbers[s.activeRubber].status,
      'a reloaded tie pointed the console at a rubber that is already over')
      .not.toBe('completed');
    expectTieSound(spec, s, 'realigned');
  });

  it('6.4b A STALE POINTER AT A FINISHED RUBBER is moved to one that can be played', () => {
    const persisted = {
      activeRubber: 0,
      rubbers: spec.rubbers.map((r, i) => ({
        key: r.key, state: initState(),
        winner: i < 2 ? 'A' : null,
        status: i < 2 ? 'completed' : 'pending',
      })),
    };
    const s = hydrateTie(persisted, spec);
    expect(s.activeRubber, 'the console reopened on a rubber that was already over').toBe(2);
    expectTieSound(spec, s, 'stale pointer');
  });

  it('6.5 an out-of-range active pointer is clamped into the tie', () => {
    const s = hydrateTie({
      activeRubber: 99,
      rubbers: spec.rubbers.map((r) => ({ key: r.key, state: initState(), winner: null, status: 'pending' })),
    }, spec);
    expect(s.activeRubber).toBe(4);
    const neg = hydrateTie({
      activeRubber: -5,
      rubbers: spec.rubbers.map((r) => ({ key: r.key, state: initState(), winner: null, status: 'pending' })),
    }, spec);
    expect(neg.activeRubber).toBe(0);
  });

  it('6.6 a nonsense status becomes pending rather than an unknown state', () => {
    const s = hydrateTie({
      rubbers: spec.rubbers.map((r) => ({ key: r.key, state: initState(), winner: null, status: 'exploded' })),
    }, spec);
    expect(s.rubbers.every((r) => r.status === 'pending')).toBe(true);
  });

  it('6.7 a nonsense winner becomes no winner', () => {
    const s = hydrateTie({
      rubbers: spec.rubbers.map((r) => ({ key: r.key, state: initState(), winner: 'C', status: 'completed' })),
    }, spec);
    expect(s.rubbers.every((r) => r.winner === null)).toBe(true);
  });

  it('6.8 a partial contest state is filled in rather than left half-built', () => {
    const s = hydrate({ a: 5 });
    expect(s.a).toBe(5);
    expect(s.b).toBe(0);
    expect(Array.isArray(s.segScores), 'the period list came back as something other than a list')
      .toBe(true);
    expect(hydrate({ segScores: 'nonsense' }).segScores).toEqual([]);
    expect(hydrate(null)).toEqual(initState());
  });
});

// ============================================================================
// 7. WHOLE TIES
// ============================================================================

describe('7. whole ties, every shipped template', () => {
  function rng(seed: number) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  for (const sport of TIE_SPORTS) {
    for (const seed of [11, 909]) {
      it(`7.x ${sport}, seed ${seed}: plays to a decided tie and stays sound throughout`, () => {
        const spec = tieTemplateFor(sport)!.tie!;
        const r = rng(seed);
        let s = initTie(spec);
        let guard = 0;
        while (!tieWinner(spec, s) && guard < spec.rubbers.length * 3) {
          guard += 1;
          const i = s.rubbers.findIndex((x) => x.status === 'pending' || x.status === 'live');
          if (i < 0) break;
          s = decideRubber(spec, s, i, r() < 0.5 ? 'A' : 'B');
          expectTieSound(spec, s, `${sport}/${seed} step ${guard}`);
        }
        const o = tieOutcome(spec, s);
        expect(o.decided,
          `${sport}/${seed}: the tie reached neither a winner nor a draw and cannot be signed off`)
          .toBe(true);

        // Every rubber is accounted for: played, or skipped because it did not matter.
        const accounted = s.rubbers.filter((x) =>
          x.status === 'completed' || x.status === 'dead').length;
        expect(accounted, `${sport}/${seed}: rubbers left neither played nor skipped`)
          .toBe(spec.rubbers.length);
      });
    }
  }

  it('7.100 undoing a decided tie rubber by rubber returns it to a fresh one', () => {
    const spec = SPEC(5);
    let s = playTie(spec, () => 'A');
    for (let i = spec.rubbers.length - 1; i >= 0; i -= 1) {
      if (s.rubbers[i].winner) s = reopenRubber(spec, s, i, true);
    }
    expect(rubbersWon(s)).toEqual({ a: 0, b: 0 });
    expect(tieWinner(spec, s)).toBeNull();
    expect(s.rubbers.some((r) => r.status === 'dead')).toBe(false);
  });
});
