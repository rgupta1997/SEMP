-- Everyone the organisation has brought in is vouched for: a current member is verified.
-- Verification is pending only on a join request, and rejecting only declines one.
-- Existing current members still pending or rejected (from before that rule) are verified.
-- RDS twin: infra/rds-migrations/020_members_start_verified.sql.

update organization_members
   set verification = 'verified',
       verified_at  = coalesce(verified_at, now()),
       rejection_note = null
 where status = 'active'
   and verification <> 'verified';
