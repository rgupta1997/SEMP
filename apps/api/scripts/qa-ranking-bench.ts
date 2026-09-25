/*
 * THE RANKING BENCH — swimming, athletics and powerlifting.
 *
 *   npx tsx scripts/qa-ranking-bench.ts            # add the draws (idempotent)
 *   npx tsx scripts/qa-ranking-bench.ts remove     # take them out again
 *
 * WHY THIS EXISTS. `seed-qa-bench.ts` builds its draw list from `isScoredSport`,
 * which is `isKernelSport || isCricketSport` - and the three measured sports are
 * neither. Its own log says so: "Not included (no scoring format - these are the
 * measured sports, covered by the Rankings path)". Nothing covers the Rankings
 * path. The console that produces the MEDAL TABLE - the number a championship is
 * remembered by - is the one console with no bench and no browser coverage at all.
 *
 * So this adds one ranking draw per measured sport to the QA bench championship,
 * with the entered orgs it needs and one fixture to open. It writes its own manifest
 * beside the seeder's, so everything it creates can be removed again and the bench
 * stays disposable.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { isRankingSport, tieTemplateFor } from '@semp/shared';

const prisma = new PrismaClient();
const MANIFEST = path.join(process.cwd(), '.qa-ranking-manifest.json');
const WEB = process.env.QA_WEB ?? 'http://localhost:5174/app';
const SPORTS = ['Swimming', 'Athletics', 'Powerlifting'];

type Manifest = Record<string, string[]>;

const load = (): Manifest => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {});
const save = (m: Manifest) => writeFileSync(MANIFEST, JSON.stringify(m, null, 2));

async function add() {
  const manifest = load();
  const track = (table: string, ids: string | string[]) => {
    manifest[table] = [...(manifest[table] ?? []), ...(Array.isArray(ids) ? ids : [ids])];
  };

  const champ = await prisma.championships.findFirst({
    where: { name: { contains: 'Claude QA All Sports' } },
    select: { id: true, name: true },
  });
  if (!champ) throw new Error('No QA bench championship - seed it first.');

  const tournament = await prisma.tournaments.findFirst({
    where: { championship_id: champ.id }, select: { id: true },
  });
  if (!tournament) throw new Error('The QA championship has no tournament.');

  const venue = await prisma.venues.findFirst({
    where: { championship_id: champ.id }, select: { id: true },
  });
  const format = await prisma.tournament_formats.findFirst({ select: { id: true, name: true } });
  if (!format) throw new Error('No tournament format in the catalogue.');

  // The official who will be assigned the fixtures, so the console opens for them.
  const official = await prisma.users.findFirst({
    where: { email: 'official@qa.test' }, select: { id: true },
  });

  const existingSports = await prisma.tournament_sports.findMany({
    where: { tournament_id: tournament.id },
    select: { id: true, sport_id: true, sports: { select: { name: true } } },
  });

  const made: string[] = [];

  for (const sportName of SPORTS) {
    if (!isRankingSport(sportName)) {
      console.log(`  ! ${sportName} is not a ranking sport - skipped`);
      continue;
    }
    const sport = await prisma.sports.findFirst({
      where: { name: { equals: sportName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!sport) { console.log(`  ! ${sportName} is not in the sports catalogue - skipped`); continue; }

    // --- tournament_sport ---
    let tsId = existingSports.find((x) => x.sports?.name?.toLowerCase() === sportName.toLowerCase())?.id;
    if (!tsId) {
      tsId = randomUUID();
      await prisma.tournament_sports.create({
        data: {
          id: tsId, tournament_id: tournament.id, sport_id: sport.id,
          format_id: format.id, display_order: 90 + SPORTS.indexOf(sportName),
        },
      });
      track('tournament_sports', tsId);
    }

    // --- discipline: the first real one for this sport ---
    const discipline = await prisma.disciplines.findFirst({
      where: { sport_id: sport.id, NOT: { name: { equals: 'Whole sport', mode: 'insensitive' } } },
      orderBy: { display_order: 'asc' },
      select: { id: true, name: true },
    });
    if (!discipline) { console.log(`  ! ${sportName} has no discipline - skipped`); continue; }

    // --- the draw ---
    const already = await prisma.tournament_disciplines.findFirst({
      where: { tournament_sport_id: tsId, discipline_id: discipline.id },
      select: { id: true },
    });
    let drawId = already?.id;
    if (!drawId) {
      drawId = randomUUID();
      await prisma.tournament_disciplines.create({
        data: {
          id: drawId, tournament_sport_id: tsId, discipline_id: discipline.id,
          format_id: format.id, ...(venue ? { venue_id: venue.id } : {}),
          status: 'upcoming', display_order: 90 + SPORTS.indexOf(sportName),
          squad_min: 1, squad_max: 15,
          // entry_type 'individual' is what makes the Results page render this as a
          // ranking event rather than looking for two opponents and a scoreline.
          entry_type: 'individual',
          format_config: {},
        },
      });
      track('tournament_disciplines', drawId);
    }

    // --- one fixture to open ---
    //
    // A ranking fixture has NO two sides - the console's own guard relaxes the
    // "both teams set" rule for a sport with an event template, because a medal
    // table is not a head-to-head.
    const fixture = await prisma.fixtures.findFirst({
      where: { tournament_discipline_id: drawId }, select: { id: true },
    });
    let fixtureId = fixture?.id;
    if (!fixtureId) {
      fixtureId = randomUUID();
      await prisma.fixtures.create({
        data: {
          id: fixtureId, tournament_discipline_id: drawId,
          status: 'scheduled', round: 'Final', match_no: 1, stage_sequence: 1,
          ...(official ? { official_id: official.id } : {}),
          live_state: {}, live_log: [],
        },
      });
      track('fixtures', fixtureId);
    } else if (official) {
      await prisma.fixtures.update({
        where: { id: fixtureId },
        data: { official_id: official.id, status: 'scheduled', live_state: {}, live_log: [] },
      });
    }

    made.push(`${sportName.padEnd(14)} ${discipline.name.padEnd(20)} ${WEB}/score/${fixtureId}`);
  }

  // ---- and one TEAM TIE, for the same reason ----
  //
  // The tie console is only offered when the DISCIPLINE is a team entry, and the QA
  // seeder drops the generic team row for every sport that has something more
  // specific. So the bench has team disciplines for basketball and box cricket only
  // - neither of which has a tie shelf - and the one console where a single fixture
  // holds five contests is unreachable and untested.
  const TIE_SPORT = 'Table Tennis';
  if (tieTemplateFor(TIE_SPORT)) {
    const sport = await prisma.sports.findFirst({
      where: { name: { equals: TIE_SPORT, mode: 'insensitive' } }, select: { id: true },
    });
    const teamDiscipline = sport && await prisma.disciplines.findFirst({
      where: {
        sport_id: sport.id, entry_type: 'team',
        NOT: { name: { equals: 'Whole sport', mode: 'insensitive' } },
      },
      orderBy: { display_order: 'asc' }, select: { id: true, name: true },
    });
    const tsId = sport ? existingSports.find((x) => x.sport_id === sport.id)?.id : undefined;

    if (sport && teamDiscipline && tsId) {
      let drawId = (await prisma.tournament_disciplines.findFirst({
        where: { tournament_sport_id: tsId, discipline_id: teamDiscipline.id },
        select: { id: true },
      }))?.id;
      if (!drawId) {
        drawId = randomUUID();
        await prisma.tournament_disciplines.create({
          data: {
            id: drawId, tournament_sport_id: tsId, discipline_id: teamDiscipline.id,
            format_id: format.id, ...(venue ? { venue_id: venue.id } : {}),
            status: 'upcoming', display_order: 95, squad_min: 2, squad_max: 10,
            entry_type: 'team', format_config: {},
          },
        });
        track('tournament_disciplines', drawId);
      }

      // Two real sides, borrowed from a draw of the same sport that already has them.
      const donor = await prisma.fixtures.findFirst({
        where: {
          tournament_disciplines: { tournament_sport_id: tsId },
          home_team_id: { not: null }, away_team_id: { not: null },
        },
        select: { home_team_id: true, away_team_id: true },
      });

      let tieFixture = (await prisma.fixtures.findFirst({
        where: { tournament_discipline_id: drawId }, select: { id: true },
      }))?.id;
      if (!tieFixture) {
        tieFixture = randomUUID();
        await prisma.fixtures.create({
          data: {
            id: tieFixture, tournament_discipline_id: drawId,
            home_team_id: donor?.home_team_id ?? null,
            away_team_id: donor?.away_team_id ?? null,
            status: 'scheduled', round: 'Final', match_no: 1, stage_sequence: 1,
            ...(official ? { official_id: official.id } : {}),
            live_state: {}, live_log: [],
          },
        });
        track('fixtures', tieFixture);
      } else if (official) {
        await prisma.fixtures.update({
          where: { id: tieFixture },
          data: { official_id: official.id, status: 'scheduled', live_state: {}, live_log: [] },
        });
      }
      made.push(`${TIE_SPORT.padEnd(14)} ${teamDiscipline.name.padEnd(20)} ${WEB}/score/${tieFixture}   [TEAM TIE]`);
    }
  }

  save(manifest);
  console.log(`\n${champ.name} — ranking and tie draws\n`);
  for (const m of made) console.log(`  ${m}`);
  console.log(`\nSign in as official@qa.test (Qa@2026). Manifest: ${MANIFEST}`);
}

async function remove() {
  const manifest = load();
  // Children before parents, or the foreign keys refuse.
  for (const table of ['fixtures', 'tournament_disciplines', 'tournament_sports']) {
    const ids = manifest[table] ?? [];
    if (!ids.length) continue;
    const n = await prisma.$executeRawUnsafe(
      `delete from ${table} where id = any($1::uuid[])`, ids);
    console.log(`  removed ${n} from ${table}`);
  }
  if (existsSync(MANIFEST)) unlinkSync(MANIFEST);
  console.log('Ranking bench removed.');
}

const cmd = process.argv[2] ?? 'add';
(cmd === 'remove' ? remove() : add())
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
