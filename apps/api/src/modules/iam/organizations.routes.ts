import { Router } from 'express';
import {
  addOrganizationMemberSchema, bulkAddOrganizationMembersSchema, createOrganizationWithOwnerSchema,
  updateOrganizationMemberSchema, updateOrganizationSchema, inviteOrgMemberSchema, ORG_KIND,
} from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';
import { asyncHandler } from '../../http/middleware/error.js';
import { validateBody } from '../../http/middleware/validate.js';
import { makeGuards } from '../../http/middleware/permissions.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from './audit.service.js';
import { inviteToOrganization, listOrganizationInvitations, revokeInvitation } from './org-invitations.service.js';
import { findUserByPhone, hashProvisionedPassword } from './users.helpers.js';
import { createNotification } from '../notifications/audience.js';

// Organizations router: list/get are open reads. Any authenticated user can
// create an organization (they become its first `owner`). Edits, deletes and
// member management require an owner/admin of that org (or super admin).
// How a membership reads in the audit trail, captured at write time so the line
// survives the person being deleted later.
function memberLabel(m: { users?: { name?: string | null; email?: string | null } | null; user_id?: string }): string {
  const u = m.users;
  if (u?.name && u?.email) return `${u.name} (${u.email})`;
  return u?.name ?? u?.email ?? m.user_id ?? 'a member';
}

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

  // List organisations. TWO SCOPES, and the difference is the tenant boundary (J6-E5-S1):
  //
  //   default            - only the organisations the caller belongs to, in full.
  //                        Super admins see every organisation, because platform
  //                        administration is their job.
  //   ?scope=directory   - the public directory: every organisation, but reduced to
  //                        the fields a stranger may see (name, short name, city,
  //                        logo, code) and never personal orgs. This is what the
  //                        "find an organisation to join" and invite pickers use.
  //
  // Until this change the default *was* the directory, returning every institution
  // on the platform in full to any authenticated user - the open cross-tenant read
  // this story exists to close. Anything richer than the directory projection must
  // stay behind membership.
  router.get('/', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const take = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 0, 0), 100) : undefined;
    const directory = req.query.scope === 'directory';

    const search = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { short_name: { contains: q, mode: 'insensitive' as const } },
            { city: { contains: q, mode: 'insensitive' as const } },
            { code: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    if (directory) {
      const rows = await prisma.organizations.findMany({
        // Personal orgs are one hidden person each; they must never be enumerable.
        where: { ...search, kind: { not: 'personal' } },
        // The projection IS the boundary here - no membership, no settings, no domains.
        select: { id: true, name: true, short_name: true, code: true, city: true, logo_url: true, kind: true, verified: true },
        orderBy: { name: 'asc' },
        ...(take ? { take } : {}),
      });
      res.json(rows);
      return;
    }

    // Any membership row, not just active ones: a pending applicant already knows
    // they applied, and hiding the org they applied to breaks their own view of it.
    const mine = req.user!.isSuperAdmin
      ? {}
      : { organization_members: { some: { user_id: req.user!.id } } };

    // Personal organisations are a person wearing an organisation's clothes so the
    // entry machinery works (J3-E1). They are not organisations anybody should be
    // browsing - not in the platform list, not in a picker, not in a count - so they
    // are excluded here too, not only from the directory. A super admin who genuinely
    // needs to see them (support, debugging) asks explicitly.
    const includePersonal = req.user!.isSuperAdmin && req.query.include_personal === 'true';
    const hidePersonal = includePersonal ? {} : { kind: { not: 'personal' } };

    const rows = await prisma.organizations.findMany({
      where: { ...search, ...mine, ...hidePersonal },
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

    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgCreated,
      target: { type: 'organizations', id: created.id, label: created.name },
      organizationId: created.id,
      summary: `Created the organisation ${created.name}`,
      diff: { kind: { from: null, to: created.kind } },
    });

    // Surface the new login's credentials once so the actor can share them.
    const credentials = owner && provision && owner.name && owner.email
      ? { name: owner.name, email: owner.email, phone: owner.phone ?? null, password: provision.tempPassword }
      : null;
    res.status(201).json({ ...created, poc_credentials: credentials });
  }));

  router.patch('/:id', orgAdmin, validateBody(updateOrganizationSchema), asyncHandler(async (req, res) => {
    const before = await prisma.organizations.findUnique({ where: { id: req.params.id } });
    const row = await prisma.organizations.update({ where: { id: req.params.id }, data: req.body });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.orgSettingsChanged,
      target: { type: 'organizations', id: row.id, label: row.name },
      organizationId: row.id,
      summary: `Updated the organisation profile for ${row.name}`,
      diff: Object.fromEntries(
        Object.keys(req.body as Record<string, unknown>)
          .filter((k) => (before as any)?.[k] !== (row as any)[k])
          .map((k) => [k, { from: (before as any)?.[k] ?? null, to: (row as any)[k] ?? null }]),
      ),
    });
    res.json(row);
  }));

  // Promote an organization to the institution tier, or demote it back (J1-E1-S3).
  // SUPER-ADMIN ONLY, deliberately: the Verified badge is a trust signal shown to
  // everyone who lands in the workspace, so it must not be self-issued. Every change
  // is audited with who did it and when.
  router.patch('/:id/verify', asyncHandler(async (req, res) => {
    if (!req.user!.isSuperAdmin) throw new ForbiddenError('Only Sportagon can verify an organisation');
    const { verified = true, kind } = req.body as { verified?: boolean; kind?: string };

    const org = await prisma.organizations.findUnique({ where: { id: req.params.id } });
    if (!org) throw new NotFoundError('Organization');

    // Verifying implies the institution tier; un-verifying drops it back to community
    // unless the caller says otherwise.
    const nextKind = kind ?? (verified ? 'institution' : 'community');
    if (!(ORG_KIND as readonly string[]).includes(nextKind)) throw new BusinessRuleError('Unknown organisation kind');

    const row = await prisma.organizations.update({
      where: { id: org.id },
      data: { verified, kind: nextKind },
    });

    await audit(prisma, req, {
      action: verified ? AUDIT_ACTIONS.orgVerified : AUDIT_ACTIONS.orgUnverified,
      target: { type: 'organizations', id: org.id, label: org.name },
      organizationId: org.id,
      summary: `${org.name} ${verified ? 'verified' : 'un-verified'} (${org.kind} → ${nextKind})`,
      diff: { kind: { from: org.kind, to: nextKind }, verified: { from: org.verified, to: verified } },
    });

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
    await createNotification(prisma, {
      organization_id: orgId,
      sender_id: userId,
      type: 'org_join_request',
      audience: 'org_admins',
      title: `${who} requested to join ${org.name}`,
      body: 'Review the request on your organization’s Members page.',
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
  //
  // The directory READ lives at `GET /organizations/:id/people`
  // (modules/people/people.routes.ts), which is module 04 §6's path and the only
  // one now. What used to sit here was a second listing of the same rows with
  // NO permission check at all - any authenticated user could read any
  // institution's full membership, names, emails and phone numbers included.
  // That is the cross-tenant class of hole J6-E5 closed for `GET /organizations`
  // and this one survived because it was a different route.
  //
  // The write routes below stay: they are already guarded by `orgAdmin`.

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

    const member = await prisma.organization_members.upsert({
      where: { user_id_organization_id: { user_id: resolvedUserId, organization_id: req.params.id } },
      update: { role, status: 'active' },
      create: { user_id: resolvedUserId, organization_id: req.params.id, role },
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberAdded,
      target: { type: 'organization_members', id: member.id, label: memberLabel(member) },
      organizationId: req.params.id,
      summary: `Added ${memberLabel(member)} as ${role}`,
      diff: { role: { from: null, to: role }, provisioned_login: { from: null, to: !!credentials } },
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
    for (const m of members) {
      await audit(prisma, req, {
        action: AUDIT_ACTIONS.memberAdded,
        target: { type: 'organization_members', id: m.id, label: memberLabel(m) },
        organizationId: orgId,
        summary: `Added ${memberLabel(m)} as ${role} (bulk)`,
        diff: { role: { from: null, to: role } },
      });
    }
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
    const updated = await prisma.organization_members.update({
      where: { id: member.id },
      data: req.body,
      include: { users: { select: { id: true, name: true, email: true, phone: true } } },
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberRoleChanged,
      target: { type: 'organization_members', id: member.id, label: memberLabel(updated) },
      organizationId: req.params.id,
      summary: `Changed ${memberLabel(updated)} from ${member.role}/${member.status} to ${updated.role}/${updated.status}`,
      diff: {
        role: { from: member.role, to: updated.role },
        status: { from: member.status, to: updated.status },
      },
    });
    res.json(updated);
  }));

  router.delete('/:id/members/:memberId', orgAdmin, asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
      select: { id: true, role: true },
    });
    if (member && ['owner', 'admin'].includes(member.role)) await assertNotLastAdmin(req.params.id, member.id);
    // Read the label before the row goes, or the entry can only name a uuid.
    const removed = member
      ? await prisma.organization_members.findUnique({ where: { id: member.id }, include: { users: { select: { name: true, email: true } } } })
      : null;
    await prisma.organization_members.deleteMany({ where: { id: req.params.memberId, organization_id: req.params.id } });
    if (removed) {
      await audit(prisma, req, {
        action: AUDIT_ACTIONS.memberRemoved,
        target: { type: 'organization_members', id: removed.id, label: memberLabel(removed) },
        organizationId: req.params.id,
        summary: `Removed ${memberLabel(removed)} from the organisation`,
        diff: { role: { from: removed.role, to: null }, status: { from: removed.status, to: null } },
      });
    }
    res.status(204).send();
  }));

  // ---- Invitations by email (J1-E3) ----
  // Inviting differs from approving a join request in one way that matters: the
  // inviter chooses the role, so this is how a coordinator gets approval rights
  // rather than arriving as a plain member.
  router.get('/:id/invitations', orgAdmin, asyncHandler(async (req, res) => {
    res.json(await listOrganizationInvitations(prisma, req.params.id));
  }));

  router.post('/:id/invitations', orgAdmin, validateBody(inviteOrgMemberSchema), asyncHandler(async (req, res) => {
    const { email, role } = req.body as { email: string; role: string };
    res.status(201).json(await inviteToOrganization(prisma, req, { organizationId: req.params.id, email, role }));
  }));

  router.delete('/:id/invitations/:invitationId', orgAdmin, asyncHandler(async (req, res) => {
    res.json(await revokeInvitation(prisma, req, req.params.id, req.params.invitationId));
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
    await createNotification(prisma, {
      target_user_id: member.user_id,
      sender_id: req.user!.id,
      type: 'org_join_approved',
      audience: 'all', // ignored for direct notifications - target_user_id drives visibility
      title: `You’ve been approved to join ${await orgName(req.params.id)}`,
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberApproved,
      target: { type: 'organization_members', id: member.id, label: memberLabel(updated) },
      organizationId: req.params.id,
      summary: `Approved ${memberLabel(updated)}'s request to join`,
      diff: { status: { from: member.status, to: 'active' } },
    });
    res.json(updated);
  }));

  router.post('/:id/members/:memberId/decline', orgAdmin, asyncHandler(async (req, res) => {
    const member = await prisma.organization_members.findFirst({
      where: { id: req.params.memberId, organization_id: req.params.id },
    });
    if (!member) throw new NotFoundError('Member');
    await prisma.organization_members.delete({ where: { id: member.id } });
    await createNotification(prisma, {
      target_user_id: member.user_id,
      sender_id: req.user!.id,
      type: 'org_join_declined',
      audience: 'all', // ignored for direct notifications - target_user_id drives visibility
      title: `Your request to join ${await orgName(req.params.id)} was declined`,
    });
    await audit(prisma, req, {
      action: AUDIT_ACTIONS.memberDeclined,
      target: { type: 'organization_members', id: member.id, label: member.user_id },
      organizationId: req.params.id,
      summary: 'Declined a request to join',
      diff: { status: { from: member.status, to: null } },
    });
    res.json({ ok: true });
  }));

  return router;
}
