-- ============================================================================
-- J6-E1 · Roles grant permissions by CODE, not by row id
--
-- `roles.permission_ids` is a uuid[] pointing at `permissions` rows. That looks like
-- the relational choice, but it repeats the mistake J6-E1-S6 just fixed for role
-- names one level down: a surrogate id is not stable. Re-seeding the catalogue, or
-- restoring it into a fresh environment, mints new uuids - and every grant silently
-- becomes a dangling reference that resolves to nothing. No error, no audit line, just
-- an organiser who can no longer do their job.
--
-- A permission CODE ('fixture.lock') is owned by the codebase, is identical in every
-- environment, and reads correctly in a database dump. So the column becomes text[]
-- and holds codes.
--
-- The existing values are cast rather than dropped. They are the placeholder uuids the
-- old JSON-textarea screen wrote, they point at rows named P1-P4, and nothing has ever
-- read this column - but deleting data on the way past is not this migration's job.
-- They survive as inert text and are cleared the first time each role is saved.
-- ============================================================================

alter table roles
  alter column permission_ids drop default;

alter table roles
  alter column permission_ids type text[] using permission_ids::text[];

alter table roles
  alter column permission_ids set default '{}'::text[];
