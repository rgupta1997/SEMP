-- Everything the six post-cutover supabase/migrations changed that is NOT a
-- table or a column, and so never reached RDS.
--
-- STATUS: NOT APPLIED. Written 2026-10-02.
--
-- ---------------------------------------------------------------------------
-- How a migration numbered 004 missed all of this
-- ---------------------------------------------------------------------------
-- 004 was generated with `prisma migrate diff`, and that diff is only ever about
-- tables, columns, indexes Prisma knows about, and enums. It does not read
-- pg_proc, it does not read pg_trigger, it does not see a partial index it did
-- not author, and it certainly does not see a seed row. So 004 faithfully
-- brought across the *shape* of the six migrations below and silently left
-- behind the behaviour:
--
--   20260925000000_fixture_format_overrides   column: done in 004. comment: no.
--   20260928000000_sportagon_id_prefixes      table:  done in 004. FUNCTIONS: no.
--   20260928000001_sportagon_id_eos_brand     (function only)      FUNCTION:  no.
--   20260928000002_platform_settings          table:  done in 004. SEED ROW:  no.
--   20260928000003_championship_archive       columns: done in 004. INDEX:    no.
--   20260929000000_organization_archive       columns: done in 004. INDEX:    no.
--
-- This is the same class of loss the "never prisma db push at RDS" rule exists
-- for, arriving by a different road: not a tool stripping objects, but a tool
-- that was never looking at them being treated as if it were a complete answer.
-- A clean `prisma migrate diff` means the tables match. It does not mean the
-- database matches.
--
-- ---------------------------------------------------------------------------
-- 1. next_sportagon_ids() - THE ONE THAT IS CURRENTLY A 500
-- ---------------------------------------------------------------------------
-- Absent from RDS. Confirmed live:
--
--     ERROR: function next_sportagon_ids(unknown, integer) does not exist
--
-- apps/api/src/modules/iam/sportagon-id.ts:16 calls it by name at runtime, so
-- three live POST routes throw rather than return:
--
--   people.routes.ts:210  POST /:id/people/import        roster import
--   people.routes.ts:400  POST /:id/people               add a person
--   teams.routes.ts:795   POST /teams/:id/members/bulk   bulk add team members
--
-- None of the three is inside a try/catch that would soften it. 004 created the
-- sportagon_id_counters table this function writes to and left the function
-- itself behind, which is the worst of both: the table looks right and is empty
-- because nothing can write to it.
--
-- The body below is the EOS-branded one from 20260928000001, which supersedes
-- 20260928000000's. Only the string it builds differs.

CREATE OR REPLACE FUNCTION next_sportagon_ids(p_prefix text, p_count integer)
RETURNS text[]
LANGUAGE plpgsql AS $$
declare
  pfx       text := upper(p_prefix);
  ids       text[] := '{}';
  need      integer;
  hi        integer;
  n         integer;
  candidate text;
begin
  if pfx !~ '^[A-Z]{3}$' then
    raise exception 'A Sportagon ID prefix is three letters, not "%"', p_prefix;
  end if;
  loop
    need := p_count - coalesce(array_length(ids, 1), 0);
    exit when need <= 0;
    insert into sportagon_id_counters as c (prefix, last_value) values (pfx, need)
    on conflict (prefix) do update set last_value = c.last_value + excluded.last_value
    returning last_value into hi;
    for n in (hi - need + 1)..hi loop
      -- lpad would TRUNCATE 10000 to "1000", so only pad below four digits.
      candidate := 'EOS-' || pfx || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
      if not exists (select 1 from users where sportagon_id = candidate) then
        ids := ids || candidate;
      end if;
    end loop;
  end loop;
  return ids;
end $$;

COMMENT ON FUNCTION next_sportagon_ids(text, integer) IS
  'Allocates p_count unused Sportagon IDs for a 3-letter prefix from sportagon_id_counters.';

