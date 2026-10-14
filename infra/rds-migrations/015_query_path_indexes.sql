-- Query-path indexes, from the 2026-10-14 database audit (pg_stat_statements +
-- pg_stat_user_indexes against the live database). Index-only: no column, table or
-- data changes, so nothing in the app's behaviour moves - only how fast it gets there.
-- Supabase twin: supabase/migrations/20261014000000_query_path_indexes.sql (same body).
--
-- STATUS: NOT APPLIED. Written 2026-10-14.
--
-- Every statement is skipped with a NOTICE if its table, column or index does not
-- exist, so the same file is safe on Supabase and RDS, and safe to re-run.
-- Plain (not CONCURRENTLY) builds: both runners wrap a file in a transaction, and at
-- this size (69 MB database) each build holds its lock for milliseconds.

-- 1. Indexes that match the predicates the app actually runs.
do $$
declare s text;
begin
  foreach s in array array[
    $s$create index if not exists idx_users_phone_last10_any on public.users (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))$s$,  -- every phone lookup's exact expression, no partial predicate
    $s$drop index if exists public.idx_users_phone_last10$s$,  -- partial: unusable by lookups that don't also say phone is not null (0 scans)
    $s$create index if not exists idx_auth_tokens_email_live on public.auth_tokens (email, kind, created_at desc) where email is not null$s$,  -- issue / verify / rate-count query the stored (already normalised) email
    $s$create index if not exists idx_auth_tokens_phone_live on public.auth_tokens (phone, kind, created_at desc) where phone is not null$s$,  -- same for phone
    $s$drop index if exists public.idx_auth_tokens_phone$s$,  -- expression index nothing queries (0 scans)
    $s$create index if not exists idx_fixtures_autolock_due on public.fixtures (completed_at) where completed_at is not null and scorecard_status <> 'locked'$s$,  -- autoLockDueFixtures
    $s$drop index if exists public.idx_pms_stats$s$,  -- GIN on stats: no query uses containment on it (0 scans), rebuilt on every rescore
    $s$alter table public.fixtures set (fillfactor = 80)$s$  -- room for HOT updates: score taps rewrite the row but no indexed column
  ] loop
    begin
      execute s;
    exception when undefined_table or undefined_column or undefined_object then
      raise notice 'skipped (query path): %', s;
    end;
  end loop;
end $$;

