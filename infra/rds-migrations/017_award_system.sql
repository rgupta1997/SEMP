-- Award system: award types mapped to sports, four award levels, team recipients.
--
-- STATUS: NOT APPLIED to RDS. Local Docker only - written 2026-10-20.
-- Do not apply to Supabase or RDS until the feature is signed off locally.
-- No Supabase twin yet; write it when the feature is promoted.
--
-- What changes:
--   award_types         gains levels, recipient_kind, all_sports, championship_id
--                       (organiser extras scoped to one event), description, audit columns.
--                       Seeds the 9 catalogue types if they are missing.
--   award_type_sports   new join table: which sports an award type is offered for.
--   fixture_awards      match-level awards can go to a team (recipient_team_id).
--   championship_awards new: tournament_sport / tournament / championship level awards.
--
-- Idempotent: every statement is IF [NOT] EXISTS or guarded.

-- ----------------------------------------------------------------------------
-- 1 · award_types
-- ----------------------------------------------------------------------------

alter table award_types add column if not exists levels text[] not null default '{match}';
alter table award_types add column if not exists recipient_kind text not null default 'player';
alter table award_types add column if not exists all_sports boolean not null default false;
alter table award_types add column if not exists championship_id uuid references championships(id) on delete cascade;
alter table award_types add column if not exists description text;
alter table award_types add column if not exists created_by uuid references users(id) on delete set null;
alter table award_types add column if not exists updated_at timestamptz not null default now();

alter table award_types drop constraint if exists award_types_levels_check;
alter table award_types add constraint award_types_levels_check
  check (cardinality(levels) > 0
         and levels <@ array['match','tournament_sport','tournament','championship']::text[]);

alter table award_types drop constraint if exists award_types_recipient_kind_check;
alter table award_types add constraint award_types_recipient_kind_check
  check (recipient_kind in ('player','team'));

-- A code is unique across the global catalogue, and unique within one event's extras.
-- An organiser may reuse a global code's wording in their own event without a clash.
-- Supabase has it as a constraint, RDS (002, built from Prisma) as a plain unique index.
alter table award_types drop constraint if exists award_types_code_key;
drop index if exists award_types_code_key;
create unique index if not exists uq_award_types_global_code
  on award_types (code) where championship_id is null;
create unique index if not exists uq_award_types_event_code
  on award_types (championship_id, code) where championship_id is not null;
create index if not exists idx_award_types_championship
  on award_types (championship_id) where championship_id is not null;

-- Seed the catalogue (RDS was built without it). Global rows only.
insert into award_types (code, label, sort_order)
select v.code, v.label, v.sort_order
  from (values
    ('player_of_the_match',      'Player of the Match',      10),
    ('player_of_the_tournament', 'Player of the Tournament', 15),
    ('mvp',                      'Most Valuable Player',     20),
    ('top_scorer',               'Top Scorer',               30),
    ('best_defender',            'Best Defender',            40),
    ('best_goalkeeper',          'Best Goalkeeper',          50),
    ('emerging_player',          'Emerging Player',          60),
    ('fair_play',                'Fair Play',                70),
    ('best_team',                'Best Team',                80)
  ) as v(code, label, sort_order)
 where not exists (select 1 from award_types a where a.code = v.code and a.championship_id is null);

-- Levels and recipient for the seeded types. Only touches rows still on the column
-- defaults, so a super admin's later edits survive a re-run.
update award_types a
   set levels = v.levels::text[], recipient_kind = v.recipient_kind, all_sports = v.all_sports
  from (values
    ('player_of_the_match',      '{match}',                                       'player', true),
    ('player_of_the_tournament', '{tournament_sport,tournament,championship}',    'player', true),
    ('mvp',                      '{match,tournament_sport,tournament,championship}', 'player', true),
    ('top_scorer',               '{tournament_sport,tournament,championship}',    'player', true),
    ('best_defender',            '{tournament_sport,tournament,championship}',    'player', true),
    ('best_goalkeeper',          '{tournament_sport,tournament,championship}',    'player', false),
    ('emerging_player',          '{tournament_sport,tournament,championship}',    'player', true),
    ('fair_play',                '{match,tournament_sport,tournament,championship}', 'team', true),
    ('best_team',                '{tournament_sport,tournament,championship}',    'team',   true)
  ) as v(code, levels, recipient_kind, all_sports)
 where a.code = v.code
   and a.championship_id is null
   and a.levels = '{match}'
   and a.recipient_kind = 'player'
   and a.all_sports = false;

