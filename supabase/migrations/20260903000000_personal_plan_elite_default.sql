-- ============================================================================
-- Personal plan defaults to Elite (max) for everyone, for now
--
-- Product decision: personal plans are not charged for at this stage, so
-- nobody should land on Free and see a paywall for something the product does
-- not actually intend to sell yet. Every existing account is moved to the top
-- of the personal ladder, and new accounts default there too - the org ladder
-- (`organizations.plan`) is untouched, since institutions ARE charged.
--
-- No `subscriptions` row is created for this: the periodic renewal sweep in
-- subscription.service.ts only ever acts on rows that already exist in
-- `subscriptions` (it queries `where current_period_end <= now`), so an
-- account with none is never touched by it and cannot be swept back to Free.
-- If personal plans are later sold for real, existing Elite holders should be
-- migrated onto a proper subscription row at that point rather than relying
-- on this default.
-- ============================================================================

alter table users alter column personal_plan set default 'max';

update users set personal_plan = 'max' where personal_plan <> 'max';
