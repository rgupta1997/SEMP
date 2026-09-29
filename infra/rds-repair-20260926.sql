-- RDS repair - statements verified to apply against semp-prod.
-- Each was probed individually (begin/rollback) before inclusion.

begin;

-- ===== sequence =============================================

-- invoice_number_seq  [from 20260826000040_plans_and_billing.sql]
create sequence if not exists invoice_number_seq;

-- sportagon_id_seq  [from 20260829000000_issue_sportagon_id.sql]
create sequence if not exists sportagon_id_seq start with 1000000;

-- ===== function =============================================

-- audit_log_is_append_only  [from 20260815010000_audit_log.sql]
create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

-- rate_limit_hit  [from 20260816040000_rate_limits.sql]
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

-- next_certificate_number  [from 20260817010000_certificates.sql]
create or replace function next_certificate_number(p_org uuid, p_year smallint, p_code varchar)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into certificate_counters (organization_id, year, code, next_number)
       values (p_org, p_year, p_code, 1)
  on conflict (organization_id, year, code) do update
          set next_number = certificate_counters.next_number + 1
    returning next_number into n;
  return n;
end $$;

-- certificate_verifications_append_only  [from 20260817010000_certificates.sql]
create or replace function certificate_verifications_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'certificate_verifications is append-only: % is not permitted', tg_op;
end $$;

-- issue_sportagon_id  [from 20260829000000_issue_sportagon_id.sql]
create or replace function issue_sportagon_id() returns trigger
language plpgsql as $$
declare
  candidate varchar(20);
begin
  -- Explicitly supplied (the seed scripts do this) wins: an ID is never reissued,
  -- and that includes not being overwritten on the way in.
  if new.sportagon_id is not null then
    return new;
  end if;
  loop
    candidate := 'EOS-' || lpad(nextval('sportagon_id_seq')::text, 7, '0');
    exit when not exists (select 1 from users where sportagon_id = candidate);
  end loop;
  new.sportagon_id := candidate;
  return new;
end $$;

-- ===== droptrigger =============================================

-- trg_audit_log_no_update  [from 20260815010000_audit_log.sql]
drop trigger if exists trg_audit_log_no_update on audit_log;

-- trg_certificate_verifications_no_update  [from 20260817010000_certificates.sql]
drop trigger if exists trg_certificate_verifications_no_update on certificate_verifications;

-- trg_users_sportagon_id  [from 20260829000000_issue_sportagon_id.sql]
drop trigger if exists trg_users_sportagon_id on users;

-- ===== trigger =============================================

-- trg_audit_log_no_update  [from 20260815010000_audit_log.sql]
create trigger trg_audit_log_no_update
  before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

-- trg_certificate_verifications_no_update  [from 20260817010000_certificates.sql]
create trigger trg_certificate_verifications_no_update
  before update or delete on certificate_verifications
  for each row execute function certificate_verifications_append_only();

-- trg_users_sportagon_id  [from 20260829000000_issue_sportagon_id.sql]
create trigger trg_users_sportagon_id
  before insert on users
  for each row execute function issue_sportagon_id();

-- ===== index =============================================

-- idx_championship_invitations_mobile  [from 20260617000000_championship_invitations.sql]
drop index if exists idx_championship_invitations_mobile;
create index if not exists idx_championship_invitations_mobile       on championship_invitations (poc_mobile);

-- uq_org_domains_domain  [from 20260815000000_org_tenancy_auth_audit.sql]
drop index if exists uq_org_domains_domain;
create unique index if not exists uq_org_domains_domain on org_domains (lower(domain));

-- idx_auth_tokens_email_kind  [from 20260815000000_org_tenancy_auth_audit.sql]
drop index if exists idx_auth_tokens_email_kind;
create index if not exists idx_auth_tokens_email_kind on auth_tokens (lower(email), kind, created_at desc);

