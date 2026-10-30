import { isEventWideCategory, type RecipientCategory } from '@semp/shared';
import { ForbiddenError } from '../../shared/errors.js';

/** Who is issuing: the institution's own issuer, or an event organiser ('all' or their sports). */
export type IssueAccess = 'issuer' | 'all' | string[];

/** A sport organiser issues one of their own sports, in a category that has a sport. */
export function assertSportIssue(access: IssueAccess, category: RecipientCategory, sportId?: string | null): void {
  if (!Array.isArray(access)) return;
  if (isEventWideCategory(category)) throw new ForbiddenError('Organising team and officials certificates are issued by the overall organiser.');
  if (!sportId || !access.includes(sportId)) throw new ForbiddenError('Pick one of the sports you organise.');
}
