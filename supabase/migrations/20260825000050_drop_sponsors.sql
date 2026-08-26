-- ============================================================================
-- Drop `sponsors`
--
-- Absent from all eight sheets of Product Breakdown v1.0 and from all 51 screens
-- of the prototype. Zero rows on this database, and its only surfaces were a
-- generic CRUD mount and a row in the web app's resource registry - no dedicated
-- UI, no reads from any feature.
--
-- Code first, table second: the five references were removed and the API and web
-- workspaces type-checked clean before this migration was written. A table
-- dropped while something still names it fails at runtime, not at build.
--
-- Reversible: the table was empty, so restoring it means re-creating the shape
-- from 20260605000000_initial_schema.sql. Nothing is lost that existed.
-- ============================================================================

drop table if exists sponsors;
