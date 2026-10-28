import { contingentKey, eventTitleIn, groupsForTitle, titlePlacingFor, EVENT_TITLE_GROUP, TITLE_GROUP_LABEL } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';
import { loadRuleIndex, ruleFromIndex } from './standings.service.js';
import { convertEventTotals } from './domain/event-conversion.js';

// The master tally of a ranking sport (swimming, powerlifting): per title, each club's
// finishing position in every event, the title total, and what the title pays. Built
// from the same event results and title setup the standings engine scores.

type EventState = 'signed_off' | 'in_progress' | 'not_started';
export interface TallyEvent { draw_id: string; name: string; share: number; state: EventState }
export interface TallyCell { place: number | null; points: number }
export interface TallyRow {
  entity_id: string; name: string; short_name: string | null;
  cells: Record<string, TallyCell>; total: number; gold: number; silver: number; bronze: number;
  rank: number; title_points: number | null;
}
export interface TallyTitle { name: string; label: string; events: TallyEvent[]; rows: TallyRow[] }
export interface SportTally { sport_id: string; sport: string; titles_on: boolean; titles: TallyTitle[] }
/** One event's own standing (its Point tally tab on Results). */
export interface EventTally { draw_id: string; sport_id: string; name: string; state: EventState; rows: Array<{ entity_id: string; name: string; short_name: string | null; place: number | null; points: number; medal: 'gold' | 'silver' | 'bronze' | null }> }

const titleLabel = (key: string) => (key === EVENT_TITLE_GROUP.sport.toLowerCase() ? TITLE_GROUP_LABEL[key] : `${TITLE_GROUP_LABEL[key] ?? key} title`);

interface EventResult { place: number | null; points: number; gold: number; silver: number; bronze: number; name: string; orgId: string }

// Finishing places: the console's saved places when there are any, else by event points.
function resultsOf(liveState: unknown): Map<string, EventResult> {
  const ls = (liveState ?? {}) as { eventStandings?: any[]; eventRanking?: { rows?: any[] } };
  const out = new Map<string, EventResult>();
  if (!Array.isArray(ls.eventStandings)) return out;
  const placed = new Map((ls.eventRanking?.rows ?? []).filter((r) => r?.orgId && r.place != null).map((r) => [String(r.orgId), Number(r.place)]));
  for (const c of ls.eventStandings) {
    if (!c?.orgId) continue;
    const key = contingentKey({ orgId: c.orgId, unitId: c.unitId ?? null });
    out.set(key, {
      place: placed.get(String(c.orgId)) ?? null, points: typeof c.points === 'number' ? c.points : 0,
      gold: c.gold ?? 0, silver: c.silver ?? 0, bronze: c.bronze ?? 0, name: String(c.org ?? ''), orgId: String(c.orgId),
    });
  }
  if (placed.size === 0) {
    // No saved places (detailed console): rank the scorers by points, sharing ties.
    const scored = [...out.values()].filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
    scored.forEach((r, i) => { r.place = i > 0 && scored[i - 1].points === r.points ? scored[i - 1].place : i + 1; });
  }
  return out;
}

const stateOf = (fixtures: Array<{ status: string; live_state: unknown }>): EventState => {
  const scored = fixtures.find((f) => ['live', 'completed'].includes(f.status) && Array.isArray((f.live_state as any)?.eventStandings));
  return !scored ? 'not_started' : scored.status === 'completed' ? 'signed_off' : 'in_progress';
};

