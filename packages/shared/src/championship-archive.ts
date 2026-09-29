// Archiving a championship: hidden, restorable, and permanently deleted once it has
// sat in the archive this long. Retrieving and re-archiving restarts the count.
export const ARCHIVE_RETENTION_DAYS = 90;

/** What any change to an archived event is refused with - on every route that refuses one. */
export const ARCHIVED_READ_ONLY_MESSAGE =
  'This championship is archived, so it can’t be changed. Retrieve it first - from its Settings or the Archived tab.';

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an event archived at `archivedAt` is permanently deleted. */
export function archivePurgeDate(archivedAt: Date | string): Date {
  return new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS);
}

/** Whole days left before that, never below zero. */
export function archiveDaysLeft(archivedAt: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((archivePurgeDate(archivedAt).getTime() - now.getTime()) / DAY_MS));
}

/**
 * How an event may be removed. `archive` once it has anything worth keeping - a
 * completed status, a played or locked match, or an issued certificate; `delete`
 * (permanent, immediate) only while it has none of those.
 */
export type ChampionshipRemovalMode = 'delete' | 'archive';
