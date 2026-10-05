-- Side-out % (the opponents' service turns faced, beside side_outs_won) and pickleball
-- "pickles" (games won to 0). Integer counters, default 0. Idempotent.

alter table racquet_match_lines add column if not exists service_turns_faced integer not null default 0;
alter table racquet_match_lines add column if not exists pickles integer not null default 0;
