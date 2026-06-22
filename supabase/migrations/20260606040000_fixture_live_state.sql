-- ============================================================================
-- Live scoring state on fixtures - backs the official match console.
--   * live_state : sport-specific match state snapshot (periods, segment scores,
--                  serve, innings, etc). Reduced client-side, persisted here.
--   * live_log   : append-only event timeline (points, wickets, cards…) powering
--                  the live ticker and post-match report.
-- Headline numbers (home_score/away_score/winner_team_id/status) remain the
-- source of truth for standings; these columns add the live detail around them.
-- ============================================================================

alter table fixtures
  add column if not exists live_state jsonb not null default '{}'::jsonb,
  add column if not exists live_log   jsonb not null default '[]'::jsonb;
