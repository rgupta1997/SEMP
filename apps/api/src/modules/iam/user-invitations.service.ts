import type { Prisma } from '../../infra/prisma.js';

// Normalize a free-form mobile to its last 10 digits (consistent with the
// championship_invitations matching) so lookups are an indexed exact match.
export const last10 = (s?: string | null): string => (s ?? '').replace(/\D/g, '').slice(-10);

// Apply any pending user_invitations addressed to this user's mobile, then mark
// them accepted. Called from buildAuthContext so it runs on every login / /me —
// but only writes when there is actually a pending invite for the number (a single
// indexed SELECT otherwise).
//
// Best-effort and defensive: this is on the hot auth path, so it NEVER throws — a
// bad/orphaned invite is logged and skipped (left pending) rather than breaking
// sign-in. No new PrismaClient; uses the shared one passed in.
export async function applyUserInvitations(prisma: Prisma, user: { id: string; phone?: string | null }): Promise<void> {
  try {
    const mobile = last10(user.phone);
    if (mobile.length < 10) return;

    const pending = await prisma.user_invitations.findMany({ where: { mobile, status: 'pending' } });
    if (pending.length === 0) return;

    const needsOrganiser = pending.some((p) => p.target_type === 'championship_organiser');
    const organiserRole = needsOrganiser
      ? await prisma.roles.findFirst({ where: { name: 'Organiser' }, select: { id: true } })
      : null;

    for (const inv of pending) {
      try {
        if (inv.target_type === 'org_member') {
          await prisma.organization_members.upsert({
            where: { user_id_organization_id: { user_id: user.id, organization_id: inv.target_id } },
            update: {},
            create: { user_id: user.id, organization_id: inv.target_id, role: inv.role ?? 'member' },
          });
        } else if (inv.target_type === 'championship_organiser') {
          if (!organiserRole) continue; // can't resolve the role — leave it pending
          await prisma.user_championship_roles.upsert({
            where: { user_id_championship_id_role_id: { user_id: user.id, championship_id: inv.target_id, role_id: organiserRole.id } },
            update: {},
            create: { user_id: user.id, championship_id: inv.target_id, role_id: organiserRole.id, assigned_by: inv.invited_by },
          });
        } else if (inv.target_type === 'championship_official') {
          await prisma.championship_officials.upsert({
            where: { championship_id_user_id: { championship_id: inv.target_id, user_id: user.id } },
            update: { is_active: true },
            create: { championship_id: inv.target_id, user_id: user.id, assigned_by: inv.invited_by, is_active: true },
          });
        } else {
          continue;
        }
        await prisma.user_invitations.update({
          where: { id: inv.id },
          data: { status: 'accepted', accepted_user_id: user.id, responded_at: new Date() },
        });
      } catch (e) {
        console.error('[user-invitations] failed to apply invite', inv.id, e);
      }
    }
  } catch (e) {
    console.error('[user-invitations] apply skipped', e);
  }
}
