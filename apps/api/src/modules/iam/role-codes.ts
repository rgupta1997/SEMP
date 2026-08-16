import type { Db } from '../../infra/prisma.js';

// Championship role lookup by STABLE CODE, never by display name.
//
// Authorisation used to resolve these roles with `where: { name: 'Organiser' }` in
// thirteen places - and the roles table has an editing screen. Renaming that role
// therefore revoked every organiser's authority silently, with no error to trace back
// to the rename. `code` is not editable through any UI, so the same lookup by code
// cannot be broken by someone tidying up a label (J6-E1-S6).

export const ROLE_CODES = {
  organiser: 'organiser',
  official: 'official',
  captain: 'captain',
  participant: 'participant',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

// `code` is nullable in the schema (backfilled, and a role added through the CRUD
// screen may not set one), so the name is kept as a fallback: a role nobody has given
// a code yet should still resolve rather than silently granting nothing.
export function roleWhereByCode(code: RoleCode) {
  const label = code.charAt(0).toUpperCase() + code.slice(1);
  // Platform rows only. Roles can now be owned by an institution, and these lookups
  // are for the platform-wide meaning of a code (the Organiser of a championship, say)
  // - resolving to one institution's private copy would be arbitrary.
  return { organization_id: null, OR: [{ code }, { code: null, name: label }] };
}

export async function roleIdByCode(db: Db, code: RoleCode): Promise<string | null> {
  const row = await db.roles.findFirst({ where: roleWhereByCode(code), select: { id: true } });
  return row?.id ?? null;
}
