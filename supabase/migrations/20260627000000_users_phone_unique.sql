-- ============================================================================
-- Enforce phone-number uniqueness at the database level
--   Matches the application-level logic in findUserByPhone: strip non-digits
--   and key on the last 10 so that "+91 98765 43210" and "9876543210" are
--   treated as the same number. Partial index (WHERE phone IS NOT NULL) lets
--   multiple rows have no phone without violating the constraint.
-- ============================================================================

create unique index if not exists users_phone_last10_key
  on users (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))
  where phone is not null;
