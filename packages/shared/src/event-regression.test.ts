import { describe, expect, it } from 'vitest';
import {
  aggregateEvent, detailedContributions, placementPoints, rankSubEvent,
  rankingContributions,
  type EventOrgContribution, type EventRankingRow, type EventState, type ParticipantResult,
} from './event-scoring.js';
import { RANKING_SPORTS, eventTemplateFor, isRankingSport } from './event-templates.js';
import type { EventSpec } from './scoring.js';

// ============================================================================
// EVENT SCORING REGRESSION SUITE.
//
// Swimming, athletics and powerlifting do not have a winner and a loser; they have
// a field, a set of marks, and a medal table. Nothing in this module had a single
// test before this file, and it decides three things a championship is judged on:
//
//   WHO WON     the ranking inside each race, lift or heat - including ties, which
//               are the whole reason competition ranking exists.
//   THE POINTS  what each org's results are worth towards the championship table.
//   THE MEDALS  the gold/silver/bronze tally printed on the medal table.
//
// A defect here does not produce a wrong scoreline somebody notices at the venue.
// It produces a wrong MEDAL TABLE at the closing ceremony, which is worse: nobody
// can check it against anything, and it is the number the whole event is remembered
// by.
//
// THE FOUR INVARIANTS:
//
//   RANKING     places start at 1, never skip backwards, and tied marks share a
//               place while consuming the ones below - "1-2-2-4", never "1-2-2-3".
//   CONSERVED   nobody is ranked who has no mark, and everybody with a mark is.
//   MEDALS      a sub-event awards at most one gold per distinct best mark, and an
//               org's medals never exceed the places it actually took.
//   POINTS      an org's points are exactly the sum of what its athletes earned.
// ============================================================================

const spec = (o: Partial<EventSpec> & { subEvents: EventSpec['subEvents'] }): EventSpec => ({
  entry: 'perAthlete',
  subEvents: o.subEvents,
  result: {
    resultType: 'time', winnerIs: 'min', unit: 's',
    aggregate: 'medals', medalPoints: [5, 3, 1],
    ...(o.result ?? {}),
  },
  ...(o as object),
} as EventSpec);

const SE = (key: string, label = key) => ({ key, label });

const P = (
  id: string, marks: Record<string, number | null>,
  o: Partial<ParticipantResult> = {},
): ParticipantResult => ({ id, name: o.name ?? id, ...o, marks });

const state = (...participants: ParticipantResult[]): EventState => ({ participants });

// ---- invariants ----

/** Places start at 1 and are a legal competition ranking. */
function expectRankingSound(ranks: Map<string, number>, n: number, note = '') {
  const places = [...ranks.values()].sort((a, b) => a - b);
  if (!places.length) return;
  expect(places[0], `RANKING ${note} does not start at 1`).toBe(1);
  for (const p of places) {
    expect(p, `RANKING ${note} place ${p} below 1`).toBeGreaterThanOrEqual(1);
    expect(p, `RANKING ${note} place ${p} exceeds the field of ${n}`).toBeLessThanOrEqual(n);
  }
  // Competition ranking: after k competitors share a place, the next distinct place
  // is exactly k further on. Equivalently, every place equals 1 + (how many are
  // strictly ahead of it).
  const counts = new Map<number, number>();
  for (const p of places) counts.set(p, (counts.get(p) ?? 0) + 1);
  let expected = 1;
  for (const place of [...counts.keys()].sort((a, b) => a - b)) {
    expect(place, `RANKING ${note} place ${place} should have been ${expected}`).toBe(expected);
    expected += counts.get(place)!;
  }
}

function expectMedalsSound(rows: EventOrgContribution[], note = '') {
  for (const r of rows) {
    for (const k of ['points', 'gold', 'silver', 'bronze'] as const) {
      expect(r[k], `MEDALS ${note} ${r.org}.${k} negative`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r[k]), `MEDALS ${note} ${r.org}.${k} not a number`).toBe(true);
    }
    expect(r.orgId, `MEDALS ${note} a contribution with no org`).toBeTruthy();
  }
  const ids = rows.map((r) => r.orgId);
  expect(new Set(ids).size, `MEDALS ${note} the same org appears twice`).toBe(ids.length);
}

