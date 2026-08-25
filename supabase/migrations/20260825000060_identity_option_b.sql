-- ============================================================================
-- Identity, Option B: two accounts may share one phone number
--
-- One person holds a personal account and a business account with different
-- emails and the SAME phone. Phone becomes a login key; email stays the account
-- key. After an OTP verifies a number, the caller chooses which account to enter.
--
-- What this deliberately does NOT do:
--
--   * `phone` stays NULLABLE. Two existing rows have none, and a NOT NULL with a
--     made-up backfill would put a fake number into the login path. Signup
--     requires it; the two legacy rows are fixed by their owners.
--   * `organization_id` and `account_type` stay. The plan calls for dropping
--     both - they assume one org per human - but 54 rows use the first, 789 the
--     second, and nine code paths read them. They go when the context model
--     replaces them, not before, or this migration breaks a working product.
-- ============================================================================

-- ---- 1. Phone stops being unique -------------------------------------------
-- The old index keyed on the last ten digits so "+91 98765 43210" and
-- "9876543210" collided. That normalisation is still exactly what the OTP lookup
-- needs; only the uniqueness has to go. Same expression, plain index: every
-- sign-in now resolves a SET of accounts from one number.

drop index if exists users_phone_last10_key;

create index if not exists idx_users_phone_last10
  on users (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))
  where phone is not null;

-- ---- 2. The portable sporting identity --------------------------------------
-- EOS-8842190. Quoted on the profile and meant to outlive any single membership,
-- so it is issued once at signup and never reissued. Under Option B a person
-- with two accounts holds two - that is the accepted cost of the split, and the
-- reason to keep this column clean enough that a person-level rollup could sit
-- above it later.

alter table users add column if not exists sportagon_id varchar(20);

update users
set sportagon_id = 'EOS-' || lpad((1000000 + (abs(hashtext(id::text)) % 8999999))::text, 7, '0')
where sportagon_id is null;

create unique index if not exists uq_users_sportagon_id on users (sportagon_id);

-- ---- 3. Public profile handle ----------------------------------------------
-- The URL segment for a public profile. Nullable: a handle is only minted when
-- someone turns their public profile on, so an unclaimed bulk-upload row does
-- not silently reserve a name.

alter table users add column if not exists handle varchar(64);

create unique index if not exists uq_users_handle on users (lower(handle)) where handle is not null;

-- ---- 4. Does this person officiate? ----------------------------------------
-- Drives whether the Officiating nav item appears at all. A derived query would
-- have to scan assignments on every page render; this is set when someone is
-- first assigned as an official.

alter table users add column if not exists officiates boolean not null default false;

update users u set officiates = true
where exists (select 1 from championship_officials co where co.user_id = u.id and co.is_active);

-- ---- 5. OTP against a phone number ------------------------------------------
-- auth_tokens was built for email and has the right shape - kind, token_hash,
-- expires_at, attempts - but the wrong subject.
--
-- `user_id` stays NULL for a phone OTP, and that is the important part: the
-- token belongs to the NUMBER, not to an account. It only resolves to one after
-- the chooser. A token bound to a user up front would have had to pick an
-- account before the person did.

alter table auth_tokens add column if not exists phone varchar(20);
alter table auth_tokens add column if not exists resends smallint not null default 0;

create index if not exists idx_auth_tokens_phone
  on auth_tokens (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), kind)
  where phone is not null;

-- A token must identify its subject one way or the other.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'auth_tokens_subject_check') then
    alter table auth_tokens add constraint auth_tokens_subject_check
      check (email is not null or phone is not null);
  end if;
end $$;

comment on column users.sportagon_id is 'Portable sporting identity, issued once at signup. Never reissued.';
comment on column auth_tokens.phone is 'Set for phone OTP. user_id stays null: the token belongs to the number, not an account.';
