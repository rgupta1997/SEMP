-- Kho kho per-match stats - the RDS twin of
-- supabase/migrations/20261023000000_kho_kho_stats.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-23.
--
-- How each defender went out, as the KKFI score sheet records it, plus chasing fouls
-- and cards, on the raid table kho kho shares with kabaddi (which uses times_out,
-- yellows and reds too). Additive with zero defaults. Idempotent.

alter table raid_match_lines add column if not exists pole_dive_outs     integer not null default 0 check (pole_dive_outs >= 0);
alter table raid_match_lines add column if not exists dive_outs          integer not null default 0 check (dive_outs >= 0);
alter table raid_match_lines add column if not exists sudden_attack_outs integer not null default 0 check (sudden_attack_outs >= 0);
alter table raid_match_lines add column if not exists times_out          integer not null default 0 check (times_out >= 0);
alter table raid_match_lines add column if not exists out_of_field_outs  integer not null default 0 check (out_of_field_outs >= 0);
alter table raid_match_lines add column if not exists late_entries       integer not null default 0 check (late_entries >= 0);
alter table raid_match_lines add column if not exists kho_fouls          integer not null default 0 check (kho_fouls >= 0);
alter table raid_match_lines add column if not exists yellows            integer not null default 0 check (yellows >= 0);
alter table raid_match_lines add column if not exists reds               integer not null default 0 check (reds >= 0);