-- 2. Foreign keys with no index. Postgres does not index the referencing side of a
--    foreign key; without one every delete of a parent row (and every cascade)
--    scans the child table - a batch user delete took 4.3s. Nullable columns get a
--    partial index: an FK check's `col = $1` implies `col is not null`, so it still
--    qualifies, and the index stays as small as the rows that use it.
do $$
declare s text;
begin
  foreach s in array array[
    $s$create index if not exists idx_achievement_claims_achievement_id on public.achievement_claims (achievement_id) where achievement_id is not null$s$,  -- -> achievements on delete no action
    $s$create index if not exists idx_achievement_claims_decided_by on public.achievement_claims (decided_by) where decided_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_achievement_claims_sport_id on public.achievement_claims (sport_id) where sport_id is not null$s$,  -- -> sports on delete no action
    $s$create index if not exists idx_auth_tokens_user_id on public.auth_tokens (user_id) where user_id is not null$s$,  -- -> users on delete cascade
    $s$create index if not exists idx_career_stats_discipline_id on public.career_stats (discipline_id) where discipline_id is not null$s$,  -- -> disciplines on delete cascade
    $s$create index if not exists idx_career_stats_sport_id on public.career_stats (sport_id)$s$,  -- -> sports on delete cascade
    $s$create index if not exists idx_certificate_templates_created_by on public.certificate_templates (created_by) where created_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_certificates_issued_by on public.certificates (issued_by) where issued_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_certificates_revoked_by on public.certificates (revoked_by) where revoked_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_certificates_template_id on public.certificates (template_id) where template_id is not null$s$,  -- -> certificate_templates on delete no action
    $s$create index if not exists idx_championship_invitations_accepted_by on public.championship_invitations (accepted_by) where accepted_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_championship_invitations_invited_by on public.championship_invitations (invited_by)$s$,  -- -> users on delete cascade
    $s$create index if not exists idx_championship_officials_assigned_by on public.championship_officials (assigned_by) where assigned_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_championship_templates_source_championship_id on public.championship_templates (source_championship_id) where source_championship_id is not null$s$,  -- -> championships on delete set null
    $s$create index if not exists idx_championships_archived_by on public.championships (archived_by) where archived_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_championships_entry_scope_unit_id on public.championships (entry_scope_unit_id) where entry_scope_unit_id is not null$s$,  -- -> org_units on delete set null
    $s$create index if not exists idx_claim_evidence_uploaded_by on public.claim_evidence (uploaded_by)$s$,  -- -> users on delete cascade
    $s$create index if not exists idx_cricket_batting_lines_fielder_id on public.cricket_batting_lines (fielder_id) where fielder_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_cricket_innings_batting_team_id on public.cricket_innings (batting_team_id) where batting_team_id is not null$s$,  -- -> teams on delete set null
    $s$create index if not exists idx_cricket_innings_bowling_team_id on public.cricket_innings (bowling_team_id) where bowling_team_id is not null$s$,  -- -> teams on delete set null
    $s$create index if not exists idx_demo_requests_handled_by on public.demo_requests (handled_by) where handled_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_demo_sandboxes_created_by on public.demo_sandboxes (created_by) where created_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_demo_sandboxes_organiser_user_id on public.demo_sandboxes (organiser_user_id) where organiser_user_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_feedback_championship_id on public.feedback (championship_id) where championship_id is not null$s$,  -- -> championships on delete set null
    $s$create index if not exists idx_feedback_handled_by on public.feedback (handled_by) where handled_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_feedback_user_id on public.feedback (user_id) where user_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_fixtures_locked_by on public.fixtures (locked_by) where locked_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_fixtures_submitted_by on public.fixtures (submitted_by) where submitted_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_notification_cursors_last_clicked_notification_id on public.notification_cursors (last_clicked_notification_id) where last_clicked_notification_id is not null$s$,  -- -> notifications on delete set null
    $s$create index if not exists idx_notification_reactions_user_id on public.notification_reactions (user_id)$s$,  -- -> users on delete cascade
    $s$create index if not exists idx_notifications_sender_id on public.notifications (sender_id) where sender_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_org_verification_requests_reviewed_by on public.org_verification_requests (reviewed_by) where reviewed_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_org_verification_requests_submitted_by on public.org_verification_requests (submitted_by) where submitted_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_organization_members_verified_by on public.organization_members (verified_by) where verified_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_organizations_archived_by on public.organizations (archived_by) where archived_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_platform_settings_updated_by on public.platform_settings (updated_by) where updated_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_player_match_stats_partner_user_id on public.player_match_stats (partner_user_id) where partner_user_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_player_match_stats_sport_id on public.player_match_stats (sport_id) where sport_id is not null$s$,  -- -> sports on delete set null
    $s$create index if not exists idx_player_match_stats_team_id on public.player_match_stats (team_id) where team_id is not null$s$,  -- -> teams on delete set null
    $s$create index if not exists idx_report_jobs_requested_by on public.report_jobs (requested_by) where requested_by is not null$s$,  -- -> users on delete no action
    $s$create index if not exists idx_scoring_formats_created_by on public.scoring_formats (created_by) where created_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_standings_org_unit_id on public.standings (org_unit_id) where org_unit_id is not null$s$,  -- -> org_units on delete cascade
    $s$create index if not exists idx_standings_organization_id on public.standings (organization_id)$s$,  -- -> organizations on delete cascade
    $s$create index if not exists idx_subscription_events_actor_id on public.subscription_events (actor_id) where actor_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_subscriptions_created_by on public.subscriptions (created_by) where created_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_team_entries_championship_organization_id on public.team_entries (championship_organization_id)$s$,  -- -> championship_organizations on delete no action
    $s$create index if not exists idx_team_entries_org_unit_id on public.team_entries (org_unit_id) where org_unit_id is not null$s$,  -- -> org_units on delete set null
    $s$create index if not exists idx_team_entries_organization_id on public.team_entries (organization_id)$s$,  -- -> organizations on delete no action
    $s$create index if not exists idx_user_invitations_accepted_user_id on public.user_invitations (accepted_user_id) where accepted_user_id is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_user_invitations_invited_by on public.user_invitations (invited_by)$s$,  -- -> users on delete cascade
    $s$create index if not exists idx_user_org_roles_assigned_by on public.user_org_roles (assigned_by) where assigned_by is not null$s$,  -- -> users on delete set null
    $s$create index if not exists idx_user_org_roles_role_id on public.user_org_roles (role_id)$s$  -- -> roles on delete cascade
  ] loop
    begin
      execute s;
    exception when undefined_table or undefined_column or undefined_object then
      raise notice 'skipped (fk index): %', s;
    end;
  end loop;
