-- ============================================================================
-- Owner and Org Admin were missing the competition permissions
--
-- 20260825000080 seeded the six organisation roles but gave the scoring and
-- locking permissions only to Sports Admin. The breakdown's matrix (sheet 05)
-- grants submit_scorecard and lock_scorecard to Owner, Org Admin AND Sports
-- Admin, and reopen_scorecard to Owner and Org Admin only.
--
-- That last split is the point of the whole permission: locking is a review,
-- reopening rewrites a published result, and the person at the match should not
-- be able to do the second. Sports Admin therefore keeps lock and does NOT get
-- unlock - which is what the previous migration had right and is preserved here.
--
-- Found by checking what six real accounts could actually do rather than by
-- reading the seed back, which is the only way this class of gap surfaces.
-- ============================================================================

update roles
set permission_ids = array(
  select distinct unnest(permission_ids || array['fixture.score','fixture.lock','fixture.unlock','official.assign'])
)
where organization_id is null and code in ('owner', 'org_admin');

-- Sports Admin assigns officials too - it runs sport day to day - but still may
-- not reverse a locked result.
update roles
set permission_ids = array(
  select distinct unnest(permission_ids || array['official.assign'])
)
where organization_id is null and code = 'sports_admin';
