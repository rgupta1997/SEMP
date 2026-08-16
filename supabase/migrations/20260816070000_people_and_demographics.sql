-- ============================================================================
-- J1-E5 · The student roll — people attributes, demographics and consent
--
-- Two tables gain columns, and WHICH table each lands on is the decision that
-- matters (module 04 §4.1):
--
--   organization_members  ← programme/batch placement, member code, verification
--   users                 ← date of birth, gender, consent, erasure tombstone
--
-- Verification is per-INSTITUTION, not per-person: the same account can be a
-- verified student of one institution and an unverified guest of another, and
-- putting `verification` on `users` would make one institution's judgement bind
-- everybody else's. Date of birth and gender are the opposite - they are facts
-- about the person, identical in every institution, so duplicating them per
-- membership would just create rows that disagree.
--
-- `scholarship` is the exception that proves the rule: it is an institution's own
-- classification of its own student, so it lives on the membership.
--
-- DEMOGRAPHICS ARE COLLECTED UNDER A RECORDED CONSENT VERSION. `consent_version`
-- + `consent_at` are stamped on the person when the data is taken, so an
-- institution can answer "under what terms was this collected?" years later
-- without reconstructing it from deploy history.
--
-- 'prefer_not_to_say' IS A REAL VALUE, not a null (J1-E5-S4). Non-disclosure has
-- to be reportable as its own category - collapsing it into null makes the
-- diversity report silently exclude exactly the people whose exclusion it is
-- supposed to measure.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 · users — facts about the person
-- ----------------------------------------------------------------------------

alter table users
  add column if not exists date_of_birth   date,
  add column if not exists gender          text,
  add column if not exists consent_at      timestamptz,
  add column if not exists consent_version text,
  -- The tombstone for J4-E10. Erasure clears identity and sets this; the
  -- lifetime record stays, attributed to a person with no PII (04 §4.7,
  -- confirmed 2026-08-16). Nothing writes it yet - the column exists so the
  -- record schema and the erasure policy agree from the start.
  add column if not exists erased_at       timestamptz;

alter table users drop constraint if exists users_gender_check;
alter table users add constraint users_gender_check
  check (gender is null or gender in ('male', 'female', 'other', 'prefer_not_to_say'));

-- ----------------------------------------------------------------------------
-- 2 · organization_members — the institution's view of that person
-- ----------------------------------------------------------------------------

alter table organization_members
  -- The institution's own identifier: roll number, employee id. Not unique
  -- platform-wide - two colleges may both have a student "2024-CS-017".
  add column if not exists member_code    varchar(64),
  add column if not exists verification   varchar not null default 'pending',
  add column if not exists verified_by    uuid references users(id) on delete set null,
  add column if not exists verified_at    timestamptz,
  add column if not exists rejection_note text,
  add column if not exists scholarship    boolean;

alter table organization_members drop constraint if exists organization_members_verification_check;
alter table organization_members add constraint organization_members_verification_check
  check (verification in ('pending', 'verified', 'rejected'));

-- Case-insensitive, per institution: "2024-cs-017" and "2024-CS-017" are the
-- same roll number, and letting both in defeats the point of having one.
create unique index if not exists uq_org_members_member_code
  on organization_members (organization_id, lower(member_code))
  where member_code is not null;

-- The verification queue (J1-E6) reads "everyone pending in this institution".
create index if not exists idx_org_members_verification
  on organization_members (organization_id, verification);

-- ----------------------------------------------------------------------------
-- 3 · Existing members are NOT retro-verified
-- ----------------------------------------------------------------------------
-- `verification` defaults to 'pending', so every member that already exists
-- becomes pending rather than verified. That is deliberate and matches the
-- refusal to backfill locks in 20260815020000: marking people verified because
-- they happened to predate the feature makes the badge mean "we assumed".