// ============================================================================
// 1. THE SHELF
// ============================================================================

const SHELF = [...RANKING_SPORTS].map((sport) => ({ sport, event: eventTemplateFor(sport)!.event! }));

describe('1. the event templates on the shelf', () => {
  it('1.1 every shipped template declares a usable event spec', () => {
    expect(SHELF.length, 'no event templates on the shelf').toBeGreaterThan(0);
    for (const { sport, event: e } of SHELF) {
      expect(e.subEvents.length, `${sport}: no sub-events`).toBeGreaterThan(0);
      expect(['min', 'max']).toContain(e.result.winnerIs);
      const keys = e.subEvents.map((x) => x.key);
      expect(new Set(keys).size, `${sport}: duplicate sub-event keys`).toBe(keys.length);
      for (const se of e.subEvents) {
        expect(se.label?.trim(), `${sport}/${se.key}: an unlabelled sub-event`).toBeTruthy();
      }
    }
  });

  it('1.2 a time event ranks the FASTEST first, a weight event the HEAVIEST', () => {
    for (const { sport, event: e } of SHELF) {
      if (e.result.resultType === 'time') {
        expect(e.result.winnerIs, `${sport}: a time event ranking the slowest first`).toBe('min');
      }
      if (e.result.resultType === 'weight' || e.result.resultType === 'distance') {
        expect(e.result.winnerIs, `${sport}: a ${e.result.resultType} event ranking the smallest first`)
          .toBe('max');
      }
    }
  });

  it('1.3 every medal scale is descending — gold is never worth less than silver', () => {
    for (const { sport, event: e } of SHELF) {
      const scales = [e.result.medalPoints, ...e.subEvents.map((x) => x.medalPoints)];
      for (const scale of scales) {
        if (!scale) continue;
        for (let i = 1; i < scale.length; i += 1) {
          expect(scale[i - 1], `${sport}: medal scale ${scale.join('/')} is not descending`)
            .toBeGreaterThanOrEqual(scale[i]);
        }
      }
    }
  });

  it('1.4 a template resolves by sport name, case-insensitively', () => {
    const known = SHELF[0].sport;
    expect(eventTemplateFor(known)?.event).toBeTruthy();
    expect(eventTemplateFor(known.toUpperCase())?.event).toBeTruthy();
    expect(eventTemplateFor(`  ${known}  `)?.event, 'a padded sport name did not resolve').toBeTruthy();
    expect(eventTemplateFor('not a sport')).toBeFalsy();
    expect(isRankingSport(known)).toBe(true);
    expect(isRankingSport('badminton'), 'a head-to-head sport was called a ranking sport').toBe(false);
  });

  it('1.5 a template is handed out as a COPY, so editing one cannot poison the shelf', () => {
    const a = eventTemplateFor(SHELF[0].sport)!;
    a.event!.subEvents.length = 0;
    expect(eventTemplateFor(SHELF[0].sport)!.event!.subEvents.length,
      'the shelf was mutated by a caller editing its template').toBeGreaterThan(0);
  });

  it('1.6 THE RELAYS PAY MORE THAN THE HEATS, which is the rulebook', () => {
    const sw = eventTemplateFor('swimming')!.event!;
    const relays = sw.subEvents.filter((x) => x.key.startsWith('relay'));
    expect(relays.length, 'no relays on the swimming sheet').toBeGreaterThan(0);
    for (const r of relays) {
      expect(r.medalPoints, `${r.key} has no scale of its own`).toBeTruthy();
      expect(r.medalPoints![0], `${r.key} pays no more than an individual race`)
        .toBeGreaterThan(sw.result.medalPoints![0]);
    }
  });
});

// ============================================================================
// 2. RANKING INSIDE ONE RACE
// ============================================================================

