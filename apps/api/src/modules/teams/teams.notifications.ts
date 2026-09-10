import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules, type AudienceRule } from '@semp/notifications/core/rules.js';
import type { NotificationTypeKey } from '@semp/notifications/core/registry.js';
import { resolveEntryRules } from '../tournaments/domain/entry-rules.js';

// Every notification this module can trigger lives here, never inline in
// teams.routes.ts - so "who does this team action tell, and who exactly do they
// reach" is always answered in one place, and testable without going through
// Express at all.

// Best-effort: the roster/team write is already committed, so a notification
// hiccup must never surface as a failed request. Matches the pattern already
// used for fixtures/org-roles notifications.
export async function tellUser(
  prisma: Prisma, actorId: string, userId: string, type: NotificationTypeKey, data: Record<string, unknown>,
): Promise<void> {
  try {
    await notify(prisma, { type, userId, senderId: actorId, data });
  } catch (err) {
    console.error(`[teams] ${type} notification failed for user ${userId}:`, err);
  }
}

// Coach + captain(s)/vice-captain(s) + this org's admins - the people who can
// actually act on this team, not the whole squad (a regular player can't
// complete a roster or speak for the team). Composed from real ids since no
// single Rule kind expresses that combination. Returns null when the team no
// longer exists, so callers can skip notifying without themselves knowing why.
async function teamStakeholdersAudience(prisma: Prisma, teamId: string): Promise<AudienceRule | null> {
  const team = await prisma.teams.findUnique({
    where: { id: teamId },
    select: {
      organization_id: true, coach_user_id: true,
      team_members: { where: { is_active: true, role: { in: ['captain', 'vice_captain'] } }, select: { user_id: true } },
    },
  });
  if (!team) return null;
  const rules: AudienceRule[] = [];
  if (team.coach_user_id) rules.push(Rules.directUser(team.coach_user_id));
  for (const m of team.team_members) rules.push(Rules.directUser(m.user_id));
  rules.push(Rules.orgAdmins(team.organization_id));
  return Rules.compose(rules);
}

export async function notifyRosterIncomplete(
  prisma: Prisma, teamId: string, actorId: string, data: Record<string, unknown>,
): Promise<void> {
  try {
    const audience = await teamStakeholdersAudience(prisma, teamId);
    if (!audience) return;
    await notify(prisma, { type: 'roster_incomplete', audience, senderId: actorId, data });
  } catch (err) {
    console.error(`[teams] roster_incomplete notification failed for team ${teamId}:`, err);
  }
}

// Coach + captain(s) + this org's admins - not just whoever clicked Create. At
// creation there is rarely a coach yet (no field for one on the create form),
// and a captain only exists when the creator wasn't an org admin (see
// seedCaptain in the route) - but admins besides the creator, and a coach
// assigned moments later by a bulk flow, still deserve to hear about it.
export async function notifyTeamCreated(
  prisma: Prisma, teamId: string, teamName: string, actorId: string,
): Promise<void> {
  try {
    const audience = await teamStakeholdersAudience(prisma, teamId);
    if (!audience) return;
    await notify(prisma, { type: 'team_created', audience, senderId: actorId, data: { teamName } });
  } catch (err) {
    console.error(`[teams] team_created notification failed for team ${teamId}:`, err);
  }
}

// Checks the team's CURRENT active roster against ONE discipline's squad_min and
// fires roster_incomplete if short. A discipline can become attached to an entry
// from FOUR different places in teams.routes.ts - the single create-and-enter
// shortcut, the bulk create-teams shortcut, entering an existing roster into
// championships, and the later single-entry "pick your discipline" PATCH - so
// this is called from all four, rather than wired into only one of them, which
// is what happened the first time this was built.
export async function checkRosterIncomplete(
  prisma: Prisma, teamId: string, actorId: string, tournamentDisciplineId: string,
): Promise<void> {
  try {
    const [drawRow, count, team] = await Promise.all([
      prisma.tournament_disciplines.findUnique({ where: { id: tournamentDisciplineId }, include: { disciplines: true } }),
      prisma.team_members.count({ where: { team_id: teamId, is_active: true } }),
      prisma.teams.findUnique({ where: { id: teamId }, select: { name: true } }),
    ]);
    if (!drawRow) return;
    const rules = resolveEntryRules(drawRow, drawRow.disciplines ?? null);
    if (count >= rules.squad_min) return;
    await notifyRosterIncomplete(prisma, teamId, actorId, {
      teamName: team?.name, count, squadMin: rules.squad_min, disciplineName: drawRow.disciplines?.name,
    });
  } catch (err) {
    console.error(`[teams] roster_incomplete check failed for team ${teamId}:`, err);
  }
}

// A single championship entry's roster was locked (POST /teams/:id/entries/:entryId/lock).
// Coach + captain(s) + org admins, same stakeholder audience as team_created and
// roster_incomplete - not the whole roster (a regular player isn't who manages
// the team's entries).
export async function notifyRosterLocked(prisma: Prisma, teamId: string, actorId: string): Promise<void> {
  try {
    const [team, audience] = await Promise.all([
      prisma.teams.findUnique({ where: { id: teamId }, select: { name: true } }),
      teamStakeholdersAudience(prisma, teamId),
    ]);
    if (!audience) return;
    await notify(prisma, {
      type: 'team_roster_locked',
      audience,
      senderId: actorId,
      data: { teamName: team?.name },
    });
  } catch (err) {
    console.error(`[teams] team_roster_locked notification failed for team ${teamId}:`, err);
  }
}
