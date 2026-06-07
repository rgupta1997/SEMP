-- ============================================================================
-- Role context columns on users
--   * institution_id : links institution staff / captains / participants to the
--                      institution they belong to. Nullable — organisers and the
--                      platform super-admin are not tied to an institution.
--   * account_type   : the user's default app shell / global role. Event-scoped
--                      roles (user_event_roles) refine capabilities per event.
--                      One of: organiser | institution | official | participant.
--                      The platform super-admin is identified by is_super_admin.
-- ============================================================================

alter table users
  add column if not exists institution_id uuid references institutions(id),
  add column if not exists account_type   varchar not null default 'participant';

create index if not exists idx_users_institution_id on users(institution_id);

-- Constrain account_type to the known set.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_account_type_check'
  ) then
    alter table users
      add constraint users_account_type_check
      check (account_type in ('organiser', 'institution', 'official', 'participant'));
  end if;
end $$;
