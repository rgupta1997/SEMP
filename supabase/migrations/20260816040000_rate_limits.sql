-- ============================================================================
-- A rate limiter that survives Lambda
--
-- The limiter counted requests in process memory. The API runs on Lambda at reserved
-- concurrency 10, so a caller spread across containers got up to 10x the nominal budget
-- and every counter died with its container - meaning a burst of cold starts reset the
-- limit for free. Against password guessing on /auth/login that is close to no limit at
-- all.
--
-- The counter moves to a table every container can see. One row per (key, window),
-- incremented with a single atomic upsert - no read-then-write, so two containers
-- racing on the same key cannot both see "4 of 5".
--
-- Deliberately NOT a general-purpose store: rows are tiny, short-lived and swept, and
-- the only writer is the pre-auth middleware.
-- ============================================================================

create table if not exists rate_limits (
  -- "<method>:<path>:<ip>:<extra>" - built by the middleware, opaque here.
  key           text        not null,
  -- Start of the fixed window. Part of the key so a new window is a new row rather
  -- than an update racing against a reset.
  window_start  timestamptz not null,
  count         integer     not null default 0,
  primary key (key, window_start)
);

-- The sweep: rows are only interesting until their window closes.
create index if not exists idx_rate_limits_window on rate_limits (window_start);

-- Atomic increment. Returns the count INCLUDING this request, so the caller compares
-- against its own max without a second round trip.
create or replace function rate_limit_hit(p_key text, p_window_start timestamptz)
returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
