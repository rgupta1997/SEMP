-- ============================================================================
-- The Version 2 notification trigger points, made insertable.
--
-- `notifications.type` is pinned by a check constraint (see
-- 20260828000040_org_verification_requests.sql's own note on this), so the
-- registry in packages/notifications is only HALF the definition: adding a key
-- there and not here does not error at the call site (every call is wrapped
-- best-effort, on purpose - a notification hiccup must never fail the action
-- that triggered it) - it fails silently inside that try/catch, forever, with
-- nothing but a server-log line nobody was watching. That is exactly what
-- happened to all 28 Version 2 trigger points: every one of them was wired
-- correctly at the application layer and rejected by Postgres on every single
-- attempt, with the request that triggered it still succeeding normally - so
-- locking a scorecard, creating an organisation, signing up, all worked, and
-- every notification they were supposed to send simply never existed.
--
-- Rebuilt rather than dropped, same as every prior migration touching this
-- constraint - an unconstrained `type` would let a typo become a notification
-- nothing knows how to render.
-- ============================================================================

alter table notifications drop constraint if exists notifications_type_check;

alter table notifications add constraint notifications_type_check
  check (type in (
    -- ---- pre-existing, unchanged ----
    'manual',
    'event_lifecycle',
    'enrollment_requested',
    'enrollment_approved',
    'enrollment_rejected',
    'enrollment_joined',
    'entry_submitted',
    'contingent_added',
    'org_join_request',
    'org_join_approved',
    'org_join_declined',
    'org_invitation',
    'org_verification_approved',
    'org_verification_rejected',
    'claim_submitted',
    'claim_approved',
    'claim_rejected',
    'plan_changed',
    'plan_downgrade_scheduled',
    'plan_downgrade_applied',
    'plan_upgrade_requested',

    -- ---- Version 2: roles ----
    'role_assigned',
    'role_changed',
    'admin_access_revoked',

    -- ---- Version 2: teams ----
    'team_created',
    'team_player_added',
    'team_player_removed',
    'team_coach_assigned',
    'team_captain_assigned',
    'team_roster_locked',

    -- ---- Version 2: fixtures / matches ----
    'fixtures_generated',
    'fixtures_published',
    'match_scheduled',
    'match_rescheduled',
    'match_venue_changed',
    'match_opponent_changed',
    'match_cancelled',
    'match_live',
    'match_score_locked',
    'result_submitted',
    'team_qualifies',

    -- ---- Version 2: registration ----
    'registration_submitted',
    'participant_approval_pending',
    'registration_rejected',

    -- ---- Version 2: organizations, records, accounts ----
    'organization_created',
    'achievement_created',
    'certificate_generated',
    'account_created',
    'account_security_changed'
  ));