-- idx_audit_log_created  [from 20260815000000_org_tenancy_auth_audit.sql]
drop index if exists idx_audit_log_created;
create index if not exists idx_audit_log_created on audit_log (created_at desc);

-- idx_audit_log_org  [from 20260815000000_org_tenancy_auth_audit.sql]
drop index if exists idx_audit_log_org;
create index if not exists idx_audit_log_org on audit_log (organization_id, created_at desc);

-- idx_audit_log_actor  [from 20260815000000_org_tenancy_auth_audit.sql]
drop index if exists idx_audit_log_actor;
create index if not exists idx_audit_log_actor on audit_log (actor_user_id, created_at desc);

-- uq_user_invitations_token  [from 20260815030000_email_invitations.sql]
drop index if exists uq_user_invitations_token;
create unique index if not exists uq_user_invitations_token
  on user_invitations (token_hash) where token_hash is not null;

-- idx_user_invitations_email  [from 20260815030000_email_invitations.sql]
drop index if exists idx_user_invitations_email;
create index if not exists idx_user_invitations_email
  on user_invitations (lower(email), status) where email is not null;

-- idx_championships_type  [from 20260815040000_championship_type.sql]
drop index if exists idx_championships_type;
create index if not exists idx_championships_type on championships (type) where type is not null;

-- idx_championships_region  [from 20260815050000_championship_region.sql]
drop index if exists idx_championships_region;
create index if not exists idx_championships_region on championships (region) where region is not null;

-- uq_organizations_one_personal_per_user  [from 20260815060000_flexible_entry.sql]
drop index if exists uq_organizations_one_personal_per_user;
create unique index if not exists uq_organizations_one_personal_per_user
  on organizations (created_by) where kind = 'personal';

