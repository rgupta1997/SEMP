import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const HOST_EMAIL = 'aman@enterprise.in';
const CHAMP_ID = '166fc646-677d-4c02-8ccb-dd0114c14ac8'; // All india cricket trials

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
  const champ = await prisma.championships.findUniqueOrThrow({ where: { id: CHAMP_ID }, select: { id: true, name: true, host_organization_id: true } });

  const cricketSport = await prisma.sports.findFirstOrThrow({ where: { name: { equals: 'Cricket', mode: 'insensitive' } }, select: { id: true } });
  const cricketTd = await prisma.tournament_disciplines.findFirstOrThrow({
    where: { tournament_sports: { tournament_id: { in: (await prisma.tournaments.findMany({ where: { championship_id: CHAMP_ID }, select: { id: true } })).map((t) => t.id) }, sport_id: cricketSport.id } },
    select: { id: true },
  });

  const existingEntries = await prisma.championship_organizations.count({ where: { championship_id: CHAMP_ID } });
  if (existingEntries > 0) throw new Error(`Refusing to run: championship already has ${existingEntries} org entries.`);

  const users = await prisma.users.findMany({ where: { email: { in: EMAILS } }, select: { id: true, name: true, email: true } });
  if (users.length !== EMAILS.length) throw new Error(`Expected ${EMAILS.length} users, found ${users.length}`);

  const summary: any[] = [];

  for (const user of users) {
    const ownerMembership = await prisma.organization_members.findFirst({
      where: { user_id: user.id, role: 'owner' },
      include: { organizations: { select: { id: true, name: true } } },
    });

    let orgId: string;
    let orgName: string;
    let orgCreated = false;
    if (ownerMembership) {
      orgId = ownerMembership.organization_id;
      orgName = ownerMembership.organizations.name;
    } else {
      orgId = randomUUID();
      orgName = `${user.name.trim()} org`;
      await prisma.organizations.create({ data: { id: orgId, name: orgName, kind: 'community' } });
      await prisma.organization_members.create({ data: {
        id: randomUUID(), user_id: user.id, organization_id: orgId, role: 'owner', status: 'active',
        verification: 'verified', verified_by: host.id, verified_at: new Date(),
      } });
      orgCreated = true;
    }

    let team = await prisma.teams.findFirst({ where: { organization_id: orgId, sport_id: cricketSport.id } });
    let teamCreated = false;
    if (!team) {
      const teamName = `${orgName.replace(/ org$/i, '')} Cricket`;
      team = await prisma.teams.create({ data: {
        id: randomUUID(), sport_id: cricketSport.id, organization_id: orgId, name: teamName,
        short_name: suggestShort(teamName), status: 'approved',
      } });
      await prisma.team_members.create({ data: { id: randomUUID(), team_id: team.id, user_id: user.id, role: 'captain' } });
      teamCreated = true;
    }

    const co = await prisma.championship_organizations.create({ data: {
      id: randomUUID(), championship_id: CHAMP_ID, organization_id: orgId,
      applied_by: user.id, status: 'approved', reviewed_by: host.id, reviewed_at: new Date(),
    } });

    const entry = await prisma.team_entries.create({ data: {
      id: randomUUID(), team_id: team.id, organization_id: orgId, championship_id: CHAMP_ID,
      championship_organization_id: co.id, tournament_discipline_id: cricketTd.id, status: 'approved',
    } });

    summary.push({ email: user.email, org: orgName, orgCreated, team: team.name, teamCreated, championship_organization_id: co.id, team_entry_id: entry.id });
  }

  console.log(`Seeded ${summary.length} orgs into "${champ.name}":`);
  console.table(summary.map((s) => ({ email: s.email, org: s.org, orgCreated: s.orgCreated, team: s.team, teamCreated: s.teamCreated })));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
