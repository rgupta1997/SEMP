import type { Prisma } from '../../infra/prisma.js';

// Materialising a career (J4-E3).
//
// RECOMPUTE, NEVER INCREMENT. Every call rebuilds a person's whole record for an
// institution from the underlying rows. Incrementing is faster and is the wrong trade:
// a delta applied twice, or applied to a result that is later corrected, is wrong
// permanently and silently. A recompute is idempotent - running it twice produces the
// same answer, which means a retry, a replay, or a nervous operator pressing the button
// again all cost time and nothing else.
//
// The three grains (sport / discipline / format) are written in ONE transaction, so a
// reader can never catch the sport total disagreeing with the disciplines under it.

export type Grain = 'sport' | 'discipline' | 'format';

interface Bucket {
  sport_id: string;
  discipline_id: string | null;
  format: string | null;
  grain: Grain;
  played: number; won: number; lost: number; drawn: number;
  gold: number; silver: number; bronze: number; awards: number;
  first_on: Date | null; last_on: Date | null;
}

const key = (sportId: string, disciplineId: string | null, format: string | null) =>
  `${sportId}|${disciplineId ?? ''}|${format ?? ''}`;

const blank = (sport_id: string, discipline_id: string | null, format: string | null, grain: Grain): Bucket => ({
  sport_id, discipline_id, format, grain,
  played: 0, won: 0, lost: 0, drawn: 0, gold: 0, silver: 0, bronze: 0, awards: 0,
  first_on: null, last_on: null,
});

const span = (b: Bucket, on: Date) => {
  if (!b.first_on || on < b.first_on) b.first_on = on;
  if (!b.last_on || on > b.last_on) b.last_on = on;
};

/**
 * Rebuild one person's career statistics for one institution.
 *
 * Returns the rows written, so a caller can log or assert on them without a re-read.
 */
export async function recomputeCareerStats(prisma: Prisma, userId: string, organizationId: string) {
  const LIVE = { superseded_at: null };

  const [entries, achievements] = await Promise.all([
    prisma.lifetime_entries.findMany({
      where: { user_id: userId, organization_id: organizationId, ...LIVE },
      select: { fixture_id: true, sport_id: true, occurred_on: true, detail: true },
      take: 5000,
    }),
    prisma.achievements.findMany({
      // Team rows are excluded: a squad medal already fanned out to a row per member,
      // so counting both would double every medal the squad ever won.
      where: { user_id: userId, organization_id: organizationId, ...LIVE },
      select: { fixture_id: true, sport_id: true, occurred_on: true, medal: true, kind: true },
      take: 5000,
    }),
  ]);

  // Discipline and format are not on either row - they hang off the fixture. Resolved
  // in one query for every fixture involved rather than per row.
  const fixtureIds = [...new Set([...entries, ...achievements]
    .map((r) => r.fixture_id).filter((f): f is string => !!f))];
  const fixtures = fixtureIds.length
    ? await prisma.fixtures.findMany({
      where: { id: { in: fixtureIds } },
      select: {
        id: true,
        tournament_disciplines: {
          select: {
            discipline_id: true,
            tournament_formats: { select: { name: true } },
            tournament_sports: { select: { sport_id: true } },
          },
        },
      },
    })
    : [];
  const shapeOf = new Map(fixtures.map((f) => [f.id, {
    discipline_id: f.tournament_disciplines?.discipline_id ?? null,
    format: f.tournament_disciplines?.tournament_formats?.name ?? null,
    sport_id: f.tournament_disciplines?.tournament_sports?.sport_id ?? null,
  }]));

  const buckets = new Map<string, Bucket>();

  /** Fold one row into all three grains at once - that IS the cascade. */
  const fold = (
    fixtureId: string | null,
    rowSportId: string | null,
    on: Date,
    apply: (b: Bucket) => void,
  ) => {
    const shape = fixtureId ? shapeOf.get(fixtureId) : undefined;
    // The row's own sport wins; the fixture's is the fallback for rows that predate
    // sport attribution. Without a sport there is no grain to file this under at all.
    const sportId = rowSportId ?? shape?.sport_id ?? null;
    if (!sportId) return;

    const levels: Array<[string | null, string | null, Grain]> = [[null, null, 'sport']];
    if (shape?.discipline_id) {
      levels.push([shape.discipline_id, null, 'discipline']);
      if (shape.format) levels.push([shape.discipline_id, shape.format, 'format']);
    }

    for (const [disciplineId, format, grain] of levels) {
      const k = key(sportId, disciplineId, format);
      if (!buckets.has(k)) buckets.set(k, blank(sportId, disciplineId, format, grain));
      const b = buckets.get(k)!;
      apply(b);
      span(b, on);
    }
  };

  for (const e of entries) {
    const outcome = (e.detail as { outcome?: string } | null)?.outcome;
    fold(e.fixture_id, e.sport_id, e.occurred_on, (b) => {
      b.played += 1;
      // `drew` in the record, `drawn` in the table - the record's wording is the
      // published one and is not worth a migration to rename.
      if (outcome === 'won') b.won += 1;
      else if (outcome === 'lost') b.lost += 1;
      else if (outcome === 'drew') b.drawn += 1;
    });
  }

  for (const a of achievements) {
    fold(a.fixture_id, a.sport_id, a.occurred_on, (b) => {
      if (a.medal === 'gold') b.gold += 1;
      else if (a.medal === 'silver') b.silver += 1;
      else if (a.medal === 'bronze') b.bronze += 1;
      if (a.kind === 'award') b.awards += 1;
    });
  }

  const rows = [...buckets.values()];

  // Delete-then-insert inside one transaction. An upsert would leave behind rows for a
  // sport somebody no longer has any results in - after a correction, say - and a
  // record that still lists a sport with zero of everything reads as a bug.
  await prisma.$transaction(async (tx) => {
    await tx.career_stats.deleteMany({ where: { user_id: userId, organization_id: organizationId } });
    if (rows.length) {
      await tx.career_stats.createMany({
        data: rows.map((r) => ({ ...r, user_id: userId, organization_id: organizationId, computed_at: new Date() })),
      });
    }
  });

  return rows;
}

