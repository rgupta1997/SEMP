import type { Prisma } from '../../infra/prisma.js';

// Normalize a free-form mobile to its last 10 digits (consistent with the
// championship_invitations matching) so lookups are an indexed exact match.
export const last10 = (s?: string | null): string => (s ?? '').replace(/\D/g, '').slice(-10);

/**
 * What an invitation is actually FOR, in words a stranger can read.
 *
 * The invitation mail names the thing being joined and the role in the subject line,
 * and the recipient has by definition never used the product - "you have been invited
 * to target_id 9c1f8e" is indistinguishable from phishing. The role label is shown
 * verbatim, so it is capitalised for a human rather than passed through as an enum.
 */
export async function describeInviteTarget(
  prisma: Prisma,
  targetType: string,
  targetId: string,
): Promise<{ name: string; roleLabel: string } | null> {
  if (targetType === 'org_member') {
    const org = await prisma.organizations.findUnique({ where: { id: targetId }, select: { name: true } });
    return org ? { name: org.name, roleLabel: 'Member' } : null;
  }

  const champ = await prisma.championships.findUnique({ where: { id: targetId }, select: { name: true } });
  if (!champ) return null;

  return {
    name: champ.name,
    roleLabel: targetType === 'championship_organiser' ? 'Organiser' : 'Official',
  };
}

// Apply any pending user_invitations addressed to this user's mobile, then mark
// them accepted. Called from buildAuthContext so it runs on every login / /me -
// but only writes when there is actually a pending invite for the number (a single
// indexed SELECT otherwise).
//
// Best-effort and defensive: this is on the hot auth path, so it NEVER throws - a
// bad/orphaned invite is logged and skipped (left pending) rather than breaking
// sign-in. No new PrismaClient; uses the shared one passed in.
export async function applyUserInvitations(
  prisma: Prisma,
  user: { id: string; phone?: string | null; email?: string | null; email_verified_at?: Date | null },
): Promise<void> {
  try {
    const mobile = last10(user.phone);
    // An email-addressed invitation is normally accepted through its link, which is
    // what proves the recipient reads that mailbox. Matching here as well is for the
    // person who was invited by email and simply signs in instead of clicking - so it
    // requires a VERIFIED address, or an unverified claim to somebody else's address
    // would collect their invitations.
    const email = user.email_verified_at && user.email ? user.email.trim().toLowerCase() : null;
    if (mobile.length < 10 && !email) return;

    const pending = await prisma.user_invitations.findMany({
      where: {
        status: 'pending',
        OR: [
          ...(mobile.length === 10 ? [{ mobile }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
    });
    if (pending.length === 0) return;

    for (const inv of pending) {
      try {
        await applyInvitation(prisma, inv, user.id);
        await prisma.user_invitations.update({
          where: { id: inv.id },
          // token_hash is cleared, not kept: the invitation is spent, and a live hash
          // on an accepted row is a link that still resolves to something.
          data: { status: 'accepted', accepted_user_id: user.id, responded_at: new Date(), token_hash: null },
        });
      } catch (e) {
        console.error('[user-invitations] failed to apply invite', inv.id, e);
      }
    }
  } catch (e) {
    console.error('[user-invitations] apply skipped', e);
  }
}

/** The row shape both acceptance paths need. */
export interface ApplicableInvitation {
  id: string;
  target_type: string;
  target_id: string;
  role: string | null;
  invited_by: string;
}

/**
 * Grant what an invitation promises. Shared by the two ways one can be accepted -
 * signing in with the invited number/address, and following the emailed link - so the
 * link cannot drift into granting something the silent path does not.
 *
 * Idempotent throughout: every write is an upsert, so re-applying is harmless. Unlike
 * applyUserInvitations this DOES throw, because the link flow has a caller who can be
 * told it failed.
 */
export async function applyInvitation(
  prisma: Prisma,
  inv: ApplicableInvitation,
  userId: string,
): Promise<void> {
  if (inv.target_type === 'org_member') {
    await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: userId, organization_id: inv.target_id } },
      update: {},
      create: { user_id: userId, organization_id: inv.target_id, role: inv.role ?? 'member' },
    });
    return;
  }

  if (inv.target_type === 'championship_organiser') {
    const organiserRole = await prisma.roles.findFirst({ where: { name: 'Organiser' }, select: { id: true } });
    // Leave it pending rather than half-applying: the role is seed data, and an
    // invitation marked accepted that granted nothing is worse than one still waiting.
    if (!organiserRole) throw new Error('Organiser role is not configured');
    await prisma.user_championship_roles.upsert({
      where: { user_id_championship_id_role_id: { user_id: userId, championship_id: inv.target_id, role_id: organiserRole.id } },
      update: {},
      create: { user_id: userId, championship_id: inv.target_id, role_id: organiserRole.id, assigned_by: inv.invited_by },
    });
    return;
  }

  if (inv.target_type === 'championship_official') {
    await prisma.championship_officials.upsert({
      where: { championship_id_user_id: { championship_id: inv.target_id, user_id: userId } },
      update: { is_active: true },
      create: { championship_id: inv.target_id, user_id: userId, assigned_by: inv.invited_by, is_active: true },
    });
    return;
  }

  throw new Error(`Unsupported invitation target: ${inv.target_type}`);
}