describe('2. ranking one sub-event', () => {
  const s100 = spec({ subEvents: [SE('50free')] });

  it('2.1 the fastest time is first when the winner is the minimum', () => {
    const st = state(P('a', { '50free': 30 }), P('b', { '50free': 28 }), P('c', { '50free': 31 }));
    const r = rankSubEvent(s100, st, '50free');
    expect(r.get('b')).toBe(1);
    expect(r.get('a')).toBe(2);
    expect(r.get('c')).toBe(3);
    expectRankingSound(r, 3);
  });

  it('2.2 the heaviest lift is first when the winner is the maximum', () => {
    const lift = spec({
      subEvents: [SE('squat')],
      result: { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'medals', medalPoints: [5, 3, 1] },
    } as any);
    const st = state(P('a', { squat: 100 }), P('b', { squat: 140 }), P('c', { squat: 120 }));
    const r = rankSubEvent(lift, st, 'squat');
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
    expect(r.get('a')).toBe(3);
    expectRankingSound(r, 3);
  });

  it('2.3 A DEAD HEAT SHARES THE PLACE and consumes the one below — 1,1,3', () => {
    // Two equal firsts both take gold and there is no silver. "1,1,2" would invent a
    // silver medallist and shift everybody behind them up a place.
    const st = state(P('a', { '50free': 28 }), P('b', { '50free': 28 }), P('c', { '50free': 31 }));
    const r = rankSubEvent(s100, st, '50free');
    expect(r.get('a')).toBe(1);
    expect(r.get('b')).toBe(1);
    expect(r.get('c'), 'the third swimmer was promoted into a silver that was not awarded').toBe(3);
    expectRankingSound(r, 3);
  });

  it('2.4 a three-way tie consumes three places', () => {
    const st = state(
      P('a', { '50free': 28 }), P('b', { '50free': 28 }), P('c', { '50free': 28 }),
      P('d', { '50free': 30 }),
    );
    const r = rankSubEvent(s100, st, '50free');
    expect([r.get('a'), r.get('b'), r.get('c')]).toEqual([1, 1, 1]);
    expect(r.get('d')).toBe(4);
    expectRankingSound(r, 4);
  });

  it('2.5 a tie further down the field shares correctly too', () => {
    const st = state(
      P('a', { '50free': 27 }), P('b', { '50free': 30 }),
      P('c', { '50free': 30 }), P('d', { '50free': 33 }),
    );
    const r = rankSubEvent(s100, st, '50free');
    expect(r.get('a')).toBe(1);
    expect(r.get('b')).toBe(2);
    expect(r.get('c')).toBe(2);
    expect(r.get('d')).toBe(4);
    expectRankingSound(r, 4);
  });

  it('2.6 NOBODY WITHOUT A MARK IS RANKED — a did-not-start is not last', () => {
    const st = state(
      P('a', { '50free': 28 }), P('b', { '50free': null }), P('c', {}),
    );
    const r = rankSubEvent(s100, st, '50free');
    expect(r.size, 'a competitor with no mark was given a place').toBe(1);
    expect(r.get('a')).toBe(1);
    expect(r.has('b')).toBe(false);
    expect(r.has('c')).toBe(false);
  });

  it('2.7 an empty field ranks nobody rather than throwing', () => {
    expect(rankSubEvent(s100, state(), '50free').size).toBe(0);
    expect(rankSubEvent(s100, state(P('a', {})), 'nosuchevent').size).toBe(0);
  });

  it('2.8 a zero mark is a real mark, not an absence', () => {
    const st = state(P('a', { '50free': 0 }), P('b', { '50free': 5 }));
    const r = rankSubEvent(s100, st, '50free');
    expect(r.size, 'a zero mark was treated as a no-show').toBe(2);
    expect(r.get('a')).toBe(1);
  });

  it('2.9 ranking is stable under the order competitors were entered in', () => {
    const marks = [['a', 28], ['b', 30], ['c', 29]] as const;
    const forward = rankSubEvent(s100, state(...marks.map(([id, m]) => P(id, { '50free': m }))), '50free');
    const backward = rankSubEvent(s100,
      state(...[...marks].reverse().map(([id, m]) => P(id, { '50free': m }))), '50free');
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });
});