-- uq_org_units_sibling_name  [from 20260815070000_org_units.sql]
drop index if exists uq_org_units_sibling_name;
create unique index if not exists uq_org_units_sibling_name
  on org_units (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- idx_teams_coach  [from 20260815080000_team_coach.sql]
drop index if exists idx_teams_coach;
create index if not exists idx_teams_coach on teams (coach_user_id) where coach_user_id is not null;

-- uq_team_members_jersey  [from 20260815080000_team_coach.sql]
drop index if exists uq_team_members_jersey;
create unique index if not exists uq_team_members_jersey
  on team_members (team_id, jersey_number) where jersey_number is not null;

-- uq_roles_code  [from 20260815090000_role_codes.sql]
drop index if exists uq_roles_code;
create unique index if not exists uq_roles_code on roles (lower(code)) where code is not null;

-- uq_user_org_roles  [from 20260815100000_rbac_engine.sql]
drop index if exists uq_user_org_roles;
create unique index if not exists uq_user_org_roles
  on user_org_roles (user_id, organization_id, role_id);

-- uq_championship_templates_org_name  [from 20260816000000_championship_templates.sql]
drop index if exists uq_championship_templates_org_name;
create unique index if not exists uq_championship_templates_org_name
  on championship_templates (organization_id, lower(name)) where organization_id is not null;

-- uq_championship_templates_personal_name  [from 20260816000000_championship_templates.sql]
drop index if exists uq_championship_templates_personal_name;
create unique index if not exists uq_championship_templates_personal_name
  on championship_templates (created_by, lower(name)) where organization_id is null;

-- uq_championship_templates_system_name  [from 20260816010000_system_templates.sql]
drop index if exists uq_championship_templates_system_name;
create unique index if not exists uq_championship_templates_system_name
  on championship_templates (lower(name)) where is_system;

-- idx_championship_templates_system  [from 20260816010000_system_templates.sql]
drop index if exists idx_championship_templates_system;
create index if not exists idx_championship_templates_system
  on championship_templates (is_system) where is_system;

-- idx_organization_members_user_org_active  [from 20260816020000_membership_role_grants.sql]
drop index if exists idx_organization_members_user_org_active;
create index if not exists idx_organization_members_user_org_active
  on organization_members (user_id, organization_id) where status = 'active';

-- uq_roles_platform_name  [from 20260816050000_org_scoped_roles.sql]
drop index if exists uq_roles_platform_name;
create unique index if not exists uq_roles_platform_name
  on roles (lower(name)) where organization_id is null;

-- uq_roles_org_name  [from 20260816050000_org_scoped_roles.sql]
drop index if exists uq_roles_org_name;
create unique index if not exists uq_roles_org_name
  on roles (organization_id, lower(name)) where organization_id is not null;

-- uq_roles_platform_code  [from 20260816050000_org_scoped_roles.sql]
drop index if exists uq_roles_platform_code;
create unique index if not exists uq_roles_platform_code
  on roles (lower(code)) where organization_id is null and code is not null;

-- uq_roles_org_code  [from 20260816050000_org_scoped_roles.sql]
drop index if exists uq_roles_org_code;
create unique index if not exists uq_roles_org_code
  on roles (organization_id, lower(code)) where organization_id is not null and code is not null;

-- idx_roles_org  [from 20260816050000_org_scoped_roles.sql]
drop index if exists idx_roles_org;
create index if not exists idx_roles_org on roles (organization_id) where organization_id is not null;

-- idx_lifetime_fixture  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_lifetime_fixture;
create index if not exists idx_lifetime_fixture
  on lifetime_entries (fixture_id) where fixture_id is not null;

-- idx_lifetime_org_date  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_lifetime_org_date;
create index if not exists idx_lifetime_org_date
  on lifetime_entries (organization_id, occurred_on desc) where organization_id is not null;

-- uq_lifetime_live_per_fixture  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists uq_lifetime_live_per_fixture;
create unique index if not exists uq_lifetime_live_per_fixture
  on lifetime_entries (user_id, fixture_id, kind, title)
  where fixture_id is not null and superseded_at is null;

-- idx_achievements_user  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_achievements_user;
create index if not exists idx_achievements_user
  on achievements (user_id, occurred_on desc) where user_id is not null;

-- idx_achievements_org  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_achievements_org;
create index if not exists idx_achievements_org
  on achievements (organization_id, occurred_on desc) where organization_id is not null;

-- idx_achievements_fixture  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_achievements_fixture;
create index if not exists idx_achievements_fixture
  on achievements (fixture_id) where fixture_id is not null;

-- uq_achievements_live_user  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists uq_achievements_live_user;
create unique index if not exists uq_achievements_live_user
  on achievements (user_id, fixture_id, kind, title)
  where user_id is not null and fixture_id is not null and superseded_at is null;

-- uq_achievements_live_team  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists uq_achievements_live_team;
create unique index if not exists uq_achievements_live_team
  on achievements (team_id, fixture_id, kind, title)
  where team_id is not null and fixture_id is not null and superseded_at is null;

-- idx_fixture_awards_type  [from 20260816060000_lifetime_and_achievements.sql]
drop index if exists idx_fixture_awards_type;
create index if not exists idx_fixture_awards_type
  on fixture_awards (award_type_id) where award_type_id is not null;

-- uq_org_members_member_code  [from 20260816070000_people_and_demographics.sql]
drop index if exists uq_org_members_member_code;
create unique index if not exists uq_org_members_member_code
  on organization_members (organization_id, lower(member_code))
  where member_code is not null;

-- idx_fixtures_live  [from 20260816080000_squad_entry_and_live.sql]
drop index if exists idx_fixtures_live;
create index if not exists idx_fixtures_live
  on fixtures (status, scheduled_at) where status = 'live';

-- uq_certificate_template_default  [from 20260817010000_certificates.sql]
drop index if exists uq_certificate_template_default;
create unique index if not exists uq_certificate_template_default
  on certificate_templates(organization_id) where is_default and archived_at is null;

-- uq_certificates_one_per_recipient  [from 20260817010000_certificates.sql]
drop index if exists uq_certificates_one_per_recipient;
create unique index if not exists uq_certificates_one_per_recipient
  on certificates(fixture_id, user_id, template_id) where revoked_at is null and superseded_at is null;

-- uq_achievement_claims_pending  [from 20260817020000_achievement_claims.sql]
drop index if exists uq_achievement_claims_pending;
create unique index if not exists uq_achievement_claims_pending
  on achievement_claims(user_id, organization_id, lower(title), occurred_on)
  where status = 'pending';

-- idx_report_jobs_claimable  [from 20260817040000_report_jobs.sql]
drop index if exists idx_report_jobs_claimable;
create index if not exists idx_report_jobs_claimable on report_jobs(status, created_at) where status = 'queued';

-- uq_career_stats_grain  [from 20260904000000_career_stats_tier.sql]
drop index if exists uq_career_stats_grain;
create unique index if not exists uq_career_stats_grain
  on career_stats(
    user_id, organization_id, sport_id,
    coalesce(discipline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(format, ''::varchar),
    tier
  );

-- idx_users_phone_last10  [from 20260825000060_identity_option_b.sql]
drop index if exists idx_users_phone_last10;
create index if not exists idx_users_phone_last10
  on users (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10))
  where phone is not null;

-- uq_users_handle  [from 20260825000060_identity_option_b.sql]
drop index if exists uq_users_handle;
create unique index if not exists uq_users_handle on users (lower(handle)) where handle is not null;

-- idx_auth_tokens_phone  [from 20260825000060_identity_option_b.sql]
drop index if exists idx_auth_tokens_phone;
create index if not exists idx_auth_tokens_phone
  on auth_tokens (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10), kind)
  where phone is not null;

