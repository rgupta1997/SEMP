-- ============================================================================
-- The profile's controlled half, and the one flag that is not a choice
--
-- Breakdown F-050 splits a sports profile in two:
--
--   CONTROLLED  what the player says about themselves - tagline, preferred
--               sports, photo, whether the profile is public at all.
--   VERIFIED    what locked scorecards wrote - participation, results,
--               statistics, medals. Never editable, by anyone.
--
-- This migration adds the first half. The second already exists as
-- lifetime_entries and achievements.
--
-- `verified_records_visible` is deliberately NOT a column. F-026 calls it the
-- trust anchor of the whole verified-record model: an institution has to be able
-- to rely on the record it issued still being visible to it. Storing it as a
-- boolean would invite a UI switch, and a switch invites turning it off - at
-- which point a "verified record" means only "verified until inconvenient".
-- It is always true, so it is a constant in code, not a row.
-- ============================================================================

create table if not exists profile_privacy (
  user_id          uuid primary key references users(id) on delete cascade,

  -- Off by default. A profile becomes public because someone chose to publish it,
  -- never because they did not find the setting.
  public_profile   boolean not null default false,

  -- Statistics are a separate decision from existence. Plenty of people are happy
  -- to be found and not happy to have their win rate quoted.
  public_stats     boolean not null default false,

  -- Lets verified organisations find and invite this person by name, email or
  -- phone. On by default: being invitable is the point of holding a Sportagon ID,
  -- and an account nobody can find cannot be asked to play.
  discoverable     boolean not null default true,

  updated_at       timestamptz not null default now()
);

-- Every existing account gets the defaults rather than a null row, so the API
-- never has to distinguish "no preferences" from "preferences that are all off".
insert into profile_privacy (user_id)
select id from users
on conflict (user_id) do nothing;

-- The controlled fields themselves. Kept on `users` rather than a side table:
-- they are facts about the person that follow them across every organisation,
-- which is exactly the rule that made account data non-org-scoped in the first place.
alter table users add column if not exists tagline varchar(160);
alter table users add column if not exists preferred_sports text[] not null default '{}';

comment on column users.tagline is
  'Player-controlled. One line under the name on the profile - never derived from results.';
comment on table profile_privacy is
  'The controlled half of a sports profile. verified_records_visible is intentionally absent: it is always true.';

-- Discover reads this for "find a player", so it is worth an index even at this size.
create index if not exists idx_profile_privacy_discoverable
  on profile_privacy (discoverable) where discoverable;
