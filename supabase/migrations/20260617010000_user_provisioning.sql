-- Admin-provisioned logins (created while adding an organization POC, a member,
-- an organiser/official, etc.) must set their own password on first login.
-- Self sign-ups leave this false.
alter table users
  add column if not exists must_change_password boolean not null default false;
