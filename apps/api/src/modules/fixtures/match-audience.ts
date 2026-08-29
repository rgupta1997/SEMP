import type { Prisma } from '../../infra/prisma.js';
import { notify } from '@semp/notifications/server/notify.js';
import { Rules, type AudienceRule } from '@semp/notifications/core/rules.js';

// The audience for a match-level notification (schedule/venue/opponent/cancel/live/
// qualifies): both teams' rosters plus their coaches (coach_user_id isn't a
// team_members role, so it can't be reached via Rules.teamMembers alone), plus an
// optional extra direct recipient (e.g. the assigned official). Its own file so both
// fixtures.routes.ts and stage-resolver.ts can use it without importing each other.
export async function matchAudience(
  prisma: Prisma,
  homeTeamId: string | null,
  awayTeamId: string | null,
  extraUserIds: (string | null | undefined)[] = [],
): Promise<AudienceRule> {
  const rules: AudienceRule[] = [];
  if (homeTeamId) rules.push(Rules.teamMembers(homeTeamId));
  if (awayTeamId) rules.push(Rules.teamMembers(awayTeamId));
  const teamIds = [homeTeamId, awayTeamId].filter((t): t is string => !!t);
  if (teamIds.length) {
    const teams = await prisma.teams.findMany({ where: { id: { in: teamIds } }, select: { coach_user_id: true } });
    for (const t of teams) if (t.coach_user_id) rules.push(Rules.directUser(t.coach_user_id));
  }
  for (const uid of extraUserIds) if (uid) rules.push(Rules.directUser(uid));
  return Rules.compose(rules);
}

// Best-effort match notification - never fails the caller's request.
export async function notifyMatch(prisma: Prisma, type: string, audience: AudienceRule, senderId: string | null, data: Record<string, unknown>): Promise<void> {
  if ((audience as { rules?: unknown[] }).rules?.length === 0) return; // nobody to tell (both slots still TBD)
  try {
    await notify(prisma, { type, audience, senderId, data });
  } catch (err) {
    console.error(`[fixtures] ${type} notification failed:`, err);
  }
}
