-- Convert notifications.audience from the legacy VARCHAR enum to the AudienceRule
-- JSONB the current code expects, PRESERVING every row's meaning.
--
-- ---------------------------------------------------------------------------
-- Why this is hand-written instead of left to Prisma
-- ---------------------------------------------------------------------------
-- `prisma migrate diff` emits, for this column:
--
--     ALTER TABLE "notifications" DROP COLUMN "audience",
--     ADD COLUMN "audience" JSONB NOT NULL;
--
-- Against the 144 rows in this database that statement does not merely lose data -
-- it FAILS, because a NOT NULL column with no default cannot be added to a
-- populated table. The migration would abort part-way, leaving the schema half
-- applied. Running this file FIRST makes the column already JSONB, so the Prisma
-- diff that follows is purely additive and no longer mentions it.
--
-- ---------------------------------------------------------------------------
-- The mapping, derived from the live data and the registry
-- ---------------------------------------------------------------------------
-- Every one of the 144 rows carries exactly the foreign key its rule needs; this
-- was verified before writing the file, not assumed:
--
--   audience               | type                | n  | key present | becomes
--   -----------------------+---------------------+----+-------------+-------------
--   all                    | org_join_approved   | 47 | target_user | direct_user
--   all                    | enrollment_approved | 19 | championship| everyone
--   all                    | manual              |  1 | championship| everyone
--   org_admins             | org_join_request    | 66 | organization| org_admins
--   organizations_captains | event_lifecycle     | 11 | championship| compose(poc, captain)
--
-- The last row is the one worth reading twice. `organizations_captains` means POCs
-- AND team captains. registry.ts says so explicitly, and records that an earlier
-- migration narrowed it to captains alone and "silently dropped organization owners
-- from every lifecycle announcement". Mapping it to a bare role('captain') here
-- would reintroduce exactly that bug, in data rather than in code - so it maps to
-- the same compose() that event_lifecycle.defaultAudience builds today.
--
-- This matters because the JSON is read, not just stored: visibilityWhere() in
-- modules/notifications/audience.ts matches it with `equals` for a direct rule and
-- `array_contains` on path ['rules'] for a compose. A wrong shape does not error -
-- it silently changes who can see a notification.
--
-- Idempotent: exits early if the column is already JSONB.

BEGIN;

DO $$
DECLARE
  current_type text;
  unmapped integer;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'audience';

  IF current_type IS NULL THEN
    RAISE EXCEPTION 'notifications.audience does not exist - wrong database?';
  END IF;

  IF current_type = 'jsonb' THEN
    RAISE NOTICE 'audience is already jsonb - nothing to do';
    RETURN;
  END IF;

  -- Refuse to run against values this file does not know how to translate. Better a
  -- clean abort than 144 rows converted and a handful quietly wrong.
  SELECT count(*) INTO unmapped
  FROM notifications
  WHERE audience NOT IN ('all', 'org_admins', 'organizations_captains');

  IF unmapped > 0 THEN
    RAISE EXCEPTION 'found % row(s) with an audience value this migration does not map', unmapped;
  END IF;

  -- Every row must be able to build its rule. Asserted rather than trusted, because
  -- a NULL key would produce {"kind":"everyone","championshipId":null} - valid JSON
  -- that matches nobody, and no error anywhere.
  SELECT count(*) INTO unmapped
  FROM notifications
  WHERE (audience = 'all' AND type = 'org_join_approved'   AND target_user_id  IS NULL)
     OR (audience = 'all' AND type <> 'org_join_approved'  AND championship_id IS NULL)
     OR (audience = 'org_admins'             AND organization_id IS NULL)
     OR (audience = 'organizations_captains' AND championship_id IS NULL);

  IF unmapped > 0 THEN
    RAISE EXCEPTION 'found % row(s) missing the key their audience rule needs', unmapped;
  END IF;

  ALTER TABLE notifications ADD COLUMN audience_jsonb JSONB;

  -- 'all' splits on type: org_join_approved was always aimed at one person.
  UPDATE notifications
     SET audience_jsonb = jsonb_build_object('kind', 'direct_user', 'userId', target_user_id)
   WHERE audience = 'all' AND type = 'org_join_approved';

  UPDATE notifications
     SET audience_jsonb = jsonb_build_object('kind', 'everyone', 'championshipId', championship_id)
   WHERE audience = 'all' AND type <> 'org_join_approved';

  UPDATE notifications
     SET audience_jsonb = jsonb_build_object('kind', 'org_admins', 'organizationId', organization_id)
   WHERE audience = 'org_admins';

  -- POCs *and* captains - see the note at the top.
  UPDATE notifications
     SET audience_jsonb = jsonb_build_object(
           'kind', 'compose',
           'rules', jsonb_build_array(
             jsonb_build_object('kind', 'role', 'role', 'poc',     'championshipId', championship_id),
             jsonb_build_object('kind', 'role', 'role', 'captain', 'championshipId', championship_id)
           ))
   WHERE audience = 'organizations_captains';

  SELECT count(*) INTO unmapped FROM notifications WHERE audience_jsonb IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION '% row(s) were not converted', unmapped;
  END IF;

  ALTER TABLE notifications DROP COLUMN audience;
  ALTER TABLE notifications RENAME COLUMN audience_jsonb TO audience;
  ALTER TABLE notifications ALTER COLUMN audience SET NOT NULL;

  RAISE NOTICE 'converted % notification row(s)', (SELECT count(*) FROM notifications);
END $$;

COMMIT;
