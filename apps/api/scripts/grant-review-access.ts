import { PrismaClient } from '@prisma/client';
import { ROLE_CODES, roleWhereByCode } from '@semp/shared';

/**
 * Give the test personas enough standing to review every workspace.
 *
 * The bench was seeded for the Waves 0-3 protocol, where each persona held exactly
 * one role so refusals could be checked cleanly. That makes it a poor bench for
 * reviewing SCREENS: most personas have no event role at all, so the event
 * workspace is invisible to them and the role-dependent navs cannot be compared.
 *
 * This grants event roles on the live championship - additively, idempotently, and
 * reversibly. It creates nothing, deletes nothing, and touches no result.
 *
 *   npx tsx scripts/grant-review-access.ts          # show what it would do
 *   npx tsx scripts/grant-review-access.ts apply
 *   npx tsx scripts/grant-review-access.ts undo     # remove exactly what it added
 */

const prisma = new PrismaClient();

/** The live championship the bench was built around. */
const CHAMPIONSHIP = 'IIMB ICE BREAKER - 2026';

/** Who gets which event role. One per role so every nav variant is reviewable. */
const GRANTS: Array<{ email: string; role: keyof typeof ROLE_CODES }> = [
  { email: 'owner@iimb.ac.in', role: 'organiser' },
  { email: 'coord@iimb.ac.in', role: 'organiser' },
  { email: 'poc@iimb.ac.in', role: 'poc' },
  { email: 'captain@iimb.ac.in', role: 'captain' },
  { email: 'student@iimb.ac.in', role: 'participant' },
];

async function main() {
  const mode = (process.argv[2] ?? 'dry') as 'dry' | 'apply' | 'undo';

  const champ = await prisma.championships.findFirst({
    where: { name: CHAMPIONSHIP },
    select: { id: true, name: true, status: true },
  });
  if (!champ) throw new Error(`No championship named "${CHAMPIONSHIP}" - nothing to grant against.`);
  console.log(`championship: ${champ.name} (${champ.status})\n`);

  for (const { email, role } of GRANTS) {
    const user = await prisma.users.findFirst({ where: { email }, select: { id: true, name: true } });
    if (!user) { console.log(`  ${email.padEnd(26)} MISSING - skipped`); continue; }

    // Roles resolve by stable code, never by display name - see @semp/shared.
    const roleRow = await prisma.roles.findFirst({ where: roleWhereByCode(ROLE_CODES[role]) });
    if (!roleRow) { console.log(`  ${email.padEnd(26)} no '${role}' role row - skipped`); continue; }

    const existing = await prisma.user_championship_roles.findFirst({
      where: { championship_id: champ.id, user_id: user.id, role_id: roleRow.id },
      select: { id: true },
    });

    if (mode === 'undo') {
      if (!existing) { console.log(`  ${email.padEnd(26)} ${role.padEnd(12)} not present`); continue; }
      await prisma.user_championship_roles.delete({ where: { id: existing.id } });
      console.log(`  ${email.padEnd(26)} ${role.padEnd(12)} REMOVED`);
      continue;
    }

    if (existing) { console.log(`  ${email.padEnd(26)} ${role.padEnd(12)} already held`); continue; }
    if (mode === 'dry') { console.log(`  ${email.padEnd(26)} ${role.padEnd(12)} would grant`); continue; }

    await prisma.user_championship_roles.create({
      data: { championship_id: champ.id, user_id: user.id, role_id: roleRow.id },
    });
    console.log(`  ${email.padEnd(26)} ${role.padEnd(12)} GRANTED`);
  }

  if (mode === 'dry') console.log('\nDry run. Pass `apply` to write, `undo` to reverse.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
