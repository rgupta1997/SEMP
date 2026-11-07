import type { EventPhoto } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';

export const PHOTO_SELECT = { id: true, url: true, caption: true, sort_order: true } as const;

/** An event's carousel photos in show order. */
export function listEventPhotos(prisma: Prisma, championshipId: string): Promise<EventPhoto[]> {
  return prisma.championship_photos.findMany({
    where: { championship_id: championshipId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: PHOTO_SELECT,
  });
}

/** For the public page: no photos rather than a broken page while migration 032 is unapplied. */
export async function listEventPhotosSafe(prisma: Prisma, championshipId: string): Promise<EventPhoto[]> {
  try {
    return await listEventPhotos(prisma, championshipId);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2021') return [];
    throw err;
  }
}
