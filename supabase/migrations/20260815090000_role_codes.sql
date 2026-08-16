-- ============================================================================
-- J6-E1-S6 · Role names stop being load-bearing
--
-- Authorisation currently resolves roles by their DISPLAY NAME - `where: { name:
-- 'Organiser' }` - in thirteen places across the API. The roles table has a CRUD
-- screen. So renaming "Organiser" to "Event Lead" in that screen silently revokes
-- every organiser's authority across the product, with no error and no audit trail
-- pointing at the cause. It is the sharpest edge in the codebase.
--
-- `code` is the fix: a stable identifier authorisation resolves by, which the UI
-- never edits. `name` becomes what it always should have been - a label.
--
-- Backfilled from the current names, so nothing changes behaviour on the way in.
-- ============================================================================

alter table roles
  add column if not exists code varchar;

-- Existing rows keep working: derive the code from today's name (lower snake case),
-- which is exactly what the lookups will now ask for.
update roles
set code = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'))
where code is null;

-- Two roles cannot share a code, or a lookup becomes ambiguous in the one place
-- ambiguity is least acceptable.
create unique index if not exists uq_roles_code on roles (lower(code)) where code is not null;
