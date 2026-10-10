-- Doubles: points the pair won on its own serve and when receiving, beside the
-- pair_*_played counts. Integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists pair_service_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists pair_return_points_won integer not null default 0;
