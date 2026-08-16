// Provisions one account per role the manual test protocol (Waves 0-3) needs, so a
// tester can sign in as any persona without hunting for a password. Idempotent:
// re-running upserts the same accounts rather than duplicating them.
//
//   npx tsx scripts/seed-test-personas.ts
//
// Every account is created with must_change_password = false, because the forced
// change is itself a thing to test and is already covered by asha@iimb.ac.in, who
// is deliberately left pending.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PASSWORD = 'Test@1234';
const ADMIN_PASSWORD = 'admin123';
const CHAMP = 'IIMB ICE BREAKER - 2026';

type Persona = {
  email: string;
  name: string;
  phone: string;
  org?: string;
  orgRole?: 'owner' | 'admin' | 'member';
  accountType?: string;
  superAdmin?: boolean;
  note: string;
};

const PEOPLE: Persona[] = [
  { email: 'admin@semp.local', name: 'Platform Admin', phone: '9000000001', superAdmin: true, accountType: 'admin',
    note: 'Super admin. /platform/* screens, and the "an admin is not a way round it" refusals.' },

  { email: 'owner@iimb.ac.in', name: 'Ishaan Owner', phone: '9000000002', org: 'IIM Bangalore', orgRole: 'owner',
    note: 'Institution owner. Roles, Modules, Structure, Activity.' },
  { email: 'coord@iimb.ac.in', name: 'Divya Coordinator', phone: '9000000003', org: 'IIM Bangalore', orgRole: 'admin',
    note: 'Sports-office coordinator. People directory, roll import, invitations.' },
  { email: 'organiser@iimb.ac.in', name: 'Arjun Organiser', phone: '9000000004', org: 'IIM Bangalore', orgRole: 'member',
    note: 'Championship organiser, NOT a super admin. Lock/unlock, approvals, schedule.' },
  { email: 'official@iimb.ac.in', name: 'Meera Official', phone: '9000000005', org: 'IIM Bangalore', orgRole: 'member',
    note: 'Match official. Score and submit; must be refused on a locked card.' },
  { email: 'poc@iimb.ac.in', name: 'Kabir POC', phone: '9000000006', org: 'IIM Bangalore', orgRole: 'member', accountType: 'institution',
    note: 'Institution POC. Entering teams, squad management.' },
  { email: 'captain@iimb.ac.in', name: 'Rhea Captain', phone: '9000000007', org: 'IIM Bangalore', orgRole: 'member',
    note: 'Squad captain (also in Section A, with real matches).' },
  { email: 'student@iimb.ac.in', name: 'Vikram Student', phone: '9000000008', org: 'IIM Bangalore', orgRole: 'member',
    note: 'Plain student. Module switch-off checks, My Game, own record.' },

  { email: 'stranger@sportagon.in', name: 'Nikhil Stranger', phone: '9000000009', org: 'Sportagon', orgRole: 'owner',
    note: 'A different institution. Cross-institution refusals (role scope, record privacy).' },

  { email: 'solo@player.test', name: 'Tara Solo', phone: '9000000010',
    note: 'No institution at all. Individual entry, and the hidden personal workspace.' },
];

