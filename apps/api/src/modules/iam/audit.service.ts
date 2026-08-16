import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';

// The immutable record of privileged actions (FR-ADM-2, J6-E3).
//
// Three rules this module exists to keep:
//
//   1. **Explicit calls, never middleware auto-capture.** Auto-capture produces
//      thousands of `PATCH /fixtures/x 200` rows and none of the semantics that make
//      a timeline readable. The list of actions worth narrating is short and curated
//      - see AUDIT_ACTIONS below.
//   2. **Labels are denormalised at write time.** A line must still read sensibly
//      after the person in it is deleted, which is also what lets right-to-erase
//      coexist with an append-only trail.
//   3. **Writes never throw.** An audit failure must not fail the action it
//      describes; it is logged loudly instead.
//
// Append-only is enforced by the database (a trigger on audit_log rejects UPDATE and
// DELETE), not by the absence of a route - see the migration.

export interface AuditTarget {
  type: string;                 // 'organizations', 'fixtures', 'championship_organizations', …
  id?: string | null;
  label?: string | null;        // "IIMB vs IIMA, Football SF" - captured now, not resolved later
}

export interface AuditEntry {
  action: string;               // dotted verb from AUDIT_ACTIONS
  target: AuditTarget;
  organizationId?: string | null;
  championshipId?: string | null;
  summary?: string | null;      // the sentence the timeline renders
  diff?: Record<string, { from: unknown; to: unknown }> | null;
  // Overrides the caller as the actor. Needed where the action creates the very
  // session it belongs to - sign-in by one-time code has no req.user yet.
  actorUserId?: string | null;
}

// The curated coverage list for v1 (module 03 §4.5). Actions whose routes don't exist
// yet - the scorecard lock, certificates, achievement claims - are listed so the
// vocabulary is agreed before those waves land, and so a grep for an action name
// finds its intended spelling rather than inventing a second one.
export const AUDIT_ACTIONS = {
  orgCreated: 'org.created',
  orgVerified: 'org.verified',
  orgUnverified: 'org.unverified',
  orgDeleted: 'org.deleted',
  orgSettingsChanged: 'org.settings.changed',
  orgUnitCreated: 'org.unit.created',
  orgUnitUpdated: 'org.unit.updated',
  orgUnitDeleted: 'org.unit.deleted',
  orgDomainCreated: 'org_domain.created',
  orgDomainUpdated: 'org_domain.updated',
  orgDomainDeleted: 'org_domain.deleted',
  memberAdded: 'org.member.added',
  memberRoleChanged: 'org.member.role_changed',
  memberRemoved: 'org.member.removed',
  memberApproved: 'org.member.approved',
  memberDeclined: 'org.member.declined',
  memberDomainJoined: 'org.member.domain_joined',
  memberInvited: 'org.member.invited',
  memberInviteAccepted: 'org.member.invite_accepted',
  memberInviteRevoked: 'org.member.invite_revoked',
  authSignupVerified: 'auth.signup_verified',
  passwordReset: 'auth.password_reset',
  teamCreated: 'team.created',
  teamUpdated: 'team.updated',
  teamDeleted: 'team.deleted',
  championshipCreated: 'championship.created',
  championshipStatusChanged: 'championship.status_changed',
  championshipDeleted: 'championship.deleted',
  fixtureSubmitted: 'fixture.submitted',
  fixtureRetracted: 'fixture.retracted',
  fixtureLocked: 'fixture.locked',
  fixtureUnlocked: 'fixture.unlocked',
  roleAssigned: 'role.assigned',
  roleRevoked: 'role.revoked',
  rolePermissionsChanged: 'permission.role_changed',
  registrationApproved: 'registration.approved',
  registrationRejected: 'registration.rejected',
} as const;

// "Akash Menon (akash@iimb.ac.in)". One indexed lookup per privileged action, which
// is affordable precisely because privileged actions are rare - and it is the last
// moment this name is guaranteed to exist.
async function labelForActor(prisma: Prisma, userId: string | null, fallbackEmail?: string | null) {
  if (!userId) return null;
  try {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (u) return `${u.name} (${u.email})`;
  } catch { /* fall through to whatever the token carried */ }
  return fallbackEmail ?? null;
}

async function write(prisma: Prisma, row: {
  actor_user_id: string | null; actor_label: string | null; ip: string | null; entry: AuditEntry;
}): Promise<void> {
  const { entry } = row;
  try {
    await prisma.audit_log.create({
      data: {
        actor_user_id: row.actor_user_id,
        actor_label: row.actor_label,
        organization_id: entry.organizationId ?? null,
        championship_id: entry.championshipId ?? null,
        action: entry.action,
        target_type: entry.target.type,
        target_id: entry.target.id ?? null,
        target_label: entry.target.label ?? null,
        summary: entry.summary ?? null,
        diff: (entry.diff ?? undefined) as any,
        ip: row.ip,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record', entry.action, err);
  }
}

// Records an action taken by the authenticated caller.
export async function audit(prisma: Prisma, req: Request, entry: AuditEntry): Promise<void> {
  const actorId = entry.actorUserId ?? req.user?.id ?? null;
  const actorLabel = await labelForActor(prisma, actorId, actorId === req.user?.id ? req.user?.email : null);
  // req.ip can be an IPv6-mapped IPv4 ("::ffff:127.0.0.1"); inet accepts it as-is.
  await write(prisma, { actor_user_id: actorId, actor_label: actorLabel, ip: req.ip ?? null, entry });
}

// Records an action the product took on its own behalf - a scheduled job, a cascade,
// anything with no human behind it. Shows as "System" in the timeline.
export async function auditSystem(prisma: Prisma, entry: AuditEntry): Promise<void> {
  await write(prisma, { actor_user_id: null, actor_label: null, ip: null, entry });
}