-- ----------------------------------------------------------------------------
-- 2 · award_type_sports - the sport mapping
-- ----------------------------------------------------------------------------

create table if not exists award_type_sports (
  id            uuid primary key default gen_random_uuid(),
  award_type_id uuid not null references award_types(id) on delete cascade,
  sport_id      uuid not null references sports(id) on delete cascade,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now(),
  constraint uq_award_type_sports unique (award_type_id, sport_id)
);

create index if not exists idx_award_type_sports_sport
  on award_type_sports (sport_id, sort_order);

-- Carry the old single sport_id over (sport_id is deprecated; dropped in a later migration).
insert into award_type_sports (award_type_id, sport_id, sort_order)
select id, sport_id, sort_order from award_types where sport_id is not null
on conflict (award_type_id, sport_id) do nothing;

-- Best Goalkeeper: only the sports that have a goalkeeper.
insert into award_type_sports (award_type_id, sport_id)
select a.id, s.id
  from award_types a
  join sports s on s.name in ('Football','Futsal','Hockey','Handball')
 where a.code = 'best_goalkeeper' and a.championship_id is null
on conflict (award_type_id, sport_id) do nothing;

-- ----------------------------------------------------------------------------
-- 3 · fixture_awards - match level, player or team
-- ----------------------------------------------------------------------------

alter table fixture_awards add column if not exists recipient_team_id uuid references teams(id) on delete cascade;
alter table fixture_awards alter column recipient_user_id drop not null;

alter table fixture_awards drop constraint if exists fixture_awards_one_recipient_check;
alter table fixture_awards add constraint fixture_awards_one_recipient_check
  check (num_nonnulls(recipient_user_id, recipient_team_id) = 1);

create index if not exists idx_fixture_awards_team
  on fixture_awards (recipient_team_id) where recipient_team_id is not null;

-- Free text recorded before the dropdown: map the common spellings of Player of the Match.
update fixture_awards fa
   set award_type_id = a.id
  from award_types a
 where fa.award_type_id is null
   and a.code = 'player_of_the_match' and a.championship_id is null
   and lower(regexp_replace(fa.award_name, '[^a-zA-Z]', '', 'g'))
       in ('potm','mom','manofthematch','playerofthematch','playerofmatch','manofmatch');

update fixture_awards fa
   set award_type_id = a.id
  from award_types a
 where fa.award_type_id is null
   and a.championship_id is null
   and lower(trim(fa.award_name)) = lower(a.label);

-- ----------------------------------------------------------------------------
-- 4 · championship_awards - tournament_sport / tournament / championship level
-- ----------------------------------------------------------------------------

create table if not exists championship_awards (
  id                  uuid primary key default gen_random_uuid(),
  award_type_id       uuid not null references award_types(id) on delete restrict,
  level               text not null,
  championship_id     uuid not null references championships(id) on delete cascade,
  tournament_id       uuid references tournaments(id) on delete cascade,
  tournament_sport_id uuid references tournament_sports(id) on delete cascade,
  award_name          varchar(120) not null,  -- label snapshot, survives a rename
  recipient_user_id   uuid references users(id) on delete cascade,
  recipient_team_id   uuid references teams(id) on delete cascade,
  notes               text,
  awarded_by          uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint championship_awards_level_check
    check (level in ('tournament_sport','tournament','championship')),
  constraint championship_awards_one_recipient_check
    check (num_nonnulls(recipient_user_id, recipient_team_id) = 1),
  constraint championship_awards_scope_check
    check (   (level = 'tournament_sport' and tournament_id is not null and tournament_sport_id is not null)
           or (level = 'tournament'       and tournament_id is not null and tournament_sport_id is null)
           or (level = 'championship'     and tournament_id is null     and tournament_sport_id is null))
);

create index if not exists idx_championship_awards_championship
  on championship_awards (championship_id, level);
create index if not exists idx_championship_awards_tournament
  on championship_awards (tournament_id) where tournament_id is not null;
create index if not exists idx_championship_awards_tournament_sport
  on championship_awards (tournament_sport_id) where tournament_sport_id is not null;
create index if not exists idx_championship_awards_user
  on championship_awards (recipient_user_id) where recipient_user_id is not null;
create index if not exists idx_championship_awards_team
  on championship_awards (recipient_team_id) where recipient_team_id is not null;
create index if not exists idx_championship_awards_type
  on championship_awards (award_type_id);
