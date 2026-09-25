import { describe, expect, it } from 'vitest';
import { TEAM_PRESETS } from './team-presets.js';
import {
  aggregateScore, foldRally, headline, isAggregate, periodsPlayed, resultEnvelope,
  type KernelState, type RallyEvent, type RallyLog,
} from './rally-kernel.js';
import type { ScoringFormat, Side } from './scoring-rules.js';
import { deriveTeamStats } from './team-stats.js';
import { statSpecFor } from './stat-registry.js';
import { toCategoryRow } from './category-lines.js';

// ============================================================================
// FOOTBALL, END TO END — every aspect of scoring a match.
//
// Football is the sport an event is most likely to be judged on, and it exercises
// more of the platform at once than anything else on the shelf:
//
//   THE CLOCK      a half does not end at a score, it ends at the whistle. The
//                  kernel owns no clock, so the console sends the whistle.
//   THE AGGREGATE  a match is 2-1 on goals, not "one half each". Reporting units
//                  would publish 1-1 for a match somebody clearly won.
//   THE PEOPLE     a goal belongs to a PERSON, and an assist to a second person on
//                  the same tap. No fold of a scoreline can recover either.
//   THE CARDS      a yellow is a fact worth keeping that moves no score at all.
//   THE DRAW       a league match may end level; a knockout may not.
//
// This file walks one match from the first tap to the typed row a profile reads,
// asserting at each step. The other suites cover the kernel and the registry in
// general; this one asks whether FOOTBALL specifically comes out right.
//
// THE FIVE INVARIANTS:
//
//   SCOREBOARD   the aggregate equals the goals actually credited, and the headline
//                standings read equals the aggregate.
//   ATTRIBUTION  every goal on the scoreboard belongs to exactly one player, and
//                every assist to a team-mate of the scorer.
//   NON-SCORING  a card, a save and a missed penalty change no score at all.
//   PERIODS      the match ends when the halves are played, never on the score.
//   TYPED        every metric the console can produce reaches a real column.
// ============================================================================

const football = (key: string): ScoringFormat => {
  const f = TEAM_PRESETS.find((p) => p.presetKey === key);
  if (!f) throw new Error(`no preset ${key}`);
  return f;
};

const FIFA = () => football('fifa_2x45');
const CORP = () => football('football_corp_2x20');
const KNOCKOUT = () => football('knockout_2x45_no_draw');

// ---- the taps a real console makes ----

/** A goal, by somebody, optionally assisted by a team-mate. */
const goal = (side: Side, by: string, assist?: string): RallyEvent => ({
  t: 'point', side, pts: 1, kind: 'goal', label: 'Goal',
  playerId: by, playerName: by,
  ...(assist ? { secondId: assist, secondName: assist } : {}),
});

/** A penalty converted: a goal that is also a penalty. */
const penScored = (side: Side, by: string): RallyEvent =>
  ({ t: 'point', side, pts: 1, kind: 'pen_scored', label: 'Penalty scored', playerId: by, playerName: by });

/** Everything that changes no score. */
const nonScoring = (kind: string, label: string) => (side: Side, by: string): RallyEvent =>
  ({ t: 'point', side, pts: 0, kind, label, playerId: by, playerName: by });

const penMissed = nonScoring('pen_missed', 'Penalty missed');
const save = nonScoring('save', 'Save');
const yellow = nonScoring('yellow', 'Yellow card');
const red = nonScoring('red', 'Red card');

/**
 * An own goal, put in by `by` - who plays for `conceded`.
 *
 * The event's `side` is who the GOAL goes to, which is the other team. This is the
 * one action where the scoreboard and the player's record point in opposite
 * directions, and the console fires it exactly like this.
 */
const ownGoal = (conceded: Side, by: string): RallyEvent => ({
  t: 'point', side: conceded === 'A' ? 'B' : 'A', pts: 1,
  kind: 'own_goal', label: 'Own goal', playerId: by, playerName: by,
});

