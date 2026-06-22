import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  addTeamMemberSchema, bulkAddTeamMembersSchema, bulkCreateTeamsSchema,
  createTeamSchema, enterChampionshipsSchema, joinTeamSchema, updateTeamEntrySchema,
  updateTeamMemberSchema, updateTeamSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { coerceFilter, parsePaging } from '../../http/paging.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { resolveEntryRules, type EntryRules } from '../tournaments/domain/entry-rules.js';
import { assertCanAddMember, assertCanLockRoster } from './domain/roster-policy.js';

// Default password for auto-provisioned players from a bulk import. They can be
// invited / reset later; precomputed once to keep the bulk loop cheap.
const DEFAULT_IMPORT_PASSWORD_HASH = bcrypt.hashSync('demo123', 10);

// Validate that a discipline draw belongs to the given championship and (optionally)
// matches the team's sport. Returns the loaded draw.
async function assertDisciplineForTeam(
  prisma: Prisma,
  disciplineId: string,
  eventId: string,
  sportId?: string,
) {
  const td = await prisma.tournament_disciplines.findUnique({
    where: { id: disciplineId },
    include: {
      tournament_sports: { include: { tournaments: { select: { championship_id: true } } } },
    },
  });
  if (!td) throw new NotFoundError('Discipline draw');
  if (td.tournament_sports.tournaments.championship_id !== eventId) {
    throw new BusinessRuleError('Discipline does not belong to this championship');
  }
  if (sportId && td.tournament_sports.sport_id !== sportId) {
    throw new BusinessRuleError('Discipline does not match the selected sport');
  }
  return td;
}

const teamDisciplineInclude = {
  include: {
    disciplines: true,
    tournament_sports: {
      include: {
        tournaments: { select: { id: true, name: true } },
      },
    },
  },
} as const;

// Organization + its owners/admins (the "points of contact"). They are surfaced
// on the team via the org membership, never as a team_member, so they never count
// toward a squad.
const organizationWithOwnersInclude = {
  include: {
    organization_members: {
      where: { role: { in: ['owner', 'admin'] as string[] }, status: 'active' },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    },
  },
};

// Every user column EXCEPT password_hash - safe to embed in any roster payload.
// `include: { users: { select: publicUserSelect } }` would serialise the bcrypt hash straight to clients.
const publicUserSelect = {
  id: true, name: true, email: true, phone: true, avatar_url: true,
  is_active: true, is_super_admin: true, account_type: true,
  organization_id: true, created_at: true, updated_at: true,
} as const;

// Each championship a roster is entered into, with its draw + championship summary.
const entryInclude = {
  include: {
    championships: { select: { id: true, name: true, slug: true, status: true } },
    tournament_disciplines: teamDisciplineInclude,
  },
  orderBy: { created_at: 'asc' },
} as const;

const teamFullInclude = {
  team_members: { include: { users: { select: publicUserSelect } } },
  organizations: organizationWithOwnersInclude,
  sports: true,
  team_entries: entryInclude,
} as const;

// Per-entry rules from its discipline draw (defaults when no draw linked yet).
function entryRules(entry: { tournament_disciplines?: any }): EntryRules {
  return resolveEntryRules(entry.tournament_disciplines ?? {}, entry.tournament_disciplines?.disciplines ?? null);
}

// The roster is shared across all of a team's entries: adding is capped by the
// most permissive squad_max among them (default 15 when standalone); each entry's
// own [min, max] is enforced strictly at lock time.
function looseAddRules(entries: Array<{ tournament_disciplines?: any }>): EntryRules {
  if (entries.length === 0) return resolveEntryRules({}, null);
  return { entry_type: 'team', squad_min: 1, squad_max: Math.max(...entries.map((e) => entryRules(e).squad_max)) };
}

// Attach per-entry rules + a roster-level loose rule used by the squad UI.
function shapeTeam(team: any) {
  const team_entries = (team.team_entries ?? []).map((e: any) => ({ ...e, entry_rules: entryRules(e) }));
  const entry_rules = team_entries.length === 0
    ? resolveEntryRules({}, null)
    : {
        entry_type: 'team' as const,
        squad_min: Math.min(...team_entries.map((e: any) => e.entry_rules.squad_min)),
        squad_max: Math.max(...team_entries.map((e: any) => e.entry_rules.squad_max)),
      };
  return { ...team, team_entries, entry_rules };
}

