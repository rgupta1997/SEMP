-- ============================================================================
-- J3-E1 · Entering without an institution
--
-- Two small columns and one index; the feature's whole weight is carried by
-- `organizations.kind = 'personal'`, which already exists. A personal org is an
-- auto-provisioned, hidden organisation of exactly one person, so a solo entrant can
-- use the existing enrolment/team/entry machinery without any of it changing - and
-- crucially without the authorisation layer changing, because the creator of that org
-- is its owner and every existing guard already passes for an owner.
--
-- See docs/eos/05-flexible-entry.md §4.1 for why this beats making the organisation
-- FKs nullable across standings, approvals and the public pages.
-- ============================================================================

-- Whether an organiser accepts entries from people with no institution behind them.
-- NOT NULL with a permissive default, and the create route decides the real default
-- per championship: on for public events, off for private ones, where the point is
-- usually that only invited institutions compete.
alter table championships
  add column if not exists allow_individual_entry boolean not null default true;

-- Existing PRIVATE championships were created before anyone could enter individually,
-- and their organisers never agreed to it. Opting them in silently would change what
-- they signed up for; opting them out matches what they have today.
update championships set allow_individual_entry = false where visibility = 'private';

-- ---------------------------------------------------------------------------
-- One personal organisation per person, enforced by the database.
--
-- The provisioning path is "find or create", so this index is not what makes the
-- common case correct - it is what stops the feature being usable to spam the
-- organisations table if that path is ever raced or bypassed.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_organizations_one_personal_per_user
  on organizations (created_by) where kind = 'personal';