const whistle = (): RallyEvent => ({ t: 'endPeriod' });

const play = (f: ScoringFormat, log: RallyLog): KernelState => foldRally(f, log, 'A').state;

const ROSTER = {
  A: ['a1', 'a2', 'a3', 'a4', 'a5'],
  B: ['b1', 'b2', 'b3', 'b4', 'b5'],
};
const sideOf = new Map<string, Side>([
  ...ROSTER.A.map((id) => [id, 'A'] as [string, Side]),
  ...ROSTER.B.map((id) => [id, 'B'] as [string, Side]),
]);
const roster = [
  ...ROSTER.A.map((userId) => ({ userId, side: 'A' as Side })),
  ...ROSTER.B.map((userId) => ({ userId, side: 'B' as Side })),
];

const derive = (log: RallyLog) => deriveTeamStats('football', log, { sideOf, roster });
const n = (bag: Record<string, number>, k: string) => bag[k] ?? 0;

// ---- invariants ----

/** Every goal on the scoreboard is credited to exactly one player. */
function expectAttributionBalances(log: RallyLog, note = '') {
  const d = derive(log);
  for (const side of ['A', 'B'] as Side[]) {
    const onBoard = log.filter((e) => e.t === 'point' && (e as never as { side: Side }).side === side)
      .reduce((sum, e) => sum + (((e as never as { pts?: number }).pts) ?? 1), 0);
    const credited = d.players
      .filter((p) => p.side === side)
      .reduce((sum, p) => sum + n(p.stats, 'goals'), 0);
    // An own goal is on the board for this side but in nobody's goals tally - it is
    // in the CONCEDING side's own-goal tally instead.
    const ownGoalsGifted = d.players
      .filter((p) => p.side !== side)
      .reduce((sum, p) => sum + n(p.stats, 'own_goals'), 0);
    expect(credited + ownGoalsGifted,
      `ATTRIBUTION ${note} side ${side}: scoreboard ${onBoard}, players credited with `
      + `${credited} goals and gifted ${ownGoalsGifted} own goals`).toBe(onBoard);
  }
}

/** An assist always belongs to a team-mate of the scorer, never an opponent. */
function expectAssistsAreTeamMates(log: RallyLog, note = '') {
  for (const raw of log) {
    if (raw.t !== 'point') continue;
    const ev = raw as never as { kind?: string; side: Side; playerId?: string; secondId?: string };
    if (!ev.secondId) continue;
    expect(sideOf.get(ev.secondId), `ATTRIBUTION ${note} ${ev.secondId} assisted a goal for `
      + `side ${ev.side} but plays for ${sideOf.get(ev.secondId)}`).toBe(ev.side);
    expect(ev.secondId, `ATTRIBUTION ${note} somebody assisted their own goal`)
      .not.toBe(ev.playerId);
  }
}

// ============================================================================
// 1. THE FORMATS ON THE SHELF
// ============================================================================

