import type { Prisma } from '../../infra/prisma.js';
import { visibilityWhere, type EventScopes } from './audience.js';

// Upserts the per-user "last seen" watermark used to compute the unread
// badge count cheaply (see getUnreadCountByCursor below). Called when the
// bell/drawer opens - kept separate from read-all, which still tracks
// per-item read state via notification_reads. The two are different jobs:
// notification_reads powers per-item state in the feed list, this cursor
// powers the badge count only.
export function markSeen(prisma: Prisma, userId: string) {
  const now = new Date();

  return prisma.notification_cursors.upsert({
    where: { user_id: userId },
    update: { last_seen_at: now, updated_at: now },
    create: { user_id: userId, last_seen_at: now },
  });
}

// Unread count. notification_deliveries encodes "who should receive this" AT
// WRITE TIME (notify()'s fan-out via resolveUserIds) - but audience membership
// can change AFTER a notification is created (e.g. a "registration is open"
// announcement fires when nobody's enrolled yet, then an org enrolls
// afterward). GET /notifications already re-evaluates visibility live via
// visibilityWhere() for exactly this reason - the feed shows such a
// notification correctly the moment the org's scope changes, even with no
// delivery row.
//
// The cursor timestamp is only a valid "have I seen this" proxy for
// notifications the user was ALWAYS eligible for - if a delivery row exists,
// they could have seen it any time after it was created, so "created after my
// last visit" correctly means "unread". It is NOT a valid proxy for a
// notification that just became visible via a live scope change: the user
// could not possibly have seen it before becoming eligible, no matter how old
// it is, so gating that branch on `created_at > cursor` too (as an earlier
// version of this function did) silently excludes exactly the notifications
// this function exists to catch, whenever they predate the user's last
// cursor update (as almost any pre-existing announcement will, for someone
// who's used the app before). For that branch, this instead mirrors the
// feed's own definition of "unread": no notification_reads row for this user.
export async function getUnreadCountByCursor(
  prisma: Prisma,
  userId: string,
  scopes: EventScopes,
): Promise<number> {
  const cursor = await prisma.notification_cursors.findUnique({
    where: { user_id: userId },
    select: { last_seen_at: true },
  });

  // Defensive fallback for a user with no cursor row yet (shouldn't happen
  // post-backfill, but comparing against NULL in SQL would otherwise return
  // 0 instead of "everything is unread").
  const since = cursor?.last_seen_at ?? new Date(0);

  if (scopes.isSuper) {
    return prisma.notifications.count({ where: { created_at: { gt: since } } });
  }

  const visible = visibilityWhere(scopes);
  return prisma.notifications.count({
    where: {
      OR: [
        // Delivered to me at write time - cursor timestamp is a faithful
        // "unread since" signal here, since I was always eligible for it.
        { created_at: { gt: since }, notification_deliveries: { some: { user_id: userId } } },
        // Visible to me NOW via a live scope match that may not have existed
        // when this was created - correctness has to come from per-item read
        // state (same as the feed), not a timestamp that predates my eligibility.
        {
          AND: [
            { OR: Array.isArray(visible.OR) ? visible.OR : [] },
            { notification_reads: { none: { user_id: userId } } },
          ],
        },
      ],
    },
  });
}