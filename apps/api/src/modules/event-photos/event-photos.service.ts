import type { EventPhoto } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';

export const PHOTO_SELECT = { id: true, url: true, caption: true, sort_order: true } as const;

/** One scope's carousel photos in show order: an event's own, or (null) the all-events set. */
export function listEventPhotos(prisma: Prisma, championshipId: string | null): Promise<EventPhoto[]> {
  return prisma.championship_photos.findMany({
    where: { championship_id: championshipId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: PHOTO_SELECT,
  });
}

/** What an event's public page shows: its own photos first, then the all-events ones. */
export async function listPublicPhotos(prisma: Prisma, championshipId: string): Promise<EventPhoto[]> {
  const [own, all] = await Promise.all([listEventPhotos(prisma, championshipId), listEventPhotos(prisma, null)]);
  return [...own.map((p) => ({ ...p, scope: 'event' as const })), ...all.map((p) => ({ ...p, scope: 'all' as const }))];
}

/**
 * For the public page: no photos rather than a broken page while migration 032 is unapplied.
 * Before 034 only event photos exist, so the all-events query simply finds none.
 */
export async function listPublicPhotosSafe(prisma: Prisma, championshipId: string): Promise<EventPhoto[]> {
  try {
    return await listPublicPhotos(prisma, championshipId);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2021') return [];
    throw err;
  }
}
