// Archiving an organisation: a freeze, not a countdown. It stays archived until its
// owner retrieves it - deleting it would take its issued certificates, its players'
// career stats and its rows in other hosts' events with it. Those rows keep its real
// name: they are other hosts' history, and they say what happened.

/**
 * How an organisation may be removed: `delete` only while it has no footprint in any
 * event and has issued nothing; `archive` otherwise.
 */
export type OrganizationRemovalMode = 'delete' | 'archive';

/** What any change inside an archived organisation is refused with - and the tooltip on its disabled controls. */
export const ORG_ARCHIVED_READ_ONLY_MESSAGE =
  'This organisation is archived, so it can’t be changed. Retrieve it first, from Administration → Organization Profile.';
