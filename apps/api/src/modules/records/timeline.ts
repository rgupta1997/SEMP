import type { Prisma } from '../../infra/prisma.js';

// The Achievement Timeline (the design's chronological view of J4-E4/E9).
//
// The Hall of Fame answers "what have we won?"; the timeline answers "what happened,
// and when?". Same rows, different question - which is why it is a separate read
// rather than a re-sort of the board: the board deliberately keeps team rows only, and
// a timeline that hid every individual milestone would be a strange history.
//
// ONE READ, TWO SCOPES. An institution's history and a person's are the same rows
// asked a different way, so they are the same function with a different WHERE. The
// alternative - a second, person-shaped timeline query - is how the two views start
// disagreeing about what counts as a milestone, and somebody who both plays and runs
// the place would be the first to notice.

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  detail: string | null;
  kind: string;
  medal: string | null;
  sport: string | null;
  recipient: string | null;
  championship_id: string | null;
  /** locked_result | validated_claim - a reader must be able to tell these apart. */
  source: string;
  tags: string[];
}

/**
 * Whose history this is.
 *
 * An organisation's timeline keeps the squad rows - at institution level the team
 * medal IS the fact. A person's keeps only rows written against them, which is the
 * per-player copy the lock fans out. Reading both from one scope would double-count
 * every squad medal at org level and attribute team rows to nobody at person level.
 */
export type TimelineScope = { organizationId: string } | { userId: string };

const scopeWhere = (scope: TimelineScope) =>
  'organizationId' in scope ? { organization_id: scope.organizationId } : { user_id: scope.userId };

const titleCase = (s: string) => s.replace(/(^|[\s-])(\w)/g, (_, a, b) => a + b.toUpperCase());

/**
 * A page of history, newest first.
 *
 * Cursor-paginated on (occurred_on, id) rather than offset: "Load more history" on an
 * offset would silently skip or repeat a row whenever something new was locked between
 * two clicks, and a history that reorders under the reader is worse than a short one.
 */
export async function achievementTimeline(prisma: Prisma, scope: TimelineScope, opts: {
  year?: number | null;
  cursorDate?: string | null;
  cursorId?: string | null;
  limit?: number;
}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  const yearWindow = opts.year
    ? { occurred_on: { gte: new Date(Date.UTC(opts.year, 0, 1)), lt: new Date(Date.UTC(opts.year + 1, 0, 1)) } }
    : {};

  // Strictly "older than the last row I showed you", tie-broken by id so two honours
  // on the same day cannot cause one to be shown twice.
  const after = opts.cursorDate
    ? {
      OR: [
        { occurred_on: { lt: new Date(opts.cursorDate) } },
        ...(opts.cursorId ? [{ occurred_on: new Date(opts.cursorDate), id: { lt: opts.cursorId } }] : []),
      ],
    }
    : {};

  const where = {
    ...scopeWhere(scope),
    superseded_at: null,
    ...yearWindow,
    ...after,
  };

  // One extra row is fetched purely to answer "is there more?" without a second count.
  const rows = await prisma.achievements.findMany({
    where,
    orderBy: [{ occurred_on: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, occurred_on: true, title: true, detail: true, kind: true, medal: true,
      sport_id: true, championship_id: true, source: true,
      users: { select: { name: true } },
    },
  });

  const page = rows.slice(0, limit);
  const sportIds = [...new Set(page.map((r) => r.sport_id).filter((s): s is string => !!s))];
  const sports = sportIds.length
    ? await prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } })
    : [];
  const sportName = new Map(sports.map((s) => [s.id, s.name]));

  const items: TimelineItem[] = page.map((r) => {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      date: r.occurred_on.toISOString().slice(0, 10),
      title: r.title,
      // The claim's own words when it came from a person; otherwise nothing invented.
      detail: typeof d.note === 'string' ? d.note : typeof d.summary === 'string' ? d.summary : null,
      kind: r.kind,
      medal: r.medal,
      sport: r.sport_id ? sportName.get(r.sport_id) ?? null : null,
      recipient: r.users?.name ?? null,
      championship_id: r.championship_id,
      source: r.source,
      tags: [
        r.sport_id ? sportName.get(r.sport_id) ?? null : null,
        r.medal ? titleCase(r.medal) : null,
        r.medal ? null : titleCase(r.kind),
        r.source === 'validated_claim' ? 'Validated claim' : null,
      ].filter((t): t is string => !!t),
    };
  });

  const last = page[page.length - 1];
  return {
    items,
    next_cursor: rows.length > limit && last ? { date: items[items.length - 1].date, id: last.id } : null,
  };
}

/** Years that actually have something in them, for the design's year chips. */
export async function achievementYears(prisma: Prisma, scope: TimelineScope): Promise<number[]> {
  const rows = await prisma.achievements.findMany({
    where: { ...scopeWhere(scope), superseded_at: null },
    select: { occurred_on: true },
    orderBy: { occurred_on: 'desc' },
    take: 2000,
  });
  return [...new Set(rows.map((r) => r.occurred_on.getUTCFullYear()))].sort((a, b) => b - a);
}
