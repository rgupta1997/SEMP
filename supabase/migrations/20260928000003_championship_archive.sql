-- Archiving a championship instead of deleting it.
--
-- An event with results (completed, a played or locked match, or an issued
-- certificate) can no longer be deleted outright - its host archives it. Archived
-- events drop out of every list, sit in an "Archived" tab, and are permanently
-- deleted ARCHIVE_RETENTION_DAYS (90) after archived_at unless retrieved. Retrieving
-- clears archived_at, so archiving again restarts the count.

alter table championships add column if not exists archived_at timestamptz;
alter table championships add column if not exists archived_by uuid references users(id) on delete set null;

-- The purge sweep asks "which archived events are past their date", often.
create index if not exists idx_championships_archived on championships (archived_at) where archived_at is not null;
