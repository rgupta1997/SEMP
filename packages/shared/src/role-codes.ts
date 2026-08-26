// Championship role lookup by STABLE CODE, never by display name.
//
// Authorisation used to resolve these roles with `where: { name: 'Organiser' }`,
// and the roles table has an editing screen. Renaming that role therefore revoked
// every organiser's authority silently, with no error to trace back to the
// rename - the sharpest edge in the codebase, and the reason migration
// 20260815090000_role_codes.sql exists. `code` is not editable through any UI, so
// the same lookup cannot be broken by someone tidying up a label.
//
// This lives in @semp/shared rather than the API because the notification
// service resolves the same roles when it expands an audience rule. Two copies of
// an authorisation lookup is how one of them silently goes stale.

export const ROLE_CODES = {
  organiser: 'organiser',
  official: 'official',
  captain: 'captain',
  participant: 'participant',
  // The point of contact an institution nominates for an event. It exists as a
  // role row, the web nav has an entry for it, and the breakdown lists it beside
  // the other four - it was simply missing here, which left it the one event role
  // the server could not resolve by code.
  poc: 'poc',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

/**
 * The `where` that resolves a role code to exactly one platform role.
 *
 * Two things it deliberately does:
 *
 * `organization_id: null` - roles can now be owned by an organisation, and these
 * lookups mean the platform-wide sense of a code (the Organiser of a
 * championship). Resolving to one tenant's private copy would be arbitrary, and
 * would leak that tenant's role into another's authorisation.
 *
 * The `name` fallback - `code` is nullable: it was backfilled, and a role created
 * through the CRUD screen may not carry one. A role nobody has coded yet should
 * still resolve rather than silently granting nothing, which is the failure mode
 * this whole mechanism exists to prevent.
 */
export function roleWhereByCode(code: RoleCode): RoleWhere {
  const label = code.charAt(0).toUpperCase() + code.slice(1);
  return {
    organization_id: null,
    OR: [{ code }, { code: null, name: label }],
  };
}

/** The shape `roleWhereByCode` returns, so consumers can type their Prisma port. */
export interface RoleWhere {
  organization_id: null;
  OR: Array<{ code: string } | { code: null; name: string }>;
}
