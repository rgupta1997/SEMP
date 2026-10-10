-- Tennis first and second serve, per racquet stat line: serve points recorded (the
-- denominator - only matches where the scorer used Fault / Ace), first-serve points
-- won, and second-serve points played and won. Integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists serve_points_tracked integer not null default 0;
alter table racquet_match_lines add column if not exists first_serve_points_won integer not null default 0;
alter table racquet_match_lines add column if not exists second_serve_points_played integer not null default 0;
alter table racquet_match_lines add column if not exists second_serve_points_won integer not null default 0;