// ============================================================================
// 3. PLACEMENT POINTS
// ============================================================================

describe('3. what a place is worth', () => {
  const medals = [5, 3, 1];

  it('3.1 first, second and third take the scale in order', () => {
    expect(placementPoints(1, medals)).toBe(5);
    expect(placementPoints(2, medals)).toBe(3);
    expect(placementPoints(3, medals)).toBe(1);
  });

  it('3.2 a place past the end of the scale earns nothing', () => {
    expect(placementPoints(4, medals)).toBe(0);
    expect(placementPoints(99, medals)).toBe(0);
  });

  it('3.3 no place earns nothing, and never throws', () => {
    expect(placementPoints(null, medals)).toBe(0);
    expect(placementPoints(undefined, medals)).toBe(0);
    expect(placementPoints(0, medals)).toBe(0);
    expect(placementPoints(-1, medals)).toBe(0);
  });

  it('3.4 a longer scale pays deeper into the field', () => {
    expect(placementPoints(6, [10, 8, 6, 5, 4, 3])).toBe(3);
  });
});

// ============================================================================
// 4. AGGREGATING A WHOLE EVENT
// ============================================================================

describe('4. the event total', () => {
  it('4.1 medals: each sub-event pays its scale to the places taken', () => {
    const s = spec({ subEvents: [SE('r1'), SE('r2')] });
    const st = state(
      P('a', { r1: 28, r2: 60 }, { orgId: 'o1', org: 'Alpha' }),
      P('b', { r1: 30, r2: 58 }, { orgId: 'o2', org: 'Beta' }),
    );
    const rows = aggregateEvent(s, st);
    // a: gold in r1 (5) + silver in r2 (3) = 8. b: the mirror.
    expect(rows.find((r) => r.key === 'o1')?.points).toBe(8);
    expect(rows.find((r) => r.key === 'o2')?.points).toBe(8);
  });

  it('4.2 A SUB-EVENT MAY OVERRIDE THE SCALE — a relay can pay more than a heat', () => {
    const s = spec({
      subEvents: [SE('heat'), { ...SE('relay'), medalPoints: [10, 7, 3] }],
    });
    const st = state(
      P('a', { heat: 28, relay: 120 }, { orgId: 'o1', org: 'Alpha' }),
      P('b', { heat: 30, relay: 130 }, { orgId: 'o2', org: 'Beta' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.find((r) => r.key === 'o1')?.points, 'the relay scale was not applied')
      .toBe(5 + 10);
    expect(rows.find((r) => r.key === 'o2')?.points).toBe(3 + 7);
  });

  it('4.3 placePoints pays on the size of the field, not a fixed scale', () => {
    const s = spec({
      subEvents: [SE('r1')],
      result: { resultType: 'time', winnerIs: 'min', unit: 's', aggregate: 'placePoints' },
    } as any);
    const st = state(
      P('a', { r1: 28 }, { orgId: 'o1' }), P('b', { r1: 29 }, { orgId: 'o2' }),
      P('c', { r1: 30 }, { orgId: 'o3' }), P('d', { r1: 31 }, { orgId: 'o4' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.find((r) => r.key === 'o1')?.points).toBe(4);
    expect(rows.find((r) => r.key === 'o4')?.points).toBe(1);
  });

  it('4.4 sumBest totals a competitor\'s marks across the sub-events', () => {
    const s = spec({
      subEvents: [SE('squat'), SE('bench'), SE('deadlift')],
      result: { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'sumBest' },
    } as any);
    const st = state(
      P('a', { squat: 100, bench: 80, deadlift: 140 }, { orgId: 'o1' }),
      P('b', { squat: 120, bench: 70, deadlift: 130 }, { orgId: 'o2' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.find((r) => r.key === 'o1')?.points).toBe(320);
    expect(rows.find((r) => r.key === 'o2')?.points).toBe(320);
  });

  it('4.5 a missing mark contributes nothing to a sumBest total', () => {
    const s = spec({
      subEvents: [SE('squat'), SE('bench')],
      result: { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'sumBest' },
    } as any);
    const st = state(P('a', { squat: 100, bench: null }, { orgId: 'o1' }));
    expect(aggregateEvent(s, st)[0].points).toBe(100);
  });

  it('4.6 two athletes from the SAME org add their points together', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      P('a', { r1: 28 }, { orgId: 'o1', org: 'Alpha' }),
      P('b', { r1: 29 }, { orgId: 'o1', org: 'Alpha' }),
      P('c', { r1: 30 }, { orgId: 'o2', org: 'Beta' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.find((r) => r.key === 'o1')?.points, 'two team-mates did not pool their points')
      .toBe(5 + 3);
    expect(rows.find((r) => r.key === 'o2')?.points).toBe(1);
  });

  it('4.7 the table comes back sorted, best first', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      P('c', { r1: 31 }, { orgId: 'o3' }),
      P('a', { r1: 28 }, { orgId: 'o1' }),
      P('b', { r1: 29 }, { orgId: 'o2' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.map((r) => r.key)).toEqual(['o1', 'o2', 'o3']);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].points).toBeGreaterThanOrEqual(rows[i].points);
    }
  });

  it('4.8 a tie pays BOTH athletes the shared place, and nobody the place it consumed', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      P('a', { r1: 28 }, { orgId: 'o1' }),
      P('b', { r1: 28 }, { orgId: 'o2' }),
      P('c', { r1: 30 }, { orgId: 'o3' }),
    );
    const rows = aggregateEvent(s, st);
    expect(rows.find((r) => r.key === 'o1')?.points).toBe(5);
    expect(rows.find((r) => r.key === 'o2')?.points).toBe(5);
    expect(rows.find((r) => r.key === 'o3')?.points, 'the third athlete was paid a silver nobody won')
      .toBe(1);
  });

  it('4.9 an athlete with no org at all is still totalled, under their own name', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(P('a', { r1: 28 }, { name: 'Independent' }));
    const rows = aggregateEvent(s, st);
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe('Independent');
  });

  it('4.10 an empty field totals to nothing rather than throwing', () => {
    expect(aggregateEvent(spec({ subEvents: [SE('r1')] }), state())).toEqual([]);
  });
});

