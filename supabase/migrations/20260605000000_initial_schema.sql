-- ============================================================================
-- SEMP - Initial schema
-- Generated for Supabase (PostgreSQL).
--
-- Apply: paste this whole file into the Supabase SQL Editor and run,
--        or `supabase db push` if you later adopt the CLI.
--
-- Scope of this migration:
--   * Tables, foreign keys, unique/index constraints, defaults.
--   * CHECK constraints derived from the enum `note:` values in the schema.
--   * Indexes on foreign-key columns (Postgres does NOT auto-index FKs).
--   * updated_at auto-touch trigger for tables that have an updated_at column.
--   * NO Row Level Security / policies (added in a later pass).
--
-- AUTH NOTE: `public.users` is currently standalone and does NOT reference
--   Supabase `auth.users`. When wiring auth later, either:
--     a) make public.users.id reference auth.users.id, or
--     b) add a separate auth_user_id uuid column + a signup trigger.
--   See the marked block at the bottom of the users table.
-- ============================================================================

create extension if not exists pgcrypto;  -- provides gen_random_uuid()

-- ----------------------------------------------------------------------------
-- updated_at auto-touch helper
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Access control: permissions, roles
-- (permission_ids / permission rules are arrays, so no FK is enforced on them)
-- ============================================================================

create table permissions (
  id          uuid primary key default gen_random_uuid(),
  code        varchar not null unique,                 -- e.g. P1, P2, P3, P4
  label       varchar not null,
  rules       jsonb[] not null default '{}'::jsonb[],
  created_at  timestamptz not null default now()
);