async function hydrateTeam(prisma: Prisma, id: string) {
  const team = await prisma.teams.findUnique({ where: { id }, include: teamFullInclude });
  if (!team) throw new NotFoundError('Team');
  return shapeTeam(team);
}

// The shared roster is frozen only once every championship entry it has is locked.
async function assertRosterEditable(prisma: Prisma, teamId: string) {
  const entries = await prisma.team_entries.findMany({ where: { team_id: teamId }, select: { status: true } });
  if (entries.length > 0 && entries.every((e) => e.status === 'roster_locked')) {
    throw new BusinessRuleError('Every championship entry for this team is locked');
  }
}

export function makeTeamsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // An org owner/admin manages teams but never plays in them, so the creator is
  // only auto-seeded as captain when they are NOT an admin of the owning org.
  const isOrgAdmin = (userId: string, orgId: string) => guards.orgRole(userId, orgId, ['owner', 'admin']);

  router.get('/teams', asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};
    for (const k of ['organization_id', 'sport_id']) {
      const val = coerceFilter(req.query[k]);
      if (val !== undefined) where[k] = val;
    }
    // championship_id / tournament_discipline_id now live on team_entries.
    const champ = coerceFilter(req.query.championship_id);
    const draw = coerceFilter(req.query.tournament_discipline_id);
    if (champ !== undefined || draw !== undefined) {
      where.team_entries = { some: {
        ...(champ !== undefined ? { championship_id: champ } : {}),
        ...(draw !== undefined ? { tournament_discipline_id: draw } : {}),
      } };
    }
    const { take, skip } = parsePaging(req.query);
    const rows = await prisma.teams.findMany({
      where,
      include: teamFullInclude,
      orderBy: { created_at: 'desc' },
      take,
      skip,
    });
    res.json(rows.map(shapeTeam));
  }));

  // Resolve an invite token (public-ish within the app) -> team summary.
  router.get('/teams/by-token/:token', asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({
      where: { invite_token: req.params.token },
      include: { organizations: true, sports: true },
    });
    if (!team) throw new NotFoundError('Team');
    res.json(team);
  }));

  router.get('/teams/:id', asyncHandler(async (req, res) => {
    res.json(await hydrateTeam(prisma, req.params.id));
  }));

  // Create a team. A team is a standalone organization asset: name + sport + org
  // are enough. Passing the championship fields enters it into one championship at
  // creation (the old all-in-one flow); otherwise it's created unassigned and
  // entered into championships later via /teams/:id/entries. The creating user is
  // seeded as captain (unless they administer the org - admins manage, not play).
  router.post('/teams', guards.teamCreate, validateBody(createTeamSchema), asyncHandler(async (req, res) => {
    const { name, sport_id, organization_id, championship_id, championship_organization_id, tournament_discipline_id } = req.body as {
      name: string; sport_id: string; organization_id: string;
      championship_id?: string; championship_organization_id?: string; tournament_discipline_id?: string;
    };
    const creatorId = req.user!.id;
    const seedCaptain = !(await isOrgAdmin(creatorId, organization_id));

    // Validate the optional "enter at create" inputs before opening a transaction.
    let entryData: { championship_id: string; championship_organization_id: string; tournament_discipline_id: string } | null = null;
    if (championship_organization_id) {
      if (!championship_id || !tournament_discipline_id) {
        throw new BusinessRuleError('Championship and discipline are required to enter a team into a championship');
      }
      const ei = await prisma.championship_organizations.findUnique({ where: { id: championship_organization_id } });
      if (!ei) throw new NotFoundError('Enrollment');
      if (ei.status !== 'approved') throw new BusinessRuleError('Organization enrollment is not approved for this championship');
      await assertDisciplineForTeam(prisma, tournament_discipline_id, championship_id, sport_id);
      const dupe = await prisma.team_entries.findFirst({
        where: { organization_id, championship_id, tournament_discipline_id },
        select: { id: true },
      });
      if (dupe) throw new BusinessRuleError('Your organization already has a team in this discipline draw');
      entryData = { championship_id, championship_organization_id, tournament_discipline_id };
    }

    const created = await prisma.$transaction(async (tx) => {
      const team = await tx.teams.create({
        data: { sport_id, organization_id, name, status: 'forming', invite_token: randomBytes(16).toString('hex') },
      });
      if (seedCaptain) await tx.team_members.create({ data: { team_id: team.id, user_id: creatorId, role: 'captain' } });
      if (entryData) {
        await tx.team_entries.create({ data: { team_id: team.id, organization_id, ...entryData, status: 'forming' } });
      }
      return team;
    });
    res.status(201).json(await hydrateTeam(prisma, created.id));
  }));

  // Enter an existing roster into one or more championships at once. Each entry
  // validates an approved enrollment; the discipline draw is OPTIONAL - a team can
  // join a championship first and pick its discipline later (smooth entry). When a
  // draw IS given it must belong to that championship and match the team's sport. A
  // roster joins each championship once, and no two teams of the same org may occupy
  // the same draw.
  router.post('/teams/:id/entries', guards.teamManager, validateBody(enterChampionshipsSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id }, select: { id: true, organization_id: true, sport_id: true } });
    if (!team) throw new NotFoundError('Team');
    const input = req.body.entries as Array<{ championship_organization_id: string; tournament_discipline_id?: string | null }>;

    const eiIds = [...new Set(input.map((e) => e.championship_organization_id))];
    const eiMap = new Map(
      (await prisma.championship_organizations.findMany({ where: { id: { in: eiIds } } })).map((e) => [e.id, e]),
    );
    const prepared = [] as Array<{ championship_id: string; championship_organization_id: string; tournament_discipline_id: string | null }>;
    for (const e of input) {
      const ei = eiMap.get(e.championship_organization_id);
      if (!ei) throw new NotFoundError('Enrollment');
      if (ei.organization_id !== team.organization_id) throw new BusinessRuleError('That enrollment belongs to a different organization');
      if (ei.status !== 'approved') throw new BusinessRuleError('Organization enrollment is not approved for this championship');
      const drawId = e.tournament_discipline_id ?? null;
      if (drawId) await assertDisciplineForTeam(prisma, drawId, ei.championship_id, team.sport_id);
      prepared.push({ championship_id: ei.championship_id, championship_organization_id: ei.id, tournament_discipline_id: drawId });
    }

    // One entry per championship for this team; one team per draw per org (drawless
    // entries skip the per-draw uniqueness check).
    const champSeen = new Set((await prisma.team_entries.findMany({ where: { team_id: team.id }, select: { championship_id: true } })).map((e) => e.championship_id));
    const wantedDraws = prepared.map((p) => p.tournament_discipline_id).filter((d): d is string => !!d);
    const drawTaken = new Set(
      (wantedDraws.length === 0 ? [] : await prisma.team_entries.findMany({
        where: { organization_id: team.organization_id, tournament_discipline_id: { in: wantedDraws }, team_id: { not: team.id } },
        select: { tournament_discipline_id: true },
      })).map((e) => e.tournament_discipline_id),
    );
    for (const p of prepared) {
      if (champSeen.has(p.championship_id)) throw new BusinessRuleError('This team is already entered in one of the selected championships');
      champSeen.add(p.championship_id);
      if (p.tournament_discipline_id) {
        if (drawTaken.has(p.tournament_discipline_id)) throw new BusinessRuleError('Your organization already has a team in one of the selected discipline draws');
        drawTaken.add(p.tournament_discipline_id);
      }
    }

    await prisma.$transaction(prepared.map((p) => prisma.team_entries.create({
      data: { team_id: team.id, organization_id: team.organization_id, status: 'forming', ...p },
    })));
    res.status(201).json(await hydrateTeam(prisma, team.id));
  }));

  // Choose (or change) the discipline draw of an existing championship entry - the
  // "now that you're in, pick your discipline" step. Same validation as entry: the
  // draw must belong to the entry's championship, match the team's sport, and not
  // already be taken by another of the org's teams. Pass null to clear it.
  router.patch('/teams/:id/entries/:entryId', guards.teamManager, validateBody(updateTeamEntrySchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id }, select: { id: true, organization_id: true, sport_id: true } });
    if (!team) throw new NotFoundError('Team');
    const entry = await prisma.team_entries.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.team_id !== team.id) throw new NotFoundError('Team entry');
    if (entry.status === 'roster_locked') throw new BusinessRuleError('Cannot change the discipline of a locked entry');
    const drawId: string | null = req.body.tournament_discipline_id ?? null;
    if (drawId) {
      await assertDisciplineForTeam(prisma, drawId, entry.championship_id, team.sport_id);
      const taken = await prisma.team_entries.findFirst({
        where: { organization_id: team.organization_id, tournament_discipline_id: drawId, team_id: { not: team.id } },
        select: { id: true },
      });
      if (taken) throw new BusinessRuleError('Your organization already has a team in this discipline draw');
    }
    await prisma.team_entries.update({ where: { id: entry.id }, data: { tournament_discipline_id: drawId } });
    res.json(await hydrateTeam(prisma, team.id));
  }));

  // Withdraw a roster from a championship. Allowed only while the entry is unlocked
  // and the team has no fixtures in that championship's discipline draw.
  router.delete('/teams/:id/entries/:entryId', guards.teamManager, asyncHandler(async (req, res) => {
    const entry = await prisma.team_entries.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.team_id !== req.params.id) throw new NotFoundError('Team entry');
    if (entry.status === 'roster_locked') throw new BusinessRuleError('Cannot withdraw a locked entry');
    if (entry.tournament_discipline_id) {
      const fixture = await prisma.fixtures.findFirst({
        where: {
          tournament_discipline_id: entry.tournament_discipline_id,
          OR: [{ home_team_id: req.params.id }, { away_team_id: req.params.id }],
        },
        select: { id: true },
      });
      if (fixture) throw new BusinessRuleError('Cannot withdraw - this team already has fixtures in this championship');
    }
    await prisma.team_entries.delete({ where: { id: entry.id } });
    res.status(204).send();
  }));

  // Lock a single championship entry (validates the shared roster against that
  // entry's discipline rules). Other entries stay editable.
  router.post('/teams/:id/entries/:entryId/lock', guards.teamManager, asyncHandler(async (req, res) => {
    const entry = await prisma.team_entries.findUnique({
      where: { id: req.params.entryId },
      include: { tournament_disciplines: { include: { disciplines: true } } },
    });
    if (!entry || entry.team_id !== req.params.id) throw new NotFoundError('Team entry');
    if (!entry.tournament_discipline_id) throw new BusinessRuleError('Link a discipline draw before locking this entry');
    const count = await prisma.team_members.count({ where: { team_id: req.params.id, is_active: true } });
    assertCanLockRoster(entryRules(entry), count);
    await prisma.team_entries.update({ where: { id: entry.id }, data: { status: 'roster_locked' } });
    res.json(await hydrateTeam(prisma, req.params.id));
  }));

  // Reopen a locked entry so the squad can be edited again for that championship.
  // Per-entry, like locking - other entries are untouched. Blocked once the team has
  // completed/scored matches in this draw, since changing the roster after results
  // would be unfair.
  router.post('/teams/:id/entries/:entryId/unlock', guards.teamManager, asyncHandler(async (req, res) => {
    const entry = await prisma.team_entries.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.team_id !== req.params.id) throw new NotFoundError('Team entry');
    if (entry.status !== 'roster_locked') throw new BusinessRuleError('This entry is not locked');
    if (entry.tournament_discipline_id) {
      const played = await prisma.fixtures.count({
        where: {
          tournament_discipline_id: entry.tournament_discipline_id,
          OR: [{ home_team_id: req.params.id }, { away_team_id: req.params.id }],
          AND: [{ OR: [{ status: { in: ['completed', 'walkover', 'bye'] } }, { home_score: { not: null } }, { away_score: { not: null } }] }],
        },
      });
      if (played > 0) throw new BusinessRuleError('This team already has completed or scored matches in this championship - its roster can’t be unlocked.');
    }
    await prisma.team_entries.update({ where: { id: entry.id }, data: { status: 'forming' } });
    res.json(await hydrateTeam(prisma, req.params.id));
  }));

  // Bulk-create teams (one roster + one championship entry per selected discipline),
  // each with the creator as captain. All-or-nothing so a partial failure never
  // leaves orphan teams.
  router.post('/teams/bulk', guards.teamCreate, validateBody(bulkCreateTeamsSchema), asyncHandler(async (req, res) => {
    const teams = req.body.teams as Array<{
      championship_id: string; sport_id: string; organization_id: string;
      championship_organization_id: string; tournament_discipline_id: string; name: string;
    }>;
    for (const t of teams) {
      await assertDisciplineForTeam(prisma, t.tournament_discipline_id, t.championship_id, t.sport_id);
    }
    const eiIds = [...new Set(teams.map((t) => t.championship_organization_id))];
    const eiMap = new Map(
      (await prisma.championship_organizations.findMany({ where: { id: { in: eiIds } }, select: { id: true, status: true } }))
        .map((e) => [e.id, e]),
    );
    // Reject duplicate draw entries against existing entries (one query) and within the batch.
    const dupKey = (t: { organization_id: string; championship_id: string; tournament_discipline_id: string }) =>
      `${t.organization_id}|${t.championship_id}|${t.tournament_discipline_id}`;
    const existing = await prisma.team_entries.findMany({
      where: { OR: teams.map((t) => ({ organization_id: t.organization_id, championship_id: t.championship_id, tournament_discipline_id: t.tournament_discipline_id })) },
      select: { organization_id: true, championship_id: true, tournament_discipline_id: true },
    });
    const seen = new Set(existing.map((e) => `${e.organization_id}|${e.championship_id}|${e.tournament_discipline_id}`));
    for (const t of teams) {
      const ei = eiMap.get(t.championship_organization_id);
      if (!ei) throw new NotFoundError('Enrollment');
      if (ei.status !== 'approved') throw new BusinessRuleError(`Enrollment not approved for "${t.name}"`);
      const k = dupKey(t);
      if (seen.has(k)) throw new BusinessRuleError(`A duplicate team for "${t.name}" is in this discipline draw`);
      seen.add(k);
    }
    const creatorId = req.user!.id;
    const orgIds = [...new Set(teams.map((t) => t.organization_id))];
    const adminOrgs = new Set<string>();
    for (const oid of orgIds) if (await isOrgAdmin(creatorId, oid)) adminOrgs.add(oid);
    const created = await prisma.$transaction(async (tx) => {
      const out: any[] = [];
      for (const t of teams) {
        const team = await tx.teams.create({
          data: { sport_id: t.sport_id, organization_id: t.organization_id, name: t.name, status: 'forming', invite_token: randomBytes(16).toString('hex') },
        });
        await tx.team_entries.create({
          data: {
            team_id: team.id, organization_id: t.organization_id, championship_id: t.championship_id,
            championship_organization_id: t.championship_organization_id, tournament_discipline_id: t.tournament_discipline_id,
            status: 'forming',
          },
        });
        if (!adminOrgs.has(t.organization_id)) {
          await tx.team_members.create({ data: { team_id: team.id, user_id: creatorId, role: 'captain' } });
        }
        out.push(team);
      }
      return out;
    });
    res.status(201).json({ created: created.length, teams: created });
  }));

  router.patch('/teams/:id', guards.teamManager, validateBody(updateTeamSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!team) throw new NotFoundError('Team');
    await prisma.teams.update({ where: { id: team.id }, data: { ...req.body } });
    res.json(await hydrateTeam(prisma, team.id));
  }));

  // Delete a whole team. A fresh team (never entered into a championship) is removed
  // along with its roster. Once it has championship entries or fixtures it's protected:
  // the caller must opt in with ?cascade=true (the UI's explicit "remove anyway"), which
  // also clears its entries and any fixtures it appears in (home/away/winner - fixture
  // awards cascade with them). team_entries would cascade on their own, but we clear
  // everything in one transaction so the parent delete can't hit a stray FK.
  router.delete('/teams/:id', guards.teamManager, asyncHandler(async (req, res) => {
    const teamId = req.params.id;
    const team = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new NotFoundError('Team');
    const cascade = req.query.cascade === 'true' || req.query.cascade === '1';
    const fixtureWhere = { OR: [{ home_team_id: teamId }, { away_team_id: teamId }, { winner_team_id: teamId }] };

    const [entryCount, fixtureCount, playedCount] = await Promise.all([
      prisma.team_entries.count({ where: { team_id: teamId } }),
      prisma.fixtures.count({ where: fixtureWhere }),
      prisma.fixtures.count({
        where: { AND: [fixtureWhere, { OR: [{ status: { in: ['completed', 'walkover', 'bye'] } }, { home_score: { not: null } }, { away_score: { not: null } }] }] },
      }),
    ]);
    // Completed/scored matches are protected even when the caller opts into cascade -
    // deleting them would corrupt opponents' fixtures and standings.
    if (playedCount > 0) {
      throw new BusinessRuleError('This team has completed or scored matches - those results must be removed before it can be deleted.');
    }
    if ((entryCount > 0 || fixtureCount > 0) && !cascade) {
      throw new BusinessRuleError('This team is entered in a championship - confirm removal to delete it along with its entries and fixtures.');
    }

    await prisma.$transaction([
      prisma.team_members.deleteMany({ where: { team_id: teamId } }),
      ...(cascade ? [prisma.fixtures.deleteMany({ where: fixtureWhere })] : []),
      prisma.team_entries.deleteMany({ where: { team_id: teamId } }),
      prisma.teams.delete({ where: { id: teamId } }),
    ]);
    res.status(204).send();
  }));

  // ---- members ----
  router.get('/teams/:id/members', asyncHandler(async (req, res) => {
    const rows = await prisma.team_members.findMany({
      where: { team_id: req.params.id },
      include: { users: { select: publicUserSelect } },
      orderBy: { joined_at: 'asc' },
    });
    res.json(rows);
  }));

  async function addMember(prisma: Prisma, teamId: string, data: { user_id: string; role: string; jersey_number?: number }) {
    const team = await prisma.teams.findUnique({
      where: { id: teamId },
      include: { team_entries: { include: { tournament_disciplines: { include: { disciplines: true } } } } },
    });
    if (!team) throw new NotFoundError('Team');
    const entries = team.team_entries;
    // The roster can be built before any championship entry; it's frozen only once
    // every entry it has is locked.
    if (entries.length > 0 && entries.every((e) => e.status === 'roster_locked')) {
      throw new BusinessRuleError('Every championship entry for this team is locked');
    }
    const count = await prisma.team_members.count({ where: { team_id: teamId, is_active: true } });
    assertCanAddMember(looseAddRules(entries), count);
    return prisma.team_members.create({
      data: { team_id: teamId, user_id: data.user_id, role: data.role, jersey_number: data.jersey_number ?? null },
    });
  }

  router.post('/teams/:id/members', guards.teamManager, validateBody(addTeamMemberSchema), asyncHandler(async (req, res) => {
    const member = await addMember(prisma, req.params.id, req.body);
    res.status(201).json(member);
  }));

  // Bulk roster import: accepts existing users and/or name+email rows. Emails are
  // resolved (matched or auto-created under the team's organization). Validates the
  // whole batch against the loose squad cap up front, then inserts atomically.
  router.post('/teams/:id/members/bulk', guards.teamManager, validateBody(bulkAddTeamMembersSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({
      where: { id: req.params.id },
      include: { team_entries: { include: { tournament_disciplines: { include: { disciplines: true } } } } },
    });
    if (!team) throw new NotFoundError('Team');
    const entries = team.team_entries;
    if (entries.length > 0 && entries.every((e) => e.status === 'roster_locked')) {
      throw new BusinessRuleError('Every championship entry for this team is locked');
    }
    const rules = looseAddRules(entries);

    const result = await prisma.$transaction(async (tx) => {
      const rows = req.body.members as Array<{ user_id?: string; name?: string; email?: string; role: string; jersey_number?: number | null }>;

      // Resolve every email in one query instead of a findUnique per row, then
      // batch-create the users that don't exist yet (createManyAndReturn gives ids).
      const emails = [...new Set(rows.map((r) => r.email).filter((e): e is string => !!e))];
      const byEmail = new Map(
        (emails.length
          ? await tx.users.findMany({ where: { email: { in: emails } }, select: { id: true, name: true, email: true } })
          : []
        ).map((u) => [u.email, u]),
      );
      const toCreate = emails
        .filter((e) => !byEmail.has(e))
        .map((email) => {
          const row = rows.find((r) => r.email === email)!;
          return {
            name: row.name?.trim() || email.split('@')[0],
            email,
            password_hash: DEFAULT_IMPORT_PASSWORD_HASH,
            organization_id: team.organization_id,
          };
        });
      if (toCreate.length) {
        const fresh = await tx.users.createManyAndReturn({ data: toCreate, select: { id: true, name: true, email: true } });
        for (const u of fresh) byEmail.set(u.email, u);
      }

      // Existing roster ids in one query; a running count enforces the squad cap.
      const onRoster = new Set(
        (await tx.team_members.findMany({ where: { team_id: team.id }, select: { user_id: true } })).map((m) => m.user_id),
      );
      let count = await tx.team_members.count({ where: { team_id: team.id, is_active: true } });

      const added: { name: string; email?: string }[] = [];
      const skipped: { label: string; reason: string }[] = [];
      const newMembers: { team_id: string; user_id: string; role: string; jersey_number: number | null }[] = [];

      for (const row of rows) {
        let userId = row.user_id ?? null;
        let label = row.name || row.email || 'member';
        if (!userId && row.email) {
          const u = byEmail.get(row.email);
          if (u) { userId = u.id; label = u.name; }
        }
        if (!userId) { skipped.push({ label, reason: 'no user/email' }); continue; }
        // onRoster also absorbs duplicates within the same batch (we add as we go).
        if (onRoster.has(userId)) { skipped.push({ label, reason: 'already on roster' }); continue; }
        if (count + 1 > rules.squad_max) {
          throw new BusinessRuleError(`Squad limit reached: at most ${rules.squad_max} members`);
        }
        onRoster.add(userId);
        newMembers.push({ team_id: team.id, user_id: userId, role: row.role, jersey_number: row.jersey_number ?? null });
        count++;
        added.push({ name: label, email: row.email });
      }

      if (newMembers.length) await tx.team_members.createMany({ data: newMembers });
      return { added: added.length, skipped, total: count };
    });

    res.status(201).json(result);
  }));

  // Join via invite token as the current authenticated user.
  router.post('/teams/by-token/:token/join', validateBody(joinTeamSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { invite_token: req.params.token } });
    if (!team) throw new NotFoundError('Team');
    const member = await addMember(prisma, team.id, { user_id: req.user!.id, role: req.body.role, jersey_number: req.body.jersey_number });
    res.status(201).json(member);
  }));

  // Edit a roster row - promote to captain, change role, set a jersey number.
  router.patch('/teams/:id/members/:memberId', guards.teamManager, validateBody(updateTeamMemberSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!team) throw new NotFoundError('Team');
    await assertRosterEditable(prisma, team.id);
    const member = await prisma.team_members.findFirst({ where: { id: req.params.memberId, team_id: team.id } });
    if (!member) throw new NotFoundError('Team member');
    const updated = await prisma.team_members.update({
      where: { id: member.id },
      data: req.body,
      include: { users: { select: publicUserSelect } },
    });
    res.json(updated);
  }));

  router.delete('/teams/:id/members/:memberId', guards.teamManager, asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!team) throw new NotFoundError('Team');
    await assertRosterEditable(prisma, team.id);
    await prisma.team_members.delete({ where: { id: req.params.memberId } });
    res.status(204).send();
  }));

  return router;
}
