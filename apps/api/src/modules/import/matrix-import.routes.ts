import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { matrixImportSchema, eventTemplateFor, isRankingSport } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { NotFoundError } from '../../shared/errors.js';
import { deriveProvisionedPassword, findUsersByPhones, maskPhone, phoneLast10 } from '../iam/users.helpers.js';

// Champion­ship setup matrix import: turn one 2D spreadsheet (sections × sport/
// discipline) into the full structure - sports/disciplines mapped in, each section
// an enrolled organization, one team per section×discipline, with Overall POCs as
// org owners and per-discipline Captains/POCs on the teams. People are matched to
// existing users by phone only; unmatched ones are skipped and reported. Every step
// is match-or-create/upsert, so re-running the same sheet is safe (idempotent).

type Person = { name: string; phone: string };
type MatrixBody = {
  default_format_id: string;
  create_missing_org_id?: string | null;
  create_missing_in_section?: boolean;
  sections: string[];
  owners: Array<Person & { section: string }>;
  units: Array<{ sport: string; discipline: string | null; teams: Array<{ section: string; captain?: Person | null; poc?: Person | null }> }>;
};

type Ref = { section: string; sport: string | null; discipline: string | null; role: 'owner' | 'captain' | 'poc'; name: string; phone: string };

// Default team name from the sheet's category, e.g. "Basketball (Men)" / "Badminton".
const teamName = (sport: string, discipline: string | null) => (discipline ? `${sport} (${discipline})` : sport);

// Flatten every person reference in the sheet (owners + captains + pocs).
function collectPeople(body: MatrixBody): Ref[] {
  const out: Ref[] = [];
  for (const o of body.owners) {
    if (o.phone) out.push({ section: o.section, sport: null, discipline: null, role: 'owner', name: o.name, phone: o.phone });
  }
  for (const u of body.units) {
    for (const t of u.teams) {
      if (t.captain?.phone) out.push({ section: t.section, sport: u.sport, discipline: u.discipline, role: 'captain', name: t.captain.name, phone: t.captain.phone });
      if (t.poc?.phone) out.push({ section: t.section, sport: u.sport, discipline: u.discipline, role: 'poc', name: t.poc.name, phone: t.poc.phone });
    }
  }
  return out;
}

// Teams to create = each (section, unit) that has at least one named person.
function countTeams(body: MatrixBody): number {
  let n = 0;
  for (const u of body.units) for (const t of u.teams) if (t.captain?.phone || t.poc?.phone) n++;
  return n;
}

// Phones (last-10 keys) that appear as Overall POCs. These become org owners and are
// ALWAYS provisioned when unmatched - a section is unusable without its owner - even
// when no "create missing users" option is chosen. Other unmatched people are created
// only when a target org is picked.
function ownerPhoneKeys(body: MatrixBody): Set<string> {
  return new Set(body.owners.map((o) => phoneLast10(o.phone)).filter((k) => k.length === 10));
}

