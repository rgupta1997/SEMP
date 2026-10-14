-- Volleyball / throwball points lost on net_match_lines - the RDS twin of
-- supabase/migrations/20261013010000_net_points_lost.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-13.
--
-- One integer counter (default 0) behind point win %. Additive and idempotent.

alter table net_match_lines add column if not exists points_lost integer not null default 0;
