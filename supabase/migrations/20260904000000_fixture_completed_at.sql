-- ============================================================================
-- When a scored fixture actually finished - for the 30-minute auto-lock
--
-- The organiser's Results screen has always had a manual "Lock" button, but
-- nothing made that happen on its own: a finished result with nobody around to
-- lock it just sat "awaiting official" indefinitely. This is the timestamp the
-- auto-lock sweep (fixtures/lock.service.ts, autoLockDueFixtures) reads to decide
-- what is due - a fixture whose result has sat unlocked for 30 minutes gets locked
-- automatically, exactly as if an organiser had pressed Lock.
--
-- STAMPED ON EVERY CONFIRMATION, NOT ONCE: the /result and /live routes set this
-- every time they write status = 'completed', so correcting a score restarts the
-- 30-minute grace period rather than letting a stale value fire mid-edit. It is
-- cleared (set back to null) whenever status moves away from 'completed' for the
-- same reason - a fixture that is no longer finished has nothing due to lock.
--
-- NULLABLE: only 'completed' fixtures ever have a value; scheduled/live ones, and
-- walkover/bye (already immediately lockable with no grace period) never do.
-- ============================================================================

alter table fixtures add column if not exists completed_at timestamptz;

comment on column fixtures.completed_at is
  'Stamped when status becomes ''completed'' (cleared if it moves away). Drives the 30-minute auto-lock sweep in fixtures/lock.service.ts.';

-- Partial index: the sweep only ever looks at unlocked fixtures with a completion
-- stamp, which is a small slice of the table - locked and never-completed fixtures
-- (the overwhelming majority) never enter this index at all.
create index if not exists idx_fixtures_autolock_due
  on fixtures (completed_at)
  where completed_at is not null and scorecard_status <> 'locked';