describe('1. the football formats', () => {
  it('1.1 all three are two halves decided on the aggregate', () => {
    for (const f of [FIFA(), CORP(), KNOCKOUT()]) {
      expect(isAggregate(f), `${f.presetKey}`).toBe(true);
      expect(f.levels[0].terminator, `${f.presetKey}: a half that ends on a score`).toBe('clock');
      expect(f.levels[f.levels.length - 1].target, `${f.presetKey}: not two halves`).toBe(2);
    }
  });

  it('1.2 a league match may end level; a knockout may not', () => {
    expect(FIFA().endStates.drawsAllowed).toBe(true);
    expect(CORP().endStates.drawsAllowed).toBe(true);
    expect(KNOCKOUT().endStates.drawsAllowed, 'a knockout that allows a draw').toBe(false);
  });

  it('1.3 each carries a clock, and the full match is twice the half', () => {
    expect(FIFA().clock?.minutes).toBe(90);
    expect(CORP().clock?.minutes).toBe(40);
    expect(KNOCKOUT().clock?.minutes).toBe(90);
  });

  it('1.4 football declares every action a console needs to record', () => {
    const spec = statSpecFor('football');
    expect(spec, 'football has no stat spec').toBeTruthy();
    const keys = (spec!.events ?? []).map((e) => e.key);
    for (const needed of ['goal', 'own_goal', 'save', 'yellow', 'red', 'pen_scored', 'pen_missed']) {
      expect(keys, `football cannot record a ${needed}`).toContain(needed);
    }
  });

  it('1.5 exactly three actions move the scoreboard, and one of them the other way', () => {
    const spec = statSpecFor('football')!;
    const scoring = spec.events.filter((e) => (e.points ?? 0) > 0).map((e) => e.key).sort();
    expect(scoring, 'the wrong set of actions is worth a goal')
      .toEqual(['goal', 'own_goal', 'pen_scored']);
    // And the own goal is the one that scores for the opposition.
    const og = spec.events.find((e) => e.key === 'own_goal')!;
    expect(og.forOpponent, 'an own goal scores for the side that put it in').toBe(true);
    for (const e of spec.events) {
      if (e.key === 'own_goal') continue;
      expect(e.forOpponent, `${e.key} scores for the opposition`).toBeFalsy();
    }
  });

  it('1.6 a goal asks for the assist on the SAME tap', () => {
    const spec = statSpecFor('football')!;
    const g = spec.events.find((e) => e.key === 'goal')!;
    expect(g.secondPlayer, 'a goal does not offer an assist').toBeTruthy();
    expect(g.secondPlayer!.optional, 'the assist is compulsory').toBe(true);
    expect(g.secondPlayerMetrics).toEqual({ assists: 1 });
  });
});

// ============================================================================
// 2. THE SCOREBOARD
// ============================================================================

describe('2. the scoreboard', () => {
  it('2.1 a goal is one on the board, for the side that scored it', () => {
    const s = play(FIFA(), [goal('A', 'a1')]);
    expect(aggregateScore(s)).toEqual([1, 0]);
  });

  it('2.2 the match is decided on the TOTAL, not on halves won', () => {
    const s = play(FIFA(), [
      goal('A', 'a1'), goal('A', 'a2'), whistle(),   // half one: A 2-0
      goal('B', 'b1'), whistle(),                    // half two: B 1-0
    ]);
    expect(aggregateScore(s)).toEqual([2, 1]);
    expect(headline(FIFA(), s), 'football reported halves instead of goals').toEqual([2, 1]);
    expect(s.winner).toBe('A');
  });

  it('2.3 the side that wins the SECOND half can still lose the match', () => {
    const s = play(FIFA(), [
      goal('A', 'a1'), goal('A', 'a2'), goal('A', 'a3'), whistle(),
      goal('B', 'b1'), goal('B', 'b2'), whistle(),
    ]);
    expect(aggregateScore(s)).toEqual([3, 2]);
    expect(s.winner, 'the match went to whoever won the last half').toBe('A');
  });

  it('2.4 a converted penalty is a goal on the board', () => {
    const s = play(FIFA(), [penScored('A', 'a1')]);
    expect(aggregateScore(s)).toEqual([1, 0]);
  });

  it('2.5 A CARD, A SAVE AND A MISSED PENALTY MOVE NO SCORE', () => {
    const log: RallyLog = [
      yellow('A', 'a1'), red('B', 'b1'), save('B', 'b5'), penMissed('A', 'a2'),
    ];
    const s = play(FIFA(), log);
    expect(aggregateScore(s), 'a non-scoring action changed the score').toEqual([0, 0]);
  });

  it('2.6 the running half is shown apart from the total', () => {
    const s = play(FIFA(), [goal('A', 'a1'), whistle(), goal('A', 'a2')]);
    expect(aggregateScore(s)).toEqual([2, 0]);
    expect(s.score[0], 'the second half did not start level').toEqual([1, 0]);
  });

  it('2.7 each half is banked and readable afterwards', () => {
    const s = play(FIFA(), [
      goal('A', 'a1'), goal('B', 'b1'), whistle(),
      goal('A', 'a2'), whistle(),
    ]);
    const env = resultEnvelope(FIFA(), s);
    expect(env.unitScores).toEqual([[1, 1], [1, 0]]);
  });
});