create table roles (
  id              uuid primary key default gen_random_uuid(),
  name            varchar not null unique,             -- Organiser, Official, Captain, POC, Participant
  description     varchar,
  permission_ids  uuid[] not null default '{}'::uuid[], -- array of permissions.id (not FK-enforced)
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- Users
-- ============================================================================

create table users (
  id          uuid primary key default gen_random_uuid(),
  -- AUTH NOTE: to link to Supabase auth, change the line above to:
  --   id uuid primary key references auth.users (id) on delete cascade,
  -- and remove the default (auth.users provides the id).
  name        varchar not null,
  email       varchar not null unique,
  phone       varchar,
  avatar_url  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================================
-- Events
-- ============================================================================

create table events (
  id           uuid primary key default gen_random_uuid(),
  name         varchar not null,
  slug         varchar not null unique,
  description  text,
  venue        varchar,
  start_date   date not null,
  end_date     date not null,
  status       varchar not null default 'draft'
                 check (status in ('draft', 'registration_open', 'ongoing', 'completed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_events_updated_at
  before update on events
  for each row execute function set_updated_at();

-- ============================================================================
-- Institutions
-- ============================================================================

create table institutions (
  id          uuid primary key default gen_random_uuid(),
  name        varchar not null,
  short_name  varchar,
  code        varchar unique,                          -- e.g. IIT-B
  logo_url    text,
  city        varchar,
  status      boolean,
  country     varchar not null default 'India',
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- Venues & grounds (venue is scoped to an event)
-- ============================================================================

create table venues (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events (id),
  name        varchar not null,                        -- e.g. Gymkhana Sports Complex
  address     text,
  city        varchar,
  country     varchar not null default 'India',
  latitude    decimal,
  longitude   decimal,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_venues_event_id on venues (event_id);

create trigger trg_venues_updated_at
  before update on venues
  for each row execute function set_updated_at();

create table venue_grounds (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues (id),
  name           varchar not null,                     -- e.g. Court 1, Swimming Pool A
  ground_type    varchar check (ground_type in ('court', 'field', 'pool', 'track', 'ring', 'table')),
  capacity       int,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index idx_venue_grounds_venue_id on venue_grounds (venue_id);

-- ============================================================================
-- Sponsors
-- ============================================================================

create table sponsors (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events (id),
  name           varchar not null,
  logo_url       text,
  tier           varchar not null default 'community'
                   check (tier in ('title', 'gold', 'silver', 'community')),
  website_url    text,
  display_order  int not null default 0,
  created_at     timestamptz not null default now()
);

create index idx_sponsors_event_id on sponsors (event_id);

-- ============================================================================
-- Sports & disciplines
-- ============================================================================

create table sports (
  id          uuid primary key default gen_random_uuid(),
  name        varchar not null,
  icon        varchar,
  created_at  timestamptz not null default now()
);

create table disciplines (
  id             uuid primary key default gen_random_uuid(),
  sport_id       uuid not null references sports (id),
  name           varchar not null,                     -- e.g. 100m Sprint, Singles
  description    varchar,
  entry_type     varchar not null default 'team'
                   check (entry_type in ('team', 'individual', 'doubles', 'relay')),
  squad_min      smallint not null default 1,
  squad_max      smallint not null default 15,
  display_order  int not null default 0
);

create index idx_disciplines_sport_id on disciplines (sport_id);

-- ============================================================================
-- Tournament formats
-- ============================================================================

create table tournament_formats (
  id          uuid primary key default gen_random_uuid(),
  name        varchar not null unique,                 -- Knockout, League, Round Robin, ...
  description varchar,
  config      jsonb not null default '{}'::jsonb,      -- template schema for this format type
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- Tournaments
-- ============================================================================

create table tournaments (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id),
  name         varchar not null,
  description  text,
  status       varchar not null default 'draft'
                 check (status in ('draft', 'active', 'completed', 'cancelled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_tournaments_event_id on tournaments (event_id);

create trigger trg_tournaments_updated_at
  before update on tournaments
  for each row execute function set_updated_at();

create table tournament_sports (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references tournaments (id),
  sport_id       uuid not null references sports (id),
  format_id      uuid not null references tournament_formats (id),
  format_config  jsonb not null default '{}'::jsonb,
  display_order  int not null default 0,
  created_at     timestamptz not null default now(),
  unique (tournament_id, sport_id)
);

create index idx_tournament_sports_tournament_id on tournament_sports (tournament_id);
create index idx_tournament_sports_sport_id on tournament_sports (sport_id);
create index idx_tournament_sports_format_id on tournament_sports (format_id);

create table tournament_disciplines (
  id                   uuid primary key default gen_random_uuid(),
  tournament_sport_id  uuid not null references tournament_sports (id),
  discipline_id        uuid references disciplines (id),        -- null for sports with no disciplines
  format_id            uuid references tournament_formats (id), -- overrides sport-level format if set
  format_config        jsonb not null default '{}'::jsonb,
  venue_id             uuid references venues (id),
  rulebook_url         text,
  entry_type           varchar,    -- overrides discipline entry_type if set
  squad_min            smallint,   -- overrides discipline squad_min if set
  squad_max            smallint,   -- overrides discipline squad_max if set
  status               varchar not null default 'upcoming'
                         check (status in ('upcoming', 'ongoing', 'completed')),
  display_order        int not null default 0,
  created_at           timestamptz not null default now(),
  unique (tournament_sport_id, discipline_id)
);

create index idx_tournament_disciplines_tournament_sport_id on tournament_disciplines (tournament_sport_id);
create index idx_tournament_disciplines_discipline_id on tournament_disciplines (discipline_id);
create index idx_tournament_disciplines_format_id on tournament_disciplines (format_id);
create index idx_tournament_disciplines_venue_id on tournament_disciplines (venue_id);

-- ============================================================================
-- Event <-> Institution applications
-- ============================================================================

create table event_institutions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id),
  institution_id  uuid not null references institutions (id),
  status          varchar not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  applied_by      uuid not null references users (id),
  reviewed_by     uuid references users (id),
  rejection_note  text,
  applied_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  unique (event_id, institution_id)
);

create index idx_event_institutions_event_id on event_institutions (event_id);
create index idx_event_institutions_institution_id on event_institutions (institution_id);
create index idx_event_institutions_applied_by on event_institutions (applied_by);
create index idx_event_institutions_reviewed_by on event_institutions (reviewed_by);

-- ============================================================================
-- User <-> Event <-> Role assignments
-- ============================================================================

create table user_event_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id),
  event_id     uuid not null references events (id),
  role_id      uuid not null references roles (id),
  assigned_by  uuid references users (id),
  assigned_at  timestamptz not null default now(),
  unique (user_id, event_id, role_id)
);

create index idx_user_event_roles_user_id on user_event_roles (user_id);
create index idx_user_event_roles_event_id on user_event_roles (event_id);
create index idx_user_event_roles_role_id on user_event_roles (role_id);
create index idx_user_event_roles_assigned_by on user_event_roles (assigned_by);

-- ============================================================================
-- Teams & members
-- ============================================================================

create table teams (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events (id),
  sport_id                  uuid not null references sports (id),
  institution_id            uuid not null references institutions (id),
  event_institution_id      uuid not null references event_institutions (id),
  tournament_discipline_id  uuid references tournament_disciplines (id),
  name                      varchar not null,
  status                    varchar not null default 'forming'
                              check (status in ('forming', 'submitted', 'approved', 'roster_locked')),
  invite_token              varchar unique,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_teams_event_id on teams (event_id);
create index idx_teams_sport_id on teams (sport_id);
create index idx_teams_institution_id on teams (institution_id);
create index idx_teams_event_institution_id on teams (event_institution_id);
create index idx_teams_tournament_discipline_id on teams (tournament_discipline_id);

create trigger trg_teams_updated_at
  before update on teams
  for each row execute function set_updated_at();

create table team_members (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams (id),
  user_id        uuid not null references users (id),
  role           varchar not null default 'player'
                   check (role in ('captain', 'vice_captain', 'player', 'substitute')),
  jersey_number  smallint,
  is_active      boolean not null default true,
  joined_at      timestamptz not null default now(),
  unique (team_id, user_id)
);

create index idx_team_members_team_id on team_members (team_id);
create index idx_team_members_user_id on team_members (user_id);

-- ============================================================================
-- Fixtures
-- ============================================================================

create table fixtures (
  id                        uuid primary key default gen_random_uuid(),
  tournament_discipline_id  uuid not null references tournament_disciplines (id),
  home_team_id              uuid references teams (id),
  away_team_id              uuid references teams (id),
  venue_ground_id           uuid references venue_grounds (id),
  round                     varchar,                  -- QF, SF, Final, Round 1, Pool A - Match 3
  pool_number               smallint,
  bracket_position          int,
  scheduled_at              timestamptz,
  duration_minutes          int,
  status                    varchar not null default 'scheduled'
                              check (status in ('scheduled', 'live', 'completed', 'postponed', 'cancelled', 'bye', 'walkover')),
  official_id               uuid references users (id),
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_fixtures_tournament_discipline_id on fixtures (tournament_discipline_id);
create index idx_fixtures_home_team_id on fixtures (home_team_id);
create index idx_fixtures_away_team_id on fixtures (away_team_id);
create index idx_fixtures_venue_ground_id on fixtures (venue_ground_id);
create index idx_fixtures_official_id on fixtures (official_id);

-- ============================================================================
-- End of initial schema
-- ============================================================================