/**
 * Everyone whose record a fixture touches, so a lock can refresh exactly them.
 *
 * Scoped per (person, institution) because career_stats is an institution's view of a
 * person - somebody who played for two institutions has two records, and locking a
 * fixture must not silently rewrite the other one.
 */
export async function peopleAffectedByFixture(prisma: Prisma, fixtureId: string) {
  const [entries, achievements] = await Promise.all([
    prisma.lifetime_entries.findMany({
      where: { fixture_id: fixtureId, organization_id: { not: null } },
      select: { user_id: true, organization_id: true },
    }),
    prisma.achievements.findMany({
      where: { fixture_id: fixtureId, user_id: { not: null }, organization_id: { not: null } },
      select: { user_id: true, organization_id: true },
    }),
  ]);

  const pairs = new Map<string, { userId: string; organizationId: string }>();
  for (const r of [...entries, ...achievements]) {
    if (!r.user_id || !r.organization_id) continue;
    pairs.set(`${r.user_id}:${r.organization_id}`, { userId: r.user_id, organizationId: r.organization_id });
  }
  return [...pairs.values()];
}

/**
 * Refresh every record a fixture touches. Called after a lock or an unlock.
 *
 * Deliberately never throws into the caller: a scorecard that will not lock because a
 * statistics table would not update is a worse product than a statistics table that is
 * briefly stale. The recompute is idempotent, so the next lock repairs it.
 */
export async function refreshCareerStatsForFixture(prisma: Prisma, fixtureId: string) {
  try {
    const people = await peopleAffectedByFixture(prisma, fixtureId);
    for (const p of people) {
      await recomputeCareerStats(prisma, p.userId, p.organizationId).catch((e) =>
        console.error('[career-stats] recompute failed', p, e));
    }
    return people.length;
  } catch (e) {
    console.error('[career-stats] refresh failed for fixture', fixtureId, e);
    return 0;
  }
}
