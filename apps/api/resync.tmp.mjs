// One-off: re-derive every championship's host cities from its venues (same rules as
// host-cities.service.ts). DRY unless APPLY=1. Temporary; deleted after running.
import { PrismaClient } from '@prisma/client';

const norm = (list) => {
  const seen = new Set(); const out = [];
  for (const raw of list) {
    const c = (raw ?? '').replace(/\s+/g, ' ').trim(); const k = c.toLowerCase();
    if (!c || seen.has(k)) continue; seen.add(k); out.push(c);
  }
  return out;
};
const apply = process.env.APPLY === '1';
const p = new PrismaClient();
try {
  const champs = await p.championships.findMany({ select: { id: true, name: true, host_cities: true, venue: true } });
  for (const c of champs) {
    const venues = await p.venues.findMany({ where: { championship_id: c.id }, orderBy: { created_at: 'asc' }, select: { city: true } });
    const cities = norm(venues.map((v) => v.city));
    if (venues.length && !cities.length) { console.log(`SKIP  ${c.name} (venues have no city)`); continue; }
    const label = cities.length ? cities.join(', ') : null;
    const same = JSON.stringify(cities) === JSON.stringify(c.host_cities) && label === c.venue;
    console.log(`${same ? 'SAME ' : 'CHANGE'} ${c.name}: [${c.host_cities.join(', ')}] -> [${cities.join(', ')}]`);
    if (!same && apply) await p.championships.update({ where: { id: c.id }, data: { host_cities: cities, venue: label } });
  }
  console.log(apply ? 'APPLIED' : 'DRY RUN - nothing written');
} finally { await p.$disconnect(); }
