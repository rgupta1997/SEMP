-- Certificate wizard: recipient categories beyond achievements (medal/placement/award).
--
-- The generator used to issue only from `achievements` rows. The new Recipients step adds
-- four more categories that are NOT achievements: participation (everyone on a locked
-- roster, no win required), organising team & volunteers (a championship's Organiser role
-- assignments), officials & referees (event_officials), and coaches (teams.coach_user_id).
-- None of those four have a single fixture behind them - a coach or an organiser is
-- attached to the EVENT, not to one match - so dedup for them has to key off
-- championship_id instead of fixture_id.
--
-- `recipient_category` also fixes a latent bug in the ORIGINAL achievement-based dedup:
-- `uq_certificates_one_per_recipient` keyed on (fixture_id, user_id, template_id), which
-- means switching an org's template between two runs would silently re-certify someone
-- who already holds the same honour. Category is what should make two certificates "the
-- same thing", not which artwork was picked - so both the fixture-scoped and the new
-- event-scoped constraint drop template_id from the key entirely.

alter table certificates
  add column if not exists recipient_category varchar(24);

-- Backfill: every certificate issued so far came from an achievement, so its category is
-- recovered from that achievement's kind (medal/placement/record/selection/honour -> the
-- winners bucket, award -> the special-awards bucket) via the same (fixture_id, user_id)
-- pair the old dedup index already assumed was unique enough to identify one.
update certificates c
   set recipient_category = case when a.kind = 'award' then 'awards' else 'winners' end
  from achievements a
 where c.recipient_category is null
   and c.fixture_id is not null
   and a.fixture_id = c.fixture_id
   and a.user_id = c.user_id;

-- Anything left (a certificate whose achievement was since deleted, or the rare row with
-- no fixture) defaults to 'winners' rather than being left null - null would exempt it
-- from every dedup constraint below, which is the one thing a certificate register can't
-- have happen quietly.
update certificates set recipient_category = 'winners' where recipient_category is null;

alter table certificates
  alter column recipient_category set not null,
  alter column recipient_category set default 'winners';

-- Dropped first so the file can be re-run. Every other statement here is already
-- guarded; this one was not, so a run that failed further down could not be resumed -
-- it stopped here on "constraint already exists" instead of reaching the failure.
alter table certificates
  drop constraint if exists chk_certificates_recipient_category;

alter table certificates
  add constraint chk_certificates_recipient_category
  check (recipient_category in ('winners', 'awards', 'participation', 'organising', 'officials', 'coaches'));

-- Replace the old template-keyed constraint with the category-keyed one, fixture-scoped.
drop index if exists uq_certificates_one_per_recipient;

-- THE DUPLICATES THE OLD KEY ALLOWED HAVE TO GO FIRST.
--
-- This is the step the migration was missing, and without it the index below cannot be
-- built on any database that has actually issued certificates: dropping template_id from
-- the key is precisely what makes two rows collide that did not collide before. Found on
-- a bench where nine people held eight certificates each for one honour - one per design
-- the organisation had tried - which is the exact bug described at the top of this file,
-- sitting in the data. A migration that fixes a bug forward but cannot pass over the rows
-- the bug produced is a migration that only runs on an empty table.
--
-- Superseded, not deleted and not revoked. `revoked_at` means somebody withdrew a
-- certificate - a real act, on the record, with a reason - and none of these were
-- withdrawn by anyone. `superseded_at` is the register's own word for "replaced by a
-- later issue of the same thing", which is what these are. The rows stay, the serials
-- stay verifiable, and only the newest issue per person per honour stays live.
--
-- Idempotent: a second run finds nothing left unsuperseded to supersede.
update certificates c
   set superseded_at = now()
 where c.revoked_at is null
   and c.superseded_at is null
   and c.fixture_id is not null
   and exists (
     select 1 from certificates newer
      where newer.fixture_id = c.fixture_id
        and newer.user_id = c.user_id
        and newer.recipient_category = c.recipient_category
        and newer.revoked_at is null
        and newer.superseded_at is null
        and (newer.issued_at, newer.id) > (c.issued_at, c.id)
   );

-- The same, for the event-scoped rows the second index below covers.
update certificates c
   set superseded_at = now()
 where c.revoked_at is null
   and c.superseded_at is null
   and c.fixture_id is null
   and c.championship_id is not null
   and exists (
     select 1 from certificates newer
      where newer.championship_id = c.championship_id
        and newer.user_id = c.user_id
        and newer.recipient_category = c.recipient_category
        and newer.fixture_id is null
        and newer.revoked_at is null
        and newer.superseded_at is null
        and (newer.issued_at, newer.id) > (c.issued_at, c.id)
   );
create unique index if not exists uq_certificates_fixture_recipient
  on certificates(fixture_id, user_id, recipient_category)
  where revoked_at is null and superseded_at is null and fixture_id is not null;

-- The new event-scoped constraint, for the four categories with no single fixture behind
-- them: one live certificate per person per category per event, however many disciplines
-- or teams they're attached to within it.
create unique index if not exists uq_certificates_event_recipient
  on certificates(championship_id, user_id, recipient_category)
  where revoked_at is null and superseded_at is null and fixture_id is null;

create index if not exists idx_certificates_recipient_category on certificates(recipient_category);
