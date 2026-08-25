import {
  granted,
  grantedCapabilities,
  CAPABILITIES,
  type CapabilityKey,
  type Ladder,
  type Tier,
} from '../core/index.js';

/**
 * Only the reads this module performs, described structurally rather than by
 * importing the concrete client.
 *
 * The reason is the same one that governs the notification package and the
 * engine's `Db` type: a caller can hand in a TRANSACTION client. A tier read
 * that happens inside the transaction which is about to change the tier sees a
 * consistent picture; one that quietly used a global client would not.
 */
export interface EntitlementsPrisma {
  organizations: {
    findUnique(args: {
      where: { id: string };
      select: { plan: true };
    }): Promise<{ plan: Tier } | null>;
  };
  users: {
    findUnique(args: {
      where: { id: string };
      select: { personal_plan: true };
    }): Promise<{ personal_plan: Tier } | null>;
  };
}

/** Raised when a capability is missing. Carries the key so the API can name it. */
export class CapabilityRequiredError extends Error {
  readonly capability: CapabilityKey;
  readonly ladder: Ladder;
  readonly status = 403;

  constructor(capability: CapabilityKey) {
    // The message names the capability and what it unlocks, never the tier -
    // this string reaches the client, and the locked surface renders from it.
    super(`${CAPABILITIES[capability].label} is not available: ${CAPABILITIES[capability].surface}`);
    this.name = 'CapabilityRequiredError';
    this.capability = capability;
    this.ladder = CAPABILITIES[capability].ladder;
  }
}

/**
 * An organisation's tier. Missing organisation is treated as `free` rather than
 * throwing: absence of an org is a permission question, answered by the caller
 * before it gets here, and conflating the two would report "upgrade" for what is
 * really "no such tenant".
 */
export async function orgTier(
  prisma: EntitlementsPrisma,
  organizationId: string,
): Promise<Tier> {
  const row = await prisma.organizations.findUnique({
    where: { id: organizationId },
    select: { plan: true },
  });
  return row?.plan ?? 'free';
}

export async function personalTier(
  prisma: EntitlementsPrisma,
  userId: string,
): Promise<Tier> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { personal_plan: true },
  });
  return row?.personal_plan ?? 'free';
}

/**
 * The tier governing `capability` for this caller. Which ladder applies is a
 * property of the capability, not of the request - so a route can ask about any
 * capability without knowing which ladder it belongs to.
 */
export async function tierFor(
  prisma: EntitlementsPrisma,
  capability: CapabilityKey,
  holder: { userId: string; organizationId?: string | null },
): Promise<Tier> {
  if (CAPABILITIES[capability].ladder === 'personal') {
    return personalTier(prisma, holder.userId);
  }
  // An org capability outside any org context is ungranted, not free-tier-granted:
  // 'free' is the correct answer because the free tier is what a caller with no
  // organisation can rely on, and create_event is deliberately available there.
  if (!holder.organizationId) return 'free';
  return orgTier(prisma, holder.organizationId);
}

export async function hasCapability(
  prisma: EntitlementsPrisma,
  capability: CapabilityKey,
  holder: { userId: string; organizationId?: string | null },
): Promise<boolean> {
  return granted(await tierFor(prisma, capability, holder), capability);
}

/** Throws `CapabilityRequiredError` unless the holder has it. */
export async function assertCapability(
  prisma: EntitlementsPrisma,
  capability: CapabilityKey,
  holder: { userId: string; organizationId?: string | null },
): Promise<void> {
  if (!(await hasCapability(prisma, capability, holder))) {
    throw new CapabilityRequiredError(capability);
  }
}

/**
 * Everything this holder can do on both ladders, in one round trip per ladder.
 * The shape the client needs to render every gate without asking again.
 */
export async function entitlementSnapshot(
  prisma: EntitlementsPrisma,
  holder: { userId: string; organizationId?: string | null },
): Promise<{
  org: { tier: Tier; capabilities: CapabilityKey[] };
  personal: { tier: Tier; capabilities: CapabilityKey[] };
}> {
  const [org, personal] = await Promise.all([
    holder.organizationId ? orgTier(prisma, holder.organizationId) : Promise.resolve<Tier>('free'),
    personalTier(prisma, holder.userId),
  ]);
  const snap = (ladder: Ladder, tier: Tier) => ({
    tier,
    capabilities: grantedCapabilities(ladder, tier),
  });
  return { org: snap('org', org), personal: snap('personal', personal) };
}
