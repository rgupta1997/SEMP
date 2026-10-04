-- Who played whom: head-to-head records and the singles / doubles career split.
--
-- Team ties now name the players of each rubber, and a racquet match names its
-- lineup. Each stat line therefore knows its opponents, and each result knows
-- whether it was singles or doubles. Idempotent: safe to re-run.

-- ── Opponents per stat line ─────────────────────────────────────────────────
-- One or two user ids (singles / doubles). Null for lines with no opponent known.
alter table player_match_stats add column if not exists opponent_user_ids uuid[];

-- "Every match against this person" is the head-to-head read.
create index if not exists idx_pms_opponents on player_match_stats using gin (opponent_user_ids);

-- ── Singles / doubles grain on career_stats ─────────────────────────────────
-- grain = 'position' rows carry position = 'singles' | 'doubles'; null elsewhere.
alter table career_stats add column if not exists position varchar(12);

alter table career_stats drop constraint if exists career_stats_grain_check;
alter table career_stats add constraint career_stats_grain_check
  check (grain in ('sport', 'discipline', 'format', 'position'));

-- The identity of a row now includes its position, or the singles and doubles rows
-- of one sport would collide with each other.
drop index if exists uq_career_stats_grain;
create unique index if not exists uq_career_stats_grain
  on career_stats(
    user_id, organization_id, sport_id,
    coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(format, ''::varchar),
    coalesce(position, ''::varchar),
    tier
  );
