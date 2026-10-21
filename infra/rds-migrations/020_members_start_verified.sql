-- Current members are verified - the RDS twin of
-- supabase/migrations/20261021010000_members_start_verified.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-21.
--
-- Data only: current members still pending or rejected become verified. Join requests,
-- declined and removed people are untouched. Idempotent: matches nothing once run.

update organization_members
   set verification = 'verified',
       verified_at  = coalesce(verified_at, now()),
       rejection_note = null
 where status = 'active'
   and verification <> 'verified';