// ============================================================================
// 3. THE CLOCK
// ============================================================================

describe('3. the clock', () => {
  it('3.1 A HALF NEVER ENDS ON THE SCORE, however many are scored', () => {
    const s = play(FIFA(), Array.from({ length: 9 }, (_, i) => goal('A', `a${(i % 5) + 1}`)));
    expect(s.finished.length, 'a half ended itself on the score').toBe(0);
    expect(s.ended).toBe(false);
    expect(aggregateScore(s)).toEqual([9, 0]);
  });

  it('3.2 the whistle banks the half and starts the next level', () => {
    const s = play(FIFA(), [goal('A', 'a1'), whistle()]);
    expect(periodsPlayed(s)).toBe(1);
    expect(s.score[0], 'the second half did not start level').toEqual([0, 0]);
    expect(s.ended, 'the match ended after one half').toBe(false);
  });

  it('3.3 the match ends only when both halves are played', () => {
    const one = play(FIFA(), [goal('A', 'a1'), whistle()]);
    expect(one.ended).toBe(false);
    const two = play(FIFA(), [goal('A', 'a1'), whistle(), whistle()]);
    expect(two.ended).toBe(true);
    expect(two.winner).toBe('A');
  });

  it('3.4 THE FULL-TIME BUZZER COMPARES THE WHOLE MATCH, not the half in progress', () => {
    // A side four up from the first half is still ahead when the second half is 0-1
    // and the hall booking runs out.
    const s = play(FIFA(), [
      goal('A', 'a1'), goal('A', 'a2'), goal('A', 'a3'), goal('A', 'a4'), whistle(),
      goal('B', 'b1'), { t: 'capFired' },
    ]);
    expect(aggregateScore(s)).toEqual([4, 1]);
    expect(s.winner, 'the buzzer gave it to whoever was scoring in the live half').toBe('A');
    expect(s.reason).toBe('cap');
  });

  it('3.5 a buzzer with the sides level does not invent a winner in a knockout', () => {
    const s = play(KNOCKOUT(), [goal('A', 'a1'), whistle(), goal('B', 'b1'), { t: 'capFired' }]);
    expect(s.winner, 'a knockout picked a winner from a level score').toBeNull();
  });
});

// ============================================================================
// 4. THE RESULT
// ============================================================================

describe('4. the result', () => {
  it('4.1 a league match may end level, and says so', () => {
    const s = play(FIFA(), [goal('A', 'a1'), whistle(), goal('B', 'b1'), whistle()]);
    expect(s.ended).toBe(true);
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
    expect(headline(FIFA(), s)).toEqual([1, 1]);
  });

  it('4.2 A KNOCKOUT LEFT LEVEL STAYS OPEN rather than inventing a winner', () => {
    // Extra time or a shoot-out settles it. Publishing a winner here would record a
    // result nobody played for.
    const s = play(KNOCKOUT(), [goal('A', 'a1'), whistle(), goal('B', 'b1'), whistle()]);
    expect(s.ended, 'a level knockout was closed').toBe(false);
    expect(s.winner).toBeNull();
  });

  it('4.3 a goalless draw is a real result, not a match that never started', () => {
    const s = play(FIFA(), [whistle(), whistle()]);
    expect(s.ended).toBe(true);
    expect(s.outcome).toBe('draw');
    expect(headline(FIFA(), s)).toEqual([0, 0]);
  });

  it('4.4 an abandoned match names nobody and is void', () => {
    const s = play(FIFA(), [
      goal('A', 'a1'), { t: 'end', outcome: 'void', reason: 'abandoned', winner: null },
    ]);
    expect(s.outcome).toBe('void');
    expect(s.winner).toBeNull();
  });

  it('4.5 a conceded match names a winner without the halves being played', () => {
    const s = play(FIFA(), [{ t: 'end', outcome: 'win', reason: 'conceded', winner: 'B' }]);
    expect(s.winner).toBe('B');
    expect(s.reason).toBe('conceded');
  });

  it('4.6 the headline never puts the loser ahead', () => {
    const s = play(FIFA(), [goal('B', 'b1'), goal('B', 'b2'), whistle(), goal('A', 'a1'), whistle()]);
    const h = headline(FIFA(), s);
    expect(s.winner).toBe('B');
    expect(h[1]).toBeGreaterThan(h[0]);
  });
});

