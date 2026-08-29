// Do the REAL championships already in this database still compute the same
// standings after the contingent change?
//
// The unit tests prove the new behaviour and the e2e script proves intra events
// work. Neither answers the question that actually decides whether this is safe to
// ship: does every championship that already exists still produce byte-identical
// standings? Every one of them is inter-organisation, every team's `org_unit_id` is
// null, so the contingent key is the organisation id and the answer should be yes -
// but "should be" is exactly the kind of reasoning this script exists to replace.
//
// Read-only in effect: each championship is recomputed INSIDE a transaction that is
// then rolled back, so the stored table is never touched even while the recompute
// deletes and rebuilds it.
//
//   node scripts/verify-standings-unchanged.mjs

import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
process.env.DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] || '').trim().replace(/^"|"$/g, '');

const prisma = new PrismaClient();

/** A stable, comparable projection of one standings table. */
const project = (rows) => rows
  .map((r) => [
    r.scope_type,
    r.scope_id ?? '-',
    r.organization_id,
    r.org_unit_id ?? '-',
    r.rank, r.played, r.won, r.drawn, r.lost, r.points,
    JSON.stringify(r.detail ?? {}),
  ].join('|'))
  .sort()
  .join('\n');

class Rollback extends Error {}

async function main() {
  const champs = await prisma.championships.findMany({
    where: { standings: { some: {} } },
    select: { id: true, name: true, entry_level: true, status: true },
    orderBy: { created_at: 'asc' },
  });

  console.log(`\nRecomputing ${champs.length} championship${champs.length === 1 ? '' : 's'} that have standings, and diffing.\n${'='.repeat(72)}`);

  const { recomputeStandings } = await import('../src/modules/standings/standings.service.ts');

  let same = 0;
  const drifted = [];

  for (const c of champs) {
    const before = await prisma.standings.findMany({ where: { championship_id: c.id } });

    let after = null;
    try {
      await prisma.$transaction(async (tx) => {
        await recomputeStandings(tx, c.id);
        after = await tx.standings.findMany({ where: { championship_id: c.id } });
        // Everything above is discarded. The recompute is destructive by design
        // (delete-then-rebuild), so this is the only safe way to run it against a
        // live table for comparison.
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) {
        drifted.push({ name: c.name, reason: `recompute threw: ${e.message.slice(0, 120)}` });
        console.log(`  ✗ ${c.name}\n      recompute threw: ${e.message.slice(0, 160)}`);
        continue;
      }
    }

    const a = project(before);
    const b = project(after ?? []);
    if (a === b) {
      same++;
      console.log(`  ✓ ${c.name} · ${before.length} rows · ${c.entry_level}`);
    } else {
      const beforeLines = a.split('\n');
      const afterLines = b.split('\n');
      const onlyBefore = beforeLines.filter((l) => !afterLines.includes(l)).slice(0, 3);
      const onlyAfter = afterLines.filter((l) => !beforeLines.includes(l)).slice(0, 3);
      drifted.push({ name: c.name, onlyBefore, onlyAfter });
      console.log(`  ✗ ${c.name} · ${before.length} stored vs ${(after ?? []).length} recomputed`);
      onlyBefore.forEach((l) => console.log(`      stored only: ${l}`));
      onlyAfter.forEach((l) => console.log(`      rebuilt only: ${l}`));
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`${same} identical, ${drifted.length} drifted`);
  if (drifted.length) process.exitCode = 1;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
