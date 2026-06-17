-- ============================================================================
-- Rebrand + role unification + multi-org membership
--
-- 1. Rename `events`→`championships`, `institutions`→`organizations` and their
--    join/role tables, plus every `event_id`/`institution_id`/`event_institution_id`
--    column, to the new domain language.
-- 2. Relax the vestigial `users.account_type` (no longer gates app shells; kept
--    only for back-compat) and rename `users.institution_id`→`organization_id`.
-- 3. Add `organization_members` (user ↔ organization, many-to-many with a per-org
--    role) and backfill it from the old single-org link + team captaincies.
-- 4. Re-point the `notifications.audience` CHECK value.
--
-- Hand-written, idempotent SQL — this is the source of truth (Prisma is
-- introspection-only). Apply via the Supabase SQL editor / `supabase db push`,
-- then `npm run prisma:pull && npm run prisma:generate`.
-- Postgres keeps FK constraints and index *names* working through a rename, so
-- index names below are intentionally left at their legacy values; a later
-- `db pull` will surface them and they can be renamed cosmetically if desired.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. Rename tables (guarded so re-running is a no-op)
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.events') is not null and to_regclass('public.championships') is null then
    alter table events rename to championships;
  end if;
  if to_regclass('public.institutions') is not null and to_regclass('public.organizations') is null then
    alter table institutions rename to organizations;
  end if;
  if to_regclass('public.event_institutions') is not null and to_regclass('public.championship_organizations') is null then
    alter table event_institutions rename to championship_organizations;
  end if;
  if to_regclass('public.event_officials') is not null and to_regclass('public.championship_officials') is null then
    alter table event_officials rename to championship_officials;
  end if;
  if to_regclass('public.user_event_roles') is not null and to_regclass('public.user_championship_roles') is null then
    alter table user_event_roles rename to user_championship_roles;
  end if;
end $$;

-- Keep the auto-touch trigger name aligned with the renamed table.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'trg_events_updated_at')
     and not exists (select 1 from pg_trigger where tgname = 'trg_championships_updated_at') then
    alter trigger trg_events_updated_at on championships rename to trg_championships_updated_at;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1b. Rename columns. Helper inlined as guarded DO blocks.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- event_id -> championship_id
  for r in
    select unnest(array[
      'venues','sponsors','tournaments','teams','notifications',
      'championship_organizations','user_championship_roles','championship_officials'
    ]) as tbl
  loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='event_id')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='championship_id') then
      execute format('alter table %I rename column event_id to championship_id', r.tbl);
    end if;
  end loop;

  -- institution_id -> organization_id
  for r in
    select unnest(array['championship_organizations','teams','users']) as tbl
  loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='institution_id')
       and not exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='organization_id') then
      execute format('alter table %I rename column institution_id to organization_id', r.tbl);
    end if;
  end loop;

  -- event_institution_id -> championship_organization_id (teams)
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='teams' and column_name='event_institution_id')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='teams' and column_name='championship_organization_id') then
    alter table teams rename column event_institution_id to championship_organization_id;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. users.account_type is now vestigial (does not gate anything). Drop its
--    NOT NULL + CHECK so it stops constraining; keep the column for back-compat.
-- ----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'users_account_type_check') then
    alter table users drop constraint users_account_type_check;
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='users' and column_name='account_type' and is_nullable='NO'
  ) then
    alter table users alter column account_type drop not null;
  end if;
end $$;

-- Keep the FK index name useful after the column rename.
do $$ begin
  if exists (select 1 from pg_class where relname = 'idx_users_institution_id')
     and not exists (select 1 from pg_class where relname = 'idx_users_organization_id') then
    alter index idx_users_institution_id rename to idx_users_organization_id;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. organization_members — many-to-many user ↔ organization with a per-org role.
-- ----------------------------------------------------------------------------
create table if not exists organization_members (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  organization_id  uuid not null references organizations(id) on delete cascade,
  role             varchar not null default 'member'
                     check (role in ('owner', 'admin', 'captain', 'member', 'alumni')),
  status           varchar not null default 'active'
                     check (status in ('active', 'past')),
  joined_at        timestamptz not null default now(),
  unique (user_id, organization_id)
);

create index if not exists idx_organization_members_user_id on organization_members (user_id);
create index if not exists idx_organization_members_organization_id on organization_members (organization_id);

-- Backfill: existing single-org links become memberships. Institution-account
-- users become owners; everyone else a member.
insert into organization_members (user_id, organization_id, role)
select u.id, u.organization_id,
       case when u.account_type = 'institution' then 'owner' else 'member' end
from users u
where u.organization_id is not null
on conflict (user_id, organization_id) do nothing;

-- Backfill: team captains / vice-captains are captains of their team's org.
insert into organization_members (user_id, organization_id, role)
select distinct tm.user_id, t.organization_id, 'captain'
from team_members tm
join teams t on t.id = tm.team_id
where tm.is_active and tm.role in ('captain', 'vice_captain') and t.organization_id is not null
on conflict (user_id, organization_id)
  do update set role = 'captain'
  where organization_members.role not in ('owner', 'admin');

-- ----------------------------------------------------------------------------
-- 4. notifications.audience: rename the value institutions_captains ->
--    organizations_captains and re-point the CHECK.
-- ----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'notifications_audience_check') then
    alter table notifications drop constraint notifications_audience_check;
  end if;
end $$;

update notifications set audience = 'organizations_captains' where audience = 'institutions_captains';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_audience_check') then
    alter table notifications
      add constraint notifications_audience_check
      check (audience in ('all', 'organizations_captains'));
  end if;
end $$;