// ============================================================================
// 5. WHO GETS THE CREDIT
// ============================================================================

describe('5. attribution', () => {
  it('5.1 a goal is credited to the scorer, and to nobody else', () => {
    const d = derive([goal('A', 'a1')]);
    expect(d.players.length).toBe(1);
    expect(d.players[0].userId).toBe('a1');
    expect(n(d.players[0].stats, 'goals')).toBe(1);
  });

  it('5.2 AN ASSIST IS ONE TAP WITH THE GOAL, and reaches the team-mate', () => {
    // An assist recorded as a separate tap is an assist nobody remembers to record.
    const d = derive([goal('A', 'a1', 'a2')]);
    const scorer = d.players.find((p) => p.userId === 'a1')!;
    const assister = d.players.find((p) => p.userId === 'a2')!;
    expect(n(scorer.stats, 'goals')).toBe(1);
    expect(n(scorer.stats, 'assists'), 'the scorer was credited with their own assist').toBe(0);
    expect(n(assister.stats, 'assists')).toBe(1);
    expect(n(assister.stats, 'goals'), 'the assister was credited with the goal').toBe(0);
    expect(assister.side, 'the assist was filed against the wrong side').toBe('A');
  });

  it('5.3 a converted penalty is both a goal and a penalty', () => {
    const d = derive([penScored('A', 'a1')]);
    const p = d.players[0].stats;
    expect(n(p, 'goals'), 'a converted penalty was not a goal').toBe(1);
    expect(n(p, 'pens_scored')).toBe(1);
  });

  it('5.4 a missed penalty is recorded and is NOT a goal', () => {
    const d = derive([penMissed('A', 'a1')]);
    expect(n(d.players[0].stats, 'pens_missed')).toBe(1);
    expect(n(d.players[0].stats, 'goals'), 'a missed penalty counted as a goal').toBe(0);
  });

  it('5.5 cards reach the player and score nothing', () => {
    const d = derive([yellow('A', 'a1'), yellow('A', 'a1'), red('A', 'a1')]);
    const p = d.players[0].stats;
    expect(n(p, 'yellows')).toBe(2);
    expect(n(p, 'reds')).toBe(1);
    expect(n(p, 'goals')).toBe(0);
  });

  it('5.6 a save is the keeper\'s, and belongs to the side that made it', () => {
    const d = derive([save('B', 'b5'), save('B', 'b5')]);
    expect(n(d.players[0].stats, 'saves')).toBe(2);
    expect(d.players[0].side).toBe('B');
  });

  it('5.7 AN OWN GOAL COUNTS FOR THE OTHER SIDE', () => {
    // The whole point of an own goal: the team that conceded it goes a goal DOWN,
    // and the scoreboard must show it. Recording only the player's own_goals tally
    // leaves the scoreline a goal short of the match that was played.
    const s = play(FIFA(), [ownGoal('A', 'a3')]);
    expect(aggregateScore(s), 'an own goal by A did not give B the goal').toEqual([0, 1]);
  });

  it('5.8 and it is still recorded against the player who put it in', () => {
    const d = derive([ownGoal('A', 'a3')]);
    const p = d.players.find((x) => x.userId === 'a3');
    expect(p, 'the own goal was not recorded against anybody').toBeTruthy();
    expect(n(p!.stats, 'own_goals')).toBe(1);
    expect(n(p!.stats, 'goals'), 'an own goal was credited as a goal').toBe(0);
  });

  it('5.9 two goals by the same player are two goals, not two players', () => {
    const d = derive([goal('A', 'a1'), goal('A', 'a1')]);
    expect(d.players.length).toBe(1);
    expect(n(d.players[0].stats, 'goals')).toBe(2);
  });

  it('5.10 an unattributed tap still moves the score and credits nobody', () => {
    const s = play(FIFA(), [{ t: 'point', side: 'A', pts: 1 }]);
    expect(aggregateScore(s)).toEqual([1, 0]);
    expect(derive([{ t: 'point', side: 'A', pts: 1 }]).players.length).toBe(0);
  });

  it('5.11 nobody outside the two team sheets is ever credited', () => {
    const d = derive([goal('A', 'a1', 'a2'), save('B', 'b5'), yellow('B', 'b2')]);
    for (const p of d.players) {
      expect(sideOf.has(p.userId), `${p.userId} is on neither team sheet`).toBe(true);
      expect(p.side, `${p.userId} was filed on the wrong side`).toBe(sideOf.get(p.userId));
    }
  });
});

