/**
 * Rebuild Northfield Institute of Technology as a full demonstration tenant.
 *
 *   npx tsx scripts/seed-northfield.ts
 *
 * Three championships, all ONGOING and part-played, so every screen has something
 * real on it - standings mid-table, fixtures both done and to come:
 *
 *   1. INTER   · 8 organisations (Northfield hosts AND competes) + 7 others
 *   2. INTRA   · 8 campuses of Northfield
 *   3. INTRA   · 8 batches inside one campus
 *
 * Eight sports in each.
 *
 * WHAT IT DELETES, and what it deliberately does not.
 *
 * Scoped to Northfield: its championships and everything beneath them, its teams,
 * its campuses and batches, its placements, and the seven partner organisations
 * this script created on a previous run (they carry a marker in `code`).
 *
 * It KEEPS the organisation row and every user account with a membership here.
 * Those are logins - `owner.nit@bench.test` and the rest of the bench personas -
 * and a seed that silently invalidated somebody's credentials would be a seed
 * nobody dared run twice. Existing people are re-placed into the new structure;
 * extra players are created only to make up the numbers.
 */
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const cfg = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^"|"$/g, '');
process.env.DATABASE_URL = cfg('DATABASE_URL');

const prisma = new PrismaClient();

/** Marks the partner organisations this script owns, so a rerun can reclaim them. */
const PARTNER_CODE = 'NFP';
const PASSWORD_HASH = bcrypt.hashSync('Bench@2026', 10);

const CAMPUSES = [
  ['Bengaluru', 'BLR'], ['Mumbai', 'BOM'], ['Delhi', 'DEL'], ['Pune', 'PNQ'],
  ['Hyderabad', 'HYD'], ['Chennai', 'MAA'], ['Kolkata', 'CCU'], ['Ahmedabad', 'AMD'],
] as const;

const BATCHES = [
  ['B.Tech 2023', 'BT23'], ['B.Tech 2024', 'BT24'], ['B.Tech 2025', 'BT25'], ['B.Tech 2026', 'BT26'],
  ['M.Tech 2024', 'MT24'], ['M.Tech 2025', 'MT25'], ['MBA 2025', 'MBA25'], ['PhD Scholars', 'PHD'],
] as const;

const PARTNERS = [
  ['Ravenshaw Institute of Science', 'RIS'], ['Calder University', 'CAL'],
  ['Thornbury Polytechnic', 'THP'], ['Westmere College of Engineering', 'WME'],
  ['Ashcroft Institute', 'ASH'], ['Marlowe Technical University', 'MTU'],
  ['Kingsbridge Institute of Technology', 'KBI'],
] as const;

const SPORT_NAMES = ['Cricket', 'Football', 'Basketball', 'Volleyball', 'Badminton', 'Table Tennis', 'Kabaddi', 'Athletics'];

