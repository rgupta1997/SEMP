-- ============================================================================
-- Score columns on fixtures — enables true result entry, computed standings
-- and a medal/points tally instead of status-only outcomes.
--   * home_score / away_score : nullable until a result is entered.
--   * winner_team_id          : the winning team (null for draws/unplayed).
-- ============================================================================

alter table fixtures
  add column if not exists home_score      integer,
  add column if not exists away_score      integer,
  add column if not exists winner_team_id  uuid references teams(id);

create index if not exists idx_fixtures_winner_team_id on fixtures(winner_team_id);
