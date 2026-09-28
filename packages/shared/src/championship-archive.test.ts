import { describe, expect, it } from 'vitest';
import { ARCHIVE_RETENTION_DAYS, archiveDaysLeft, archivePurgeDate } from './championship-archive.js';

describe('championship archive dates', () => {
  const archived = new Date('2026-09-28T10:00:00Z');

  it('purges the retention period after archiving', () => {
    expect(ARCHIVE_RETENTION_DAYS).toBe(90);
    expect(archivePurgeDate(archived).toISOString()).toBe('2026-12-27T10:00:00.000Z');
  });

  it('counts the days left, never below zero', () => {
    expect(archiveDaysLeft(archived, archived)).toBe(90);
    expect(archiveDaysLeft(archived, new Date('2026-12-26T10:00:00Z'))).toBe(1);
    expect(archiveDaysLeft(archived, new Date('2027-02-01T00:00:00Z'))).toBe(0);
  });
});