const FIRST = ['Aarav', 'Ananya', 'Vihaan', 'Diya', 'Arjun', 'Ishita', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Dev', 'Nisha', 'Yash', 'Tara', 'Aditya', 'Riya', 'Karan', 'Priya', 'Neel', 'Aisha'];
const LAST = ['Sharma', 'Nair', 'Iyer', 'Bose', 'Menon', 'Reddy', 'Kulkarni', 'Chauhan', 'Banerjee', 'Pillai', 'Sethi', 'Rao'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * How good a squad is, 0..1 - stable for a given (team, sport) pair.
 *
 * Derived from a hash rather than stored, so it needs no state and never drifts.
 * Mixing the SPORT in is what stops the eight tables being eight copies of one
 * ranking: a campus strong at cricket is not thereby strong at badminton, which is
 * the first thing anybody notices in a demo.
 */
function strength(teamId: string, sport: string): number {
  let h = 2166136261;
  for (const ch of `${teamId}:${sport}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
let rng = 12345;
/** Deterministic PRNG - a seed that produces a different league every run cannot be discussed. */
const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };

async function main() {
  const org = await prisma.organizations.findFirst({
    where: { name: { contains: 'Northfield', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error('Northfield Institute of Technology not found');
  // Bound after the guard: `build()` below is a closure, and TypeScript cannot keep
  // a narrowing across one because the closure could in principle run later.
  const host = org;
  console.log(`Rebuilding ${org.name}\n${'='.repeat(60)}`);

  // ---- 1 · wipe, scoped -----------------------------------------------------
  const partnerOrgs = await prisma.organizations.findMany({ where: { code: { startsWith: PARTNER_CODE } }, select: { id: true } });
  const partnerIds = partnerOrgs.map((o) => o.id);
  const orgIds = [org.id, ...partnerIds];

  const champs = await prisma.championships.findMany({
    where: { OR: [{ host_organization_id: { in: orgIds } }, { championship_organizations: { some: { organization_id: { in: orgIds } } } }] },
    select: { id: true },
  });
  const champIds = champs.map((c) => c.id);

  if (champIds.length) {
    // Order taken from the live foreign-key map, not from guesswork. The ones that
    // matter are the NO ACTION keys - they refuse rather than cascade, and
    // `certificates` holds two of them (into fixtures AND championships), so it has
    // to go before either. A certificate is somebody's record, and deleting one is
    // only acceptable here because the championship it belongs to is going too.
    await prisma.certificate_verifications.deleteMany({ where: { certificates: { championship_id: { in: champIds } } } });
    await prisma.certificates.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.fixture_awards.deleteMany({ where: { fixtures: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } } } } });
    await prisma.fixture_events.deleteMany({ where: { fixtures: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } } } } });
    await prisma.fixtures.deleteMany({ where: { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } } } });
    await prisma.standings.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.standings_rules.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.team_entries.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.tournament_disciplines.deleteMany({ where: { tournament_sports: { tournaments: { championship_id: { in: champIds } } } } });
    await prisma.tournament_sports.deleteMany({ where: { tournaments: { championship_id: { in: champIds } } } });
    await prisma.tournaments.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.championship_invitations.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.championship_organizations.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.championship_officials.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.user_championship_roles.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.notification_reads.deleteMany({ where: { notifications: { championship_id: { in: champIds } } } });
    await prisma.notification_reactions.deleteMany({ where: { notifications: { championship_id: { in: champIds } } } });
    await prisma.notification_deliveries.deleteMany({ where: { notifications: { championship_id: { in: champIds } } } });
    await prisma.notification_cursors.deleteMany({ where: { notifications: { championship_id: { in: champIds } } } });
    await prisma.notifications.deleteMany({ where: { championship_id: { in: champIds } } });
    // Grounds hang off venues with their own refusing key.
    await prisma.venue_grounds.deleteMany({ where: { venues: { championship_id: { in: champIds } } } });
    await prisma.venues.deleteMany({ where: { championship_id: { in: champIds } } });
    await prisma.championships.deleteMany({ where: { id: { in: champIds } } });
  }

  const teams = await prisma.teams.findMany({ where: { organization_id: { in: orgIds } }, select: { id: true } });
  if (teams.length) {
    await prisma.team_members.deleteMany({ where: { team_id: { in: teams.map((t) => t.id) } } });
    await prisma.teams.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
  }
  await prisma.org_unit_members.deleteMany({ where: { organization_id: { in: orgIds } } });
  await prisma.org_units.deleteMany({ where: { organization_id: { in: orgIds } } });
  if (partnerIds.length) {
    await prisma.organization_members.deleteMany({ where: { organization_id: { in: partnerIds } } });
    await prisma.organizations.deleteMany({ where: { id: { in: partnerIds } } });
  }
  console.log(`  wiped ${champIds.length} championships, ${teams.length} teams, ${partnerIds.length} partner orgs`);

  // ---- 2 · structure --------------------------------------------------------
  type Unit = { id: string; name: string };
  const campuses: Unit[] = [];
  for (const [i, [name, code]] of CAMPUSES.entries()) {
    campuses.push(await prisma.org_units.create({
      data: { organization_id: org.id, type: 'campus', name, code, status: 'ACTIVE', display_order: i },
    }));
  }
  const batches: Unit[] = [];
  for (const [i, [name, code]] of BATCHES.entries()) {
    batches.push(await prisma.org_units.create({
      data: { organization_id: org.id, type: 'department', name, code, parent_id: campuses[0].id, status: 'ACTIVE', display_order: i },
    }));
  }
  console.log(`  ${campuses.length} campuses, ${batches.length} batches under ${campuses[0].name}`);

  // ---- 3 · people -----------------------------------------------------------
  // Existing members are reused so their logins keep working; the rest are made up
  // to the number the squads need.
  const existing = await prisma.organization_members.findMany({
    where: { organization_id: org.id }, select: { user_id: true },
  });
  const pool: string[] = existing.map((m) => m.user_id);

  const WANT = 200;
  const toCreate = Math.max(0, WANT - pool.length);
  for (let i = 0; i < toCreate; i++) {
    const name = `${FIRST[rand(FIRST.length)]} ${LAST[rand(LAST.length)]}`;
    const email = `nf.player${i + 1}@bench.test`;
    const u = await prisma.users.upsert({
      where: { email },
      update: {},
      create: { name, email, phone: `98${String(20000000 + i).padStart(8, '0')}`, password_hash: PASSWORD_HASH, account_type: 'participant' },
      select: { id: true },
    });
    await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: u.id, organization_id: org.id } },
      update: { status: 'active', verification: 'verified' },
      create: { user_id: u.id, organization_id: org.id, role: 'member', status: 'active', verification: 'verified' },
    });
    pool.push(u.id);
  }
  console.log(`  ${pool.length} people (${toCreate} created, ${existing.length} kept)`);

  // Placement. Campus 0 carries the batches, so its people are spread across them -
  // and every third person gets a SECOND batch, because multi-unit membership is a
  // real case and a seed with none of it demonstrates nothing.
  const perCampus = Math.floor(pool.length / campuses.length);
  const placements: Array<{ organization_id: string; org_unit_id: string; user_id: string }> = [];
  const campusPeople: string[][] = campuses.map(() => []);
  const batchPeople: string[][] = batches.map(() => []);

  pool.forEach((userId, i) => {
    const ci = Math.min(campuses.length - 1, Math.floor(i / perCampus));
    campusPeople[ci].push(userId);
    placements.push({ organization_id: org.id, org_unit_id: campuses[ci].id, user_id: userId });
    if (ci === 0) {
      const bi = campusPeople[0].length % batches.length;
      batchPeople[bi].push(userId);
      placements.push({ organization_id: org.id, org_unit_id: batches[bi].id, user_id: userId });
      if (campusPeople[0].length % 3 === 0) {
        const bj = (bi + 3) % batches.length;
        batchPeople[bj].push(userId);
        placements.push({ organization_id: org.id, org_unit_id: batches[bj].id, user_id: userId });
      }
    }
  });
  await prisma.org_unit_members.createMany({ data: placements, skipDuplicates: true });
  console.log(`  ${placements.length} placements (${placements.length - pool.length} people in more than one unit)`);

  // ---- 4 · sports -----------------------------------------------------------
  const sports = await prisma.sports.findMany({
    where: { name: { in: SPORT_NAMES } },
    select: { id: true, name: true, disciplines: { select: { id: true, name: true }, take: 1 } },
  });
  if (sports.length < 8) throw new Error(`need 8 sports, found ${sports.length}`);
  const format = await prisma.tournament_formats.findFirst({ select: { id: true } });
  if (!format) throw new Error('no tournament format in the catalogue');
  const fmt = format;
  console.log(`  ${sports.length} sports: ${sports.map((s) => s.name).join(', ')}`);

  const organiserRole = await prisma.roles.findFirst({ where: { code: 'organiser', organization_id: null }, select: { id: true } });
  const owner = await prisma.organization_members.findFirst({
    where: { organization_id: org.id, role: 'owner' }, select: { user_id: true },
  });
  const actor = owner?.user_id ?? pool[0];

  // ---- 5 · the three championships ------------------------------------------
  const stamp = Date.now().toString(36);

  /** One championship, its draws, its squads and a part-played fixture list. */
  async function build(opts: {
    name: string;
    level: 'organization' | 'campus' | 'department';
    entrants: Array<{ orgId: string; unitId: string | null; label: string; players: string[] }>;
  }) {
    const champ = await prisma.championships.create({
      data: {
        name: opts.name,
        slug: `${slug(opts.name)}-${stamp}`,
        venue: 'Bengaluru',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-09-30'),
        status: 'ongoing',
        visibility: 'public',
        host_organization_id: host.id,
        entry_level: opts.level,
      },
    });
    if (organiserRole) {
      await prisma.user_championship_roles.create({ data: { championship_id: champ.id, user_id: actor, role_id: organiserRole.id } });
    }
    const tournament = await prisma.tournaments.create({ data: { championship_id: champ.id, name: opts.name, status: 'active' } });
    await prisma.venues.create({ data: { championship_id: champ.id, name: 'Main Ground', city: 'Bengaluru' } });

    // Entries. An internal championship gets ONE host row that every squad hangs
    // off; an open one gets a row per organisation.
    const entryByKey = new Map<string, string>();
    if (opts.level === 'organization') {
      for (const e of opts.entrants) {
        const row = await prisma.championship_organizations.create({
          data: { championship_id: champ.id, organization_id: e.orgId, applied_by: actor, reviewed_by: actor, reviewed_at: new Date(), status: 'approved' },
        });
        entryByKey.set(e.orgId, row.id);
      }
    } else {
      // The single standing entry an internal championship gets. Named for what it
      // is rather than `host`, which is the ORGANISATION further up.
      const hostEntry = await prisma.championship_organizations.create({
        data: { championship_id: champ.id, organization_id: host.id, applied_by: actor, reviewed_by: actor, reviewed_at: new Date(), status: 'approved' },
      });
      for (const e of opts.entrants) {
        entryByKey.set(e.unitId!, hostEntry.id);
        // The invitation is what makes a unit's participation a decision. Created
        // accepted, because inside one organisation there is nobody to accept.
        await prisma.championship_invitations.create({
          data: {
            championship_id: champ.id, organization_id: host.id, org_unit_id: e.unitId!,
            org_name: e.label, invited_by: actor, status: 'accepted', accepted_by: actor, responded_at: new Date(),
          },
        });
      }
    }

    let fixtures = 0;
    let played = 0;
    let inPlay = 0;
    for (const sport of sports) {
      const ts = await prisma.tournament_sports.create({ data: { tournament_id: tournament.id, sport_id: sport.id, format_id: fmt.id } });
      const draw = await prisma.tournament_disciplines.create({
        data: { tournament_sport_id: ts.id, discipline_id: sport.disciplines[0]?.id ?? null, format_id: fmt.id, status: 'ongoing' },
      });

      // One squad per entrant per sport, picked only from that entrant's own people.
      const squads: string[] = [];
      for (const e of opts.entrants) {
        const team = await prisma.teams.create({
          data: {
            sport_id: sport.id, organization_id: e.orgId, org_unit_id: e.unitId,
            name: `${e.label} ${sport.name}`, status: 'approved',
          },
        });
        const picked = e.players.slice(0, 8);
        if (picked.length) {
          await prisma.team_members.createMany({
            data: picked.map((user_id, i) => ({ team_id: team.id, user_id, role: i === 0 ? 'captain' : 'player' })),
            skipDuplicates: true,
          });
        }
        await prisma.team_entries.create({
          data: {
            team_id: team.id, organization_id: e.orgId, org_unit_id: e.unitId,
            championship_id: champ.id, championship_organization_id: entryByKey.get(e.unitId ?? e.orgId)!,
            tournament_discipline_id: draw.id, status: 'approved',
          },
        });
        squads.push(team.id);
      }

      // A round robin drawn ROUND BY ROUND (the circle method), with the first
      // five of seven rounds played.
      //
      // Both halves of that matter, and the naive version got both wrong. Skipping
      // every third fixture out of a flat i/j loop left entrants having played
      // anywhere between 24 and 48 matches, which no real competition does; playing
      // whole rounds means everybody has played the same number and the table is
      // comparable. And scores drawn from a flat random gave the first-listed squad
      // a systematic home advantage, producing a ladder where one campus had won 40
      // of 40 and another 0 of 40 - a table that reads as broken rather than as
      // mid-season.
      //
      // Each entrant instead gets a strength, and a result is that strength plus
      // noise, so favourites usually win, upsets happen, and draws occur.
      const rows: any[] = [];
      const ROUNDS_PLAYED = 5;
      // The round after the played ones is IN PLAY. A tenant meant to demonstrate a
      // live product with nothing live in it demonstrates half of one - and it is
      // also the only way to see the "Matches live now" card do anything.
      const ROUND_LIVE = ROUNDS_PLAYED;

      // Circle method: fix the first squad, rotate the rest.
      const order = squads.slice();
      const roundsOf: string[][][] = [];
      for (let r = 0; r < order.length - 1; r++) {
        const pairs: string[][] = [];
        for (let k = 0; k < order.length / 2; k++) {
          pairs.push([order[k], order[order.length - 1 - k]]);
        }
        roundsOf.push(pairs);
        order.splice(1, 0, order.pop()!);
      }

      roundsOf.forEach((pairs, r) => {
        const done = r < ROUNDS_PLAYED;
        const live = r === ROUND_LIVE;
        pairs.forEach(([home, away], k) => {
          let hs: number | null = null;
          let as: number | null = null;
          if (done || live) {
            // Strength is a property of the SQUAD, so a campus that is strong at
            // cricket is not automatically strong at everything - the index is
            // mixed with the sport to decorrelate the eight tables.
            const sh = strength(home, sport.name);
            const sa = strength(away, sport.name);
            hs = Math.max(0, Math.round(sh * 3 + rand(3) - 1));
            as = Math.max(0, Math.round(sa * 3 + rand(3) - 1));
          }
          rows.push({
            tournament_discipline_id: draw.id,
            home_team_id: home, away_team_id: away,
            status: done ? 'completed' : live ? 'live' : 'scheduled',
            scheduled_at: new Date(Date.UTC(2026, 7, 3 + r * 3, 9 + k * 2, 0)),
            home_score: hs, away_score: as,
            // A live match has a running score and NO winner - deciding one before
            // the final whistle is exactly what the scorecard lock exists to prevent.
            winner_team_id: done ? (hs! > as! ? home : hs! < as! ? away : null) : null,
          });
          if (done) played++;
          if (live) inPlay++;
        });
      });
      await prisma.fixtures.createMany({ data: rows });
      fixtures += rows.length;
    }

    const { recomputeStandingsAtomic } = await import('../src/modules/standings/standings.service.js');
    await recomputeStandingsAtomic(prisma as never, champ.id);
    const rowsOut = await prisma.standings.count({ where: { championship_id: champ.id, scope_type: 'championship' } });
    console.log(`  ${opts.name}: ${opts.entrants.length} entrants · ${fixtures} fixtures (${played} played, ${inPlay} live) · ${rowsOut} standings rows`);
    return champ;
  }

  // (a) INTER - Northfield hosts AND competes, plus seven others.
  const partners: Array<{ orgId: string; unitId: string | null; label: string; players: string[] }> = [];
  for (const [i, [name, code]] of PARTNERS.entries()) {
    const o = await prisma.organizations.create({
      data: { name, code: `${PARTNER_CODE}${code}`, short_name: code, city: 'Bengaluru', kind: 'institution', status: true, verified: true },
    });
    // Each partner needs its own people, or its squads would be picked from ours.
    const theirs: string[] = [];
    for (let k = 0; k < 10; k++) {
      const email = `p${i + 1}.player${k + 1}@bench.test`;
      const u = await prisma.users.upsert({
        where: { email },
        update: {},
        create: { name: `${FIRST[rand(FIRST.length)]} ${LAST[rand(LAST.length)]}`, email, password_hash: PASSWORD_HASH, account_type: 'participant' },
        select: { id: true },
      });
      await prisma.organization_members.upsert({
        where: { user_id_organization_id: { user_id: u.id, organization_id: o.id } },
        update: { status: 'active' },
        create: { user_id: u.id, organization_id: o.id, role: 'member', status: 'active', verification: 'verified' },
      });
      theirs.push(u.id);
    }
    partners.push({ orgId: o.id, unitId: null, label: code, players: theirs });
  }

  await build({
    name: 'Northfield Invitational 2026',
    level: 'organization',
    entrants: [{ orgId: org.id, unitId: null, label: 'Northfield', players: pool.slice(0, 10) }, ...partners],
  });

  // (b) INTRA - campus against campus.
  await build({
    name: 'Northfield Inter-Campus Games 2026',
    level: 'campus',
    entrants: campuses.map((c, i) => ({ orgId: org.id, unitId: c.id, label: c.name, players: campusPeople[i] })),
  });

  // (c) INTRA - batch against batch, inside the first campus.
  await build({
    name: `Northfield ${campuses[0].name} Batch League 2026`,
    level: 'department',
    entrants: batches.map((b, i) => ({ orgId: org.id, unitId: b.id, label: b.name, players: batchPeople[i] })),
  });

  console.log('\nDone.');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
