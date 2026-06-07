import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  addTeamMemberSchema, bulkAddTeamMembersSchema, bulkCreateTeamsSchema,
  createTeamSchema, joinTeamSchema, updateTeamMemberSchema, updateTeamSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { coerceFilter, parsePaging } from '../../http/paging.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { resolveEntryRules } from '../tournaments/domain/entry-rules.js';
import { assertCanAddMember, assertCanLockRoster } from './domain/roster-policy.js';

// Default password for auto-provisioned players from a bulk import. They can be
// invited / reset later; precomputed once to keep the bulk loop cheap.
const DEFAULT_IMPORT_PASSWORD_HASH = bcrypt.hashSync('demo123', 10);

async function rulesForTeam(prisma: Prisma, tournamentDisciplineId: string | null) {
  if (!tournamentDisciplineId) return resolveEntryRules({}, null);
  const td = await prisma.tournament_disciplines.findUnique({
    where: { id: tournamentDisciplineId },
    include: { disciplines: true },
  });
  return resolveEntryRules(td ?? {}, td?.disciplines ?? null);
}

async function assertDisciplineForTeam(
  prisma: Prisma,
  disciplineId: string,
  eventId: string,
  sportId?: string,
) {
  const td = await prisma.tournament_disciplines.findUnique({
    where: { id: disciplineId },
    include: {
      tournament_sports: { include: { tournaments: { select: { event_id: true } } } },
    },
  });
  if (!td) throw new NotFoundError('Discipline draw');
  if (td.tournament_sports.tournaments.event_id !== eventId) {
    throw new BusinessRuleError('Discipline does not belong to this event');
  }
  if (sportId && td.tournament_sports.sport_id !== sportId) {
    throw new BusinessRuleError('Discipline does not match the selected sport');
  }
  return td;
}

