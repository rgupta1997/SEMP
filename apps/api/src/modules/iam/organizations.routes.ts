import { Router } from 'express';
import {
  addOrganizationMemberSchema, bulkAddOrganizationMembersSchema, createOrganizationWithOwnerSchema,
  updateOrganizationMemberSchema, updateOrganizationSchema,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { assertStaffSeatAvailable } from '../billing/usage.js';
import { audienceOfRole } from './module-access.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { findUserByPhone, hashProvisionedPassword } from './users.helpers.js';
import { notify } from '@semp/notifications/server/notify.js';
// Organizations router: list/get are open reads. Any authenticated user can
// create an organization (they become its first `owner`). Edits, deletes and
// member management require an owner/admin of that org (or super admin).
export function makeOrganizationsRouter(prisma: Prisma): Router {
  const router = Router();
  const guards = makeGuards(prisma);

  // super OR owner/admin of the :id org
  const orgAdmin = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (await guards.orgRole(u.id, req.params.id, ['owner', 'admin'])) return next();
    throw new ForbiddenError('Only an organization owner/admin can do this');
  });

  // super OR owner of the :id org. Deleting an organization is owner-only - admins
  // manage day-to-day, but tearing down the whole org is the owner's call.
  const orgOwner = asyncHandler(async (req, _res, next) => {
    const u = req.user!;
    if (u.isSuperAdmin) return next();
    if (await guards.orgRole(u.id, req.params.id, ['owner'])) return next();
    throw new ForbiddenError('Only the organization owner can delete it');
  });

  // List/search the master org list. `q` matches name/short_name/city/code (used by
  // the invite picker's server-side typeahead); `limit` caps the result count so the
  // picker can show just the first handful by default. No params → the full list.
  router.get('/', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const take = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 0, 0), 100) : undefined;
    const rows = await prisma.organizations.findMany({
      where: q
        ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { short_name: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
          ],
        }
        : undefined,
      orderBy: { name: 'asc' },
      ...(take ? { take } : {}),
    });
    res.json(rows);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await prisma.organizations.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError('Organization');
    res.json(row);
  }));

  // Create an organization - the creator becomes its owner. Optionally assigns a
  // separate POC/owner: if the phone (or email) already belongs to a user we reuse
  // them, otherwise we provision a new login (forced to change its password on
  // first sign-in) and return its temporary password once so it can be shared.
  router.post('/', validateBody(createOrganizationWithOwnerSchema), asyncHandler(async (req, res) => {
    const { owner, ...organization } = req.body as {
      name: string; short_name?: string; code?: string; logo_url?: string;
      city?: string; status?: boolean; country?: string;
      owner?: { user_id?: string; name?: string; email?: string; password?: string; phone?: string };
    };

    // Resolve an existing POC: an explicitly chosen user, else a phone/email match.
    let pocUserId: string | null = null;
    if (owner) {
      if (owner.user_id) {
        pocUserId = owner.user_id;
      } else {
        const existing = await findUserByPhone(prisma, owner.phone)
          ?? (owner.email ? await prisma.users.findUnique({ where: { email: owner.email }, select: { id: true } }) : null);
        pocUserId = existing?.id ?? null;
      }
    }
    const provision = owner && !pocUserId ? await hashProvisionedPassword(owner.password) : null;

    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organizations.create({ data: { ...organization, status: organization.status ?? true } });
      // The authenticated creator is always an owner of the new org.
      await tx.organization_members.create({
        data: { user_id: req.user!.id, organization_id: org.id, role: 'owner' },
      });
      // If the creator has no primary org yet, set it so their next JWT/context reflects the org.
      await tx.users.updateMany({
        where: { id: req.user!.id, organization_id: null },
        data: { organization_id: org.id },
      });
      if (owner) {
        if (!pocUserId) {
          if (!owner.name || !owner.email) throw new BusinessRuleError('Provide a name and email for the new POC');
          const u = await tx.users.create({
            data: { name: owner.name, email: owner.email, phone: owner.phone ?? null, password_hash: provision!.password_hash, organization_id: org.id, must_change_password: true },
          });
          pocUserId = u.id;
        }
        await tx.organization_members.upsert({
          where: { user_id_organization_id: { user_id: pocUserId, organization_id: org.id } },
          update: { role: 'owner' },
          create: { user_id: pocUserId, organization_id: org.id, role: 'owner' },
        });
      }
      return org;
    });

    // Surface the new login's credentials once so the actor can share them.
    const credentials = owner && provision && owner.name && owner.email
      ? { name: owner.name, email: owner.email, phone: owner.phone ?? null, password: provision.tempPassword }
      : null;
    res.status(201).json({ ...created, poc_credentials: credentials });
  }));

  router.patch('/:id', orgAdmin, validateBody(updateOrganizationSchema), asyncHandler(async (req, res) => {
    const row = await prisma.organizations.update({ where: { id: req.params.id }, data: req.body });
    res.json(row);
  }));

  // Delete an organization (owner-only). Most of the org's data RESTRICTs the delete
  // (teams, users' primary-org pointer, championship entries/enrollments/invitations),
  // so we clear it in one transaction; members + standings cascade on their own.
  // Completed/scored matches are protected - those results must be removed first, even
  // with cascade - and a non-empty org needs an explicit ?cascade=true confirmation.
  router.delete('/:id', orgOwner, asyncHandler(async (req, res) => {
    const orgId = req.params.id;
    const org = await prisma.organizations.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) throw new NotFoundError('Organization');
    const cascade = req.query.cascade === 'true' || req.query.cascade === '1';

    const teams = await prisma.teams.findMany({ where: { organization_id: orgId }, select: { id: true } });
    const teamIds = teams.map((t) => t.id);
    const fixtureWhere = teamIds.length
      ? { OR: [{ home_team_id: { in: teamIds } }, { away_team_id: { in: teamIds } }, { winner_team_id: { in: teamIds } }] }
      : null;

    const [entryCount, enrollCount, playedCount] = await Promise.all([
      prisma.team_entries.count({ where: { organization_id: orgId } }),
      prisma.championship_organizations.count({ where: { organization_id: orgId } }),
      fixtureWhere
        ? prisma.fixtures.count({ where: { AND: [fixtureWhere, { OR: [{ status: { in: ['completed', 'walkover', 'bye'] } }, { home_score: { not: null } }, { away_score: { not: null } }] }] } })
        : Promise.resolve(0),
    ]);
    if (playedCount > 0) {
      throw new BusinessRuleError('This organization has teams with completed or scored matches - those results must be removed before it can be deleted.');
    }
    if ((teamIds.length > 0 || entryCount > 0 || enrollCount > 0) && !cascade) {
      throw new BusinessRuleError('This organization still has teams or championship entries - confirm removal to delete it along with them.');
    }

    await prisma.$transaction([
      ...(fixtureWhere ? [prisma.fixtures.deleteMany({ where: fixtureWhere })] : []),
      ...(teamIds.length ? [prisma.team_members.deleteMany({ where: { team_id: { in: teamIds } } })] : []),
      prisma.team_entries.deleteMany({ where: { organization_id: orgId } }),
      prisma.teams.deleteMany({ where: { organization_id: orgId } }),
      prisma.championship_invitations.deleteMany({ where: { organization_id: orgId } }),
      prisma.championship_organizations.deleteMany({ where: { organization_id: orgId } }),
      // Clear the now-dangling primary-org pointer on any user (their memberships cascade).
      prisma.users.updateMany({ where: { organization_id: orgId }, data: { organization_id: null } }),
      prisma.organizations.delete({ where: { id: orgId } }),
    ]);
    res.status(204).send();
  }));

  // ---- Self-service join requests ----
  // Any signed-in user can request to join an org. A request is just an
  // organization_members row with status 'pending' - it grants no access until an
  // owner/admin approves (orgRole() requires status 'active'). The org's admins are
  // notified via an 'org_admins' notification.
  router.post('/:id/join', asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const orgId = req.params.id;
    const org = await prisma.organizations.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundError('Organization');

    const existing = await prisma.organization_members.findUnique({
      where: { user_id_organization_id: { user_id: userId, organization_id: orgId } },
    });
    if (existing?.status === 'active') throw new BusinessRuleError('You are already a member of this organization');
    if (existing?.status === 'pending') { res.json(existing); return; } // idempotent

    // No row yet, or a past/rejected one being re-opened.
    const member = existing
      ? await prisma.organization_members.update({ where: { id: existing.id }, data: { status: 'pending', role: 'member' } })
      : await prisma.organization_members.create({ data: { user_id: userId, organization_id: orgId, role: 'member', status: 'pending' } });

    const actor = await prisma.users.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const who = actor?.name || actor?.email || 'Someone';
    await notify(prisma, {
      type: 'org_join_request',
      organizationId: orgId,
      senderId: userId,
      data: {
        who,
        organizationName: org.name,
      },
    });
    res.status(201).json(member);
  }));

  // Withdraw your own pending request.
  router.delete('/:id/join', asyncHandler(async (req, res) => {
    await prisma.organization_members.deleteMany({
      where: { user_id: req.user!.id, organization_id: req.params.id, status: 'pending' },
    });
    res.json({ ok: true });
  }));

  // ---- Members ----
  router.get('/:id/members', asyncHandler(async (req, res) => {
    const rows = await prisma.organization_members.findMany({
      where: { organization_id: req.params.id },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { joined_at: 'asc' },
    });
    res.json(rows);
  }));

  // Add a member. Users are central: resolve by user_id, then by phone, then by
  // email; provision a new login only if none match. A newly provisioned login is
  // forced to change its password on first sign-in and its temporary password is
  // returned once so it can be shared.
  router.post('/:id/members', orgAdmin, validateBody(addOrganizationMemberSchema), asyncHandler(async (req, res) => {
    const { user_id, name, email, phone, role } = req.body as { user_id?: string; name?: string; email?: string; phone?: string; role: string };

    let resolvedUserId = user_id ?? null;
    let credentials: { name: string; email: string; phone: string | null; password: string } | null = null;

    if (!resolvedUserId) {
      const existing = await findUserByPhone(prisma, phone)
        ?? (email ? await prisma.users.findUnique({ where: { email }, select: { id: true } }) : null);
      if (existing) {
        resolvedUserId = existing.id;
      } else if (email) {
        const { tempPassword, password_hash } = await hashProvisionedPassword(null);
        const u = await prisma.users.create({
          data: { name: name?.trim() || email.split('@')[0], email, phone: phone ?? null, password_hash, organization_id: req.params.id, must_change_password: true },
        });
        resolvedUserId = u.id;
        credentials = { name: u.name, email: u.email, phone: u.phone, password: tempPassword };
      }
    }
    if (!resolvedUserId) throw new BusinessRuleError('Provide a user, a registered phone, or an email to create one');

    // Staff seats are a plan ceiling. Charged only when somebody crosses INTO
    // staff - re-adding an existing admin occupies no new seat.
    const existingMember = await prisma.organization_members.findUnique({
      where: { user_id_organization_id: { user_id: resolvedUserId, organization_id: req.params.id } },
      select: { role: true, status: true },
    });
    await assertStaffSeatAvailable(
      prisma, req.params.id, role,
      existingMember?.status === 'active' && audienceOfRole(existingMember.role) === 'staff',
    );

    const member = await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: resolvedUserId, organization_id: req.params.id } },
      update: { role, status: 'active' },
      create: { user_id: resolvedUserId, organization_id: req.params.id, role },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.status(201).json({ ...member, poc_credentials: credentials });
  }));

  // Bulk-add several already-registered users in one request (multi-select picker).
  // Each id is upserted to an active membership with the given role; re-adding an
  // existing member just refreshes their role. One round-trip instead of N.
  router.post('/:id/members/bulk', orgAdmin, validateBody(bulkAddOrganizationMembersSchema), asyncHandler(async (req, res) => {
    const { user_ids, role } = req.body as { user_ids: string[]; role: string };
    const orgId = req.params.id;
    const members = await prisma.$transaction(
      [...new Set(user_ids)].map((user_id) => prisma.organization_members.upsert({
        where: { user_id_organization_id: { user_id, organization_id: orgId } },
        update: { role, status: 'active' },
        create: { user_id, organization_id: orgId, role },
        include: { users: { select: { id: true, name: true, email: true, phone: true } } },
      })),
    );
    res.status(201).json(members);
  }));

  // An org must always keep at least one active owner/admin. Throws if the given
  // member is the last one and the change/removal would leave none - so an owner
  // can't demote, deactivate or remove themselves into an unmanageable org.
  async function assertNotLastAdmin(orgId: string, memberId: string): Promise<void> {
    const others = await prisma.organization_members.count({
      where: { organization_id: orgId, role: { in: ['owner', 'admin'] }, status: 'active', id: { not: memberId } },
    });
    if (others === 0) throw new BusinessRuleError('This is the organization’s only owner/admin - promote another member to owner first.');
  }

  router.patch('/:id/members/:memberId', orgAdmin, validateBody(updateOrganizationMemberSchema), asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
    });
    if (!member) throw new NotFoundError('Member');
    const isAdmin = ['owner', 'admin'].includes(member.role);
    const losesAdmin = isAdmin && (
      (req.body.role !== undefined && !['owner', 'admin'].includes(req.body.role)) ||
      (req.body.status !== undefined && req.body.status !== 'active')
    );
    if (losesAdmin) await assertNotLastAdmin(req.params.id, member.id);
    // A promotion into staff takes a seat; a change between two staff roles, or
    // anything that does not touch the role at all, does not.
    if (req.body.role !== undefined) {
      await assertStaffSeatAvailable(
        prisma, req.params.id, req.body.role,
        member.status === 'active' && audienceOfRole(member.role) === 'staff',
      );
    }
    const updated = await prisma.organization_members.update({
      where: { id: member.id },
      data: req.body,
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    res.json(updated);
  }));

  router.delete('/:id/members/:memberId', orgAdmin, asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
      select: { id: true, role: true },
    });
    if (member && ['owner', 'admin'].includes(member.role)) await assertNotLastAdmin(req.params.id, member.id);
    await prisma.organization_members.deleteMany({ where: { id: req.params.memberId, organization_id: req.params.id } });
    res.status(204).send();
  }));

  // ---- Approve / decline a pending join request ----
  // Resolve the org name once for the requester-facing notification.
  async function orgName(id: string): Promise<string> {
    return (await prisma.organizations.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'the organization';
  }

  router.post('/:id/members/:memberId/approve', orgAdmin, asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
    });
    if (!member) throw new NotFoundError('Member');
    const updated = await prisma.organization_members.update({
      where: { id: member.id },
      data: { status: 'active' },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    await notify(prisma, {
      type: 'org_join_approved',
      userId: member.user_id,
      senderId: req.user!.id,
      data: {
        organizationName: await orgName(req.params.id),
      },
    });
    res.json(updated);
  }));

  router.post('/:id/members/:memberId/decline', orgAdmin, asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
    });
    if (!member) throw new NotFoundError('Member');
    await prisma.organization_members.delete({ where: { id: member.id } });
    await notify(prisma, {
      type: 'org_join_declined',
      userId: member.user_id,
      senderId: req.user!.id,
      data: {
        organizationName: await orgName(req.params.id),
      },
    });
    res.json({ ok: true });
  }));

  return router;
}
