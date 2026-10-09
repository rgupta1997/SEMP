-- Tennis career extras on the racquet stat line: love holds (a service game held without
-- losing a point), bagels (a set won 6-0) and wins from a set down. Integer, default 0.
-- Idempotent. (Tie-break, set, games and deciding-set win % are worked out from counters
-- already stored, so they need no columns.)

alter table racquet_match_lines add column if not exists love_holds        integer not null default 0;
alter table racquet_match_lines add column if not exists bagels            integer not null default 0;
alter table racquet_match_lines add column if not exists won_from_set_down integer not null default 0;
