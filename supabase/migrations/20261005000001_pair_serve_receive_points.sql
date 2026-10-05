-- Doubles: the pair's serve and receive points, beside each player's own.
--
-- A doubles player's "Points on your serve" / "Points receiving" are now personal;
-- these keep the pair's totals so a profile can show both. Null-free counters,
-- 0 for singles. Idempotent.

alter table racquet_match_lines add column if not exists pair_service_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists pair_return_points_played integer not null default 0;