const log = (s: string) => console.log(s);

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const orgs = new Map<string, string>();
  for (const o of await prisma.organizations.findMany({ select: { id: true, name: true } })) orgs.set(o.name, o.id);

  log('accounts');
  const byEmail = new Map<string, string>();
  for (const p of PEOPLE) {
    const data = {
      name: p.name,
      phone: p.phone,
      password_hash: p.superAdmin ? adminHash : hash,
      is_super_admin: !!p.superAdmin,
      is_active: true,
      must_change_password: false,
      account_type: p.accountType ?? 'participant',
    };
    const u = await prisma.users.upsert({ where: { email: p.email }, create: { email: p.email, ...data }, update: data });
    byEmail.set(p.email, u.id);

    if (p.org) {
      const orgId = orgs.get(p.org);
      if (!orgId) throw new Error(`missing organisation: ${p.org}`);
      await prisma.organization_members.upsert({
        where: { user_id_organization_id: { user_id: u.id, organization_id: orgId } },
        create: { user_id: u.id, organization_id: orgId, role: p.orgRole ?? 'member', status: 'active', verification: 'verified' },
        update: { role: p.orgRole ?? 'member', status: 'active', verification: 'verified' },
      });
    }
    log(`  ${p.email.padEnd(24)} ${p.superAdmin ? ADMIN_PASSWORD : PASSWORD}`);
  }

  // ---- championship wiring -------------------------------------------------------
  const champ = await prisma.championships.findFirst({ where: { name: CHAMP }, select: { id: true } });
  if (!champ) throw new Error(`missing championship: ${CHAMP}`);

  // Discover filters by region, and the chips are derived from country - with it null
  // there is nothing to filter and the check cannot be run at all.
  await prisma.championships.update({ where: { id: champ.id }, data: { country: 'India', region: 'asia' } });

  const roles = new Map<string, string>();
  for (const r of await prisma.roles.findMany({ where: { organization_id: null }, select: { id: true, code: true, name: true } })) {
    roles.set(r.code ?? r.name.toLowerCase(), r.id);
  }
  const grant = async (email: string, code: string) => {
    const uid = byEmail.get(email)!;
    const rid = roles.get(code);
    if (!rid) throw new Error(`missing role: ${code}`);
    await prisma.user_championship_roles.upsert({
      where: { user_id_championship_id_role_id: { user_id: uid, championship_id: champ.id, role_id: rid } },
      create: { user_id: uid, championship_id: champ.id, role_id: rid },
      update: {},
    });
  };
  // ICE BREAKER was organised by a super admin, which makes every "an admin is not a
  // way round it" check unrunnable on it. Give it a plain organiser.
  await grant('organiser@iimb.ac.in', 'organiser');
  await grant('official@iimb.ac.in', 'official');
  log(`\nchampionship: ${CHAMP}`);
  log('  organiser@iimb.ac.in -> Organiser, official@iimb.ac.in -> Official');

  const officialId = byEmail.get('official@iimb.ac.in')!;
  await prisma.championship_officials.upsert({
    where: { championship_id_user_id: { championship_id: champ.id, user_id: officialId } },
    create: { championship_id: champ.id, user_id: officialId, is_active: true },
    update: { is_active: true },
  });

  // Put the official on the matches that actually have two teams, so the Live tab has
  // a name to show and the score console has an owner.
  const playable = await prisma.fixtures.findMany({
    where: { home_team_id: { not: null }, away_team_id: { not: null } },
    select: { id: true }, take: 6,
  });
  if (playable.length) {
    await prisma.fixtures.updateMany({ where: { id: { in: playable.map((f) => f.id) } }, data: { official_id: officialId } });
    log(`  official assigned to ${playable.length} fixtures`);
  }

  // ---- squad membership, so captain/student have real matches ---------------------
  const sectionA = orgs.get('Section A');
  const team = sectionA
    ? await prisma.teams.findFirst({ where: { organization_id: sectionA, name: { startsWith: 'Badminton' } }, select: { id: true, name: true } })
    : null;
  if (team) {
    for (const [email, role] of [['captain@iimb.ac.in', 'captain'], ['student@iimb.ac.in', 'player']] as const) {
      const uid = byEmail.get(email)!;
      if (sectionA) {
        await prisma.organization_members.upsert({
          where: { user_id_organization_id: { user_id: uid, organization_id: sectionA } },
          create: { user_id: uid, organization_id: sectionA, role: 'member', status: 'active', verification: 'verified' },
          update: {},
        });
      }
      await prisma.team_members.upsert({
        where: { team_id_user_id: { team_id: team.id, user_id: uid } },
        create: { team_id: team.id, user_id: uid, role, is_active: true },
        update: { role, is_active: true },
      });
    }
    log(`  captain/student added to Section A - ${team.name}`);
  }

  // ---- reset the module switches to default --------------------------------------
  // "people" was left off for students by an earlier test run, which would make the
  // Wave 3 module check pass before it was performed.
  const iimb = orgs.get('IIM Bangalore');
  if (iimb) {
    const row = await prisma.organizations.findUnique({ where: { id: iimb }, select: { settings: true } });
    const settings = (row?.settings ?? {}) as any;
    const modules = { ...(settings.modules ?? {}) };
    let changed = false;
    for (const k of Object.keys(modules)) {
      const v: string[] = modules[k] ?? [];
      if (!v.includes('staff') || !v.includes('students')) { modules[k] = ['staff', 'students']; changed = true; }
    }
    if (changed) {
      await prisma.organizations.update({ where: { id: iimb }, data: { settings: { ...settings, modules } } });
      log('  IIM Bangalore module switches reset to default (all on)');
    }
  }

  log('\ndone');
}

main()
  .catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