end $$;

-- 3. Redundant indexes: each is a left prefix of another index on the same table,
--    which serves every query it could. They only cost write time. Uniques and
--    primary keys are never dropped, and each drop happens only if the index that
--    covers it exists in THIS database (RDS and Supabase need not match exactly).
do $$
declare pair text[];
begin
  foreach pair slice 1 in array array[
    array['idx_board_lines_line', 'uq_board_line'],
    array['idx_event_officials_event_id', 'event_officials_event_id_user_id_key'],
    array['idx_event_institutions_event_id', 'idx_event_institutions_event_status'],
    array['idx_combat_lines_line', 'uq_combat_line'],
    array['idx_bat_lines_line', 'uq_bat_line'],
    array['idx_bowl_lines_line', 'uq_bowl_line'],
    array['idx_field_lines_line', 'uq_field_line'],
    array['idx_cricket_innings_fixture', 'uq_cricket_innings'],
    array['idx_fixtures_tournament_discipline_id', 'idx_fixtures_draw_ordering'],
    array['idx_fixtures_official_id', 'idx_fixtures_official_scheduled'],
    array['idx_invasion_lines_line', 'uq_invasion_line'],
    array['idx_net_lines_line', 'uq_net_line'],
    array['idx_notification_cursors_user', 'notification_cursors_pkey'],
    array['idx_notification_reactions_notification_id', 'notification_reactions_notification_id_user_id_reaction_key'],
    array['idx_notifications_event_id', 'idx_notifications_event_created'],
    array['idx_org_unit_members_unit', 'uq_org_unit_members'],
    array['idx_organization_members_organization_id', 'idx_organization_members_org_status'],
    array['idx_organization_members_user_id', 'organization_members_user_id_organization_id_key'],
    array['idx_raid_lines_line', 'uq_raid_line'],
    array['idx_standings_championship', 'idx_standings_scope'],
    array['idx_team_entries_team', 'uq_team_entries_team_championship'],
    array['idx_team_members_team_id', 'team_members_team_id_user_id_key'],
    array['idx_tournament_disciplines_tournament_sport_id', 'tournament_disciplines_tournament_sport_id_discipline_id_key'],
    array['idx_tournament_sports_tournament_id', 'tournament_sports_tournament_id_sport_id_key'],
    array['idx_user_event_roles_user_id', 'user_event_roles_user_id_event_id_role_id_key'],
    array['idx_user_org_roles_org', 'idx_user_org_roles_status'],
    array['idx_users_organization_id', 'idx_users_institution_account_type']
  ] loop
    if to_regclass('public.' || pair[2]) is not null then
      execute format('drop index if exists public.%I', pair[1]);
    else
      raise notice 'kept % - its cover % is missing here', pair[1], pair[2];
    end if;
  end loop;
end $$;