-- ---------------------------------------------------------------------------
-- 2. issue_sportagon_id() - CHANGES THE ID SCHEME FOR NEW USERS
-- ---------------------------------------------------------------------------
-- RDS still has the pre-cutover body, which mints from a sequence:
--
--     candidate := 'EOS-' || lpad(nextval('sportagon_id_seq')::text, 7, '0');
--
-- All 821 existing users are that shape (EOS-0000001 ... ), and sportagon_id_seq
-- sits at 1000820. The trigger works, so sign-up is NOT broken today - this is
-- drift, not an outage, and it is the reason the missing function above went
-- unnoticed: the trigger path never needed it.
--
-- Replacing it switches new IDs to EOS-STG0001. Nothing is renumbered and no
-- existing ID is reissued; the two namespaces cannot collide, because one is
-- EOS- + 7 digits and the other EOS- + 3 letters + 4 digits. But it IS a visible
-- change to the next ID a person is given, which is why it is called out here
-- rather than buried.
--
-- Leaving this statement out is a legitimate choice: items 1, 3 and 5 stand on
-- their own, and the three broken routes are fixed by item 1 alone. Items 1 and
-- 2 are not a package.

CREATE OR REPLACE FUNCTION issue_sportagon_id() RETURNS trigger
LANGUAGE plpgsql AS $$
begin
  if new.sportagon_id is null then
    new.sportagon_id := (next_sportagon_ids('STG', 1))[1];
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The two archive partial indexes
-- ---------------------------------------------------------------------------
-- `WHERE archived_at is not null` is what makes these worth having: archived
-- rows are the rare case, so the index stays small and the "show me the archive"
-- query does not scan 29 organisations or 6 championships to find them. Prisma
-- cannot express a partial index, which is precisely why it neither created
-- these nor reported them missing.

CREATE INDEX IF NOT EXISTS idx_championships_archived
  ON championships (archived_at) WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_archived
  ON organizations (archived_at) WHERE archived_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. plans_enforced - A PRODUCT DECISION, NOT A SCHEMA FIX. READ THIS ONE.
-- ---------------------------------------------------------------------------
-- 20260928000002 seeds plans_enforced = false, and says why: "Off from today:
-- there is no real payment wiring yet."
--
-- That row is absent from RDS, and absent does not mean neutral. resolve.ts:64
-- reads `value = row?.value !== false`, so no row evaluates to TRUE: plan
-- enforcement is currently ON in production. Every capability gate is live
-- against plans nobody can pay for, because the payment wiring the migration
-- refers to still does not exist.
--
-- So this statement is not bringing RDS into line with a schema - it flips a
-- product switch for real users. It is the one thing in this file that a dry run
-- cannot reassure you about, and it is deliberately LAST so it can be deleted
-- without disturbing anything above it.
--
-- Apply it if the intent in 20260928000002 still holds. Delete it if production
-- is meant to enforce plans regardless.

INSERT INTO platform_settings (key, value) VALUES ('plans_enforced', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. fixtures.format_overrides: the CHECK constraint and the comment
-- ---------------------------------------------------------------------------
-- The constraint is the substantive one. 20260925000000 adds it so that a scalar
-- or an array cannot be stored where the loader spreads an object - without it a
-- bad write is "a silent no-op at best", in that migration's own words. 004
-- created the column and not the constraint, so RDS has been accepting
-- `format_overrides = 5` since 2026-09-25. 342 fixtures were checked: all NULL,
-- so nothing existing violates it and the ADD validates instantly.
--
-- Drop-then-add, because ADD CONSTRAINT has no IF NOT EXISTS; this is what makes
-- the file replayable.

ALTER TABLE fixtures DROP CONSTRAINT IF EXISTS fixtures_format_overrides_is_object;
ALTER TABLE fixtures ADD CONSTRAINT fixtures_format_overrides_is_object
  CHECK (format_overrides IS NULL OR jsonb_typeof(format_overrides) = 'object');

COMMENT ON COLUMN fixtures.format_overrides IS
  'Per-match patch applied on top of the resolved scoring format. Only the keys that were changed; null/absent means inherit. Keys: periodMinutes, extraTimeMinutes, drawsAllowed.';

-- Verification.
--
--   SELECT next_sportagon_ids('STG', 2);              -- expect {EOS-STG0001,EOS-STG0002}
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'fixtures_format_overrides_is_object';
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('idx_championships_archived','idx_organizations_archived');
--   SELECT key, value FROM platform_settings WHERE key = 'plans_enforced';
--
-- Then the three routes that were 500ing: POST /:id/people, /:id/people/import,
-- /teams/:id/members/bulk.
