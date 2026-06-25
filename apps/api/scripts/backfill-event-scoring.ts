/*
 * Backfill ranking-event scoring to the current code template.
 *
 *   npx tsx scripts/backfill-event-scoring.ts            # DRY RUN (default) - swimming
 *   npx tsx scripts/backfill-event-scoring.ts apply      # write changes
 *   npx tsx scripts/backfill-event-scoring.ts apply Swimming,Athletics
 *
 * Why: each ranking draw persists its scoring spec in tournament_disciplines.format_config
 * .scoring, and each event fixture persists its per-org points in live_state.eventStandings
 * (computed by the console FROM that stored spec). When the code template changes - e.g.
 * swimming relays moving from 5/3/1 to 10/7/3 and gaining the 100m Free + Medley Relay
 * events - existing draws keep the OLD spec, so their standings stay wrong until re-saved.
 *
 * This script, per matching draw:
 *   1. rewrites format_config.scoring to eventTemplateFor(sport) (so the console shows the
 *      correct events going forward), preserving any other format_config keys; and
 *   2. recomputes live_state.eventStandings for every already-scored fixture from its stored
 *      marks (live_state.event.participants) using the NEW spec.
 * Then it recomputes championship standings for every affected championship.
 *
 * Existing marks are preserved (they're keyed by sub-event key; stable keys like 'relay'
 * keep their data, new events like 'm100f'/'relayMedley' simply start empty).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { eventTemplateFor, detailedContributions, type EventSpec, type ParticipantResult } from '@semp/shared';
import { recomputeStandings } from '../src/modules/standings/standings.service.js';

const prisma = new PrismaClient();
const APPLY = process.argv[2] === 'apply';
const SPORTS = (process.argv[3] ?? 'Swimming,Powerlifting,Athletics').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — sports: ${SPORTS.join(', ')}\n`);

  const draws = await prisma.tournament_disciplines.findMany({
    where: { tournament_sports: { sports: { name: { in: SPORTS, mode: 'insensitive' } } } },
    select: {
      id: true,
      format_config: true,
      tournament_sports: { select: { sports: { select: { name: true } }, tournaments: { select: { championship_id: true } } } },
    },
  });

  const affectedChampionships = new Set<string>();
  let drawsUpdated = 0;
  let fixturesRecomputed = 0;

  for (const d of draws) {
    const sportName = d.tournament_sports?.sports?.name ?? '';
    const template = eventTemplateFor(sportName);
    if (!template?.event) { console.log(`  skip draw ${d.id} — no event template for "${sportName}"`); continue; }
    const spec = template.event as EventSpec;

    const fixtures = await prisma.fixtures.findMany({
      where: { tournament_discipline_id: d.id },
      select: { id: true, live_state: true },
    });

    let recomputedHere = 0;
    for (const f of fixtures) {
      const ls = (f.live_state ?? {}) as any;
      const participants = ls?.event?.participants as ParticipantResult[] | undefined;
      if (!Array.isArray(participants) || participants.length === 0) continue; // nothing scored / simple-ranking console
      const eventStandings = detailedContributions(spec, { participants });
      recomputedHere++;
      if (APPLY) {
        await prisma.fixtures.update({ where: { id: f.id }, data: { live_state: { ...ls, eventStandings } } });
      }
    }

    if (APPLY) {
      const fc = (d.format_config ?? {}) as any;
      await prisma.tournament_disciplines.update({ where: { id: d.id }, data: { format_config: { ...fc, scoring: template } } });
    }

    const champId = d.tournament_sports?.tournaments?.championship_id;
    if (champId) affectedChampionships.add(champId);
    drawsUpdated++;
    fixturesRecomputed += recomputedHere;
    console.log(`  ${sportName} draw ${d.id}: spec refreshed, ${recomputedHere} fixture(s) recomputed`);
  }

  if (APPLY) {
    for (const champId of affectedChampionships) {
      await recomputeStandings(prisma as any, champId);
      console.log(`  recomputed standings for championship ${champId}`);
    }
  }

  console.log(`\n${APPLY ? 'DONE' : 'DRY RUN'} — ${drawsUpdated} draw(s), ${fixturesRecomputed} scored fixture(s), ${affectedChampionships.size} championship(s).`);
  if (!APPLY) console.log('Pass "apply" to write.');
}

main().catch((e) => { console.error('FAILED:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
