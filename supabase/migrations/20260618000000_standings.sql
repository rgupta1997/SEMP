-- Configurable, multi-level standings.
--
-- Two tables:
--   standings_rules - per-championship scoring rules. A row overrides the implicit
--     default for a scope (the whole championship, a format, or a discipline).
--     Absence of a row means the engine falls back to DEFAULT_STANDINGS_RULE in
--     code (league points 3/1/0), so existing championships need no backfill.
--   standings - materialized org-level points tables, rebuilt per championship
--     whenever a fixture is scored. Maintained at three aggregation scopes:
--     championship (scope_id null), tournament (scope_id = tournaments.id) and
--     sport (scope_id = sports.id).

create table if not exists standings_rules (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references championships(id) on delete cascade,
  scope_type      varchar not null,           -- 'championship' | 'format' | 'discipline'
  scope_id        uuid,                        -- null = championship default; else format_id / discipline_id
  config          jsonb not null default '{}', -- typed rule: { scheme, ... }
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One rule per (championship, scope_type, scope_id). A partial unique index handles
-- the NULL scope_id (championship default) case, which a plain UNIQUE would not.
create unique index if not exists uq_standings_rules_scope
  on standings_rules(championship_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_standings_rules_championship on standings_rules(championship_id);

create table if not exists standings (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references championships(id) on delete cascade,
  scope_type      varchar not null,            -- 'championship' | 'tournament' | 'sport'
  scope_id        uuid,                         -- null = championship; else tournaments.id / sports.id
  organization_id uuid not null references organizations(id) on delete cascade,
  played          int not null default 0,
  won             int not null default 0,
  drawn           int not null default 0,
  lost            int not null default 0,
  points          int not null default 0,
  detail          jsonb not null default '{}', -- scheme-specific tally (golds/silvers/bronzes, round reached)
  rank            int,
  computed_at     timestamptz not null default now()
);

create unique index if not exists uq_standings_scope_org
  on standings(championship_id, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), organization_id);
create index if not exists idx_standings_championship on standings(championship_id);
create index if not exists idx_standings_scope on standings(championship_id, scope_type, scope_id);