-- idx_users_unverified  [from 20260825000070_identity_verification.sql]
drop index if exists idx_users_unverified;
create index if not exists idx_users_unverified
  on users (created_at desc)
  where email_verified_at is null or phone_verified_at is null;

-- uq_user_org_roles_scoped  [from 20260825000080_role_model.sql]
drop index if exists uq_user_org_roles_scoped;
create unique index if not exists uq_user_org_roles_scoped
  on user_org_roles (user_id, organization_id, role_id, coalesce(scope_ref, ''));

-- idx_profile_privacy_discoverable  [from 20260826000000_profile_privacy.sql]
drop index if exists idx_profile_privacy_discoverable;
create index if not exists idx_profile_privacy_discoverable
  on profile_privacy (discoverable) where discoverable;

-- idx_championships_host_org  [from 20260826000010_championship_host_org.sql]
drop index if exists idx_championships_host_org;
create index if not exists idx_championships_host_org
  on championships (host_organization_id) where host_organization_id is not null;

-- idx_subscriptions_one_live_per_org  [from 20260826000040_plans_and_billing.sql]
drop index if exists idx_subscriptions_one_live_per_org;
create unique index if not exists idx_subscriptions_one_live_per_org
  on subscriptions (organization_id)
  where status in ('active', 'pending_downgrade') and organization_id is not null;

-- idx_subscriptions_one_live_per_user  [from 20260826000040_plans_and_billing.sql]
drop index if exists idx_subscriptions_one_live_per_user;
create unique index if not exists idx_subscriptions_one_live_per_user
  on subscriptions (user_id)
  where status in ('active', 'pending_downgrade') and user_id is not null;

-- idx_subscriptions_due  [from 20260826000040_plans_and_billing.sql]
drop index if exists idx_subscriptions_due;
create index if not exists idx_subscriptions_due
  on subscriptions (current_period_end)
  where status in ('active', 'pending_downgrade');

-- idx_invoices_org  [from 20260826000040_plans_and_billing.sql]
drop index if exists idx_invoices_org;
create index if not exists idx_invoices_org  on invoices (organization_id, issued_at desc) where organization_id is not null;

