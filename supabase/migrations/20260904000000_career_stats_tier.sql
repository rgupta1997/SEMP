-- ============================================================================
-- COMPETITION TIER on the career record.
--
-- WHY. A career total that adds every result together is a career total that lies.
-- A hundred against another institution and a hundred in an inter-department game
-- are not the same hundred, and cricket has kept first-class, List A and T20 apart
-- for a century for exactly that reason. Here the distinction is INTER (institution
-- against institution) and INTRA (campuses or departments of one institution).
--
-- Derived from `championships.entry_level`, which already decides who competes - so
-- the tier cannot drift from the shape of the event that produced it, and nobody has
-- to remember to tag anything.
--
-- 'all' IS STORED, not computed on read. A profile leads with the combined record and
-- shows the split underneath; making the reader sum rows would mean every consumer
-- re-implementing the rollup, and one of them getting it wrong. The rollup is written
-- in the same transaction as its parts, so the two can never disagree.
--
-- Existing rows become 'all', which is what they have always been - a single
-- undifferentiated total. They are rewritten with their real tiers the next time
-- anything that touches that person is locked, because the career recompute is a
-- delete-and-rebuild rather than an increment.
-- ============================================================================

alter table career_stats
  add column if not exists tier varchar(12) not null default 'all'
    check (tier in ('all', 'inter', 'intra'));

comment on column career_stats.tier is
  'Competition level: inter (institution v institution), intra (units of one institution), or all (the rollup of both). Derived from championships.entry_level at recompute time.';

-- The read a profile actually makes: this person, this sport, this tier.
create index if not exists idx_career_stats_user_sport_tier
  on career_stats(user_id, sport_id, tier, grain);

-- And the leaderboard read: everyone in an institution, at one tier.
create index if not exists idx_career_stats_org_tier
  on career_stats(organization_id, sport_id, tier, grain);

-- ────────────────────────────────────────────────────────────────────────────
-- The uniqueness has to include the tier.
--
-- `uq_career_stats_grain` was one row per (person, institution, sport, discipline,
-- format). With a tier column that is one row too few: the 'all' rollup and the
-- 'inter' row it rolls up are the same tuple by that definition, so writing both
-- collided and the whole recompute rolled back. Widening it is what makes a rollup
-- alongside its parts expressible at all.
-- ────────────────────────────────────────────────────────────────────────────
drop index if exists uq_career_stats_grain;

create unique index if not exists uq_career_stats_grain
  on career_stats(
    user_id, organization_id, sport_id,
    coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(format, ''::varchar),
    tier
  );
