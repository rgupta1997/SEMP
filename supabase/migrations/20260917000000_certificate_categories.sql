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

alter table certificates
  add constraint chk_certificates_recipient_category
  check (recipient_category in ('winners', 'awards', 'participation', 'organising', 'officials', 'coaches'));

-- Replace the old template-keyed constraint with the category-keyed one, fixture-scoped.
drop index if exists uq_certificates_one_per_recipient;
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
