-- ============================================================================
-- An event is hosted BY an organisation. Say so.
--
-- Until now the only way to answer "who runs this event?" was to find a user
-- holding the organiser role and then ask which organisation they belong to.
-- That derivation is wrong in ways that matter:
--
--   * an organiser who leaves the institution takes the hosting with them;
--   * an organiser who belongs to two organisations makes the event hosted by
--     both, or by whichever the query happened to read first;
--   * a personal organiser - a coach running a local event - looks institutional.
--
-- Hosting is a fact about the event, so it belongs on the event. Nullable,
-- because an individual genuinely can host without an organisation behind them.
-- ============================================================================

alter table championships
  add column if not exists host_organization_id uuid references organizations(id) on delete set null;

comment on column championships.host_organization_id is
  'The organisation running this event. Null means an individual is hosting - a real case, not missing data.';

-- Backfill from the old derivation, but only where it is unambiguous: exactly one
-- organisation across all of the event''s organisers. Where organisers span two
-- organisations the honest answer is "we do not know", and a guess written into a
-- column is worse than a null somebody can fill in.
with derived as (
  select ucr.championship_id, min(om.organization_id::text)::uuid as org_id
  from user_championship_roles ucr
  join roles r  on r.id = ucr.role_id and r.code = 'organiser'
  join organization_members om
       on om.user_id = ucr.user_id and om.status = 'active'
  group by ucr.championship_id
  having count(distinct om.organization_id) = 1
)
update championships c
   set host_organization_id = d.org_id
  from derived d
 where d.championship_id = c.id
   and c.host_organization_id is null;

create index if not exists idx_championships_host_org
  on championships (host_organization_id) where host_organization_id is not null;
