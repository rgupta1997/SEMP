-- Break points against a player on their own serve, so "break points saved %" can be
-- worked out (saved / faced). Saved was already counted; faced was not. Integer, default
-- 0. Idempotent.

alter table racquet_match_lines add column if not exists break_points_faced integer not null default 0;