-- idx_invoices_user  [from 20260826000040_plans_and_billing.sql]
drop index if exists idx_invoices_user;
create index if not exists idx_invoices_user on invoices (user_id, issued_at desc) where user_id is not null;

-- uq_championship_entrants  [from 20260827000000_intra_org_championships.sql]
drop index if exists uq_championship_entrants;
create unique index if not exists uq_championship_entrants
  on championship_organizations (
    championship_id,
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- uq_championship_invite_target  [from 20260828000010_invite_campuses.sql]
drop index if exists uq_championship_invite_target;
create unique index uq_championship_invite_target
  on championship_invitations (
    championship_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('pending', 'accepted');

-- uq_org_verification_open  [from 20260828000040_org_verification_requests.sql]
drop index if exists uq_org_verification_open;
create unique index if not exists uq_org_verification_open
  on org_verification_requests (organization_id)
  where status = 'pending';

-- idx_teams_short_name  [from 20260829000010_team_short_name.sql]
drop index if exists idx_teams_short_name;
create index if not exists idx_teams_short_name on teams (organization_id, upper(short_name));

-- idx_fixtures_match_no  [from 20260829000020_fixture_match_no.sql]
drop index if exists idx_fixtures_match_no;
create index if not exists idx_fixtures_match_no
  on fixtures (tournament_discipline_id, match_no)
  where match_no is not null;

-- uq_scoring_formats_name  [from 20260903000000_racquet_scoring_and_stats.sql]
drop index if exists uq_scoring_formats_name;
create unique index if not exists uq_scoring_formats_name
  on scoring_formats(coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     coalesce(sport_id, '00000000-0000-0000-0000-000000000000'::uuid),
                     lower(name))
  where archived_at is null;

-- uq_pms_fixture_user_rubber  [from 20260903000000_racquet_scoring_and_stats.sql]
drop index if exists uq_pms_fixture_user_rubber;
create unique index if not exists uq_pms_fixture_user_rubber
  on player_match_stats (fixture_id, user_id, coalesce(rubber_key, ''));

-- uq_racquet_line  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists uq_racquet_line;
create unique index if not exists uq_racquet_line
  on racquet_match_lines(line_id, coalesce(rubber_key, ''));

-- idx_invasion_goals  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_invasion_goals;
create index if not exists idx_invasion_goals on invasion_match_lines(goals desc) where goals > 0;

-- idx_invasion_points  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_invasion_points;
create index if not exists idx_invasion_points on invasion_match_lines(points_scored desc) where points_scored > 0;

-- idx_raid_points  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_raid_points;
create index if not exists idx_raid_points on raid_match_lines(raid_points desc) where raid_points > 0;

-- idx_board_break  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_board_break;
create index if not exists idx_board_break on board_match_lines(highest_break desc) where highest_break > 0;

-- idx_bat_runs  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_bat_runs;
create index if not exists idx_bat_runs on cricket_batting_lines(runs desc) where runs > 0;

-- idx_bowl_wickets  [from 20260903000020_per_category_stat_tables.sql]
drop index if exists idx_bowl_wickets;
create index if not exists idx_bowl_wickets on cricket_bowling_lines(wickets desc) where wickets > 0;

-- idx_fixtures_autolock_due  [from 20260904000000_fixture_completed_at.sql]
drop index if exists idx_fixtures_autolock_due;
create index if not exists idx_fixtures_autolock_due
  on fixtures (completed_at)
  where completed_at is not null and scorecard_status <> 'locked';

-- idx_demo_requests_participants  [from 20260908000000_demo_request_details.sql]
drop index if exists idx_demo_requests_participants;
create index if not exists idx_demo_requests_participants
  on demo_requests (participant_count desc)
  where participant_count is not null;

-- ===== comment =============================================

-- issue_sportagon_id  [from 20260829000000_issue_sportagon_id.sql]
comment on function issue_sportagon_id() is
  'Mints users.sportagon_id on insert when not supplied. The column''s "issued at signup" contract lives here, not in the application.';

commit;