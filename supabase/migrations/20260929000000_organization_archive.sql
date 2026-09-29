-- Archiving an organisation instead of deleting it.
--
-- An organisation with any footprint - a hosted event, an entry or team in any event,
-- an issued certificate, a player's career stats - can only be archived. Archiving
-- hides it and archives the events it hosts; it stays archived until its owner
-- retrieves it (no automatic purge: deleting it would take its certificates, its
-- players' career stats and its rows in other hosts' events with it).
--
-- championships.archived_with_org marks events archived BY the organisation's
-- archive, so retrieving the organisation brings back exactly those - and the event
-- purge (90 days) leaves them alone while their organisation is archived.

alter table organizations add column if not exists archived_at timestamptz;
alter table organizations add column if not exists archived_by uuid references users(id) on delete set null;
create index if not exists idx_organizations_archived on organizations (archived_at) where archived_at is not null;

alter table championships add column if not exists archived_with_org boolean not null default false;