function assertTeamHasDiscipline(team: { tournament_discipline_id: string | null }) {
  if (!team.tournament_discipline_id) {
    throw new BusinessRuleError('Cannot manage this team until the organiser adds a discipline draw for it');
  }
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

// Institution + its point(s) of contact (institution-account users). The POC is
// surfaced on the team without ever being a team_member, so it never counts
// toward a squad.
const institutionWithPocInclude = {
  include: {
    users: {
      where: { account_type: 'institution', is_active: true },
      select: { id: true, name: true, email: true, phone: true },
    },
  },
} as const;

// Every user column EXCEPT password_hash — safe to embed in any roster payload.
// `include: { users: { select: publicUserSelect } }` would serialise the bcrypt hash straight to clients.
const publicUserSelect = {
  id: true, name: true, email: true, phone: true, avatar_url: true,
  is_active: true, is_super_admin: true, account_type: true,
  institution_id: true, created_at: true, updated_at: true,
} as const;

export function makeTeamsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  router.get('/teams', asyncHandler(async (req, res) => {
    const where: Record<string, unknown> = {};
    for (const k of ['event_id', 'tournament_discipline_id', 'institution_id', 'sport_id']) {
      const val = coerceFilter(req.query[k]);
      if (val !== undefined) where[k] = val;
    }
    const { take, skip } = parsePaging(req.query);
    const rows = await prisma.teams.findMany({
      where,
      include: {
        institutions: institutionWithPocInclude,
        sports: true,
        events: { select: { id: true, name: true, slug: true, status: true } },
        tournament_disciplines: teamDisciplineInclude,
        team_members: { include: { users: { select: { id: true, name: true, email: true, phone: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take,
      skip,
    });
    res.json(rows);
  }));

  // Resolve an invite token (public-ish within the app) -> team summary.
  router.get('/teams/by-token/:token', asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({
      where: { invite_token: req.params.token },
      include: { institutions: true, sports: true },
    });
    if (!team) throw new NotFoundError('Team');
    res.json(team);
  }));

  router.get('/teams/:id', asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({
      where: { id: req.params.id },
      include: {
        team_members: { include: { users: { select: publicUserSelect } } },
        institutions: institutionWithPocInclude, sports: true, events: { select: { id: true, name: true, slug: true, status: true } },
        tournament_disciplines: teamDisciplineInclude,
      },
    });
    if (!team) throw new NotFoundError('Team');
    // Resolve the effective squad rules so the roster UI can show limits + validate.
    const entry_rules = resolveEntryRules(
      team.tournament_disciplines ?? {},
      team.tournament_disciplines?.disciplines ?? null,
    );
    res.json({ ...team, entry_rules });
  }));

  // Create a team — requires the institution's enrollment to be approved.
  // The creating user is automatically enrolled as the team captain so the team
  // shows up in their "my teams" immediately (and survives a refresh).
  router.post('/teams', guards.teamCreate, validateBody(createTeamSchema), asyncHandler(async (req, res) => {
    const ei = await prisma.event_institutions.findUnique({ where: { id: req.body.event_institution_id } });
    if (!ei) throw new NotFoundError('Enrollment');
    if (ei.status !== 'approved') {
      throw new BusinessRuleError('Institution enrollment is not approved for this event');
    }
    await assertDisciplineForTeam(prisma, req.body.tournament_discipline_id, req.body.event_id, req.body.sport_id);
    // Enforce one-team-per-discipline on create too (was only checked on PATCH), so a
    // double-submit / retry can't silently create a second team. The partial unique
    // index added in the DB migration is the race-proof backstop behind this.
    const dupe = await prisma.teams.findFirst({
      where: {
        institution_id: req.body.institution_id,
        event_id: req.body.event_id,
        tournament_discipline_id: req.body.tournament_discipline_id,
      },
      select: { id: true },
    });
    if (dupe) throw new BusinessRuleError('Your institution already has a team in this discipline draw');
    const creatorId = req.user!.id;
    // A POC (institution account) manages teams but never plays in them, so they
    // are not seeded onto the roster — they are surfaced via the institution link.
    const seedCaptain = req.user!.accountType !== 'institution';
    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.teams.create({
        data: {
          event_id: req.body.event_id,
          sport_id: req.body.sport_id,
          institution_id: req.body.institution_id,
          event_institution_id: req.body.event_institution_id,
          tournament_discipline_id: req.body.tournament_discipline_id,
          name: req.body.name,
          status: 'forming',
          invite_token: randomBytes(16).toString('hex'),
        },
      });
      // Seed the roster with the creator as captain (idempotent-safe: one row).
      if (seedCaptain) {
        await tx.team_members.create({
          data: { team_id: created.id, user_id: creatorId, role: 'captain' },
        });
      }
      return tx.teams.findUnique({
        where: { id: created.id },
        include: { team_members: { include: { users: { select: publicUserSelect } } }, institutions: true, sports: true },
      });
    });
    res.status(201).json(team);
  }));

  // Bulk-create teams (one per selected discipline), each with the creator as
  // captain. All-or-nothing so a partial failure never leaves orphan teams.
  router.post('/teams/bulk', guards.teamCreate, validateBody(bulkCreateTeamsSchema), asyncHandler(async (req, res) => {
    const teams = req.body.teams as Array<{
      event_id: string; sport_id: string; institution_id: string;
      event_institution_id: string; tournament_discipline_id: string; name: string;
    }>;
    for (const t of teams) {
      await assertDisciplineForTeam(prisma, t.tournament_discipline_id, t.event_id, t.sport_id);
    }
    // Batch-load the referenced enrollments once instead of a findUnique per team.
    const eiIds = [...new Set(teams.map((t) => t.event_institution_id))];
    const eiMap = new Map(
      (await prisma.event_institutions.findMany({ where: { id: { in: eiIds } }, select: { id: true, status: true } }))
        .map((e) => [e.id, e]),
    );
    // Reject duplicates against existing teams (one query) and within the batch itself.
    const dupKey = (t: { institution_id: string; event_id: string; tournament_discipline_id: string | null }) =>
      `${t.institution_id}|${t.event_id}|${t.tournament_discipline_id}`;
    const existing = await prisma.teams.findMany({
      where: { OR: teams.map((t) => ({ institution_id: t.institution_id, event_id: t.event_id, tournament_discipline_id: t.tournament_discipline_id })) },
      select: { institution_id: true, event_id: true, tournament_discipline_id: true },
    });
    const seen = new Set(existing.map(dupKey));
    for (const t of teams) {
      const ei = eiMap.get(t.event_institution_id);
      if (!ei) throw new NotFoundError('Enrollment');
      if (ei.status !== 'approved') throw new BusinessRuleError(`Enrollment not approved for "${t.name}"`);
      const k = dupKey(t);
      if (seen.has(k)) throw new BusinessRuleError(`A duplicate team for "${t.name}" is in this discipline draw`);
      seen.add(k);
    }
    const creatorId = req.user!.id;
    const seedCaptain = req.user!.accountType !== 'institution';
    const created = await prisma.$transaction(async (tx) => {
      const out: any[] = [];
      for (const t of teams) {
        const team = await tx.teams.create({
          data: {
            event_id: t.event_id,
            sport_id: t.sport_id,
            institution_id: t.institution_id,
            event_institution_id: t.event_institution_id,
            tournament_discipline_id: t.tournament_discipline_id,
            name: t.name,
            status: 'forming',
            invite_token: randomBytes(16).toString('hex'),
          },
        });
        if (seedCaptain) {
          await tx.team_members.create({ data: { team_id: team.id, user_id: creatorId, role: 'captain' } });
        }
        out.push(team);
      }
      return out;
    });
    res.status(201).json({ created: created.length, teams: created });
  }));

  router.patch('/teams/:id', guards.teamManager, validateBody(updateTeamSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id } });
    if (!team) throw new NotFoundError('Team');
    if (team.status === 'roster_locked' && req.body.tournament_discipline_id !== undefined) {
      throw new BusinessRuleError('Cannot change discipline after the roster is locked');
    }
    const data: Record<string, unknown> = { ...req.body };
    if (req.body.tournament_discipline_id !== undefined) {
      const td = await assertDisciplineForTeam(
        prisma,
        req.body.tournament_discipline_id,
        team.event_id,
      );
      const duplicate = await prisma.teams.findFirst({
        where: {
          institution_id: team.institution_id,
          event_id: team.event_id,
          tournament_discipline_id: req.body.tournament_discipline_id,
          id: { not: team.id },
        },
      });
      if (duplicate) {
        throw new BusinessRuleError('Your institution already has a team in this discipline draw');
      }
      data.sport_id = td.tournament_sports.sport_id;
    }
    const updated = await prisma.teams.update({
      where: { id: team.id },
      data,
      include: {
        team_members: { include: { users: { select: publicUserSelect } } },
        institutions: true,
        sports: true,
        events: { select: { id: true, name: true, slug: true, status: true } },
        tournament_disciplines: teamDisciplineInclude,
      },
    });
    const entry_rules = resolveEntryRules(
      updated.tournament_disciplines ?? {},
      updated.tournament_disciplines?.disciplines ?? null,
    );
    res.json({ ...updated, entry_rules });
  }));

  router.delete('/teams/:id', guards.teamManager, asyncHandler(async (req, res) => {
    await prisma.teams.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }));

  // Lock the roster (validates squad size against resolved entry rules).
  router.post('/teams/:id/lock', guards.teamManager, asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id } });
    if (!team) throw new NotFoundError('Team');
    assertTeamHasDiscipline(team);
    const count = await prisma.team_members.count({ where: { team_id: team.id, is_active: true } });
    const rules = await rulesForTeam(prisma, team.tournament_discipline_id);
    assertCanLockRoster(rules, count);
    const updated = await prisma.teams.update({ where: { id: team.id }, data: { status: 'roster_locked' } });
    res.json(updated);
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
    const team = await prisma.teams.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundError('Team');
    assertTeamHasDiscipline(team);
    if (team.status === 'roster_locked') throw new BusinessRuleError('Roster is locked');
    const count = await prisma.team_members.count({ where: { team_id: teamId, is_active: true } });
    const rules = await rulesForTeam(prisma, team.tournament_discipline_id);
    assertCanAddMember(rules, count);
    return prisma.team_members.create({
      data: { team_id: teamId, user_id: data.user_id, role: data.role, jersey_number: data.jersey_number ?? null },
    });
  }

  router.post('/teams/:id/members', guards.teamManager, validateBody(addTeamMemberSchema), asyncHandler(async (req, res) => {
    const member = await addMember(prisma, req.params.id, req.body);
    res.status(201).json(member);
  }));

  // Bulk roster import: accepts existing users and/or name+email rows. Emails are
  // resolved (matched or auto-created under the team's institution). Validates the
  // whole batch against squad_max up front, then inserts atomically.
  router.post('/teams/:id/members/bulk', guards.teamManager, validateBody(bulkAddTeamMembersSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id } });
    if (!team) throw new NotFoundError('Team');
    assertTeamHasDiscipline(team);
    if (team.status === 'roster_locked') throw new BusinessRuleError('Roster is locked');
    const rules = await rulesForTeam(prisma, team.tournament_discipline_id);

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
            account_type: 'participant',
            institution_id: team.institution_id,
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
          throw new BusinessRuleError(`Squad limit reached: a ${rules.entry_type} draw allows at most ${rules.squad_max} members`);
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

  // Edit a roster row — promote to captain, change role, set a jersey number.
  router.patch('/teams/:id/members/:memberId', guards.teamManager, validateBody(updateTeamMemberSchema), asyncHandler(async (req, res) => {
    const team = await prisma.teams.findUnique({ where: { id: req.params.id } });
    if (!team) throw new NotFoundError('Team');
    if (team.status === 'roster_locked') throw new BusinessRuleError('Roster is locked');
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
    const team = await prisma.teams.findUnique({ where: { id: req.params.id } });
    if (!team) throw new NotFoundError('Team');
    if (team.status === 'roster_locked') throw new BusinessRuleError('Roster is locked');
    await prisma.team_members.delete({ where: { id: req.params.memberId } });
    res.status(204).send();
  }));

  return router;
}
