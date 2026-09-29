import { orgIdPrefix } from '@semp/shared';
import type { Db } from '../../infra/prisma.js';

/** The letters this organisation stamps on accounts it creates (EOS-AEO0001 for "Aman enterprise org"). */
export async function orgIdPrefixFor(db: Db, organizationId: string): Promise<string> {
  const org = await db.organizations.findUnique({ where: { id: organizationId }, select: { name: true } });
  return orgIdPrefix(org?.name);
}

/**
 * `count` unused Sportagon IDs for one prefix, in one round trip - see
 * next_sportagon_ids() in 20260928000000_sportagon_id_prefixes.sql.
 */
export async function mintSportagonIds(db: Db, prefix: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const [row] = await db.$queryRaw<Array<{ ids: string[] }>>`select next_sportagon_ids(${prefix}, ${count}::int) as ids`;
  return row.ids;
}