export function makeMatrixImportRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);
  // Super admin, or the organiser of THIS championship.
  const manage = guards.championshipManager(async (req) => req.params.id);

  // ---- Dry run: resolve phones, report scope + unmatched people. No writes. ----
  router.post('/:id/matrix-import/validate', manage, validateBody(matrixImportSchema), asyncHandler(async (req, res) => {
    const body = req.body as MatrixBody;
    const championship = await prisma.championships.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!championship) throw new NotFoundError('Championship');

    const people = collectPeople(body);
    const phoneMap = await findUsersByPhones(prisma, people.map((p) => p.phone));
    const resolved = (phone: string) => phoneMap.get(phoneLast10(phone)) ?? null;
    const unmatched = people.filter((p) => !resolved(p.phone));

    // Which section orgs already exist (the main create-vs-existing signal)?
    const existingOrgs = await prisma.organizations.findMany({ where: { name: { in: body.sections } }, select: { name: true } });
    const existingOrgNames = new Set(existingOrgs.map((o) => o.name.toLowerCase()));

    // Unmatched people get provisioned (deduped by phone) when a target org is chosen
    // (an explicit org, or each person's own section org). Overall POCs (org owners) are
    // ALWAYS provisioned, so only the *other* unmatched people are skipped & reported.
    const ownerKeys = ownerPhoneKeys(body);
    const provision = !!body.create_missing_org_id || !!body.create_missing_in_section;
    const willCreatePhone = (p: Ref) => { const k = phoneLast10(p.phone); return k.length === 10 && (provision || ownerKeys.has(k)); };
    const creatable = new Set(unmatched.filter(willCreatePhone).map((p) => phoneLast10(p.phone)));
    const skipped = unmatched.filter((p) => !creatable.has(phoneLast10(p.phone)));

    res.json({
      sections: body.sections.map((name) => ({ name, exists: existingOrgNames.has(name.toLowerCase()) })),
      sports: body.units.map((u) => ({ sport: u.sport, discipline: u.discipline })),
      teams: countTeams(body),
      people: { total: people.length, matched: people.length - unmatched.length, unmatched: skipped.length },
      will_create: creatable.size,
      unmatched: skipped.map((p) => ({ section: p.section, sport: p.sport, discipline: p.discipline, role: p.role, name: p.name, phone: maskPhone(p.phone) })),
    });
  }));

  // ---- Commit: orchestrate all writes idempotently. ----
  router.post('/:id/matrix-import', manage, validateBody(matrixImportSchema), asyncHandler(async (req, res) => {
    const actorId = req.user!.id;
    const championshipId = req.params.id;
    const body = req.body as MatrixBody;

    const championship = await prisma.championships.findUnique({ where: { id: championshipId }, select: { id: true } });
    if (!championship) throw new NotFoundError('Championship');

    // Ranking sports (powerlifting/swimming/athletics) have no head-to-head matches, so
    // they're locked to the "Rankings" format rather than the sheet's default (Knockout).
    // Resolve its id once; if the format isn't seeded yet we fall back to the default.
    const rankingFormat = await prisma.tournament_formats.findFirst({ where: { name: { equals: 'Rankings', mode: 'insensitive' } }, select: { id: true } });
    const rankingFormatId = rankingFormat?.id ?? null;

    // Resolve people up front (one query); anyone we can't match by phone is either
    // provisioned as a new login or skipped (see below).
    const people = collectPeople(body);
    const phoneMap = await findUsersByPhones(prisma, people.map((p) => p.phone));
    const resolved = (phone: string) => phoneMap.get(phoneLast10(phone)) ?? null;
    const createOrgId = body.create_missing_org_id ?? null;
    // Provision missing people either in one chosen org, or in each person's own section org.
    const provisionMissing = !!createOrgId || !!body.create_missing_in_section;
    const ownerKeys = ownerPhoneKeys(body);

    // Build provisional logins for unmatched phones (deduped, remembering the section they
    // first appear in). Overall POCs become org owners and are ALWAYS provisioned so no
    // section is left without one; other unmatched people are created only when a target
    // org is chosen. The sheet has no email, so synthesize one from the phone; password
    // follows the firstname@last4 rule. Hash OUTSIDE the transaction (bcrypt is CPU-bound).
    const newUsers = new Map<string, { name: string; email: string; phone: string; section: string; isOwner: boolean; password: string; password_hash: string }>();
    for (const p of people) {
      const last10 = phoneLast10(p.phone);
      if (last10.length !== 10 || resolved(p.phone) || newUsers.has(last10)) continue;
      const isOwner = ownerKeys.has(last10);
      if (!isOwner && !provisionMissing) continue;
      const name = p.name.trim() || `User ${last10}`;
      const password = deriveProvisionedPassword(name, p.phone);
      newUsers.set(last10, { name, email: `${last10}@import.local`, phone: p.phone, section: p.section, isOwner, password, password_hash: '' });
    }
    if (newUsers.size) {
      await Promise.all([...newUsers.values()].map(async (u) => { u.password_hash = await bcrypt.hash(u.password, 10); }));
    }

    const summary = {
      orgs: { created: 0, existing: 0 },
      sports: { created: 0 },
      disciplines: { created: 0 },
      draws: { created: 0 },
      teams: { created: 0, existing: 0 },
      users: { created: 0 },
      owners_assigned: 0,
      captains_assigned: 0,
      pocs_assigned: 0,
    };

    await prisma.$transaction(async (tx) => {
      // 1) The championship's single tournament (create one if missing).
      const tournament = (await tx.tournaments.findFirst({ where: { championship_id: championshipId }, select: { id: true } }))
        ?? (await tx.tournaments.create({ data: { championship_id: championshipId, name: 'Main', status: 'active' }, select: { id: true } }));
      // Default venue for new draws: the one seeded from the host city at championship
      // creation (organiser can reassign later on the Venues tab).
      const venueId = (await tx.venues.findFirst({ where: { championship_id: championshipId }, orderBy: { created_at: 'asc' }, select: { id: true } }))?.id ?? null;

      // 2) Sports / disciplines / draws - cached so a sport shared by two rows is reused.
      const sportIdByName = new Map<string, string>();
      const tsIdBySport = new Map<string, string>();          // tournament_sport per sport
      const tdIdByUnit = new Map<string, string>();           // tournament_discipline per "sport||discipline"
      const sportInfoByName = new Map<string, { sportId: string; tsId: string }>();

      const getSport = async (name: string): Promise<string> => {
        const key = name.toLowerCase();
        if (sportIdByName.has(key)) return sportIdByName.get(key)!;
        const found = await tx.sports.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
        const id = found?.id ?? (summary.sports.created++, (await tx.sports.create({ data: { name }, select: { id: true } })).id);
        sportIdByName.set(key, id);
        return id;
      };
      const getTournamentSport = async (sportName: string): Promise<{ sportId: string; tsId: string }> => {
        const key = sportName.toLowerCase();
        if (sportInfoByName.has(key)) return sportInfoByName.get(key)!;
        const sportId = await getSport(sportName);
        // Ranking sports use the Rankings format; everything else the sheet's default. For
        // ranking sports we also correct the format on re-import (they're never head-to-head).
        const ranking = isRankingSport(sportName) && !!rankingFormatId;
        const formatId = ranking ? rankingFormatId! : body.default_format_id;
        const ts = await tx.tournament_sports.upsert({
          where: { tournament_id_sport_id: { tournament_id: tournament.id, sport_id: sportId } },
          update: ranking ? { format_id: formatId } : {},
          create: { tournament_id: tournament.id, sport_id: sportId, format_id: formatId },
          select: { id: true },
        });
        const info = { sportId, tsId: ts.id };
        tsIdBySport.set(key, ts.id);
        sportInfoByName.set(key, info);
        return info;
      };
      const getDraw = async (sportName: string, discipline: string | null): Promise<{ sportId: string; tdId: string }> => {
        const unitKey = `${sportName.toLowerCase()}||${(discipline ?? '').toLowerCase()}`;
        const { sportId, tsId } = await getTournamentSport(sportName);
        if (tdIdByUnit.has(unitKey)) return { sportId, tdId: tdIdByUnit.get(unitKey)! };

        let disciplineId: string | null = null;
        if (discipline) {
          const foundD = await tx.disciplines.findFirst({ where: { sport_id: sportId, name: { equals: discipline, mode: 'insensitive' } }, select: { id: true } });
          disciplineId = foundD?.id ?? (summary.disciplines.created++, (await tx.disciplines.create({ data: { sport_id: sportId, name: discipline }, select: { id: true } })).id);
        }

        // Composite unique allows multiple NULL discipline_id rows, so resolve null draws via findFirst.
        let td = disciplineId
          ? await tx.tournament_disciplines.findUnique({ where: { tournament_sport_id_discipline_id: { tournament_sport_id: tsId, discipline_id: disciplineId } }, select: { id: true } })
          : await tx.tournament_disciplines.findFirst({ where: { tournament_sport_id: tsId, discipline_id: null }, select: { id: true } });
        if (!td) {
          // Ranking sports get their multi-competitor event template so the scoring console
          // shows the right races/lifts/events (not a default single-contest console).
          const scoring = eventTemplateFor(sportName);
          td = await tx.tournament_disciplines.create({
            data: { tournament_sport_id: tsId, discipline_id: disciplineId, venue_id: venueId, ...(scoring ? { format_config: { scoring } as any } : {}) },
            select: { id: true },
          });
          summary.draws.created++;
        }
        tdIdByUnit.set(unitKey, td.id);
        return { sportId, tdId: td.id };
      };

      // 3) Sections -> organizations -> approved championship enrollment.
      const orgIdBySection = new Map<string, string>();
      const champOrgBySection = new Map<string, string>();
      const ensureSection = async (section: string): Promise<{ orgId: string; champOrgId: string }> => {
        const key = section.toLowerCase();
        if (orgIdBySection.has(key)) return { orgId: orgIdBySection.get(key)!, champOrgId: champOrgBySection.get(key)! };
        const found = await tx.organizations.findFirst({ where: { name: { equals: section, mode: 'insensitive' } }, select: { id: true } });
        const orgId = found?.id ?? (summary.orgs.created++, (await tx.organizations.create({ data: { name: section, status: true }, select: { id: true } })).id);
        if (found) summary.orgs.existing++;
        const champOrg = await tx.championship_organizations.upsert({
          where: { championship_id_organization_id: { championship_id: championshipId, organization_id: orgId } },
          update: { status: 'approved', reviewed_by: actorId, reviewed_at: new Date() },
          create: { championship_id: championshipId, organization_id: orgId, applied_by: actorId, reviewed_by: actorId, reviewed_at: new Date(), status: 'approved' },
          select: { id: true },
        });
        orgIdBySection.set(key, orgId);
        champOrgBySection.set(key, champOrg.id);
        return { orgId, champOrgId: champOrg.id };
      };
      // Make sure every declared section org + enrollment exists, even if it has no people yet.
      for (const section of body.sections) await ensureSection(section);

      // Team people (captains / per-discipline POCs) become plain MEMBERS of their section
      // org so the org shows in their "Organizations" list. Collected here (deduped by
      // user+org) and written in ONE batch after step 5 - doing an upsert per person blew
      // the interactive-transaction budget on large sheets (P2028). skipDuplicates leaves
      // any existing membership (e.g. an owner row) untouched, so it never downgrades.
      const teamOrgMembers = new Map<string, { user_id: string; organization_id: string }>();
      const addTeamOrgMember = (userId: string, orgId: string) =>
        teamOrgMembers.set(`${userId}|${orgId}`, { user_id: userId, organization_id: orgId });

      // 3.5) Provision missing logins (now that section orgs exist), then fold them into
      //      the phone map so the assignment loops resolve them like any matched user.
      //      Owners' home org is ALWAYS their own section org (they own it); other people
      //      go to the chosen org, else their section org.
      if (newUsers.size) {
        const list = [...newUsers.values()];
        const orgFor = (u: { section: string; isOwner: boolean }) =>
          u.isOwner ? (orgIdBySection.get(u.section.toLowerCase()) ?? null) : (createOrgId ?? orgIdBySection.get(u.section.toLowerCase()) ?? null);
        await tx.users.createMany({
          data: list.map((u) => ({ name: u.name, email: u.email, phone: u.phone, password_hash: u.password_hash, organization_id: orgFor(u), must_change_password: true })),
          skipDuplicates: true,
        });
        const created = await tx.users.findMany({ where: { email: { in: list.map((u) => u.email) } }, select: { id: true, name: true, email: true, phone: true } });
        // Org memberships are assigned uniformly below - owners in step 4, team people
        // (captains / per-discipline POCs) in step 5 - so new and matched users get the
        // same roles. Here we only create the logins + fold them into the phone map.
        for (const u of created) {
          const k = phoneLast10(u.phone);
          if (k.length === 10 && !phoneMap.has(k)) { phoneMap.set(k, u); summary.users.created++; }
        }
      }

      // 4) Overall POCs -> org owners. The owner membership (role owner, status active) is
      //    what the auth context + canManageOrg use to surface and let them manage the org
      //    on login. Also set their home org when they don't have one yet, so they land on it.
      for (const o of body.owners) {
        const user = o.phone ? resolved(o.phone) : null;
        if (!user) continue;
        const { orgId } = await ensureSection(o.section);
        await tx.organization_members.upsert({
          where: { user_id_organization_id: { user_id: user.id, organization_id: orgId } },
          update: { role: 'owner', status: 'active' },
          create: { user_id: user.id, organization_id: orgId, role: 'owner' },
        });
        await tx.users.updateMany({ where: { id: user.id, organization_id: null }, data: { organization_id: orgId } });
        summary.owners_assigned++;
      }

      // 5) Teams + entries + captain/poc members, per section × unit.
      for (const u of body.units) {
        for (const t of u.teams) {
          if (!t.captain?.phone && !t.poc?.phone) continue; // empty cell - nothing to build
          const { orgId, champOrgId } = await ensureSection(t.section);
          const { sportId, tdId } = await getDraw(u.sport, u.discipline);
          const name = teamName(u.sport, u.discipline);

          let team = await tx.teams.findFirst({ where: { organization_id: orgId, sport_id: sportId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
          if (!team) {
            team = await tx.teams.create({ data: { organization_id: orgId, sport_id: sportId, name, status: 'forming' }, select: { id: true } });
            summary.teams.created++;
          } else {
            summary.teams.existing++;
          }

          await tx.team_entries.upsert({
            where: { team_id_championship_id: { team_id: team.id, championship_id: championshipId } },
            update: { tournament_discipline_id: tdId, championship_organization_id: champOrgId },
            create: { team_id: team.id, organization_id: orgId, championship_id: championshipId, championship_organization_id: champOrgId, tournament_discipline_id: tdId, status: 'forming' },
          });

          const captain = t.captain?.phone ? resolved(t.captain.phone) : null;
          if (captain) {
            await tx.team_members.upsert({
              where: { team_id_user_id: { team_id: team.id, user_id: captain.id } },
              update: { role: 'captain', is_active: true },
              create: { team_id: team.id, user_id: captain.id, role: 'captain' },
            });
            // Also a member of the section org, so the org shows in their Organizations.
            addTeamOrgMember(captain.id, orgId);
            summary.captains_assigned++;
          }
          // The per-discipline POC is added as vice_captain: that team role carries the
          // same manage-the-team ("owner") rights as captain (see teamManager guard) and
          // is permitted by the team_members role check constraint (no 'poc' value). Skip
          // if they're already this team's captain so we never downgrade them.
          const poc = t.poc?.phone ? resolved(t.poc.phone) : null;
          if (poc && poc.id !== captain?.id) {
            await tx.team_members.upsert({
              where: { team_id_user_id: { team_id: team.id, user_id: poc.id } },
              update: { role: 'vice_captain', is_active: true },
              create: { team_id: team.id, user_id: poc.id, role: 'vice_captain' },
            });
            addTeamOrgMember(poc.id, orgId);
            summary.pocs_assigned++;
          }
        }
      }

      // 6) One batch insert of all team-person org memberships (members). skipDuplicates
      //    keeps existing rows (owners/admins) as-is, so nobody is downgraded.
      if (teamOrgMembers.size) {
        await tx.organization_members.createMany({
          data: [...teamOrgMembers.values()].map((m) => ({ ...m, role: 'member' })),
          skipDuplicates: true,
        });
      }
    }, { timeout: 120000, maxWait: 15000 });

    // Recompute matches now that provisioned users are in the phone map - anyone still
    // unmatched had no valid phone / no target org and was skipped.
    const stillUnmatched = people.filter((p) => !resolved(p.phone));
    res.status(201).json({
      ...summary,
      people: { total: people.length, matched: people.length - stillUnmatched.length, unmatched: stillUnmatched.length },
      // Credentials for the logins we just created, surfaced once so the actor can share them.
      created_users: [...newUsers.values()].map((u) => ({ name: u.name, email: u.email, phone: u.phone, password: u.password })),
      unmatched: stillUnmatched.map((p) => ({ section: p.section, sport: p.sport, discipline: p.discipline, role: p.role, name: p.name, phone: maskPhone(p.phone) })),
    });
  }));

  return router;
}
