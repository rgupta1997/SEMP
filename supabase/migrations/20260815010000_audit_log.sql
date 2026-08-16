-- ============================================================================
-- J6-E3 · The audit trail, brought to its final shape
--
-- `audit_log` was introduced in 20260815000000 so the very first auth actions had
-- somewhere to land. This migration replaces that placeholder with the shape module
-- 03 §4.5 specifies, and adds the property that makes the table worth anything as
-- evidence: it is append-only, enforced by the database rather than by convention.
--
-- What changes and why:
--   * bigserial id      - append-only and time-ordered; a monotonic key keeps the
--                         index tight and makes "everything since X" trivial.
--   * NO foreign keys   - deliberate, matching the notifications.organization_id
--                         precedent. An audit row must never be cascade-deleted, or
--                         mutated to null, by the thing it describes. That is the
--                         entire point of an audit log.
--   * actor_label /     - denormalised at write time, so a line still reads sensibly
--     target_label        after the user is deleted (J6-E3-S4, and what makes
--                         right-to-erase compatible with an immutable trail).
--   * championship_id   - the second timeline scope.
--   * diff / ip         - what changed, and from where.
--
-- The id type changes, so the placeholder is replaced rather than altered. Any rows
-- it already collected are COPIED FORWARD, not dropped - a migration that deletes
-- audit history to reshape it would defeat the table's only purpose. The old table
-- is set aside as audit_log_v0 first, so a failure part-way leaves the rows intact.
-- ============================================================================

-- Step 1: set the placeholder aside, recognised by a column only it has.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_log' and column_name = 'entity_type'
  ) then
    drop table if exists audit_log_v0;
    alter table audit_log rename to audit_log_v0;
  end if;
end $$;

create table if not exists audit_log (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  actor_user_id   uuid,          -- no FK, by design. null = System
  actor_label     text,          -- "Akash Menon (akash@iimb.ac.in)" at the time of writing
  organization_id uuid,          -- scope for the organisation timeline
  championship_id uuid,          -- scope for the championship timeline
  action          text not null, -- 'fixture.locked', 'registration.approved', …
  target_type     text not null, -- 'fixture', 'championship_organization', …
  target_id       uuid,
  target_label    text,          -- "IIMB vs IIMA, Football SF" at the time of writing
  summary         text,          -- the human sentence the timeline renders
  diff            jsonb,         -- { field: { from, to } }
  ip              inet,
  created_at      timestamptz not null default now()
);

-- Step 2: carry the placeholder's rows across, deriving the labels the old shape
-- never captured. This is the last moment the actor's name is recoverable, which is
-- precisely the argument for denormalising it from here on.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audit_log_v0') then
    insert into audit_log (at, actor_user_id, actor_label, organization_id, action,
                           target_type, target_id, target_label, summary, diff, created_at)
    select v.created_at,
           v.actor_user_id,
           case when u.id is null then null else u.name || ' (' || u.email || ')' end,
           v.organization_id,
           v.action,
           coalesce(v.entity_type, 'unknown'),
           v.entity_id,
           o.name,
           v.summary,
           v.metadata,
           v.created_at
    from audit_log_v0 v
    left join users u on u.id = v.actor_user_id
    left join organizations o on o.id = v.organization_id
    order by v.created_at;

    drop table audit_log_v0;
  end if;
end $$;

create index if not exists idx_audit_org_at on audit_log (organization_id, at desc);
create index if not exists idx_audit_champ_at on audit_log (championship_id, at desc);
create index if not exists idx_audit_target on audit_log (target_type, target_id, at desc);
create index if not exists idx_audit_actor_at on audit_log (actor_user_id, at desc);

-- ---------------------------------------------------------------------------
-- Append-only, enforced here rather than in the application.
--
-- REVOKE alone is not enough on this database: the API connects as the table's
-- owner, and ownership bypasses table privileges. So the trigger is the real
-- guard and the revokes are defence in depth for every other role.
-- ---------------------------------------------------------------------------

create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists trg_audit_log_no_update on audit_log;
create trigger trg_audit_log_no_update
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

revoke update, delete, truncate on audit_log from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke update, delete, truncate on audit_log from authenticated;
    grant select, insert on audit_log to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on audit_log from anon;
  end if;
end $$;