// ============================================================================
// 6. A WHOLE MATCH, TAP BY TAP
// ============================================================================

describe('6. a whole match', () => {
  /** The taps an official actually makes over ninety minutes. */
  const MATCH: RallyLog = [
    // first half
    goal('A', 'a1', 'a2'),
    save('B', 'b5'),
    yellow('B', 'b3'),
    goal('B', 'b1', 'b2'),
    penMissed('A', 'a4'),
    goal('A', 'a2', 'a1'),
    whistle(),
    // second half
    save('A', 'a5'),
    penScored('B', 'b4'),
    red('A', 'a3'),
    goal('A', 'a1'),
    save('B', 'b5'),
    whistle(),
  ];

  it('6.1 the scoreline is what the goals say it is', () => {
    const s = play(FIFA(), MATCH);
    expect(aggregateScore(s)).toEqual([3, 2]);
    expect(headline(FIFA(), s)).toEqual([3, 2]);
    expect(s.winner).toBe('A');
    expect(s.ended).toBe(true);
  });

  it('6.2 both halves are banked with their own scores', () => {
    const env = resultEnvelope(FIFA(), play(FIFA(), MATCH));
    expect(env.unitScores).toEqual([[2, 1], [1, 1]]);
  });

  it('6.3 every goal on the board belongs to exactly one player', () => {
    expectAttributionBalances(MATCH, 'whole match');
  });

  it('6.4 every assist belongs to a team-mate of the scorer', () => {
    expectAssistsAreTeamMates(MATCH, 'whole match');
  });

  it('6.5 the full card reads the way a match report would', () => {
    const d = derive(MATCH);
    const of = (id: string) => d.players.find((p) => p.userId === id)?.stats ?? {};
    expect(n(of('a1'), 'goals')).toBe(2);
    expect(n(of('a1'), 'assists')).toBe(1);
    expect(n(of('a2'), 'goals')).toBe(1);
    expect(n(of('a2'), 'assists')).toBe(1);
    expect(n(of('a4'), 'pens_missed')).toBe(1);
    expect(n(of('a3'), 'reds')).toBe(1);
    expect(n(of('a5'), 'saves')).toBe(1);
    expect(n(of('b1'), 'goals')).toBe(1);
    expect(n(of('b2'), 'assists')).toBe(1);
    expect(n(of('b3'), 'yellows')).toBe(1);
    expect(n(of('b4'), 'goals')).toBe(1);
    expect(n(of('b4'), 'pens_scored')).toBe(1);
    expect(n(of('b5'), 'saves')).toBe(2);
  });

  it('6.6 nobody who did nothing gets a line of zeroes', () => {
    const d = derive(MATCH);
    // a-side: a1 a2 a3 a4 a5 all did something; b1 b2 b3 b4 b5 likewise.
    expect(d.players.length).toBe(10);
    for (const p of d.players) {
      const total = Object.values(p.stats).reduce((x, y) => x + y, 0);
      expect(total, `${p.userId} has a line of nothing`).toBeGreaterThan(0);
    }
  });

  it('6.7 undo takes the last tap back, attribution and all', () => {
    // The final tap of the match is the whistle; the one before it is b5's second
    // save. Undoing twice has to take that save off b5's card, not just the log.
    const full = derive(MATCH);
    const less = derive(MATCH.slice(0, -2));
    expect(n(full.players.find((p) => p.userId === 'b5')!.stats, 'saves')).toBe(2);
    expect(n(less.players.find((p) => p.userId === 'b5')!.stats, 'saves')).toBe(1);
    // And the scoreline is untouched by undoing a save.
    expect(aggregateScore(play(FIFA(), MATCH.slice(0, -2)))).toEqual([3, 2]);
  });

  it('6.8 the same log twice is the same match', () => {
    expect(JSON.stringify(derive(MATCH))).toBe(JSON.stringify(derive(MATCH)));
    expect(JSON.stringify(play(FIFA(), MATCH))).toBe(JSON.stringify(play(FIFA(), MATCH)));
  });

  it('6.9 EVERY METRIC THE CONSOLE PRODUCES REACHES A REAL COLUMN', () => {
    // A metric with no column is a tap that is recorded and then dropped at the
    // last step, which is invisible from the console.
    const d = derive(MATCH);
    for (const p of d.players) {
      const mapped = toCategoryRow('football', p.stats, {});
      expect(mapped, `no detail table for football`).toBeTruthy();
      expect(mapped!.table).toBe('invasion_match_lines');
      expect(mapped!.unmapped, `${p.userId}: ${mapped!.unmapped.join(', ')} has no column`)
        .toEqual([]);
    }
  });

  it('6.10 the typed row carries the numbers the fold produced', () => {
    const d = derive(MATCH);
    const a1 = d.players.find((p) => p.userId === 'a1')!;
    const row = toCategoryRow('football', a1.stats, {})!.row;
    expect(row.goals).toBe(2);
    expect(row.assists).toBe(1);
  });
});

