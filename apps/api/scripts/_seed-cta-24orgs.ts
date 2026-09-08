import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const HOST_EMAIL = 'aman@enterprise.in';
const CHAMP_ID = '62c0db2c-e6ac-4c95-a6a2-0665b31e2800'; // CTA event
const CRICKET_SPORT_ID = '4a3e5f08-7cad-4a2d-8f08-eeebb09d7820';
const CRICKET_TD_ID = 'c98cce97-713a-42dd-8ac2-524ef2718f25'; // Whole sport
const YOGA_SPORT_ID = 'f2ae7c62-4eb0-45f7-93f4-5a2d6c015970';
const YOGA_TD_ID = '5a70dbe0-1860-4f31-9eac-fb57abf0b3df'; // Individual

const EMAILS = [
  'karan@ac.iimb.in', 'arjun@ac.iimb.in', 'gyan@iimb.ac.in', 'tanya@iimb.ac.in',
  'nihal@iimb.ac.in', 'subh@iimb.ac.in', 'asha@iimb.ac.in', 'hrithik@iimb.ac.in',
  'aman@player3.in', 'aman@player2.in', 'aman@player1.in', 'aman@fan.in',
  'aman@heros.in', 'aman@gangsters.in', 'aman@wolves.in', 'aman@panthers.in',
  'aman@vipers.in', 'aman@knights.in', 'aman@risers.in', 'aman@united.in',
  'aman@royals.in', 'aman@giants.in', 'aman@titans.in', 'aman@lions.in',
];

function suggestShort(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'TM';
  const out = words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('');
  return (out.length >= 2 ? out : words[0].slice(0, 4)).toUpperCase().slice(0, 12);
}

async function main() {
  const host = await prisma.users.findUniqueOrThrow({ where: { email: HOST_EMAIL }, select: { id: true } });
  const users = await prisma.users.findMany({ where: { email: { in: EMAILS } }, select: { id: true, name: true, email: true } });
  if (users.length !== EMAILS.length) throw new Error(`Expected ${EMAILS.length} users, found ${users.length}`);

  const alreadyCricket = await prisma.team_entries.count({ where: { tournament_discipline_id: CRICKET_TD_ID } });
  const alreadyYoga = await prisma.team_entries.count({ where: { tournament_discipline_id: YOGA_TD_ID } });
  console.log(`Pre-existing entries -> Cricket: ${alreadyCricket}, Yoga: ${alreadyYoga} (expected: 2 cricket from earlier testing, 0 yoga)`);

  const summary: any[] = [];

  for (const user of users) {
    const ownerMembership = await prisma.organization_members.findFirstOrThrow({
      where: { user_id: user.id, role: 'owner' },
      include: { organizations: { select: { id: true, name: true } } },
    });
    const orgId = ownerMembership.organization_id;
    const orgName = ownerMembership.organizations.name;

    // championship_organizations is per-championship - this org hasn't applied to
    // CTA event before (only entered elsewhere), so create fresh, approved.
    let co = await prisma.championship_organizations.findFirst({ where: { championship_id: CHAMP_ID, organization_id: orgId } });
    if (!co) {
      co = await prisma.championship_organizations.create({ data: {
        id: randomUUID(), championship_id: CHAMP_ID, organization_id: orgId,
        applied_by: user.id, status: 'approved', reviewed_by: host.id, reviewed_at: new Date(),
      } });
    }

    // Reuse the SAME cricket/yoga teams already built for "All India Cricket
    // Trials" - a team plays across multiple championships via its own
    // team_entries row, not a fresh team per event.
    let cricketTeam = await prisma.teams.findFirst({ where: { organization_id: orgId, sport_id: CRICKET_SPORT_ID } });
    if (!cricketTeam) {
      const teamName = `${orgName.replace(/ org$/i, '')} Cricket`;
      cricketTeam = await prisma.teams.create({ data: {
        id: randomUUID(), sport_id: CRICKET_SPORT_ID, organization_id: orgId, name: teamName,
        short_name: suggestShort(teamName), status: 'approved',
      } });
      await prisma.team_members.create({ data: { id: randomUUID(), team_id: cricketTeam.id, user_id: user.id, role: 'captain' } });
    }
    let yogaTeam = await prisma.teams.findFirst({ where: { organization_id: orgId, sport_id: YOGA_SPORT_ID } });
    if (!yogaTeam) {
      const teamName = `${orgName.replace(/ org$/i, '')} Yoga`;
      yogaTeam = await prisma.teams.create({ data: {
        id: randomUUID(), sport_id: YOGA_SPORT_ID, organization_id: orgId, name: teamName,
        short_name: suggestShort(teamName), status: 'approved',
      } });
      await prisma.team_members.create({ data: { id: randomUUID(), team_id: yogaTeam.id, user_id: user.id, role: 'captain' } });
    }

    const cricketEntry = await prisma.team_entries.upsert({
      where: { team_id_championship_id: { team_id: cricketTeam.id, championship_id: CHAMP_ID } },
      update: {},
      create: {
        id: randomUUID(), team_id: cricketTeam.id, organization_id: orgId, championship_id: CHAMP_ID,
        championship_organization_id: co.id, tournament_discipline_id: CRICKET_TD_ID, status: 'approved',
      },
    });
    const yogaEntry = await prisma.team_entries.upsert({
      where: { team_id_championship_id: { team_id: yogaTeam.id, championship_id: CHAMP_ID } },
      update: {},
      create: {
        id: randomUUID(), team_id: yogaTeam.id, organization_id: orgId, championship_id: CHAMP_ID,
        championship_organization_id: co.id, tournament_discipline_id: YOGA_TD_ID, status: 'approved',
      },
    });

    summary.push({ email: user.email, org: orgName, cricketTeam: cricketTeam.name, yogaTeam: yogaTeam.name, cricketEntry: cricketEntry.id, yogaEntry: yogaEntry.id });
  }

  console.log(`Seeded ${summary.length} orgs into CTA event (Cricket + Yoga):`);
  console.table(summary.map((s) => ({ email: s.email, org: s.org, cricketTeam: s.cricketTeam, yogaTeam: s.yogaTeam })));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
