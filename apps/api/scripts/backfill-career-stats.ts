import { PrismaClient } from '@prisma/client';
import { recomputeCareerStats } from '../src/modules/records/career-stats.service.js';

// One-off backfill for J4-E3.
//
// The lock keeps career_stats current from now on, but every result locked before the
// table existed left nothing behind. This walks the existing record and builds the rows
// those locks would have written.
//
// Safe to run repeatedly: recomputeCareerStats rebuilds a person from source rather
// than adjusting them, so a second run produces the same numbers as the first.

const prisma = new PrismaClient();

async function main() {
  const [entries, achievements] = await Promise.all([
    prisma.lifetime_entries.findMany({
      where: { organization_id: { not: null }, superseded_at: null },
      select: { user_id: true, organization_id: true },
    }),
    prisma.achievements.findMany({
      where: { user_id: { not: null }, organization_id: { not: null }, superseded_at: null },
      select: { user_id: true, organization_id: true },
    }),
  ]);

  const pairs = new Map<string, { userId: string; organizationId: string }>();
  for (const r of [...entries, ...achievements]) {
    if (!r.user_id || !r.organization_id) continue;
    pairs.set(`${r.user_id}:${r.organization_id}`, { userId: r.user_id, organizationId: r.organization_id });
  }

  console.log(`${pairs.size} (person, institution) records to build`);
  let done = 0;
  let rows = 0;
  for (const p of pairs.values()) {
    const written = await recomputeCareerStats(prisma as any, p.userId, p.organizationId);
    rows += written.length;
    done += 1;
    if (done % 25 === 0) console.log(`  ${done}/${pairs.size}`);
  }

  const byGrain = await prisma.career_stats.groupBy({ by: ['grain'], _count: { _all: true } });
  console.log(`done: ${done} records, ${rows} rows written`);
  console.log('by grain:', Object.fromEntries(byGrain.map((g) => [g.grain, g._count._all])));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
