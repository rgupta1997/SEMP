import { citiesLabel, normaliseCities } from '@semp/shared';
import type { Prisma } from '../../infra/prisma.js';

// A championship's host cities are DERIVED from its venues: the cities its venues are
// in, in the order the venues were added. Recomputed after every venue change, so the
// line under the title can never claim a city nothing is played in.

/** Recompute `host_cities` (and the joined `venue` text) from the championship's venues. */
export async function syncHostCities(prisma: Prisma, championshipId: string): Promise<void> {
  const venues = await prisma.venues.findMany({
    where: { championship_id: championshipId },
    orderBy: { created_at: 'asc' },
    select: { city: true },
  });
  const cities = normaliseCities(venues.map((v) => v.city ?? ''));
  // Venues exist but none names a city (older ones were added without one): nothing
  // to derive from, so keep what is there rather than wipe it.
  if (venues.length && !cities.length) return;
  await prisma.championships.update({
    where: { id: championshipId },
    data: { host_cities: cities, venue: cities.length ? citiesLabel(cities) : null },
  });
}

/**
 * Make the venues match a typed list of host cities (Create Event, and editing a draft
 * from the wizard): a placeholder venue for each new city, and an UNTOUCHED placeholder
 * removed for a city taken off the list. A venue anyone has worked on stays.
 */
export async function reconcileCityVenues(prisma: Prisma, championshipId: string, cities: string[]): Promise<void> {
  const venues = await prisma.venues.findMany({
    where: { championship_id: championshipId },
    select: { id: true, name: true, city: true, address: true, _count: { select: { venue_grounds: true } } },
  });
  const wanted = new Set(cities.map((c) => c.toLowerCase()));
  const have = new Set(venues.map((v) => (v.city ?? '').toLowerCase()));

  const fresh = cities.filter((c) => !have.has(c.toLowerCase()));
  if (fresh.length) {
    await prisma.venues.createMany({ data: fresh.map((c) => ({ championship_id: championshipId, name: c, city: c })) });
  }

  // Untouched = still named after its city, no address, no grounds.
  const dropped = venues.filter((v) => v.city && !wanted.has(v.city.toLowerCase())
    && v.name.toLowerCase() === v.city.toLowerCase() && !v.address && v._count.venue_grounds === 0);
  for (const v of dropped) {
    // A discipline may still point at it; then it stays, and so does its city.
    try { await prisma.venues.delete({ where: { id: v.id } }); } catch { /* in use - keep */ }
  }

  await syncHostCities(prisma, championshipId);
}
