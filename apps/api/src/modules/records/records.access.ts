import type { Db } from '../../infra/prisma.js';
import { ForbiddenError } from '../../shared/errors.js';
import { can } from '../../http/middleware/can.js';

// Who may read someone else's permanent record (J4-E2-S4).
//
// FR-PPL-5 says a coordinator can open "a player's" profile. Read literally that
// is every player on the platform - which is a privacy incident with a
// requirement number, not a feature. The boundary is:
//
//   self            → always
//   super admin     → always
//   everyone else   → must share an ACTIVE institution with the subject,
//                     AND hold `people.view` in one of the institutions shared
//
// The two conditions are checked in that order and separately, which is the part
// that matters. Sharing an institution is a fact about the subject that no
// amount of role configuration inside a DIFFERENT institution can manufacture,
// so a generous `people.view` grant can never reach across the tenant boundary.
// Collapsing them into one permission check would make it able to.

export interface RecordViewer {
  id: string;
  isSuperAdmin?: boolean;
}

export interface RecordAccess {
  /** Institutions the viewer and the subject both actively belong to. */
  sharedOrgIds: string[];
  isSelf: boolean;
}

export async function activeOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.organization_members.findMany({
    where: { user_id: userId, status: 'active' },
    select: { organization_id: true },
  });
  return [...new Set(rows.map((r) => r.organization_id))];
}

/** Throws `ForbiddenError` unless this viewer may read this person's record. */
export async function authorizeRecordView(db: Db, viewer: RecordViewer, subjectId: string): Promise<RecordAccess> {
  if (viewer.id === subjectId) return { sharedOrgIds: await activeOrgIds(db, subjectId), isSelf: true };

  const [viewerOrgs, subjectOrgs] = await Promise.all([
    activeOrgIds(db, viewer.id),
    activeOrgIds(db, subjectId),
  ]);
  const sharedOrgIds = viewerOrgs.filter((id) => subjectOrgs.includes(id));

  if (viewer.isSuperAdmin) return { sharedOrgIds, isSelf: false };

  if (sharedOrgIds.length === 0) {
    throw new ForbiddenError('You can only open the record of someone in an institution you belong to.');
  }

  for (const organizationId of sharedOrgIds) {
    if (await can(db, 'people.view', { user: { id: viewer.id }, scope: { organizationId } })) {
      return { sharedOrgIds, isSelf: false };
    }
  }
  throw new ForbiddenError('You do not have permission to view people in this institution.');
}
