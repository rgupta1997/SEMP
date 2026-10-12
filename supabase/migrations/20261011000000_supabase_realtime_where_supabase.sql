-- Restores Supabase Realtime for notifications ON SUPABASE DATABASES ONLY.
--
-- Beta runs on a Supabase project with REALTIME_TRANSPORT=supabase: the browser
-- subscribes to notification_deliveries INSERTs, and RLS decides who receives which
-- row. 20260922000000_retire_supabase_realtime.sql removed both pieces; this puts
-- them back wherever Supabase's own objects exist, and does nothing anywhere else.
--
-- Safe on RDS / plain Postgres: there is no `supabase_realtime` publication, no
-- `auth.uid()` and no `authenticated` role there, so every step below is skipped.
-- A Supabase database running AppSync is unaffected too - nothing subscribes.
--
-- NOTE before taking an RDS baseline dump FROM a Supabase database: re-run
-- 20260922000000_retire_supabase_realtime.sql first, as RUNBOOK-rds.md describes.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (select 1 from pg_roles where rolname = 'authenticated')
     and exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'auth' and p.proname = 'uid'
     )
  then
    -- Who may receive a delivery: only the user it is addressed to. Prisma connects
    -- as owner and bypasses RLS, so the API's own reads and writes are unchanged.
    execute 'alter table notification_deliveries enable row level security';
    execute 'drop policy if exists "Users can receive their own notification deliveries" on notification_deliveries';
    execute $p$
      create policy "Users can receive their own notification deliveries"
      on notification_deliveries for select to authenticated
      using (user_id = auth.uid())
    $p$;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_deliveries'
    ) then
      execute 'alter publication supabase_realtime add table notification_deliveries';
    end if;
  end if;
end $$;
