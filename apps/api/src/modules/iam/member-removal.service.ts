import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { assertOrgNotArchived } from './organization-archive.service.js';
import { notifyJoinApproved } from './organizations.notifications.js';
import { leaveSquadsWhere } from '../teams/squad-places.js';
import { phoneLast10 } from './users.helpers.js';
import { assertWithinOrgLimit } from '@semp/entitlements/server';
import { countPeople } from '../billing/usage.js';

/**
 * Vouched for by the organisation. Everyone it makes a member - added, invited,
 * imported, re-added, or a join request it accepts - is verified from the start: the
 * organisation bringing someone in IS the vouching. Only a join request is ever
 * unverified, and rejecting one declines it. `by` is who brought them in.
 */
export const vouchedBy = (by: string | null) =>
  ({ verification: 'verified', verified_by: by, verified_at: new Date(), rejection_note: null }) as const;

/**
 * The fields an OWNER's membership starts with. An owner is the organisation's own
 * account holder - leaving them "pending" put the person who runs the place in the
 * Awaiting verification queue of their own People page. `by` is who vouches: the owner
 * themselves when they created it, else whoever set them up.
 */
export const ownerMembership = (by: string | null) =>
  ({ role: 'owner', status: 'active', ...vouchedBy(by) }) as const;

/**
 * Remove people from an organisation.
 *
 * The membership is KEPT, marked 'past' - it is what the People page's Removed tab lists
 * and what Re-add (restoreMembers) brings back. Everything that checks membership reads
 * status 'active', so a past member has no access. What goes: their campus / unit
 * placements, any role granted here (Sports Admin and the like), campus administrator
 * and coach appointments, and this as their home organisation. Their sports record - certificates, career stats, medals, results - belongs to the person
 * and is untouched. Places on this organisation's squads are made inactive and dated,
 * not deleted, so line-ups of matches already played still read correctly.
 *
 * Owners are refused (ownership is handed over, not removed), and an admin only when
 * another active owner/admin remains - an organisation must never be left unmanaged.
 */
export async function removeMembers(prisma: Prisma, req: Request, organizationId: string, memberIds: string[]) {
  // An archived organisation's roll is frozen, as it is for verifying.
  await assertOrgNotArchived(prisma, organizationId);
  // Ids from another organisation are simply not found - never confirmed to exist.
  const members = await prisma.organization_members.findMany({
    where: { id: { in: memberIds }, organization_id: organizationId },
    select: { id: true, user_id: true, role: true, status: true, users: { select: { name: true, email: true, phone: true } } },
  });
  if (!members.length) return { removed: 0 };

  const owners = members.filter((m) => m.role === 'owner');
  if (owners.length) {
    throw new BusinessRuleError(`${owners.map((m) => m.users?.name ?? 'An owner').join(', ')} owns this organisation - hand ownership to someone else before removing them.`);
  }
  const removing = new Set(members.map((m) => m.id));
  if (members.some((m) => m.role === 'admin' && m.status === 'active')) {
    const remaining = await prisma.organization_members.count({
      where: { organization_id: organizationId, role: { in: ['owner', 'admin'] }, status: 'active', id: { notIn: [...removing] } },
    });
    if (remaining === 0) throw new BusinessRuleError('That would leave the organisation with no owner or admin.');
  }

  const userIds = members.map((m) => m.user_id);
  // An invitation still waiting for them would let them straight back in at sign-in.
  const mobiles = members.map((m) => phoneLast10(m.users?.phone)).filter((p) => p.length === 10);
  const emails = members.map((m) => m.users?.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  await prisma.$transaction([
    prisma.user_invitations.updateMany({
      where: {
        target_type: 'org_member', target_id: organizationId, status: 'pending',
        OR: [{ mobile: { in: mobiles } }, { email: { in: emails } }],
      },
      data: { status: 'revoked', revoked_at: new Date(), responded_at: new Date(), token_hash: null },
    }),
    prisma.org_unit_members.deleteMany({ where: { organization_id: organizationId, user_id: { in: userIds } } }),
    prisma.user_org_roles.deleteMany({ where: { organization_id: organizationId, user_id: { in: userIds } } }),
    leaveSquadsWhere(prisma, { user_id: { in: userIds }, teams: { organization_id: organizationId } }),
    // Appointments held here go too - each one grants rights or reaches them without membership.
    prisma.org_units.updateMany({ where: { organization_id: organizationId, admin_user_id: { in: userIds } }, data: { admin_user_id: null } }),
    prisma.teams.updateMany({ where: { organization_id: organizationId, coach_user_id: { in: userIds } }, data: { coach_user_id: null } }),
    // No longer their home organisation (sign-in default, and who may manage their account).
    prisma.users.updateMany({ where: { id: { in: userIds }, organization_id: organizationId }, data: { organization_id: null } }),
    prisma.organization_members.updateMany({ where: { id: { in: [...removing] }, organization_id: organizationId }, data: { status: 'past' } }),
  ]);

  for (const m of members) {
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberRemoved,
      target: { type: 'organization_members', id: m.id, label: `${m.users?.name} (${m.users?.email})` },
      organizationId,
      summary: `Removed ${m.users?.name ?? 'a member'} from this organisation`,
      diff: { status: { from: m.status, to: 'removed' } },
    });
  }
  return { removed: members.length };
}

/**
 * Re-add people removed earlier (status 'past'): members again, told so with the same
 * "you're in" notification an approval sends. Placements, roles and squad places are
 * not restored - they are given again, deliberately. Someone removed as an admin comes
 * back as a plain member, so re-adding never quietly hands back admin rights.
 */
export async function restoreMembers(prisma: Prisma, req: Request, organizationId: string, memberIds: string[]) {
  await assertOrgNotArchived(prisma, organizationId);
  const members = await prisma.organization_members.findMany({
    where: { id: { in: memberIds }, organization_id: organizationId, status: 'past' },
    select: { id: true, user_id: true, role: true, users: { select: { name: true, email: true } } },
  });
  if (!members.length) return { restored: 0 };
  // Coming back takes a place on the roll, under the same plan ceiling as adding someone.
  await assertWithinOrgLimit(prisma, 'people', organizationId, (await countPeople(prisma, organizationId)) + members.length - 1);

  const ids = members.map((m) => m.id);
  await prisma.$transaction([
    prisma.organization_members.updateMany({ where: { id: { in: ids }, role: 'admin' }, data: { role: 'member' } }),
    prisma.organization_members.updateMany({ where: { id: { in: ids } }, data: { status: 'active', ...vouchedBy(req.user!.id) } }),
  ]);

  const orgName = (await prisma.organizations.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? 'the organization';
  for (const m of members) {
    await notifyJoinApproved(prisma, m.user_id, orgName, req.user!.id);
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberAdded,
      target: { type: 'organization_members', id: m.id, label: `${m.users?.name} (${m.users?.email})` },
      organizationId,
      summary: `Re-added ${m.users?.name ?? 'a member'} to this organisation`,
      diff: { status: { from: 'past', to: 'active' } },
    });
  }
  return { restored: members.length };
}
