import { ORGANIZATION_MEMBER_ROLE, type Audience } from '@semp/shared';
import { limitsFor, type LimitKey } from '@semp/entitlements';
import { assertWithinOrgLimit, limitState, type LimitState } from '@semp/entitlements/server';
import type { Tier } from '@semp/entitlements';
import type { Prisma } from '../../infra/prisma.js';
import { audienceOfRole } from '../iam/module-access.js';

// Counting what a plan's ceilings are ceilings ON.
//
// This lives in the API rather than in the entitlements package on purpose. The
// package knows what a plan allows; knowing how many active events an
// institution has is a question about the championships table, and teaching a
// small pure module to read the domain is how it stops being either.
//
// The counts are derived, never stored. A cached counter is a second source of
// truth for something the database already knows, and it goes wrong in the
// direction that blocks a paying customer from creating an event they are
// entitled to.

/** The membership roles that occupy a staff seat, derived from the same rule the module gate uses. */
const ROLES_BY_AUDIENCE = (audience: Audience): string[] =>
  ORGANIZATION_MEMBER_ROLE.filter((r) => audienceOfRole(r) === audience);

const STAFF_ROLES = ROLES_BY_AUDIENCE('staff');
const STUDENT_ROLES = ROLES_BY_AUDIENCE('students');

/**
 * An event stops counting against the ceiling when it is over. `active_events`
 * is about concurrency - how much an institution may run at once - not about how
 * many it has ever run, so a completed season must free its slot or a customer's
 * first year quietly becomes their last.
 */
const FINISHED = ['completed', 'cancelled'];

export async function countActiveEvents(prisma: Prisma, organizationId: string): Promise<number> {
  return prisma.championships.count({
    where: { host_organization_id: organizationId, status: { notIn: FINISHED } },
  });
}

export async function countPeople(prisma: Prisma, organizationId: string): Promise<number> {
  return prisma.organization_members.count({
    where: { organization_id: organizationId, status: 'active', role: { in: STUDENT_ROLES } },
  });
}

export async function countStaffSeats(prisma: Prisma, organizationId: string): Promise<number> {
  return prisma.organization_members.count({
    where: { organization_id: organizationId, status: 'active', role: { in: STAFF_ROLES } },
  });
}

const COUNTERS: Record<LimitKey, (prisma: Prisma, organizationId: string) => Promise<number>> = {
  active_events: countActiveEvents,
  people: countPeople,
  staff_seats: countStaffSeats,
};

/** One limit, counted and resolved against the tier. What a create route asks. */
export async function usageOf(
  prisma: Prisma,
  key: LimitKey,
  organizationId: string,
  tier: Tier,
): Promise<LimitState> {
  return limitState('org', tier, key, await COUNTERS[key](prisma, organizationId));
}

/**
 * Every org limit at once, for the meters on the billing panel.
 *
 * Three counts in parallel rather than in sequence: they are independent, and
 * the panel is behind a pooled connection where three round trips in series is
 * the difference between a panel that opens and one that appears to hang.
 */
export async function orgUsage(
  prisma: Prisma,
  organizationId: string,
  tier: Tier,
): Promise<LimitState[]> {
  const keys = limitsFor('org');
  const counts = await Promise.all(keys.map((k) => COUNTERS[k](prisma, organizationId)));
  return keys.map((k, i) => limitState('org', tier, k, counts[i]));
}

/**
 * A staff seat is about to be occupied - is there one free?
 *
 * Called wherever a membership is written with a staff role. `wasAlreadyStaff`
 * matters: promoting an admin to owner occupies no NEW seat, and refusing it
 * because the institution is at its ceiling would make a full institution unable
 * to reorganise itself. Only a person crossing INTO staff is charged a seat.
 */
export async function assertStaffSeatAvailable(
  prisma: Prisma,
  organizationId: string,
  role: string,
  wasAlreadyStaff: boolean,
): Promise<void> {
  if (audienceOfRole(role) !== 'staff' || wasAlreadyStaff) return;
  await assertWithinOrgLimit(prisma, 'staff_seats', organizationId, await countStaffSeats(prisma, organizationId));
}
