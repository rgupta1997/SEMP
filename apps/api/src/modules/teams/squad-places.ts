import { Prisma as PrismaNS } from '@prisma/client';
import type { Db } from '../../infra/prisma.js';

/**
 * Raw-SQL test: was this squad place held for this event? Still on the squad, left on
 * or after the event started, or left before leave dates were recorded (unknown, so
 * counted as it always was). Someone dropped before the event is not its participant.
 * Needs `tm` = team_members and `c` = championships in the query.
 */
export const HELD_FOR_EVENT = PrismaNS.sql`(tm.is_active or tm.left_at is null or tm.left_at >= coalesce(c.start_date::timestamptz, '-infinity'::timestamptz))`;

// A squad place is never deleted when someone leaves it: it is marked inactive with the
// date they left, so their history can tell their matches from the team's later ones.
// One row per person per team, so coming back reactivates that row rather than adding one.

/** Take these people off this squad (or off every squad in `where`), dated now. */
export function leaveSquadsWhere(db: Db, where: { team_id?: string | { in: string[] }; user_id?: string | { in: string[] }; teams?: object }) {
  return db.team_members.updateMany({
    where: { ...where, is_active: true },
    data: { is_active: false, left_at: new Date() },
  });
}

/**
 * Put someone on a squad: a new row, or their old one made active again.
 * `joined_at` is kept from the first time - one row holds one stint, so the earlier
 * matches stay theirs.
 */
export function joinSquad(db: Db, data: { team_id: string; user_id: string; role: string; jersey_number?: number | null }) {
  return db.team_members.upsert({
    where: { team_id_user_id: { team_id: data.team_id, user_id: data.user_id } },
    update: { is_active: true, left_at: null, role: data.role, jersey_number: data.jersey_number ?? null },
    create: { team_id: data.team_id, user_id: data.user_id, role: data.role, jersey_number: data.jersey_number ?? null },
  });
}
