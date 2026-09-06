import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const CHAMP_ID = '166fc646-677d-4c02-8ccb-dd0114c14ac8'; // All india cricket trials
const YOGA_SPORT_ID = 'f2ae7c62-4eb0-45f7-93f4-5a2d6c015970';
const YOGA_TD_ID = '5e91248f-44c4-4ab4-9266-16261f552b9a'; // "Individual" discipline

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
  const users = await prisma.users.findMany({ where: { email: { in: EMAILS } }, select: { id: true, name: true, email: true } });
  if (users.length !== EMAILS.length) throw new Error(`Expected ${EMAILS.length} users, found ${users.length}`);

  const alreadyYoga = await prisma.team_entries.count({ where: { tournament_discipline_id: YOGA_TD_ID } });
  if (alreadyYoga > 0) throw new Error(`Refusing to run: Yoga discipline already has ${alreadyYoga} entries.`);

  const summary: any[] = [];

  for (const user of users) {
    const ownerMembership = await prisma.organization_members.findFirstOrThrow({
      where: { user_id: user.id, role: 'owner' },
      include: { organizations: { select: { id: true, name: true } } },
    });
    const orgId = ownerMembership.organization_id;
    const orgName = ownerMembership.organizations.name;

    const co = await prisma.championship_organizations.findFirstOrThrow({
      where: { championship_id: CHAMP_ID, organization_id: orgId },
    });

    let team = await prisma.teams.findFirst({ where: { organization_id: orgId, sport_id: YOGA_SPORT_ID } });
    let teamCreated = false;
    if (!team) {
      const teamName = `${orgName.replace(/ org$/i, '')} Yoga`;
      team = await prisma.teams.create({ data: {
        id: randomUUID(), sport_id: YOGA_SPORT_ID, organization_id: orgId, name: teamName,
        short_name: suggestShort(teamName), status: 'approved',
      } });
      await prisma.team_members.create({ data: { id: randomUUID(), team_id: team.id, user_id: user.id, role: 'captain' } });
      teamCreated = true;
    }

    const entry = await prisma.team_entries.create({ data: {
      id: randomUUID(), team_id: team.id, organization_id: orgId, championship_id: CHAMP_ID,
      championship_organization_id: co.id, tournament_discipline_id: YOGA_TD_ID, status: 'approved',
    } });

    summary.push({ email: user.email, org: orgName, team: team.name, teamCreated, team_entry_id: entry.id });
  }

  console.log(`Seeded ${summary.length} Yoga entries.`);
  console.table(summary.map((s) => ({ email: s.email, org: s.org, team: s.team, teamCreated: s.teamCreated })));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
