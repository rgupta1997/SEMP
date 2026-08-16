import type { Request } from 'express';
import type { Prisma } from '../../infra/prisma.js';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { audit, AUDIT_ACTIONS } from '../iam/audit.service.js';
import { createNotification } from '../notifications/audience.js';

// Deciding a registration (J2-E2-S2). One decision is a unit of work made of four
// parts - the stamped transition, the audit line, the applicant being told, and the
// championship-wide announcement on an approval - and the single-row route and the
// bulk route both run it from here so the two can never drift apart.

export type EnrollmentDecision = 'approved' | 'rejected';

export interface EnrollmentReview {
  status: EnrollmentDecision;
  rejection_note?: string | null;
}

// A bulk selection can span more than one championship, so authority is checked per
// enrolment instead of once at the route. The single-row route already passed its
// middleware guard and passes nothing here.
export type AuthorizeChampionship = (championshipId: string) => Promise<boolean>;

export interface EnrollmentReviewResult {
  enrollment_id: string;
  ok: boolean;
  error?: string;
}

// A decline with no stated reason is precisely the one an applicant cannot act on -
// they cannot fix what they were never told. Long enough that "no" doesn't qualify,
// matching the correction reason on a scorecard unlock.
function requiredNote(review: EnrollmentReview): string | null {
  if (review.status !== 'rejected') return null;
  const note = review.rejection_note?.trim() ?? '';
  if (note.length < 5) {
    throw new BusinessRuleError('Give the applicant a reason for the rejection - it is shown to them.');
  }
  return note;
}

export async function reviewEnrollment(
  prisma: Prisma,
  req: Request,
  enrollmentId: string,
  review: EnrollmentReview,
  authorize?: AuthorizeChampionship,
) {
  const note = requiredNote(review);

  // The audit entry and the notifications are deliberately outside the transaction:
  // an audit line describing a rolled-back decision would be a lie, and a message to
  // an applicant cannot be un-sent.
  const { row, previous, orgName, orgShortName, championshipName } = await prisma.$transaction(async (tx) => {
    const existing = await tx.championship_organizations.findUnique({
      where: { id: enrollmentId },
      include: { organizations: { select: { name: true, short_name: true } }, championships: { select: { name: true } } },
    });
    if (!existing) throw new NotFoundError('Enrollment');
    if (authorize && !(await authorize(existing.championship_id))) {
      throw new ForbiddenError('You do not manage this championship');
    }

    const updated = await tx.championship_organizations.update({
      where: { id: enrollmentId },
      data: {
        status: review.status,
        rejection_note: note,
        reviewed_by: req.user!.id,
        reviewed_at: new Date(),
      },
    });

    return {
      row: updated,
      previous: existing.status,
      orgName: existing.organizations?.name ?? null,
      orgShortName: existing.organizations?.short_name ?? null,
      championshipName: existing.championships?.name ?? null,
    };
  });

  const approved = review.status === 'approved';
  const displayName = orgShortName || orgName || 'An organization';

  await audit(prisma, req, {
    action: approved ? AUDIT_ACTIONS.registrationApproved : AUDIT_ACTIONS.registrationRejected,
    target: {
      type: 'championship_organizations', id: row.id,
      label: `${orgName ?? 'An organisation'} in ${championshipName ?? 'a championship'}`,
    },
    organizationId: row.organization_id,
    championshipId: row.championship_id,
    summary: `${approved ? 'Approved' : 'Rejected'} ${orgName ?? 'an organisation'}'s registration`,
    diff: {
      status: { from: previous, to: row.status },
      ...(row.rejection_note ? { rejection_note: { from: null, to: row.rejection_note } } : {}),
    },
  });

  // Re-deciding something already in this state stamps a fresh reviewer but is not
  // news - announcing it again would tell an applicant twice that they got in.
  if (previous !== review.status) {
    // The applicant. Addressed to the org rather than to whoever happened to click
    // Apply: the person who applied may have left, and a rejected org has no other
    // route back into the championship's own feed.
    await createNotification(prisma, {
      championship_id: row.championship_id,
      organization_id: row.organization_id,
      sender_id: req.user!.id,
      // A decline is its own kind of news - it used to borrow the neutral lifecycle
      // type, so the message that matters most to an applicant arrived labelled
      // "Championship update".
      type: approved ? 'enrollment_approved' : 'enrollment_rejected',
      audience: 'org_admins',
      title: approved
        ? `You're in: ${championshipName ?? 'the championship'}`
        : `Registration declined: ${championshipName ?? 'the championship'}`,
      body: approved
        ? `${orgName ?? 'Your organization'} has been approved to participate. You can now enter teams.`
        : `The organiser declined ${orgName ?? 'your'} registration — "${row.rejection_note}"`,
    });

    // Everyone else only hears about arrivals; a decline is the applicant's business.
    if (approved) {
      await createNotification(prisma, {
        championship_id: row.championship_id,
        sender_id: req.user!.id,
        // The same event, told to two different audiences: the applicant gets
        // enrollment_approved above ("you're in"), everyone else gets this - which is
        // news about a third party and must not read as their own approval.
        type: 'enrollment_joined',
        audience: 'all',
        title: `${displayName} has joined the championship`,
        body: `${orgName ?? displayName} has been approved to participate${championshipName ? ` in ${championshipName}` : ''}.`,
      });
    }
  }

  return row;
}

// Partial success is the correct outcome: one enrolment that cannot be decided must
// not cost the organiser the other forty-nine. Each decision is its own transaction,
// looped here - a single transaction spanning the batch would hold a pooled
// connection well past the 15s Lambda ceiling and roll back good work on one bad row.
export async function reviewEnrollmentsBulk(
  prisma: Prisma,
  req: Request,
  enrollmentIds: string[],
  review: EnrollmentReview,
  authorize?: AuthorizeChampionship,
): Promise<EnrollmentReviewResult[]> {
  // Fail the whole batch on a missing note rather than reporting fifty identical
  // per-item errors - it is a mistake in the request, not in any one enrolment.
  requiredNote(review);

  const results: EnrollmentReviewResult[] = [];
  for (const id of [...new Set(enrollmentIds)]) {
    try {
      await reviewEnrollment(prisma, req, id, review, authorize);
      results.push({ enrollment_id: id, ok: true });
    } catch (err: any) {
      results.push({ enrollment_id: id, ok: false, error: err?.message ?? 'Could not decide this registration' });
    }
  }
  return results;
}

// Wraps a guard check so a batch spanning one championship costs one lookup rather
// than one per enrolment - the difference between a fast batch and a timed-out one.
export function memoizedAuthorizer(check: AuthorizeChampionship): AuthorizeChampionship {
  const seen = new Map<string, Promise<boolean>>();
  return (championshipId: string) => {
    let answer = seen.get(championshipId);
    if (!answer) { answer = check(championshipId); seen.set(championshipId, answer); }
    return answer;
  };
}
