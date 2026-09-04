/*
 * Clearing what the APP wrote on top of a seeded bench.
 *
 * WHY THIS EXISTS. A seed manifest records the rows the seed inserted, and cleanup
 * deletes exactly those. That is correct and it is not enough: the moment somebody
 * actually USES the bench - scores a match, locks a result - the app writes rows
 * keyed by those seeded users and fixtures that the manifest has never heard of.
 * Deleting the users then fails on a foreign key, and the bench becomes undeletable.
 *
 * Found the hard way: `npx tsx scripts/seed-qa-bench.ts cleanup` failed with
 * `lifetime_entries_user_id_fkey` after a single result was locked. Every bench had
 * the same latent problem, so the fix lives here rather than three times over.
 *
 * WHAT IT TOUCHES. Only rows belonging to the ids handed in. The seeded users exist
 * nowhere else, so a row referencing one of them was written FOR this bench and
 * belongs to it. Nullable references are nulled rather than deleted, because the row
 * itself (a fixture, a team) is the manifest's to remove in FK order afterwards.
 *
 * Every statement is best-effort: a database that has not had the newer migrations
 * applied does not have the newer tables, and a cleanup must not fail for that.
 */
import type { PrismaClient } from '@prisma/client';

/** Tables to delete outright, with the column holding the user reference. */
const DELETE_BY_USER: Array<[table: string, column: string]> = [
  // records - written by locking a result
  ['lifetime_entries', 'user_id'],
  ['achievements', 'user_id'],
  ['career_stats', 'user_id'],
  ['claim_evidence', 'uploaded_by'],
  ['achievement_claims', 'user_id'],
  ['achievement_claims', 'decided_by'],
  ['certificates', 'user_id'],
  ['certificates', 'issued_by'],
  ['certificates', 'revoked_by'],
  // the typed stat detail cascades from player_match_stats, but these two carry
  // their OWN user references and would block the users delete on their own.
  ['cricket_batting_lines', 'bowler_id'],
  ['cricket_batting_lines', 'fielder_id'],
  ['racquet_match_lines', 'partner_user_id'],
  ['player_match_stats', 'partner_user_id'],
  ['player_match_stats', 'user_id'],
  ['fixture_events', 'player_user_id'],
  ['fixture_events', 'second_user_id'],
  // identity and preferences
  ['profile_privacy', 'user_id'],
  ['auth_tokens', 'user_id'],
  // notifications - a lock notifies participants
  ['notification_reactions', 'user_id'],
  ['notification_reads', 'user_id'],
  ['notification_deliveries', 'user_id'],
  ['notification_cursors', 'user_id'],
  ['notifications', 'sender_id'],
  // awards and roles
  ['fixture_awards', 'recipient_user_id'],
  ['user_org_roles', 'user_id'],
  ['user_org_roles', 'assigned_by'],
  ['org_unit_members', 'user_id'],
  ['championship_invitations', 'invited_by'],
  ['championship_invitations', 'accepted_by'],
  ['user_invitations', 'invited_by'],
  ['user_invitations', 'accepted_user_id'],
  ['report_jobs', 'requested_by'],
];

/** Columns to NULL rather than delete - the row belongs to the manifest. */
const NULL_BY_USER: Array<[table: string, column: string]> = [
  ['fixtures', 'locked_by'],
  ['fixtures', 'submitted_by'],
  ['fixtures', 'official_id'],
  ['teams', 'coach_user_id'],
  ['org_units', 'admin_user_id'],
  ['organizations', 'created_by'],
  ['scoring_formats', 'created_by'],
  ['championship_templates', 'created_by'],
  ['championship_organizations', 'applied_by'],
  ['championship_organizations', 'reviewed_by'],
  ['organization_members', 'verified_by'],
];

/**
 * Remove everything the app wrote for these users, so the manifest's own deletes
 * can then run without hitting a foreign key.
 *
 * Returns a per-table count of what it removed, for the cleanup log - a silent
 * purge would make a failure impossible to diagnose.
 */
export async function purgeUserArtefacts(
  prisma: PrismaClient, userIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!userIds.length) return out;

  for (const [table, column] of DELETE_BY_USER) {
    try {
      const n = await prisma.$executeRawUnsafe(
        `delete from ${table} where ${column} = any($1::uuid[])`, userIds);
      if (n) out[`${table}.${column}`] = n;
    } catch { /* table or column absent on this database */ }
  }
  for (const [table, column] of NULL_BY_USER) {
    try {
      const n = await prisma.$executeRawUnsafe(
        `update ${table} set ${column} = null where ${column} = any($1::uuid[])`, userIds);
      if (n) out[`${table}.${column} (nulled)`] = n;
    } catch { /* as above */ }
  }
  return out;
}

/**
 * Remove what belongs to these fixtures. Separate from the user purge because a
 * fixture's rows outlive the people on it - a scorecard keeps its innings even if
 * every player is deleted - and the two are cleaned in different orders.
 */
export async function purgeFixtureArtefacts(
  prisma: PrismaClient, fixtureIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!fixtureIds.length) return out;
  for (const table of ['cricket_innings', 'player_match_stats', 'fixture_events', 'fixture_awards', 'lifetime_entries']) {
    try {
      const n = await prisma.$executeRawUnsafe(
        `delete from ${table} where fixture_id = any($1::uuid[])`, fixtureIds);
      if (n) out[table] = n;
    } catch { /* absent on this database */ }
  }
  return out;
}
