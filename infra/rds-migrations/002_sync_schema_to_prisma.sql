-- Brings the RDS schema up to apps/api/prisma/schema.prisma: 33 tables -> 71.
--
-- APPLIED to semp-prod (ap-south-1) on 2026-09-24. Kept as the record of what ran.
--
-- Generated with:
--   prisma migrate diff --from-url <rds> \
--     --to-schema-datamodel apps/api/prisma/schema.prisma --script
--
-- ...then modified in exactly two places, both for the same reason. Prisma emitted
--
--     DROP INDEX "event_institutions_event_id_institution_id_key";
--     DROP INDEX "roles_name_key";
--
-- but both indexes are owned by a UNIQUE CONSTRAINT, and Postgres refuses to drop
-- an index out from under one ("...requires it. HINT: You can drop constraint ...
-- instead"). They became ALTER TABLE ... DROP CONSTRAINT. The unfamiliar first name
-- is a fossil: the table was renamed event_institutions -> championship_organizations
-- and the constraint kept its original name.
--
-- Run 001_notifications_audience_to_jsonb.sql FIRST. Without it this diff also
-- contains `ALTER TABLE "notifications" DROP COLUMN "audience", ADD COLUMN
-- "audience" JSONB NOT NULL`, which against 144 existing rows does not lose data so
-- much as abort - a NOT NULL column with no default cannot be added to a populated
-- table - leaving the schema half applied.
--
-- Applied wrapped in BEGIN/COMMIT. That is not ceremony: the first attempt failed on
-- the constraint problem above, and the transaction is the only reason the database
-- was still at a clean 33 tables afterwards rather than somewhere in between.
--
-- Data preserved through both migrations: 818 users, 29 organizations, 6
-- championships, 342 fixtures, 144 notifications. `prisma migrate diff` reports an
-- empty migration afterwards.
--
-- One deliberate drop: `sponsors` (0 rows, absent from schema.prisma), confirmed.

-- CreateEnum
CREATE TYPE "billing_period" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('active', 'pending_downgrade', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "tier" AS ENUM ('free', 'pro', 'max');

-- CreateEnum
CREATE TYPE "role_kind" AS ENUM ('org', 'event');

-- CreateEnum
CREATE TYPE "role_scope" AS ENUM ('whole_org', 'campus_unit', 'single_event');

-- DropForeignKey
ALTER TABLE "sponsors" DROP CONSTRAINT "sponsors_event_id_fkey";

-- DropIndex
ALTER TABLE "championship_organizations" DROP CONSTRAINT "event_institutions_event_id_institution_id_key";

-- DropIndex
ALTER TABLE "roles" DROP CONSTRAINT "roles_name_key";

-- AlterTable
ALTER TABLE "championship_invitations" ADD COLUMN     "org_unit_id" UUID;

-- AlterTable
ALTER TABLE "championship_organizations" ADD COLUMN     "org_unit_id" UUID;

-- AlterTable
ALTER TABLE "championships" ADD COLUMN     "allow_individual_entry" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "country" VARCHAR,
ADD COLUMN     "entry_level" VARCHAR(16) NOT NULL DEFAULT 'organization',
ADD COLUMN     "entry_scope_unit_id" UUID,
ADD COLUMN     "host_organization_id" UUID,
ADD COLUMN     "region" VARCHAR,
ADD COLUMN     "type" VARCHAR,
ADD COLUMN     "visibility" VARCHAR NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "demo_requests" ADD COLUMN     "city" VARCHAR,
ADD COLUMN     "event_date" TEXT,
ADD COLUMN     "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "participant_count" INTEGER,
ADD COLUMN     "source" VARCHAR,
ADD COLUMN     "sport_count" INTEGER;

-- AlterTable
ALTER TABLE "fixture_awards" ADD COLUMN     "award_type_id" UUID;

-- AlterTable
ALTER TABLE "fixture_events" ADD COLUMN     "clock_seconds" INTEGER,
ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "metric_value" DECIMAL,
ADD COLUMN     "period_no" SMALLINT,
ADD COLUMN     "second_user_id" UUID;

-- AlterTable
ALTER TABLE "fixtures" ADD COLUMN     "away_slot_label" VARCHAR,
ADD COLUMN     "completed_at" TIMESTAMPTZ(6),
ADD COLUMN     "home_slot_label" VARCHAR,
ADD COLUMN     "live_started_at" TIMESTAMPTZ(6),
ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_at" TIMESTAMPTZ(6),
ADD COLUMN     "locked_by" UUID,
ADD COLUMN     "match_no" INTEGER,
ADD COLUMN     "scorecard_status" VARCHAR NOT NULL DEFAULT 'draft',
ADD COLUMN     "scoring_format_id" UUID,
ADD COLUMN     "stage_sequence" SMALLINT NOT NULL DEFAULT 1,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "submitted_by" UUID;

-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "member_code" VARCHAR(64),
ADD COLUMN     "rejection_note" TEXT,
ADD COLUMN     "scholarship" BOOLEAN,
ADD COLUMN     "verification" VARCHAR NOT NULL DEFAULT 'pending',
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billing_address" TEXT,
ADD COLUMN     "billing_email" TEXT,
ADD COLUMN     "billing_gstin" TEXT,
ADD COLUMN     "billing_name" TEXT,
ADD COLUMN     "billing_phone" TEXT,
ADD COLUMN     "billing_state_code" TEXT,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "kind" VARCHAR NOT NULL DEFAULT 'community',
ADD COLUMN     "plan" "tier" NOT NULL DEFAULT 'free',
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "area" VARCHAR,
ADD COLUMN     "scope" VARCHAR;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "code" VARCHAR,
ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "role_kind",
ADD COLUMN     "organization_id" UUID,
ADD COLUMN     "scope" "role_scope",
ALTER COLUMN "permission_ids" SET DATA TYPE TEXT[];

-- AlterTable
ALTER TABLE "standings" ADD COLUMN     "org_unit_id" UUID;

-- AlterTable
ALTER TABLE "team_entries" ADD COLUMN     "org_unit_id" UUID;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "coach_user_id" UUID,
ADD COLUMN     "org_unit_id" UUID,
ADD COLUMN     "short_name" VARCHAR(12);

-- AlterTable
ALTER TABLE "tournament_disciplines" ADD COLUMN     "round_formats" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "scoring_format_id" UUID;

-- AlterTable
ALTER TABLE "user_invitations" ADD COLUMN     "email" VARCHAR,
ADD COLUMN     "expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "revoked_at" TIMESTAMPTZ(6),
ADD COLUMN     "token_hash" VARCHAR,
ALTER COLUMN "mobile" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "consent_at" TIMESTAMPTZ(6),
ADD COLUMN     "consent_version" TEXT,
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "erased_at" TIMESTAMPTZ(6),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "handle" VARCHAR(64),
ADD COLUMN     "officiates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "personal_plan" "tier" NOT NULL DEFAULT 'max',
ADD COLUMN     "phone_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "preferred_sports" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sportagon_id" VARCHAR(20),
ADD COLUMN     "tagline" VARCHAR(160);

-- DropTable
DROP TABLE "sponsors";

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "notification_cursors" (
    "user_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone,
    "last_clicked_notification_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_cursors_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "org_verification_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_name" VARCHAR NOT NULL,
    "contact_role" VARCHAR,
    "contact_email" VARCHAR NOT NULL,
    "contact_phone" VARCHAR,
    "registered_name" VARCHAR,
    "registration_id" VARCHAR,
    "website" VARCHAR,
    "address" TEXT,
    "document_url" TEXT,
    "note" TEXT,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "submitted_by" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_sandboxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_name" VARCHAR NOT NULL,
    "slug" VARCHAR NOT NULL,
    "email_domain" VARCHAR NOT NULL,
    "brand_color" VARCHAR,
    "config" JSONB NOT NULL DEFAULT '{}',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "organiser_user_id" UUID,
    "organiser_email" VARCHAR NOT NULL,
    "organiser_password" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'seeding',
    "error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seeded_at" TIMESTAMPTZ(6),

    CONSTRAINT "demo_sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL DEFAULT 'achievement',
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT,
    "sport_id" UUID,
    "occurred_on" DATE NOT NULL,
    "evidence_url" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "achievement_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievement_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "team_id" UUID,
    "organization_id" UUID,
    "championship_id" UUID,
    "fixture_id" UUID,
    "sport_id" UUID,
    "kind" TEXT NOT NULL,
    "medal" TEXT,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "occurred_on" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'locked_result',
    "lock_version" INTEGER,
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_label" TEXT,
    "organization_id" UUID,
    "championship_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "target_label" TEXT,
    "summary" TEXT,
    "diff" JSONB,
    "ip" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey1" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR,
    "user_id" UUID,
    "kind" VARCHAR NOT NULL,
    "token_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone" VARCHAR(20),
    "resends" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "award_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sport_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "award_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sport_id" UUID NOT NULL,
    "discipline_id" UUID,
    "format" VARCHAR(40),
    "grain" VARCHAR(12) NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "drawn" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "silver" INTEGER NOT NULL DEFAULT 0,
    "bronze" INTEGER NOT NULL DEFAULT 0,
    "awards" INTEGER NOT NULL DEFAULT 0,
    "first_on" DATE,
    "last_on" DATE,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "tier" VARCHAR(12) NOT NULL DEFAULT 'all',

    CONSTRAINT "career_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_counters" (
    "organization_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "certificate_counters_pkey" PRIMARY KEY ("organization_id","year","code")
);

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "design" JSONB NOT NULL DEFAULT '{}',
    "code" VARCHAR(8),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_verifications" (
    "id" BIGSERIAL NOT NULL,
    "certificate_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" VARCHAR(24) NOT NULL,
    "ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "certificate_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "template_id" UUID,
    "championship_id" UUID,
    "fixture_id" UUID,
    "user_id" UUID,
    "recipient_name" VARCHAR(200) NOT NULL,
    "serial" VARCHAR(40) NOT NULL,
    "seq" INTEGER NOT NULL,
    "year" SMALLINT NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signature" VARCHAR(64) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_reason" TEXT,
    "lock_version" INTEGER,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "championship_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR NOT NULL,
    "description" TEXT,
    "organization_id" UUID,
    "created_by" UUID,
    "source_championship_id" UUID,
    "shape" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "championship_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifetime_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "championship_id" UUID,
    "fixture_id" UUID,
    "sport_id" UUID,
    "occurred_on" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'locked_result',
    "lock_version" INTEGER,
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifetime_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_domains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "domain" VARCHAR NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "code" VARCHAR,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "admin_user_id" UUID,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "season" SMALLINT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "requested_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_org_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope_ref" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "user_org_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_privacy" (
    "user_id" UUID NOT NULL,
    "public_profile" BOOLEAN NOT NULL DEFAULT false,
    "public_stats" BOOLEAN NOT NULL DEFAULT false,
    "discoverable" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_privacy_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ladder" TEXT NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "plan" "tier" NOT NULL,
    "period" "billing_period" NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'active',
    "current_period_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "pending_plan" "tier",
    "pending_effective_at" TIMESTAMPTZ(6),
    "provider" TEXT NOT NULL DEFAULT 'none',
    "provider_ref" TEXT,
    "created_by" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "ladder" TEXT NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "plan" "tier" NOT NULL,
    "period" "billing_period" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal_paise" BIGINT NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1800,
    "tax_paise" BIGINT NOT NULL,
    "total_paise" BIGINT NOT NULL,
    "buyer_name" TEXT,
    "buyer_email" TEXT,
    "buyer_address" TEXT,
    "buyer_gstin" TEXT,
    "place_of_supply" TEXT,
    "sac_code" TEXT NOT NULL DEFAULT '998314',
    "status" TEXT NOT NULL DEFAULT 'paid',
    "provider" TEXT NOT NULL DEFAULT 'none',
    "provider_ref" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_plan" "tier",
    "to_plan" "tier",
    "actor_id" UUID,
    "note" TEXT,
    "effective_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_unit_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_unit_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fixture_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "organization_id" UUID,
    "sport_id" UUID,
    "rubber_key" VARCHAR(40),
    "partner_user_id" UUID,
    "position" VARCHAR(24),
    "role" VARCHAR(16) NOT NULL DEFAULT 'player',
    "played" BOOLEAN NOT NULL DEFAULT true,
    "minutes" INTEGER,
    "outcome" VARCHAR(8),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "occurred_on" DATE NOT NULL,
    "source" VARCHAR(24) NOT NULL DEFAULT 'locked_result',
    "lock_version" INTEGER,
    "superseded_at" TIMESTAMPTZ(6),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_formats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "sport_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "preset_key" VARCHAR(60),
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "units_won" INTEGER NOT NULL DEFAULT 0,
    "units_lost" INTEGER NOT NULL DEFAULT 0,
    "points_scored" INTEGER NOT NULL DEFAULT 0,
    "queens" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "highest_break" INTEGER NOT NULL DEFAULT 0,
    "breaks_50" INTEGER NOT NULL DEFAULT 0,
    "centuries" INTEGER NOT NULL DEFAULT 0,
    "result_points_x2" SMALLINT,
    "colour" VARCHAR(5),
    "board_no" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutes" INTEGER,
    "opponent_user_id" UUID,

    CONSTRAINT "board_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combat_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "weight_class" VARCHAR(24),
    "side_used" VARCHAR(5),
    "bouts" INTEGER NOT NULL DEFAULT 0,
    "rounds_won" INTEGER NOT NULL DEFAULT 0,
    "rounds_lost" INTEGER NOT NULL DEFAULT 0,
    "touches_for" INTEGER NOT NULL DEFAULT 0,
    "touches_against" INTEGER NOT NULL DEFAULT 0,
    "win_by" VARCHAR(16),
    "penalties" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutes" INTEGER,
    "stoppages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "combat_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_batting_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "innings" SMALLINT NOT NULL,
    "bat_position" SMALLINT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "balls_faced" INTEGER NOT NULL DEFAULT 0,
    "fours" INTEGER NOT NULL DEFAULT 0,
    "sixes" INTEGER NOT NULL DEFAULT 0,
    "dismissal" VARCHAR(20) NOT NULL DEFAULT 'not_out',
    "bowler_id" UUID,
    "fielder_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cricket_batting_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_bowling_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "innings" SMALLINT NOT NULL,
    "balls_bowled" INTEGER NOT NULL DEFAULT 0,
    "maidens" INTEGER NOT NULL DEFAULT 0,
    "runs_conceded" INTEGER NOT NULL DEFAULT 0,
    "wickets" INTEGER NOT NULL DEFAULT 0,
    "wides" INTEGER NOT NULL DEFAULT 0,
    "no_balls" INTEGER NOT NULL DEFAULT 0,
    "dots" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cricket_bowling_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_fielding_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "innings" SMALLINT NOT NULL,
    "catches" INTEGER NOT NULL DEFAULT 0,
    "stumpings" INTEGER NOT NULL DEFAULT 0,
    "run_outs" INTEGER NOT NULL DEFAULT 0,
    "drops" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cricket_fielding_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cricket_innings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fixture_id" UUID NOT NULL,
    "innings" SMALLINT NOT NULL,
    "batting_team_id" UUID,
    "bowling_team_id" UUID,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "wickets" INTEGER NOT NULL DEFAULT 0,
    "balls" INTEGER NOT NULL DEFAULT 0,
    "wides" INTEGER NOT NULL DEFAULT 0,
    "no_balls" INTEGER NOT NULL DEFAULT 0,
    "byes" INTEGER NOT NULL DEFAULT 0,
    "leg_byes" INTEGER NOT NULL DEFAULT 0,
    "penalty_runs" INTEGER NOT NULL DEFAULT 0,
    "ended_by" VARCHAR(12),
    "target" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cricket_innings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invasion_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "position" VARCHAR(24),
    "minutes" INTEGER,
    "started" BOOLEAN NOT NULL DEFAULT true,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "own_goals" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "clean_sheet" BOOLEAN NOT NULL DEFAULT false,
    "yellows" INTEGER NOT NULL DEFAULT 0,
    "reds" INTEGER NOT NULL DEFAULT 0,
    "pens_scored" INTEGER NOT NULL DEFAULT 0,
    "pens_missed" INTEGER NOT NULL DEFAULT 0,
    "points_scored" INTEGER NOT NULL DEFAULT 0,
    "fg_1" INTEGER NOT NULL DEFAULT 0,
    "fg_2" INTEGER NOT NULL DEFAULT 0,
    "fg_3" INTEGER NOT NULL DEFAULT 0,
    "rebounds" INTEGER NOT NULL DEFAULT 0,
    "steals" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "turnovers" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invasion_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "net_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "position" VARCHAR(24),
    "points_scored" INTEGER NOT NULL DEFAULT 0,
    "aces" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "digs" INTEGER NOT NULL DEFAULT 0,
    "service_errors" INTEGER NOT NULL DEFAULT 0,
    "attack_errors" INTEGER NOT NULL DEFAULT 0,
    "reception_errors" INTEGER NOT NULL DEFAULT 0,
    "sets_played" INTEGER NOT NULL DEFAULT 0,
    "sets_won" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutes" INTEGER,
    "points_won" INTEGER NOT NULL DEFAULT 0,
    "sets_lost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "net_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "racquet_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "rubber_key" VARCHAR(40),
    "partner_user_id" UUID,
    "points_won" INTEGER NOT NULL DEFAULT 0,
    "points_lost" INTEGER NOT NULL DEFAULT 0,
    "service_points_played" INTEGER NOT NULL DEFAULT 0,
    "service_points_won" INTEGER NOT NULL DEFAULT 0,
    "return_points_played" INTEGER NOT NULL DEFAULT 0,
    "return_points_won" INTEGER NOT NULL DEFAULT 0,
    "games_won" INTEGER NOT NULL DEFAULT 0,
    "games_lost" INTEGER NOT NULL DEFAULT 0,
    "sets_won" INTEGER NOT NULL DEFAULT 0,
    "sets_lost" INTEGER NOT NULL DEFAULT 0,
    "deciders_won" INTEGER NOT NULL DEFAULT 0,
    "deuce_points_played" INTEGER NOT NULL DEFAULT 0,
    "deuce_points_won" INTEGER NOT NULL DEFAULT 0,
    "tiebreaks_won" INTEGER NOT NULL DEFAULT 0,
    "tiebreaks_lost" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "comeback_win" BOOLEAN NOT NULL DEFAULT false,
    "aces" INTEGER NOT NULL DEFAULT 0,
    "double_faults" INTEGER NOT NULL DEFAULT 0,
    "break_points_played" INTEGER NOT NULL DEFAULT 0,
    "break_points_won" INTEGER NOT NULL DEFAULT 0,
    "break_points_saved" INTEGER NOT NULL DEFAULT 0,
    "lets" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deciders_lost" INTEGER NOT NULL DEFAULT 0,
    "first_serves_in" INTEGER NOT NULL DEFAULT 0,
    "winners" INTEGER NOT NULL DEFAULT 0,
    "unforced_errors" INTEGER NOT NULL DEFAULT 0,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "walkover_received" BOOLEAN NOT NULL DEFAULT false,
    "whitewash" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "racquet_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raid_match_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "position" VARCHAR(24),
    "raid_points" INTEGER NOT NULL DEFAULT 0,
    "raids" INTEGER NOT NULL DEFAULT 0,
    "successful_raids" INTEGER NOT NULL DEFAULT 0,
    "super_raids" INTEGER NOT NULL DEFAULT 0,
    "do_or_die_won" INTEGER NOT NULL DEFAULT 0,
    "tackle_points" INTEGER NOT NULL DEFAULT 0,
    "tackles" INTEGER NOT NULL DEFAULT 0,
    "super_tackles" INTEGER NOT NULL DEFAULT 0,
    "bonus_points" INTEGER NOT NULL DEFAULT 0,
    "all_outs" INTEGER NOT NULL DEFAULT 0,
    "touch_points" INTEGER NOT NULL DEFAULT 0,
    "dream_run_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minutes" INTEGER,

    CONSTRAINT "raid_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notification_deliveries_user_created" ON "notification_deliveries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notification_cursors_user" ON "notification_cursors"("user_id");

-- CreateIndex
CREATE INDEX "idx_org_verification_created" ON "org_verification_requests"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_org_verification_status" ON "org_verification_requests"("status");

-- CreateIndex
CREATE INDEX "idx_org_verification_org" ON "org_verification_requests"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "demo_sandboxes_slug_key" ON "demo_sandboxes"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "demo_sandboxes_email_domain_key" ON "demo_sandboxes"("email_domain");

-- CreateIndex
CREATE INDEX "idx_demo_sandboxes_created" ON "demo_sandboxes"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_achievement_claims_org" ON "achievement_claims"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_achievement_claims_user" ON "achievement_claims"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_actor_at" ON "audit_log"("actor_user_id", "at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_champ_at" ON "audit_log"("championship_id", "at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_org_at" ON "audit_log"("organization_id", "at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_target" ON "audit_log"("target_type", "target_id", "at" DESC);

-- CreateIndex
CREATE INDEX "idx_auth_tokens_expires" ON "auth_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "award_types_code_key" ON "award_types"("code");

-- CreateIndex
CREATE INDEX "idx_award_types_sport" ON "award_types"("sport_id", "sort_order");

-- CreateIndex
CREATE INDEX "idx_career_stats_org_sport" ON "career_stats"("organization_id", "sport_id", "grain");

-- CreateIndex
CREATE INDEX "idx_career_stats_user" ON "career_stats"("user_id", "grain", "last_on" DESC);

-- CreateIndex
CREATE INDEX "idx_career_stats_org_tier" ON "career_stats"("organization_id", "sport_id", "tier", "grain");

-- CreateIndex
CREATE INDEX "idx_career_stats_user_sport_tier" ON "career_stats"("user_id", "sport_id", "tier", "grain");

-- CreateIndex
CREATE INDEX "idx_certificate_templates_org" ON "certificate_templates"("organization_id", "archived_at");

-- CreateIndex
CREATE INDEX "idx_certificate_verifications_cert" ON "certificate_verifications"("certificate_id", "verified_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_certificates_token" ON "certificates"("token");

-- CreateIndex
CREATE INDEX "idx_certificates_championship" ON "certificates"("championship_id");

-- CreateIndex
CREATE INDEX "idx_certificates_org" ON "certificates"("organization_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "idx_certificates_user" ON "certificates"("user_id", "issued_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_certificates_serial" ON "certificates"("organization_id", "serial");

-- CreateIndex
CREATE INDEX "idx_championship_templates_creator" ON "championship_templates"("created_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_championship_templates_org" ON "championship_templates"("organization_id", "name");

-- CreateIndex
CREATE INDEX "idx_claim_evidence_claim" ON "claim_evidence"("claim_id", "uploaded_at");

-- CreateIndex
CREATE INDEX "idx_lifetime_user_date" ON "lifetime_entries"("user_id", "occurred_on" DESC);

-- CreateIndex
CREATE INDEX "idx_org_domains_org" ON "org_domains"("organization_id");

-- CreateIndex
CREATE INDEX "idx_org_units_org" ON "org_units"("organization_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_org_units_parent" ON "org_units"("parent_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_org_units_admin" ON "org_units"("admin_user_id");

-- CreateIndex
CREATE INDEX "idx_org_units_status" ON "org_units"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_rate_limits_window" ON "rate_limits"("window_start");

-- CreateIndex
CREATE INDEX "idx_report_jobs_org" ON "report_jobs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_user_org_roles_org" ON "user_org_roles"("organization_id");

-- CreateIndex
CREATE INDEX "idx_user_org_roles_user" ON "user_org_roles"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_org_roles_status" ON "user_org_roles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "idx_invoices_number" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "idx_invoices_subscription" ON "invoices"("subscription_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "idx_subscription_events_sub" ON "subscription_events"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_org_unit_members_org" ON "org_unit_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_org_unit_members_unit" ON "org_unit_members"("org_unit_id");

-- CreateIndex
CREATE INDEX "idx_org_unit_members_user" ON "org_unit_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_org_unit_members" ON "org_unit_members"("org_unit_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_pms_fixture" ON "player_match_stats"("fixture_id");

-- CreateIndex
CREATE INDEX "idx_pms_org" ON "player_match_stats"("organization_id", "sport_id");

-- CreateIndex
CREATE INDEX "idx_pms_stats" ON "player_match_stats" USING GIN ("stats" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "idx_pms_user" ON "player_match_stats"("user_id", "occurred_on" DESC);

-- CreateIndex
CREATE INDEX "idx_scoring_formats_org" ON "scoring_formats"("organization_id");

-- CreateIndex
CREATE INDEX "idx_scoring_formats_sport" ON "scoring_formats"("sport_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_board_line" ON "board_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_board_lines_line" ON "board_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_board_opponent" ON "board_match_lines"("opponent_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_combat_line" ON "combat_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_combat_lines_line" ON "combat_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_bat_bowler" ON "cricket_batting_lines"("bowler_id");

-- CreateIndex
CREATE INDEX "idx_bat_lines_line" ON "cricket_batting_lines"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bat_line" ON "cricket_batting_lines"("line_id", "innings");

-- CreateIndex
CREATE INDEX "idx_bowl_lines_line" ON "cricket_bowling_lines"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_bowl_line" ON "cricket_bowling_lines"("line_id", "innings");

-- CreateIndex
CREATE INDEX "idx_field_lines_line" ON "cricket_fielding_lines"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_field_line" ON "cricket_fielding_lines"("line_id", "innings");

-- CreateIndex
CREATE INDEX "idx_cricket_innings_fixture" ON "cricket_innings"("fixture_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cricket_innings" ON "cricket_innings"("fixture_id", "innings");

-- CreateIndex
CREATE UNIQUE INDEX "uq_invasion_line" ON "invasion_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_invasion_lines_line" ON "invasion_match_lines"("line_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_net_line" ON "net_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_net_lines_line" ON "net_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_racquet_lines_line" ON "racquet_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_racquet_lines_partner" ON "racquet_match_lines"("partner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_raid_line" ON "raid_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_raid_lines_line" ON "raid_match_lines"("line_id");

-- CreateIndex
CREATE INDEX "idx_championship_invitations_unit" ON "championship_invitations"("org_unit_id");

-- CreateIndex
CREATE INDEX "idx_championship_organizations_unit" ON "championship_organizations"("org_unit_id");

-- CreateIndex
CREATE INDEX "idx_championships_entry_level" ON "championships"("entry_level");

-- CreateIndex
CREATE INDEX "idx_fixture_events_second" ON "fixture_events"("second_user_id");

-- CreateIndex
CREATE INDEX "idx_fixtures_stage_sequence" ON "fixtures"("tournament_discipline_id", "stage_sequence", "pool_number");

-- CreateIndex
CREATE INDEX "idx_fixtures_scorecard_status" ON "fixtures"("tournament_discipline_id", "scorecard_status");

-- CreateIndex
CREATE INDEX "idx_fixtures_scoring_format" ON "fixtures"("scoring_format_id");

-- CreateIndex
CREATE INDEX "idx_notifications_audience_gin" ON "notifications" USING GIN ("audience" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "idx_org_members_verification" ON "organization_members"("organization_id", "verification");

-- CreateIndex
CREATE INDEX "idx_organizations_kind" ON "organizations"("kind");

-- CreateIndex
CREATE INDEX "idx_organizations_plan" ON "organizations"("plan");

-- CreateIndex
CREATE INDEX "idx_standings_unit" ON "standings"("championship_id", "org_unit_id");

-- CreateIndex
CREATE INDEX "idx_teams_org_unit" ON "teams"("org_unit_id");

-- CreateIndex
CREATE INDEX "idx_td_scoring_format" ON "tournament_disciplines"("scoring_format_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_sportagon_id" ON "users"("sportagon_id");

-- CreateIndex
CREATE INDEX "idx_users_personal_plan" ON "users"("personal_plan");

-- AddForeignKey
ALTER TABLE "championship_organizations" ADD CONSTRAINT "championship_organizations_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championships" ADD CONSTRAINT "championships_entry_scope_unit_id_fkey" FOREIGN KEY ("entry_scope_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championships" ADD CONSTRAINT "championships_host_organization_id_fkey" FOREIGN KEY ("host_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_scoring_format_id_fkey" FOREIGN KEY ("scoring_format_id") REFERENCES "scoring_formats"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "team_entries" ADD CONSTRAINT "team_entries_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tournament_disciplines" ADD CONSTRAINT "tournament_disciplines_scoring_format_id_fkey" FOREIGN KEY ("scoring_format_id") REFERENCES "scoring_formats"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_cursors" ADD CONSTRAINT "notification_cursors_last_clicked_notification_id_fkey" FOREIGN KEY ("last_clicked_notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_cursors" ADD CONSTRAINT "notification_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championship_invitations" ADD CONSTRAINT "championship_invitations_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixture_awards" ADD CONSTRAINT "fixture_awards_award_type_id_fkey" FOREIGN KEY ("award_type_id") REFERENCES "award_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_verification_requests" ADD CONSTRAINT "org_verification_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_verification_requests" ADD CONSTRAINT "org_verification_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_verification_requests" ADD CONSTRAINT "org_verification_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "demo_sandboxes" ADD CONSTRAINT "demo_sandboxes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "demo_sandboxes" ADD CONSTRAINT "demo_sandboxes_organiser_user_id_fkey" FOREIGN KEY ("organiser_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievement_claims" ADD CONSTRAINT "achievement_claims_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievement_claims" ADD CONSTRAINT "achievement_claims_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievement_claims" ADD CONSTRAINT "achievement_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievement_claims" ADD CONSTRAINT "achievement_claims_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievement_claims" ADD CONSTRAINT "achievement_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "award_types" ADD CONSTRAINT "award_types_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "career_stats" ADD CONSTRAINT "career_stats_discipline_id_fkey" FOREIGN KEY ("discipline_id") REFERENCES "disciplines"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "career_stats" ADD CONSTRAINT "career_stats_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "career_stats" ADD CONSTRAINT "career_stats_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "career_stats" ADD CONSTRAINT "career_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate_counters" ADD CONSTRAINT "certificate_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificate_verifications" ADD CONSTRAINT "certificate_verifications_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_championship_id_fkey" FOREIGN KEY ("championship_id") REFERENCES "championships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championship_templates" ADD CONSTRAINT "championship_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championship_templates" ADD CONSTRAINT "championship_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "championship_templates" ADD CONSTRAINT "championship_templates_source_championship_id_fkey" FOREIGN KEY ("source_championship_id") REFERENCES "championships"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "achievement_claims"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lifetime_entries" ADD CONSTRAINT "lifetime_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_org_roles" ADD CONSTRAINT "user_org_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_org_roles" ADD CONSTRAINT "user_org_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_org_roles" ADD CONSTRAINT "user_org_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_org_roles" ADD CONSTRAINT "user_org_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_second_user_id_fkey" FOREIGN KEY ("second_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "profile_privacy" ADD CONSTRAINT "profile_privacy_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoring_formats" ADD CONSTRAINT "scoring_formats_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoring_formats" ADD CONSTRAINT "scoring_formats_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scoring_formats" ADD CONSTRAINT "scoring_formats_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_match_lines" ADD CONSTRAINT "board_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "board_match_lines" ADD CONSTRAINT "board_match_lines_opponent_user_id_fkey" FOREIGN KEY ("opponent_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "combat_match_lines" ADD CONSTRAINT "combat_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_batting_lines" ADD CONSTRAINT "cricket_batting_lines_bowler_id_fkey" FOREIGN KEY ("bowler_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_batting_lines" ADD CONSTRAINT "cricket_batting_lines_fielder_id_fkey" FOREIGN KEY ("fielder_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_batting_lines" ADD CONSTRAINT "cricket_batting_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_bowling_lines" ADD CONSTRAINT "cricket_bowling_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_fielding_lines" ADD CONSTRAINT "cricket_fielding_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_batting_team_id_fkey" FOREIGN KEY ("batting_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_bowling_team_id_fkey" FOREIGN KEY ("bowling_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cricket_innings" ADD CONSTRAINT "cricket_innings_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invasion_match_lines" ADD CONSTRAINT "invasion_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "net_match_lines" ADD CONSTRAINT "net_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "racquet_match_lines" ADD CONSTRAINT "racquet_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "racquet_match_lines" ADD CONSTRAINT "racquet_match_lines_partner_user_id_fkey" FOREIGN KEY ("partner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "raid_match_lines" ADD CONSTRAINT "raid_match_lines_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "player_match_stats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