// ============================================================================
// 5. WHAT REACHES THE STANDINGS
// ============================================================================

describe('5. the standings contribution', () => {
  it('5.1 detailed: points match the aggregate, medals come from the top three', () => {
    const s = spec({ subEvents: [SE('r1'), SE('r2')] });
    const st = state(
      P('a', { r1: 28, r2: 60 }, { orgId: 'o1', org: 'Alpha' }),
      P('b', { r1: 29, r2: 61 }, { orgId: 'o2', org: 'Beta' }),
      P('c', { r1: 30, r2: 62 }, { orgId: 'o3', org: 'Gamma' }),
    );
    const rows = detailedContributions(s, st);
    expectMedalsSound(rows, 'detailed');
    const alpha = rows.find((r) => r.orgId === 'o1')!;
    expect(alpha.gold, 'the winner of both races did not get two golds').toBe(2);
    expect(alpha.silver).toBe(0);
    expect(alpha.points).toBe(10);
    expect(rows.find((r) => r.orgId === 'o2')!.silver).toBe(2);
    expect(rows.find((r) => r.orgId === 'o3')!.bronze).toBe(2);
  });

  it('5.2 an athlete with no org is display-only and reaches no standings row', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      P('a', { r1: 28 }, { name: 'Independent' }),
      P('b', { r1: 30 }, { orgId: 'o2', org: 'Beta' }),
    );
    const rows = detailedContributions(s, st);
    expect(rows.length, 'an unaffiliated athlete reached the standings').toBe(1);
    expect(rows[0].orgId).toBe('o2');
  });

  it('5.3 A DEAD HEAT FOR GOLD AWARDS TWO GOLDS AND NO SILVER', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      P('a', { r1: 28 }, { orgId: 'o1', org: 'Alpha' }),
      P('b', { r1: 28 }, { orgId: 'o2', org: 'Beta' }),
      P('c', { r1: 30 }, { orgId: 'o3', org: 'Gamma' }),
    );
    const rows = detailedContributions(s, st);
    expectMedalsSound(rows, 'dead heat');
    expect(rows.find((r) => r.orgId === 'o1')!.gold).toBe(1);
    expect(rows.find((r) => r.orgId === 'o2')!.gold).toBe(1);
    const silvers = rows.reduce((n, r) => n + r.silver, 0);
    expect(silvers, 'a silver was awarded in a race whose silver was consumed by a tie').toBe(0);
    expect(rows.find((r) => r.orgId === 'o3')!.bronze).toBe(1);
  });

  it('5.4 nobody outside the top three takes a medal', () => {
    const s = spec({ subEvents: [SE('r1')] });
    const st = state(
      ...['a', 'b', 'c', 'd', 'e'].map((id, i) =>
        P(id, { r1: 28 + i }, { orgId: `o${i + 1}`, org: id })),
    );
    const rows = detailedContributions(s, st);
    expectMedalsSound(rows, 'top three');
    const medals = rows.reduce((n, r) => n + r.gold + r.silver + r.bronze, 0);
    expect(medals, 'more than three medals were awarded in one race').toBe(3);
    expect(rows.find((r) => r.orgId === 'o4')!.gold + rows.find((r) => r.orgId === 'o4')!.silver
      + rows.find((r) => r.orgId === 'o4')!.bronze).toBe(0);
  });

  it('5.5 a sumBest event awards points but no medals', () => {
    const s = spec({
      subEvents: [SE('squat'), SE('bench')],
      result: { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'sumBest' },
    } as any);
    const st = state(P('a', { squat: 100, bench: 80 }, { orgId: 'o1', org: 'Alpha' }));
    const rows = detailedContributions(s, st);
    expect(rows[0].points).toBe(180);
    expect(rows[0].gold + rows[0].silver + rows[0].bronze,
      'a total-based event handed out medals it has no places for').toBe(0);
  });

  it('5.6 ranking model: a place becomes points plus the right medal', () => {
    const rows: EventRankingRow[] = [
      { orgId: 'o1', org: 'Alpha', place: 1 },
      { orgId: 'o2', org: 'Beta', place: 2 },
      { orgId: 'o3', org: 'Gamma', place: 3 },
      { orgId: 'o4', org: 'Delta', place: 7 },
    ];
    const out = rankingContributions(rows, [5, 3, 1]);
    expectMedalsSound(out, 'ranking');
    expect(out.find((r) => r.orgId === 'o1')).toMatchObject({ points: 5, gold: 1, silver: 0, bronze: 0 });
    expect(out.find((r) => r.orgId === 'o2')).toMatchObject({ points: 3, silver: 1 });
    expect(out.find((r) => r.orgId === 'o3')).toMatchObject({ points: 1, bronze: 1 });
    expect(out.find((r) => r.orgId === 'o4')).toMatchObject({ points: 0, gold: 0, silver: 0, bronze: 0 });
  });

  it('5.7 an org with no place at all contributes nothing', () => {
    const out = rankingContributions([
      { orgId: 'o1', org: 'Alpha', place: null },
      { orgId: null, org: 'Nobody', place: 1 },
      { orgId: 'o2', org: 'Beta', place: 0 },
    ], [5, 3, 1]);
    expect(out.length).toBe(0);
  });

  it('5.8 THE PARTICIPATION FLOOR is flagged, so a breakdown can tell it from a place', () => {
    // Placed eleventh, awarded a consolation point by the organiser. Those points
    // are real, but they are not a place - and a medal table that cannot tell the
    // difference will print them as one.
    const out = rankingContributions([{ orgId: 'o1', org: 'Alpha', place: 11, points: 1 }], [5, 3, 1]);
    expect(out[0].points).toBe(1);
    expect(out[0].participation, 'a consolation point was not flagged as participation').toBe(1);
    expect(out[0].gold + out[0].silver + out[0].bronze).toBe(0);
  });

  it('5.9 a real place with explicit points is NOT flagged as participation', () => {
    const out = rankingContributions([{ orgId: 'o1', org: 'Alpha', place: 1, points: 5 }], [5, 3, 1]);
    expect(out[0].participation).toBe(0);
  });

  it('5.10 explicit points always beat the scale, so an organiser override sticks', () => {
    const out = rankingContributions([{ orgId: 'o1', org: 'Alpha', place: 1, points: 99 }], [5, 3, 1]);
    expect(out[0].points).toBe(99);
    expect(out[0].gold).toBe(1);
  });
});

