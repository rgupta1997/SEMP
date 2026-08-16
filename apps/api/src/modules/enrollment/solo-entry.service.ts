import type { Request } from 'express';
import type { Db, Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, NotFoundError } from '../../shared/errors.js';
import { audit } from '../iam/audit.service.js';
import { createNotification } from '../notifications/audience.js';

// Entering a competition without an institution (J3-E1).
//
// The design in docs/eos/05-flexible-entry.md: on a person's first independent entry,
// silently create a hidden `organizations.kind = 'personal'` row owned by them, then
// run the ordinary enrolment/team/entry flow completely unchanged. The person never
// meets the word "organisation".
//
// The strongest argument for it is what it does NOT require: the creator of a personal
// org is its owner, so every existing authorisation guard - enrollSelf, teamCreate,
// teamManager - already passes. The only new server-side logic is provisioning, and
// the only new rules are about keeping these orgs out of sight (see the `kind` filters
// on the organisation directory).

export interface SoloEntryInput {
  championshipId: string;
  /** The draw to enter. Its entry type decides whether a squad is even a question. */
  drawId: string;
  /** Named squad = "a group of friends"; absent = "just me". */
  squadName?: string | null;
}

// Find the person's personal org, or make one. A partial unique index on
// (created_by) where kind='personal' means this can never quietly produce a second.
async function personalOrgFor(db: Db, user: { id: string; name: string }): Promise<string> {
  const existing = await db.organizations.findFirst({
    where: { kind: 'personal', created_by: user.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const org = await db.organizations.create({
    data: {
      // Named for the person, because this row is what standings and fixtures read
      // when they ask an entry who it belongs to (J3-E1-S3).
      name: user.name,
      kind: 'personal',
      verified: false,
      created_by: user.id,
      status: true,
    },
    select: { id: true },
  });
  await db.organization_members.create({
    data: { user_id: user.id, organization_id: org.id, role: 'owner', status: 'active' },
  });
  return org.id;
}

export async function enterAsIndividual(prisma: Prisma, req: Request, input: SoloEntryInput) {
  const actor = await prisma.users.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, organization_id: true },
  });
  if (!actor) throw new NotFoundError('User');

  const championship = await prisma.championships.findUnique({
    where: { id: input.championshipId },
    select: { id: true, name: true, status: true, allow_individual_entry: true },
  });
  if (!championship) throw new NotFoundError('Championship');
  if (championship.status !== 'registration_open') {
    throw new BusinessRuleError('This championship is not open for registration');
  }
  // The organiser's call, and it is enforced here rather than only hidden in the UI
  // (J3-E1-S5): an inter-college championship should not acquire unaffiliated
  // entrants because somebody found the endpoint.
  if (!championship.allow_individual_entry) {
    throw new BusinessRuleError('This championship only accepts entries from institutions');
  }

  const draw = await prisma.tournament_disciplines.findUnique({
    where: { id: input.drawId },
    select: {
      id: true, entry_type: true,
      disciplines: { select: { name: true } },
      tournament_sports: {
        select: { sport_id: true, sports: { select: { name: true } }, tournaments: { select: { championship_id: true } } },
      },
    },
  });
  if (!draw || draw.tournament_sports?.tournaments?.championship_id !== championship.id) {
    throw new NotFoundError('Draw');
  }

  const sportId = draw.tournament_sports?.sport_id;
  if (!sportId) throw new BusinessRuleError('This draw has no sport to enter');

  // "or none of them are" (J3-E1-S1). A half-created entry would leave a person with
  // a stray personal org and no way to see why nothing happened.
  const result = await prisma.$transaction(async (tx) => {
    const organizationId = await personalOrgFor(tx, actor);

    // Enrolment: the same pending row an institution gets, so the organiser's
    // approvals queue is one queue (J3-E1-S6).
    const enrolment = await tx.championship_organizations.upsert({
      where: { championship_id_organization_id: { championship_id: championship.id, organization_id: organizationId } },
      update: {},
      create: {
        championship_id: championship.id,
        organization_id: organizationId,
        applied_by: actor.id,
        status: 'pending',
      },
    });

    // The team is what fixtures and standings actually reference. For "just me" it is
    // a one-person team named after the person; for a group it carries their name.
    const teamName = input.squadName?.trim() || actor.name;
    let team = await tx.teams.findFirst({
      where: { organization_id: organizationId, sport_id: sportId, name: teamName },
      select: { id: true },
    });
    if (!team) {
      team = await tx.teams.create({
        data: { organization_id: organizationId, sport_id: sportId, name: teamName, status: 'forming' },
        select: { id: true },
      });
      await tx.team_members.create({
        // Captain, because for a group entry they are the one who can manage it -
        // and for a solo entry there is nobody else it could be.
        data: { team_id: team.id, user_id: actor.id, role: 'captain', is_active: true },
      });
    }

    // team_entries denormalises the org and the enrolment row it belongs to, so the
    // standings and approvals queries never have to join back through the team.
    const entry = await tx.team_entries.upsert({
      where: { team_id_championship_id: { team_id: team.id, championship_id: championship.id } },
      update: { tournament_discipline_id: draw.id },
      create: {
        team_id: team.id,
        organization_id: organizationId,
        championship_id: championship.id,
        championship_organization_id: enrolment.id,
        tournament_discipline_id: draw.id,
      },
    });

    return { organizationId, enrolment, team, entry, teamName };
  });

  const drawLabel = [draw.tournament_sports?.sports?.name, draw.disciplines?.name].filter(Boolean).join(' · ');

  await audit(prisma, req, {
    action: 'registration.individual_entry',
    target: { type: 'team_entries', id: result.entry.id, label: `${result.teamName} — ${drawLabel}` },
    organizationId: result.organizationId,
    championshipId: championship.id,
    summary: `${actor.name} entered ${championship.name} (${drawLabel}) as an individual`,
    diff: { squad: { from: null, to: input.squadName ?? null } },
  });

  // Same as an institution's application: the organising team is told, and the entry
  // waits for their approval (J3-E1-S6).
  const organisers = await prisma.user_championship_roles.findMany({
    where: { championship_id: championship.id },
    select: { user_id: true },
  });
  for (const o of [...new Map(organisers.map((r) => [r.user_id, r])).values()]) {
    await createNotification(prisma, {
      championship_id: championship.id,
      target_user_id: o.user_id,
      sender_id: actor.id,
      // An individual entry awaiting review - a task for the organiser, which is why
      // it is not in the same family as "you're in".
      type: 'entry_submitted',
      audience: 'all',
      title: `${result.teamName} entered ${championship.name}`,
      body: `An individual entry for ${drawLabel}. Review it on the Approvals tab.`,
    });
  }

  return {
    entry_id: result.entry.id,
    team_id: result.team.id,
    team_name: result.teamName,
    status: result.enrolment.status,
    entry_type: draw.entry_type,
    draw: drawLabel,
  };
}