// ============================================================================
// 7. THE CORPORATE AND KNOCKOUT VARIANTS
// ============================================================================

describe('7. the other two football formats', () => {
  it('7.1 the corporate format plays the same way, over shorter halves', () => {
    const s = play(CORP(), [goal('A', 'a1'), whistle(), goal('B', 'b1'), goal('B', 'b2'), whistle()]);
    expect(aggregateScore(s)).toEqual([1, 2]);
    expect(s.winner).toBe('B');
    expect(CORP().officiatingMode, 'the corporate format is not self-scored').toBe('selfScored');
  });

  it('7.2 a knockout decided in normal time is an ordinary result', () => {
    const s = play(KNOCKOUT(), [goal('A', 'a1'), whistle(), whistle()]);
    expect(s.ended).toBe(true);
    expect(s.winner).toBe('A');
  });

  it('7.3 all three formats produce the same stat line from the same taps', () => {
    const taps = [goal('A', 'a1', 'a2'), yellow('B', 'b1')];
    const one = JSON.stringify(derive(taps));
    for (const f of [FIFA(), CORP(), KNOCKOUT()]) {
      // The stats are folded from the log, not the format - so the format cannot
      // change who scored.
      void play(f, taps);
      expect(JSON.stringify(derive(taps)), `${f.presetKey}`).toBe(one);
    }
  });
});