// ============================================================================
// 6. WHOLE MEETS
// ============================================================================

describe('6. a whole meet', () => {
  function rng(seed: number) {
    let x = seed;
    return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  }

  /** A realistic heat sheet: several orgs, several races, ties and no-shows included. */
  function meet(seed: number, orgs = 4, athletes = 12, races = 3) {
    const r = rng(seed);
    const subEvents = Array.from({ length: races }, (_, i) => SE(`r${i + 1}`));
    const participants: ParticipantResult[] = [];
    for (let i = 0; i < athletes; i += 1) {
      const marks: Record<string, number | null> = {};
      for (const se of subEvents) {
        // A deliberate cluster of identical marks, so dead heats really happen.
        marks[se.key] = r() < 0.15 ? null : 25 + Math.floor(r() * 6);
      }
      participants.push(P(`p${i}`, marks, {
        orgId: `o${(i % orgs) + 1}`, org: `Org ${(i % orgs) + 1}`, name: `Athlete ${i}`,
      }));
    }
    return { spec: spec({ subEvents }), state: state(...participants) };
  }

  for (const seed of [3, 88, 5150]) {
    it(`6.x seed ${seed}: every race ranks legally and the medal table balances`, () => {
      const { spec: s, state: st } = meet(seed);

      // RANKING + CONSERVED, per race.
      for (const se of s.subEvents) {
        const ranks = rankSubEvent(s, st, se.key);
        const withMark = st.participants.filter((p) => typeof p.marks[se.key] === 'number');
        expect(ranks.size, `seed ${seed} ${se.key}: ranked ${ranks.size} of ${withMark.length} finishers`)
          .toBe(withMark.length);
        expectRankingSound(ranks, withMark.length, `seed ${seed} ${se.key}`);
      }

      const rows = detailedContributions(s, st);
      expectMedalsSound(rows, `seed ${seed}`);

      // POINTS: every org's total is exactly what the aggregate says it earned.
      const agg = new Map(aggregateEvent(s, st).map((a) => [a.key, a.points]));
      for (const row of rows) {
        expect(row.points, `seed ${seed}: ${row.org} points disagree with the aggregate`)
          .toBe(agg.get(row.orgId) ?? 0);
      }

      // MEDALS: each race awards exactly as many medals as it has top-three places,
      // counting shared places once per athlete.
      let expectedMedals = 0;
      for (const se of s.subEvents) {
        const ranks = rankSubEvent(s, st, se.key);
        for (const [pid, rank] of ranks) {
          if (rank > 3) continue;
          if (st.participants.find((p) => p.id === pid)?.orgId) expectedMedals += 1;
        }
      }
      const awarded = rows.reduce((n, x) => n + x.gold + x.silver + x.bronze, 0);
      expect(awarded, `seed ${seed}: the medal table does not balance against the races`)
        .toBe(expectedMedals);
    });
  }

  it('6.100 the same heat sheet always produces the same medal table', () => {
    const { spec: s, state: st } = meet(777);
    expect(JSON.stringify(detailedContributions(s, st)))
      .toBe(JSON.stringify(detailedContributions(s, st)));
  });
});
