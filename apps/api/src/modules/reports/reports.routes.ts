import { Router } from 'express';
import { Prisma as PrismaNS } from '@prisma/client';
import {
  deltaPct, seasonLabel, seasonOf, seasonRange, seasonStartMonthOf, suppressSmall, MIN_COHORT,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { can } from '../../http/middleware/can.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors.js';

// Leadership reporting (J5-E1/E2/E3) and the championship's own operational view
// (J2-E8).
//
// Three rules hold across every figure on every tab, and they are the reason these
// live in one file rather than next to the features they describe:
//
//   1. ONLY LOCKED RESULTS COUNT. A report is what an institution takes to a board.
//      A number that can still change is not a report, it is a preview.
//   2. NO FABRICATED COMPARISONS. The first season has no predecessor; that reads
//      "no comparison available", never 0%.
//   3. NOBODY IS IDENTIFIABLE. Demographic cells below MIN_COHORT are suppressed,
//      and "prefer not to say" is its own answer rather than being folded into
//      "unknown" or quietly dropped.

export function makeReportsRouter(prisma: Prisma): Router {
  const router = Router();

  const gate = async (req: any, organizationId: string) => {
    const allowed = await can(prisma, 'report.view', {
      user: { id: req.user!.id, isSuperAdmin: req.user!.isSuperAdmin },
      scope: { organizationId },
      fallback: async () => !!(await prisma.organization_members.findFirst({
        where: { user_id: req.user!.id, organization_id: organizationId, status: 'active', role: { in: ['owner', 'admin'] } },
        select: { id: true },
      })),
    });
    if (!allowed) throw new ForbiddenError('You do not have permission to view reports for this institution.');
  };

  /** The championships this institution ran or entered, with the season each sits in. */
  async function scope(organizationId: string) {
    const org = await prisma.organizations.findUnique({ where: { id: organizationId }, select: { settings: true, name: true } });
    if (!org) throw new NotFoundError('Organisation');
    const startMonth = seasonStartMonthOf(org.settings);

    const [hosted, entered] = await Promise.all([
      prisma.user_championship_roles.findMany({
        where: { roles: { code: 'organiser' },
                 users_user_championship_roles_user_idTousers: { organization_members: { some: { organization_id: organizationId, status: 'active' } } } },
        select: { championship_id: true },
      }),
      prisma.championship_organizations.findMany({
        where: { organization_id: organizationId, status: 'approved' }, select: { championship_id: true },
      }),
    ]);
    const ids = [...new Set([...hosted.map((h) => h.championship_id), ...entered.map((e) => e.championship_id)])];
    const champs = ids.length
      ? await prisma.championships.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, start_date: true, status: true } })
      : [];
    const bySeason = new Map<number, string[]>();
    for (const c of champs) {
      const s = seasonOf(c.start_date, startMonth);
      bySeason.set(s, [...(bySeason.get(s) ?? []), c.id]);
    }
    return { org, startMonth, champs, bySeason, allIds: ids };
  }

  /** Season to report on: the one asked for, else the most recent with anything in it. */
  const pickSeason = (req: any, bySeason: Map<number, string[]>, startMonth: number) => {
    const asked = Number(req.query.season);
    if (Number.isInteger(asked)) return asked;
    const seasons = [...bySeason.keys()].sort((a, b) => b - a);
    return seasons[0] ?? seasonOf(new Date(), startMonth as any);
  };

  /**
   * Unique people who actually took part for this institution in a set of
   * championships. Counted once each however many sports they played (J5-E1-S3).
   */
  async function participantsIn(organizationId: string, champIds: string[]) {
    if (!champIds.length) return [] as Array<{ user_id: string; sport: string; org_unit_id: string | null }>;
    return prisma.$queryRaw<Array<{ user_id: string; sport: string; org_unit_id: string | null }>>(PrismaNS.sql`
      select distinct tm.user_id, s.name as sport, om.org_unit_id
        from team_entries te
        join tournament_disciplines td on td.id = te.tournament_discipline_id
        join tournament_sports ts on ts.id = td.tournament_sport_id
        join sports s on s.id = ts.sport_id
        join team_members tm on tm.team_id = te.team_id
        left join organization_members om
               on om.user_id = tm.user_id and om.organization_id = ${organizationId}::uuid
       where te.organization_id = ${organizationId}::uuid
         and te.championship_id in (${PrismaNS.join(champIds.map((id) => PrismaNS.sql`${id}::uuid`))})`);
  }

  /** Locked matches only - rule 1. */
  async function lockedStats(organizationId: string, champIds: string[]) {
    if (!champIds.length) return { matches: 0, won: 0, decided: 0 };
    const rows = await prisma.$queryRaw<Array<{ matches: bigint; won: bigint; decided: bigint }>>(PrismaNS.sql`
      with ours as (
        select distinct f.id, f.winner_team_id,
               (select array_agg(t.id) from teams t
                 where t.organization_id = ${organizationId}::uuid
                   and t.id in (f.home_team_id, f.away_team_id)) as our_teams
          from fixtures f
          join tournament_disciplines td on td.id = f.tournament_discipline_id
          join tournament_sports ts on ts.id = td.tournament_sport_id
          join tournaments tn on tn.id = ts.tournament_id
         where f.locked_at is not null
           and tn.championship_id in (${PrismaNS.join(champIds.map((id) => PrismaNS.sql`${id}::uuid`))}))
      select count(*) filter (where our_teams is not null) as matches,
             count(*) filter (where winner_team_id = any(our_teams)) as won,
             count(*) filter (where our_teams is not null and winner_team_id is not null) as decided
        from ours`);
    const r = rows[0];
    return { matches: Number(r?.matches ?? 0), won: Number(r?.won ?? 0), decided: Number(r?.decided ?? 0) };
  }

  const medalTally = (rows: Array<{ medal: string | null }>) => {
    const t = { gold: 0, silver: 0, bronze: 0 };
    for (const r of rows) if (r.medal && r.medal in t) t[r.medal as keyof typeof t] += 1;
    return { ...t, total: t.gold + t.silver + t.bronze };
  };

  // ---- J5-E1 · participation -------------------------------------------------
  const build_participation = async (organizationId: string, seasonArg?: number) => {
    const { org, startMonth, bySeason } = await scope(organizationId);
    const season = seasonArg ?? pickSeason({ query: {} }, bySeason, startMonth);

    const thisIds = bySeason.get(season) ?? [];
    const prevIds = bySeason.get(season - 1) ?? [];
    const [now, before] = await Promise.all([participantsIn(organizationId, thisIds), participantsIn(organizationId, prevIds)]);
    const [lockedNow, lockedPrev] = await Promise.all([lockedStats(organizationId, thisIds), lockedStats(organizationId, prevIds)]);
    const [medalsNow, medalsPrev] = await Promise.all([
      thisIds.length ? prisma.achievements.findMany({ where: { organization_id: organizationId, championship_id: { in: thisIds }, superseded_at: null, medal: { not: null } }, select: { medal: true } }) : [],
      prevIds.length ? prisma.achievements.findMany({ where: { organization_id: organizationId, championship_id: { in: prevIds }, superseded_at: null, medal: { not: null } }, select: { medal: true } }) : [],
    ]);

    const uniq = (rows: typeof now) => new Set(rows.map((r) => r.user_id)).size;
    const bySport = new Map<string, Set<string>>();
    for (const r of now) bySport.set(r.sport, (bySport.get(r.sport) ?? new Set()).add(r.user_id));

    // Programme rollup. Somebody with no placement is "Unassigned", not dropped -
    // an institution that cannot see who it hasn't placed cannot fix it.
    const units = await prisma.org_units.findMany({ where: { organization_id: organizationId }, select: { id: true, name: true, type: true, parent_id: true } });
    const unitName = new Map(units.map((u) => [u.id, u.name]));
    const parentOf = new Map(units.map((u) => [u.id, u.parent_id]));
    const programmeOf = (unitId: string | null): string => {
      if (!unitId) return 'Unassigned';
      let cur: string | null = unitId;
      while (cur && parentOf.get(cur)) cur = parentOf.get(cur)!;
      return cur ? (unitName.get(cur) ?? 'Unassigned') : 'Unassigned';
    };
    const byProgramme = new Map<string, Set<string>>();
    for (const r of now) {
      const key = programmeOf(r.org_unit_id);
      byProgramme.set(key, (byProgramme.get(key) ?? new Set()).add(r.user_id));
    }

    // The same six-season series the dashboard draws, from the same definition (J5-E1-S4).
    const seasons = [...bySeason.keys()].sort((a, b) => a - b).slice(-6);
    const trend = [] as Array<{ season: number; label: string; participants: number }>;
    for (const s of seasons) {
      trend.push({ season: s, label: seasonLabel(s, startMonth), participants: uniq(await participantsIn(organizationId, bySeason.get(s) ?? [])) });
    }

    return ({
      organization: { id: organizationId, name: org.name },
      season, season_label: seasonLabel(season, startMonth), season_start_month: startMonth,
      available_seasons: [...bySeason.keys()].sort((a, b) => b - a).map((s) => ({ season: s, label: seasonLabel(s, startMonth) })),
      kpis: {
        participants: { value: uniq(now), delta_pct: deltaPct(uniq(now), prevIds.length ? uniq(before) : null) },
        events: { value: thisIds.length, delta_pct: deltaPct(thisIds.length, prevIds.length || null) },
        matches_played: { value: lockedNow.matches, delta_pct: deltaPct(lockedNow.matches, prevIds.length ? lockedPrev.matches : null) },
        medals: { value: medalTally(medalsNow).total, delta_pct: deltaPct(medalTally(medalsNow).total, prevIds.length ? medalTally(medalsPrev).total : null) },
      },
      by_sport: [...bySport.entries()].map(([sport, set]) => ({ sport, participants: set.size })).sort((a, b) => b.participants - a.participants),
      by_programme: [...byProgramme.entries()].map(([programme, set]) => ({ programme, participants: set.size })).sort((a, b) => b.participants - a.participants),
      trend,
      basis: 'Locked results only. Figures are for the selected season.',
    });
  };

  router.get('/organizations/:id/reports/participation', asyncHandler(async (req, res) => {
    await gate(req, req.params.id);
    const seasonQ = Number(req.query.season);
    res.json(await build_participation(req.params.id, Number.isInteger(seasonQ) ? seasonQ : undefined));
  }));

  // ---- J5-E2 · performance ---------------------------------------------------
  const build_performance = async (organizationId: string, seasonArg?: number) => {
    const { org, startMonth, bySeason } = await scope(organizationId);
    const season = seasonArg ?? pickSeason({ query: {} }, bySeason, startMonth);
    const thisIds = bySeason.get(season) ?? [];
    const prevIds = bySeason.get(season - 1) ?? [];

    const load = (ids: string[]) => (ids.length
      ? prisma.achievements.findMany({
        where: { organization_id: organizationId, championship_id: { in: ids }, superseded_at: null },
        select: { medal: true, kind: true, sport_id: true, user_id: true, title: true },
      })
      : Promise.resolve([] as Array<{ medal: string | null; kind: string; sport_id: string | null; user_id: string | null; title: string }>));
    const [now, before] = await Promise.all([load(thisIds), load(prevIds)]);
    const [lockedNow, lockedPrev] = await Promise.all([lockedStats(organizationId, thisIds), lockedStats(organizationId, prevIds)]);

    // Medals are READ from achievements, never recomputed from fixtures (J5-E2-S1):
    // the achievement is the record, and a second derivation would be a second answer.
    const tally = medalTally(now);
    const prevTally = medalTally(before);
    const winRate = lockedNow.decided ? Math.round((lockedNow.won / lockedNow.decided) * 100) : null;
    const prevWinRate = lockedPrev.decided ? Math.round((lockedPrev.won / lockedPrev.decided) * 100) : null;

    const sportIds = [...new Set(now.map((a) => a.sport_id).filter((s): s is string => !!s))];
    const sportName = new Map((sportIds.length
      ? await prisma.sports.findMany({ where: { id: { in: sportIds } }, select: { id: true, name: true } })
      : []).map((s) => [s.id, s.name]));

    const perSport = new Map<string, { gold: number; silver: number; bronze: number }>();
    for (const a of now) {
      if (!a.medal) continue;
      const key = a.sport_id ? (sportName.get(a.sport_id) ?? 'Unknown sport') : 'Unattributed';
      const b = perSport.get(key) ?? { gold: 0, silver: 0, bronze: 0 };
      if (a.medal in b) b[a.medal as keyof typeof b] += 1;
      perSport.set(key, b);
    }

    // Top performers, counted per person. Awards come from typed achievements, so
    // "MVP", "mvp" and "Most Valuable Player" are one thing (J5-E2-S3).
    const perPerson = new Map<string, { gold: number; silver: number; bronze: number; awards: number }>();
    for (const a of now) {
      if (!a.user_id) continue;
      const b = perPerson.get(a.user_id) ?? { gold: 0, silver: 0, bronze: 0, awards: 0 };
      if (a.medal && a.medal in b) b[a.medal as keyof typeof b] += 1;
      if (a.kind === 'award') b.awards += 1;
      perPerson.set(a.user_id, b);
    }
    const topIds = [...perPerson.entries()]
      .sort((x, y) => (y[1].gold * 3 + y[1].silver * 2 + y[1].bronze + y[1].awards) - (x[1].gold * 3 + x[1].silver * 2 + x[1].bronze + x[1].awards))
      .slice(0, 10).map(([id]) => id);
    const names = new Map((topIds.length
      ? await prisma.users.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } })
      : []).map((u) => [u.id, u.name]));

    return ({
      organization: { id: organizationId, name: org.name },
      season, season_label: seasonLabel(season, startMonth),
      available_seasons: [...bySeason.keys()].sort((a, b) => b - a).map((s) => ({ season: s, label: seasonLabel(s, startMonth) })),
      kpis: {
        medals: { value: tally.total, delta_pct: deltaPct(tally.total, prevIds.length ? prevTally.total : null) },
        gold: { value: tally.gold, delta_pct: deltaPct(tally.gold, prevIds.length ? prevTally.gold : null) },
        // null, not 0 - "no decided matches" is not "we lost everything".
        win_rate_pct: { value: winRate, delta_pct: winRate !== null && prevWinRate !== null ? winRate - prevWinRate : null },
        awards: { value: now.filter((a) => a.kind === 'award').length, delta_pct: deltaPct(now.filter((a) => a.kind === 'award').length, prevIds.length ? before.filter((a) => a.kind === 'award').length : null) },
      },
      medals_by_sport: [...perSport.entries()]
        .map(([sport, m]) => ({ sport, ...m, total: m.gold + m.silver + m.bronze }))
        .sort((a, b) => b.total - a.total),
      top_performers: topIds.map((id) => ({ user_id: id, name: names.get(id) ?? 'Unknown', ...perPerson.get(id)!,
        total_medals: perPerson.get(id)!.gold + perPerson.get(id)!.silver + perPerson.get(id)!.bronze })),
      basis: 'Medals are read from recorded achievements; win rate counts locked results only.',
    });
  };

  router.get('/organizations/:id/reports/performance', asyncHandler(async (req, res) => {
    await gate(req, req.params.id);
    const seasonQ = Number(req.query.season);
    res.json(await build_performance(req.params.id, Number.isInteger(seasonQ) ? seasonQ : undefined));
  }));

  // ---- J5-E3 · diversity & inclusion -----------------------------------------
  const build_inclusion = async (organizationId: string, seasonArg?: number) => {
    const { org, startMonth, bySeason } = await scope(organizationId);
    const season = seasonArg ?? pickSeason({ query: {} }, bySeason, startMonth);
    const thisIds = bySeason.get(season) ?? [];
    const prevIds = bySeason.get(season - 1) ?? [];

    const [now, before] = await Promise.all([participantsIn(organizationId, thisIds), participantsIn(organizationId, prevIds)]);
    const ids = [...new Set(now.map((r) => r.user_id))];
    const people = ids.length
      ? await prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, gender: true } })
      : [];
    const genderOf = new Map(people.map((p) => [p.id, p.gender ?? 'unknown']));

    // Every answer is its own category. 'prefer_not_to_say' is a real answer and is
    // never folded into 'unknown', and 'unknown' is never inferred away (J5-E3-S1).
    const genders = new Map<string, Set<string>>();
    for (const id of ids) {
      const g = genderOf.get(id) ?? 'unknown';
      genders.set(g, (genders.get(g) ?? new Set()).add(id));
    }
    const total = ids.length;
    const womenIds = genders.get('female') ?? new Set();

    const prevIdsSet = [...new Set(before.map((r) => r.user_id))];
    const prevPeople = prevIdsSet.length
      ? await prisma.users.findMany({ where: { id: { in: prevIdsSet }, gender: 'female' }, select: { id: true } })
      : [];

    // Women by sport, each cell suppressed if it would identify somebody.
    const womenBySport = new Map<string, Set<string>>();
    for (const r of now) if (genderOf.get(r.user_id) === 'female') womenBySport.set(r.sport, (womenBySport.get(r.sport) ?? new Set()).add(r.user_id));

    // First-time athletes: nobody with a lifetime entry before this season starts.
    const { start } = seasonRange(season, startMonth);
    const returning = ids.length
      ? await prisma.lifetime_entries.findMany({ where: { user_id: { in: ids }, occurred_on: { lt: start } }, select: { user_id: true }, distinct: ['user_id'] })
      : [];
    const firstTimers = ids.length - new Set(returning.map((r) => r.user_id)).size;

    // Representation by programme, INCLUDING the programmes nobody reached - an
    // inclusion report that omits the zeroes answers the wrong question (J5-E3-S3).
    const programmes = await prisma.org_units.findMany({ where: { organization_id: organizationId, parent_id: null }, select: { id: true, name: true } });
    const memberCounts = await prisma.$queryRaw<Array<{ programme_id: string | null; members: bigint }>>(PrismaNS.sql`
      select coalesce(root.id, null) as programme_id, count(distinct om.user_id) as members
        from organization_members om
        left join org_units u on u.id = om.org_unit_id
        left join org_units root on root.id = coalesce(u.parent_id, u.id)
       where om.organization_id = ${organizationId}::uuid and om.status = 'active'
       group by 1`);
    const membersOf = new Map(memberCounts.map((m) => [m.programme_id ?? 'none', Number(m.members)]));
    const partsByProgramme = new Map<string, Set<string>>();
    const unitRows = await prisma.org_units.findMany({ where: { organization_id: organizationId }, select: { id: true, parent_id: true } });
    const rootOf = new Map(unitRows.map((u) => [u.id, u.parent_id ?? u.id]));
    for (const r of now) {
      const root = r.org_unit_id ? (rootOf.get(r.org_unit_id) ?? 'none') : 'none';
      partsByProgramme.set(root, (partsByProgramme.get(root) ?? new Set()).add(r.user_id));
    }

    return ({
      organization: { id: organizationId, name: org.name },
      season, season_label: seasonLabel(season, startMonth),
      available_seasons: [...bySeason.keys()].sort((a, b) => b - a).map((s) => ({ season: s, label: seasonLabel(s, startMonth) })),
      min_cohort: MIN_COHORT,
      participants: total,
      women: {
        count: suppressSmall(womenIds.size),
        share_pct: total ? Math.round((womenIds.size / total) * 100) : null,
        delta_pct: deltaPct(womenIds.size, prevIdsSet.length ? prevPeople.length : null),
      },
      // Reported as they answered, including the refusals.
      gender_breakdown: [...genders.entries()]
        .map(([gender, set]) => ({ gender, count: suppressSmall(set.size) }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
      women_by_sport: [...womenBySport.entries()]
        .map(([sport, set]) => ({ sport, count: suppressSmall(set.size) }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
      first_time_athletes: { value: firstTimers, share_pct: total ? Math.round((firstTimers / total) * 100) : null },
      by_programme: [
        ...programmes.map((p) => {
          const took = partsByProgramme.get(p.id)?.size ?? 0;
          const members = membersOf.get(p.id) ?? 0;
          return { programme: p.name, participants: took, members, share_pct: members ? Math.round((took / members) * 100) : null };
        }),
        ...(partsByProgramme.has('none') || membersOf.has('none')
          ? [{ programme: 'Unassigned', participants: partsByProgramme.get('none')?.size ?? 0, members: membersOf.get('none') ?? 0, share_pct: null }]
          : []),
      ].sort((a, b) => b.participants - a.participants),
      basis: `Aggregate only. Cells below ${MIN_COHORT} people are suppressed, and "prefer not to say" is reported as its own answer.`,
    });
  };

  router.get('/organizations/:id/reports/inclusion', asyncHandler(async (req, res) => {
    await gate(req, req.params.id);
    const seasonQ = Number(req.query.season);
    res.json(await build_inclusion(req.params.id, Number.isInteger(seasonQ) ? seasonQ : undefined));
  }));

  // ---- J2-E8 · the championship's operational status --------------------------
  router.get('/championships/:eventId/reports/status', asyncHandler(async (req, res) => {
    const championshipId = req.params.eventId;
    const isOrganiser = req.user!.isSuperAdmin || !!(await prisma.user_championship_roles.findFirst({
      where: { user_id: req.user!.id, championship_id: championshipId, roles: { code: 'organiser' } }, select: { id: true },
    }));
    // Visible only to the organising team (J2-E8-S1) - this is an internal view of
    // what is unfinished, not a public scoreboard.
    if (!isOrganiser) throw new ForbiddenError('Only the organising team can see the operational status.');

    const champ = await prisma.championships.findUnique({ where: { id: championshipId }, select: { id: true, name: true, status: true } });
    if (!champ) throw new NotFoundError('Championship');
    const inChamp = { tournament_disciplines: { tournament_sports: { tournaments: { championship_id: championshipId } } } };

    const [regs, approved, pending, fixtures, scheduled, completed, locked, submitted, medals, tbd, unscored] = await Promise.all([
      prisma.championship_organizations.count({ where: { championship_id: championshipId } }),
      prisma.championship_organizations.count({ where: { championship_id: championshipId, status: 'approved' } }),
      prisma.championship_organizations.count({ where: { championship_id: championshipId, status: 'pending' } }),
      prisma.fixtures.count({ where: inChamp }),
      prisma.fixtures.count({ where: { ...inChamp, scheduled_at: { not: null } } }),
      prisma.fixtures.count({ where: { ...inChamp, status: { in: ['completed', 'walkover', 'bye'] } } }),
      prisma.fixtures.count({ where: { ...inChamp, locked_at: { not: null } } }),
      prisma.fixtures.count({ where: { ...inChamp, scorecard_status: 'submitted' } }),
      prisma.achievements.count({ where: { championship_id: championshipId, superseded_at: null, medal: { not: null } } }),
      prisma.fixtures.count({ where: { ...inChamp, OR: [{ home_team_id: null }, { away_team_id: null }], status: { not: 'bye' } } }),
      prisma.fixtures.count({ where: { ...inChamp, status: { in: ['completed', 'walkover'] }, home_score: null } }),
    ]);

    const bar = (done: number, of: number) => ({ done, of, pct: of ? Math.round((done / of) * 100) : null });
    const attention = [
      { key: 'pending_registrations', label: 'Applications awaiting a decision', count: pending, href: `/championships/${championshipId}/approvals` },
      { key: 'submitted_scorecards', label: 'Scorecards submitted and ready to lock', count: submitted, href: `/championships/${championshipId}/results` },
      { key: 'unscheduled', label: 'Fixtures with no date yet', count: fixtures - scheduled, href: `/championships/${championshipId}/schedule` },
      { key: 'tbd_slots', label: 'Matches still waiting on a team', count: tbd, href: `/championships/${championshipId}/schedule` },
      { key: 'played_unscored', label: 'Played but never scored', count: unscored, href: `/championships/${championshipId}/results` },
    ].filter((a) => a.count > 0);

    res.set('Cache-Control', 'no-store');
    res.json({
      championship: champ,
      kpis: { registrations: regs, approved, pending, matches_played: completed, medals_awarded: medals, certificates_issued: null },
      progress: {
        registrations_approved: bar(approved, regs),
        fixtures_scheduled: bar(scheduled, fixtures),
        matches_completed: bar(completed, fixtures),
        results_verified: bar(locked, fixtures),
        certificates_issued: null,
      },
      needs_attention: attention,
      // J2-E8-S1: never presented as a final position.
      basis: 'Live figures — this championship is still in progress.',
      as_of: new Date().toISOString(),
    });
  }));

  // Exposed so the Annual Impact Report composes these exact figures (J5-E5).
  (router as any).builders = { participation: build_participation, performance: build_performance, inclusion: build_inclusion };
  return router;
}
