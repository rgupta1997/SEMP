import type { EnrollmentStatus, InvitationStatus } from '@semp/shared';

// Named, importable values for the two status vocabularies InvitePanel and
// ApplicationsQueue compare against - so a call site reads `APPLICATION_STATUS.APPROVED`
// instead of the bare string 'approved', and a typo becomes a missing-property error
// instead of a filter that silently never matches.
//
// `satisfies Record<string, ...Status>` ties each object back to the shared enum in
// packages/shared/src/enums.ts (itself mirroring the DB check constraints), so this
// file cannot drift from what the database actually accepts.

/** An application's own status (championship_organizations.status). */
export const APPLICATION_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const satisfies Record<string, EnrollmentStatus>;

/** A host-sent invitation's own status (championship_invitations.status) - a
 *  different vocabulary from APPLICATION_STATUS even though both collapse to the
 *  same three UI buckets below. */
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, InvitationStatus>;

/** The three tabs InvitePanel and ApplicationsQueue share, plus 'all'. Both an
 *  application and an invitation get mapped down into one of these three. */
export const INVITE_BUCKET = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type InviteBucket = (typeof INVITE_BUCKET)[keyof typeof INVITE_BUCKET];
export type InviteFilter = InviteBucket | 'all';
export const INVITE_FILTER_OPTIONS = [INVITE_BUCKET.PENDING, INVITE_BUCKET.APPROVED, INVITE_BUCKET.REJECTED, 'all'] as const satisfies readonly InviteFilter[];

/** An invitation's status, read as the same three-bucket vocabulary an
 *  application uses - the mapping InvitePanel's `inviteBucket` used to hardcode. */
export const invitationBucket = (status: string): InviteBucket =>
  status === INVITATION_STATUS.ACCEPTED ? INVITE_BUCKET.APPROVED
    : status === INVITATION_STATUS.PENDING ? INVITE_BUCKET.PENDING
      : INVITE_BUCKET.REJECTED;
