/**
 * Push the role ladder into the database, as a FLOOR.
 *
 *   npx tsx scripts/sync-role-catalogue.ts          # report what would change
 *   npx tsx scripts/sync-role-catalogue.ts --write  # write it
 *
 * `packages/shared/src/role-model.ts` owns the ladder; `roles.permission_ids` is
 * where can() reads it. Migration 20260828000030 established the floor once, and this
 * script is how it is re-established whenever the model changes - so that the next
 * permission added to Sports Admin does not need a fourth hand-written migration to
 * reach Org Admin and Owner.
 *
 * IT ONLY EVER ADDS. Two facts about this database made that the only safe
 * semantics, and both are visible in it right now:
 *
 *   * /platform/roles is a live screen. The platform `organiser` row holds 18
 *     permissions where the ladder computes 6, so a replace would silently revoke
 *     whatever a super admin set there.
 *   * An institution can own its own copy of a role, and one holds exactly
 *     `{report.view}` for Viewer - deliberately narrower than the platform floor.
 *     Institution rows are never touched; they are reported so a copy that has
 *     fallen behind the platform definition is visible rather than silent.
 *
 * Removing a permission therefore stays a deliberate, reviewed act in a migration -
 * as `security.manage` leaving Org Admin was. A sync that could take authority away
 * is a sync nobody should run without reading it first, and this one does not.
 *
 * Idempotent, and safe against production. The dry run is the default because the
 * alternative - a script whose default is to change authorisation - is not a script
 * anybody should run to find out what it does.
 */

import { PrismaClient } from '@prisma/client';
import { ROLE_DEFS, effectiveGrants } from '@semp/shared';

const prisma = new PrismaClient();
const WRITE = process.argv.includes('--write');

async function main() {
  console.log(WRITE ? '\nSyncing the role floor.\n' : '\nDry run - pass --write to apply.\n');

  let changed = 0;
  let missing = 0;

  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    const floor = effectiveGrants(code) as unknown as string[];
    const row = await prisma.roles.findFirst({
      where: { organization_id: null, code },
      select: { id: true, permission_ids: true, kind: true, scope: true, description: true },
    });

    if (!row) {
      // Not created here. A missing platform role is a seeding problem, and minting
      // one from a sync script would hide it - the row also carries an id that
      // user_org_roles and user_championship_roles point at.
      console.log(`  ! ${code.padEnd(16)} no platform role row - run the migrations`);
      missing += 1;
      continue;
    }

    const current = ((row.permission_ids as unknown as string[]) ?? []);
    const behind = floor.filter((p) => !current.includes(p));
    // Everything the human side has added on top of the ladder. Reported, never
    // removed - see the header.
    const extra = current.filter((p) => !floor.includes(p));
    const meta =
      row.kind !== def.vocabulary || row.scope !== def.reach || row.description !== def.description;

    if (!behind.length && !meta) {
      console.log(
        `  = ${code.padEnd(16)} floor of ${floor.length} met` +
        (extra.length ? `, plus ${extra.length} added by hand` : ''),
      );
      continue;
    }

    console.log(
      `  ${WRITE ? '>' : '~'} ${code.padEnd(16)}` +
      (behind.length ? ` +${behind.join(' +')}` : '') +
      (meta ? '  (kind/scope/description)' : '') +
      (extra.length ? `  [keeping ${extra.length} added by hand]` : ''),
    );
    changed += 1;

    if (WRITE) {
      await prisma.roles.update({
        where: { id: row.id },
        data: {
          // Union, in catalogue order for the part the ladder owns, with anything
          // added by hand kept on the end.
          permission_ids: [...floor, ...extra],
          kind: def.vocabulary as any,
          scope: def.reach as any,
          is_system: true,
          description: def.description,
        },
      });
    }
  }

  // What each institution has chosen to differ on. Not touched, but worth seeing: an
  // override that predates a permission being added to the platform role will never
  // receive it, and that is the copy's owner's decision to revisit.
  const overrides = await prisma.roles.findMany({
    where: { organization_id: { not: null }, code: { in: Object.keys(ROLE_DEFS) } },
    select: { code: true, organization_id: true, permission_ids: true, organizations: { select: { name: true } } },
  });

  if (overrides.length) {
    console.log('\nInstitution-owned copies (left alone):');
    for (const o of overrides) {
      const floor = effectiveGrants(o.code ?? '') as unknown as string[];
      const current = ((o.permission_ids as unknown as string[]) ?? []);
      const behind = floor.filter((p) => !current.includes(p));
      console.log(
        `  · ${(o.organizations?.name ?? o.organization_id ?? '').slice(0, 26).padEnd(28)} ${(o.code ?? '').padEnd(16)}` +
        (behind.length ? ` narrower than the platform floor by: ${behind.join(', ')}` : ' at or above the floor'),
      );
    }
  }

  console.log(
    `\n${changed} platform role${changed === 1 ? '' : 's'} ${WRITE ? 'updated' : 'would change'}` +
    (missing ? `, ${missing} missing` : '') + '.\n',
  );
}

main()
  .catch((e) => { console.error('\nSync failed:\n', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
