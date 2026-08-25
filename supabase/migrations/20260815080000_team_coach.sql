-- ============================================================================
-- J3-E2-S3 · A team's coach
--
-- Coach is a PROPERTY OF THE TEAM, not a squad-member role, and that is the whole
-- design decision: FR-TEAM-3 says a coach must not count against squad size, and the
-- moment a coach is a `team_members` row every squad-size check in
-- roster-policy.ts has to learn to exclude them - in the add path, the lock path, and
-- anywhere either is copied later. One nullable column on `teams` keeps the squad
-- rules exactly as they are.
--
-- This implements the recommendation in docs/eos/09-championship-core-deltas.md §4.1
-- while open question #5 (is a coach a team role, an org role, or its own entity?) is
-- still formally unanswered. If the answer comes back "an org-level role", this column
-- is a one-line drop - which is not true of a role added to an enum and written into
-- rows.
--
-- ON DELETE SET NULL: a coach leaving the platform must not take the team with them.
-- ============================================================================

alter table teams
  add column if not exists coach_user_id uuid references users(id) on delete set null;

create index if not exists idx_teams_coach on teams (coach_user_id) where coach_user_id is not null;

-- ---------------------------------------------------------------------------
-- Jersey numbers are unique within a squad (J3-E2-S2).
--
-- Enforced here as well as in the route because the roster is written from four
-- places - the roster page, the bulk add, the matrix importer and the demo seeder -
-- and a duplicate number is the kind of thing that only surfaces on match day.
-- Partial, so any number of players may have no number at all.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_team_members_jersey
  on team_members (team_id, jersey_number) where jersey_number is not null;
