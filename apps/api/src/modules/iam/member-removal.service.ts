import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { assertOrgNotArchived } from './organization-archive.service.js';

/**
 * Remove people from an organisation outright.
 *
 * Only the ORGANISATION's record of them goes: the membership row, their campus /
 * unit placements and any role granted here (Sports Admin and the like). Their
 * sports record - certificates, career stats, medals, results - belongs to the person
 * and is untouched. Places on this organisation's squads are made inactive, not
 * deleted, so line-ups of matches already played still read correctly.
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
    select: { id: true, user_id: true, role: true, status: true, users: { select: { name: true, email: true } } },
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
  await prisma.$transaction([
    prisma.org_unit_members.deleteMany({ where: { organization_id: organizationId, user_id: { in: userIds } } }),
    prisma.user_org_roles.deleteMany({ where: { organization_id: organizationId, user_id: { in: userIds } } }),
    prisma.team_members.updateMany({
      where: { user_id: { in: userIds }, is_active: true, teams: { organization_id: organizationId } },
      data: { is_active: false },
    }),
    prisma.organization_members.deleteMany({ where: { id: { in: [...removing] }, organization_id: organizationId } }),
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
