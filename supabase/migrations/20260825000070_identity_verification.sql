-- ============================================================================
-- Signup verifies BOTH email and phone; a token may be keyed to either
--
-- The auth model, as specified:
--
--   Sign in   phone + OTP, phone + password, or email + password.
--   Sign up   email, phone, name and password - all four required.
--   Verify    both the email and the phone, independently.
--   Option B  phone1+email1 existing does not block phone1+email2 signing up.
--
-- Two consequences for the schema.
-- ============================================================================

-- ---- 1. auth_tokens.email becomes nullable ---------------------------------
-- A phone OTP has no email. The column was NOT NULL from the initial schema,
-- which is why 20260825000060's "email is not null or phone is not null" check
-- could never actually be satisfied by a phone-only row - the NOT NULL fired
-- first. The check constraint is the real rule; the NOT NULL was the old,
-- narrower version of it.

alter table auth_tokens alter column email drop not null;

-- ---- 2. Independent verification stamps -------------------------------------
-- Two addresses, two proofs, two timestamps. Not one `verified` boolean: a
-- person can verify their phone and abandon the email, and the product has to
-- know which of the two it is still waiting on rather than treating the account
-- as wholly unverified.
--
-- Nullable and unset by default. Every existing row is therefore unverified,
-- which is the honest answer - none of them ever proved either address, because
-- until now nothing asked.

alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists phone_verified_at timestamptz;

create index if not exists idx_users_unverified
  on users (created_at desc)
  where email_verified_at is null or phone_verified_at is null;

comment on column users.email_verified_at is
  'Set when this address was proved by code. Independent of phone_verified_at.';
comment on column users.phone_verified_at is
  'Set when this number was proved by OTP. The number may be shared with another account (Option B).';

-- Note for whoever implements sign-in: phone + password is ambiguous in exactly
-- the way phone + OTP is, because a phone resolves to a SET of accounts. The
-- password disambiguates only when the two accounts have different passwords -
-- so the chooser has to be reachable from the password path too, not just OTP.
