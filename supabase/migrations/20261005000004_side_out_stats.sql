-- Side-out scoring stats per racquet stat line (traditional pickleball, English squash):
-- side-outs won, service turns, and points scored in them. Integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists side_outs_won integer not null default 0;
alter table racquet_match_lines add column if not exists service_turns integer not null default 0;
alter table racquet_match_lines add column if not exists service_turn_points integer not null default 0;
