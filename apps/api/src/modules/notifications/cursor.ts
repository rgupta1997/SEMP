import type { Prisma } from '../../infra/prisma.js';

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

// Cheap unread count. notification_deliveries already encodes "who should
// receive this" at write time (notify()'s fan-out via resolveUserIds), so
// this is a plain indexed range scan against a per-user table - no
// visibility recomputation via visibilityWhere(), no anti-join against
// notification_reads.
export async function getUnreadCountByCursor(
  prisma: Prisma,
  userId: string,
): Promise<number> {
  const cursor = await prisma.notification_cursors.findUnique({
    where: { user_id: userId },
    select: { last_seen_at: true },
  });

  // Defensive fallback for a user with no cursor row yet (shouldn't happen
  // post-backfill, but comparing against NULL in SQL would otherwise return
  // 0 instead of "everything is unread").
  const since = cursor?.last_seen_at ?? new Date(0);

  return prisma.notification_deliveries.count({
    where: {
      user_id: userId,
      created_at: { gt: since },
    },
  });
}