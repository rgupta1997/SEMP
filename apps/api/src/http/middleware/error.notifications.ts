import type { PlanLimitError } from '@semp/entitlements/server';
import { notify } from '@semp/notifications/server/notify.js';
import type { Prisma as Db } from '../../infra/prisma.js';

// Best-effort and fire-and-forget: the HTTP response has already gone out by the
// time this runs (errorHandler is synchronous Express middleware, and the
// response must not wait on a notification), so a notify() failure is caught
// here rather than awaited. Only the org ladder sets ceilings today (see
// PlanLimitError.organizationId) - the personal ladder throws the same error
// type with no organizationId, and nobody is told.
export function notifyUsageLimitReached(prisma: Db, err: Pick<PlanLimitError, 'organizationId' | 'message'>): void {
  if (!err.organizationId) return;
  notify(prisma, {
    type: 'usage_limit_reached',
    organizationId: err.organizationId,
    senderId: null,
    data: { message: err.message },
  }).catch((e) => console.error('[billing] usage_limit_reached notification failed:', e));
}
