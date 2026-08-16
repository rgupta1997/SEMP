import { Router } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { can } from '../../http/middleware/can.js';
import { authorizeRecordView } from './records.access.js';
import { provisionalEntriesFor } from './provisional.service.js';

// Reading the permanent record (J4-E2).
//
// THIS ROUTER IS READ-ONLY, and that is a requirement rather than an oversight
// (J4-E2-S2): "no user interface offers editing or deleting a timeline entry, and
// no API endpoint permits it. The only route to change one is a correction to the
// underlying result." So there is no POST, PATCH or DELETE here and there must
// never be one - a timeline an admin can quietly edit is not evidence of
// anything. Corrections go through the audited unlock → fix → relock cycle, which
// supersedes the old rows and writes new ones.
//
// The privacy boundary lives in `records.access.ts`, where it can be tested
// directly rather than only through a route.

export function makeRecordsRouter(prisma: Prisma): Router {
  const router = Router();

  const authorize = (viewerId: string, isSuper: boolean, subjectId: string) =>
    authorizeRecordView(prisma, { id: viewerId, isSuperAdmin: isSuper }, subjectId);

  // Only live rows, ever. A superseded entry is history the database keeps, not
  // something a profile claims is true.
  const LIVE = { superseded_at: null } as const;

  const entryView = (e: {
    id: string; occurred_on: Date; kind: string; title: string; detail: unknown;
    organization_id: string | null; championship_id: string | null; fixture_id: string | null;
    sport_id: string | null; source: string;
  }) => ({
    id: e.id,
    date: e.occurred_on,
    kind: e.kind,
    title: e.title,
    detail: e.detail,
    organization_id: e.organization_id,
    championship_id: e.championship_id,
    fixture_id: e.fixture_id,
    sport_id: e.sport_id,
    source: e.source,
    // Every lock-derived row IS a verified result - that is the only way it got
    // written. Stated explicitly so the client never has to infer it.
    verified: e.source === 'locked_result',
  });

  const achievementView = (a: {
    id: string; occurred_on: Date; kind: string; medal: string | null; title: string; detail: unknown;
    organization_id: string | null; championship_id: string | null; fixture_id: string | null; sport_id: string | null; source: string;
  }) => ({
    id: a.id,
    date: a.occurred_on,
    kind: a.kind,
    medal: a.medal,
    title: a.title,
    detail: a.detail,
    organization_id: a.organization_id,
    championship_id: a.championship_id,
    fixture_id: a.fixture_id,
    sport_id: a.sport_id,
    source: a.source,
  });

  async function loadProfile(userId: string) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!user) throw new NotFoundError('Person');

    const [entries, achievements] = await Promise.all([
      prisma.lifetime_entries.findMany({
        where: { user_id: userId, ...LIVE },
        orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
        take: 500,
      }),
      prisma.achievements.findMany({
        // Team rows are excluded: a squad medal already fanned out to a row of
        // its own for each member, and counting both would double every medal.
        where: { user_id: userId, ...LIVE },
        orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
        take: 500,
      }),
    ]);

    // Played but not yet official. Shown on the same timeline, badged - see
    // provisional.service.ts for why both belong on one page.
    const provisional = await provisionalEntriesFor(prisma, userId);

    // The headline numbers FR-PRO-3 asks for. Derived from live rows on the way
    // out rather than cached, because they are small and a cache that drifts
    // from the record is worse than a join.
    //
    // VERIFIED ROWS ONLY. Provisional results are on the page but never in the
    // count - "medals won" has to be a number the institution can defend, and a
    // medal from a scorecard that is still editable is not one.
    const medals = { gold: 0, silver: 0, bronze: 0 };
    let awards = 0;
    for (const a of achievements) {
      if (a.medal && a.medal in medals) medals[a.medal as keyof typeof medals] += 1;
      if (a.kind === 'award') awards += 1;
    }
    const outcomes = { won: 0, lost: 0, drew: 0 };
    for (const e of entries) {
      const outcome = (e.detail as { outcome?: string } | null)?.outcome;
      if (outcome && outcome in outcomes) outcomes[outcome as keyof typeof outcomes] += 1;
    }

    // The same numbers again, split by sport (J4-E3). One global career total answers
    // "how much have they played"; only the per-sport split answers "what are they",
    // which is the question a coach, a selector and the player all actually ask.
    // Derived from the rows already loaded rather than re-queried - the split has to
    // add up to the totals above, and two queries is how that stops being true.
    const sportIds = [...new Set([...entries, ...achievements].map((r) => r.sport_id).filter((s): s is string => !!s))];
    const sportNames = sportIds.length
      ? new Map((await prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } }))
        .map((s) => [s.id, s.name]))
      : new Map<string, string>();

    const bySport = new Map<string, {
      sport_id: string | null; sport: string; events: number;
      won: number; lost: number; drew: number;
      medals: { gold: number; silver: number; bronze: number }; awards: number;
    }>();
    const bucket = (sportId: string | null) => {
      const key = sportId ?? 'unattributed';
      if (!bySport.has(key)) {
        bySport.set(key, {
          sport_id: sportId,
          // Rows that predate sport attribution are grouped honestly rather than
          // dropped, so the split still sums to the career total.
          sport: sportId ? (sportNames.get(sportId) ?? 'Unknown sport') : 'Unattributed',
          events: 0, won: 0, lost: 0, drew: 0,
          medals: { gold: 0, silver: 0, bronze: 0 }, awards: 0,
        });
      }
      return bySport.get(key)!;
    };
    for (const e of entries) {
      const b = bucket(e.sport_id);
      b.events += 1;
      const outcome = (e.detail as { outcome?: string } | null)?.outcome;
      if (outcome === 'won' || outcome === 'lost' || outcome === 'drew') b[outcome] += 1;
    }
    for (const a of achievements) {
      const b = bucket(a.sport_id);
      if (a.medal && a.medal in b.medals) b.medals[a.medal as keyof typeof b.medals] += 1;
      if (a.kind === 'award') b.awards += 1;
    }
    const per_sport = [...bySport.values()]
      .map((s) => ({ ...s, total_medals: s.medals.gold + s.medals.silver + s.medals.bronze }))
      .sort((a, b) => b.total_medals - a.total_medals || b.events - a.events || a.sport.localeCompare(b.sport));

    return {
      person: user,
      stats: {
        events: entries.length,
        ...outcomes,
        medals,
        awards,
        total_medals: medals.gold + medals.silver + medals.bronze,
        // Counted separately and never folded in, so the page can say "12
        // verified, 4 awaiting an organiser" instead of one number that is
        // quietly neither.
        provisional: provisional.length,
      },
      per_sport,
      // One list, already ordered - the client badges each row by `verified`
      // rather than re-sorting two arrays and risking a different order per
      // viewer.
      timeline: [...entries.map(entryView), ...provisional]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
      achievements: achievements.map(achievementView),
    };
  }

  // The player's own record. Same payload as the admin view, from one code path,
  // so what a coordinator sees and what the player sees can never diverge.
  router.get('/me/profile', asyncHandler(async (req, res) => {
    res.json(await loadProfile(req.user!.id));
  }));

  router.get('/people/:userId/profile', asyncHandler(async (req, res) => {
    await authorize(req.user!.id, !!req.user!.isSuperAdmin, req.params.userId);
    res.json(await loadProfile(req.params.userId));
  }));

  router.get('/people/:userId/achievements', asyncHandler(async (req, res) => {
    await authorize(req.user!.id, !!req.user!.isSuperAdmin, req.params.userId);
    const rows = await prisma.achievements.findMany({
      where: { user_id: req.params.userId, ...LIVE },
      orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
      take: 500,
    });
    res.json(rows.map(achievementView));
  }));

  // An institution's own honours board - what module 08's reports and the Hall of
  // Fame (J4-E9) both read. Team rows are kept here: at org level the squad medal
  // is the fact, and its per-player copies would triple-count it.
  router.get('/organizations/:id/achievements', asyncHandler(async (req, res) => {
    const organizationId = req.params.id;
    const allowed = await can(prisma, 'people.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active' },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to view this institution\'s achievements.');

    const rows = await prisma.achievements.findMany({
      where: { organization_id: organizationId, team_id: { not: null }, ...LIVE },
      orderBy: [{ occurred_on: 'desc' }, { created_at: 'desc' }],
      take: 500,
    });
    res.json(rows.map(achievementView));
  }));

  return router;
}