export async function readTitleTally(prisma: Db, championshipId: string): Promise<{ sports: SportTally[]; events: EventTally[] }> {
  const index = await loadRuleIndex(prisma, championshipId);
  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { tournaments: { championship_id: championshipId } } },
    select: {
      id: true, discipline_id: true, format_id: true, display_order: true,
      disciplines: { select: { name: true, entry_type: true } },
      tournament_sports: { select: { sport_id: true, format_id: true, sports: { select: { name: true } } } },
      fixtures: { select: { status: true, live_state: true } },
    },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  });
  // Ranking events only: the draws the engine scores by event ranking.
  const eventDraws = draws.filter((d) => ruleFromIndex(index, d.discipline_id, d.format_id ?? d.tournament_sports.format_id,
    d.tournament_sports.sports?.name, d.disciplines?.entry_type).scheme === 'ranking');

  const results = new Map(eventDraws.map((d) => {
    const scored = d.fixtures.find((f) => ['live', 'completed'].includes(f.status) && Array.isArray((f.live_state as any)?.eventStandings));
    return [d.id, scored ? resultsOf(scored.live_state) : new Map<string, EventResult>()];
  }));
  const orgIds = [...new Set([...results.values()].flatMap((m) => [...m.values()].map((r) => r.orgId)))];
  const orgs = new Map((await prisma.organizations.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, short_name: true } }))
    .map((o) => [o.id, o]));
  const nameOf = (r: EventResult) => orgs.get(r.orgId)?.name ?? r.name;
  const shortOf = (r: EventResult) => orgs.get(r.orgId)?.short_name ?? null;

  const events: EventTally[] = eventDraws.map((d) => ({
    draw_id: d.id, sport_id: d.tournament_sports.sport_id, name: d.disciplines?.name ?? 'Event', state: stateOf(d.fixtures),
    rows: [...results.get(d.id)!].map(([key, r]) => ({
      entity_id: key, name: nameOf(r), short_name: shortOf(r), place: r.place, points: r.points,
      medal: r.gold ? 'gold' as const : r.silver ? 'silver' as const : r.bronze ? 'bronze' as const : null,
    })).sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity) || b.points - a.points || a.name.localeCompare(b.name)),
  }));

  const bySport = new Map<string, typeof eventDraws>();
  for (const d of eventDraws) bySport.set(d.tournament_sports.sport_id, [...(bySport.get(d.tournament_sports.sport_id) ?? []), d]);

  const sports: SportTally[] = [...bySport].map(([sportId, sportDraws]) => {
    const config = index.sportTitles.get(sportId);
    const titlesOn = !!config?.enabled;
    // Each title's events with the share they count at (Whole sport only, when titles are off).
    const titleEvents = new Map<string, { name: string; events: TallyEvent[] }>();
    for (const d of sportDraws) {
      const groups = titlesOn ? groupsForTitle(eventTitleIn(config, d.discipline_id ?? '')) : [{ name: EVENT_TITLE_GROUP.sport, share: 1 }];
      for (const g of groups) {
        const key = g.name.toLowerCase();
        const t = titleEvents.get(key) ?? { name: g.name, events: [] };
        titleEvents.set(key, t);
        t.events.push({ draw_id: d.id, name: d.disciplines?.name ?? 'Event', share: g.share, state: stateOf(d.fixtures) });
      }
    }
    const titles: TallyTitle[] = [...titleEvents].map(([key, t]) => {
      const rows = new Map<string, TallyRow>();
      for (const e of t.events) {
        for (const [entity, r] of results.get(e.draw_id)!) {
          const row = rows.get(entity) ?? { entity_id: entity, name: nameOf(r), short_name: shortOf(r), cells: {}, total: 0, gold: 0, silver: 0, bronze: 0, rank: 0, title_points: null };
          rows.set(entity, row);
          row.cells[e.draw_id] = { place: r.place, points: r.points };
          row.total += r.points * e.share;
          row.gold += r.gold; row.silver += r.silver; row.bronze += r.bronze;
        }
      }
      const sorted = [...rows.values()].sort((a, b) => b.total - a.total || b.gold - a.gold || b.silver - a.silver || a.name.localeCompare(b.name));
      const level = (a: TallyRow, b: TallyRow) => a.total === b.total && a.gold === b.gold && a.silver === b.silver;
      sorted.forEach((r, i) => { r.rank = i > 0 && level(sorted[i - 1], r) ? sorted[i - 1].rank : i + 1; });
      if (titlesOn) {
        // What the title pays, exactly as the standings engine converts it.
        const placing = titlePlacingFor(config, t.name);
        const paid = new Map(convertEventTotals(sorted.map((r) => ({ entity_id: r.entity_id, points: r.total, gold: r.gold, silver: r.silver })), placing.places, placing.participation)
          .map((x) => [x.entity_id, x.points]));
        sorted.forEach((r) => { r.title_points = paid.get(r.entity_id) ?? 0; });
      }
      return { name: t.name, label: titleLabel(key), events: t.events, rows: sorted };
    });
    return { sport_id: sportId, sport: sportDraws[0].tournament_sports.sports?.name ?? 'Sport', titles_on: titlesOn, titles };
  });
  return { sports, events };
}
