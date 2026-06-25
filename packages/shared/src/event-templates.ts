// Seeded multi-competitor event templates (swimming, powerlifting, athletics) -
// the canonical "ranking" sports that have no head-to-head matches: every competitor
// performs and the final standings come from the ranking event. These were previously
// defined in the web scoring feature; they live here so BOTH the web console/seed AND
// the API (matrix import, fixture setup) agree on which sports are ranking-based and
// what their event spec is. Data, not logic - a format we don't ship is configured,
// not coded.

import type { EventSpec, FormatTemplate } from './scoring.js';

const event = (
  result: EventSpec['result'],
  subEvents: EventSpec['subEvents'],
  opts?: Pick<EventSpec, 'pickOne' | 'subEventNoun'>,
): FormatTemplate => ({
  fixtureType: 'event',
  scoringMode: 'manual',
  event: { subEvents, result, ...opts },
});

const EVENT_TEMPLATES: Record<string, FormatTemplate> = {
  // 13 events (rulebook): 11 individual races pay 5/3/1, the 2 mixed relays pay 10/7/3.
  // Each race is ranked (fastest wins) and the top finishers earn their org those points.
  swimming: event(
    { resultType: 'time', winnerIs: 'min', unit: 's', aggregate: 'medals', medalPoints: [5, 3, 1] },
    [
      { key: 'm25f', label: "Men's 25m Freestyle" },
      { key: 'm50f', label: "Men's 50m Freestyle" },
      { key: 'm100f', label: "Men's 100m Freestyle" },
      { key: 'm25bk', label: "Men's 25m Backstroke" },
      { key: 'm25fly', label: "Men's 25m Butterfly" },
      { key: 'm25br', label: "Men's 25m Breaststroke" },
      { key: 'w25f', label: "Women's 25m Freestyle" },
      { key: 'w50f', label: "Women's 50m Freestyle" },
      { key: 'w25bk', label: "Women's 25m Backstroke" },
      { key: 'w25fly', label: "Women's 25m Butterfly" },
      { key: 'w25br', label: "Women's 25m Breaststroke" },
      { key: 'relay', label: 'Mixed 4x25m Freestyle Relay', kind: 'relay', medalPoints: [10, 7, 3] },
      { key: 'relayMedley', label: 'Mixed 4x25m Medley Relay', kind: 'relay', medalPoints: [10, 7, 3] },
    ],
    { subEventNoun: 'Race' },
  ),
  // Each lifter is in ONE weight class; enter their best total. Lifters are ranked
  // within their class (heaviest wins) and the top finishers earn 5/3/1 for their org.
  powerlifting: event(
    { resultType: 'weight', winnerIs: 'max', unit: 'kg', aggregate: 'medals', medalPoints: [5, 3, 1] },
    [
      { key: 'm63', label: 'Men ≤63kg' }, { key: 'm74', label: 'Men ≤74kg' }, { key: 'm85', label: 'Men ≤85kg' }, { key: 'm96', label: 'Men ≤96kg' },
      { key: 'w62', label: 'Women ≤62kg' }, { key: 'w62p', label: 'Women 62kg+' },
    ],
    { pickOne: true, subEventNoun: 'Weight category' },
  ),
  // Athletics: many track/field events, each ranked; the top finishers earn 5/3/1 for
  // their org. The default ranking console only needs the placement points; the detailed
  // per-athlete console treats higher marks as better (suits field events).
  athletics: event(
    { resultType: 'points', winnerIs: 'max', unit: 'pts', aggregate: 'medals', medalPoints: [5, 3, 1] },
    [
      { key: 'm100', label: "Men's 100m" }, { key: 'm200', label: "Men's 200m" }, { key: 'm400', label: "Men's 400m" },
      { key: 'mlj', label: "Men's Long Jump" }, { key: 'msp', label: "Men's Shot Put" },
      { key: 'w100', label: "Women's 100m" }, { key: 'w200', label: "Women's 200m" },
      { key: 'wlj', label: "Women's Long Jump" }, { key: 'wsp', label: "Women's Shot Put" },
      { key: 'relay', label: 'Mixed 4x100m Relay' },
    ],
    { subEventNoun: 'Event' },
  ),
};

// The canonical set of ranking sport names (lowercased). Anything with an event
// template is a ranking sport and should be locked to the "Rankings" fixture format.
export const RANKING_SPORTS: ReadonlySet<string> = new Set(Object.keys(EVENT_TEMPLATES));

// The seeded event template for a sport, if any (drives the "Multi-competitor event"
// option in the discipline editor). Deep-copied so callers can persist it freely.
export function eventTemplateFor(name?: string | null): FormatTemplate | undefined {
  const t = name ? EVENT_TEMPLATES[name.trim().toLowerCase()] : undefined;
  return t ? (JSON.parse(JSON.stringify(t)) as FormatTemplate) : undefined;
}

// True when a sport is a measured/ranking sport (no head-to-head matches).
export function isRankingSport(name?: string | null): boolean {
  return !!name && RANKING_SPORTS.has(name.trim().toLowerCase());
}
