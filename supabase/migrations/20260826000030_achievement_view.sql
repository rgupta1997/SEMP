-- ============================================================================
-- The honours board leaves the People module
--
-- /organizations/:id/achievements and its timeline were gated on `people.view`.
-- That permission lives in the People area, so the module pre-check in can()
-- resolved them against the PEOPLE module - and an institution that had limited
-- its directory to staff ("people": ["staff"], which IIM Bangalore has) was
-- refusing its own students a board that is switched on for them under Records.
-- The module gate runs ahead of every grant AND the fallback, so a Viewer holding
-- people.view was still denied: the nav offered Achievements and the page 403'd.
--
-- The permission is now `achievement.view`, in the Records area. This migration
-- carries the existing configuration across rather than re-deciding it: every
-- role that could read the board before - platform rows and an institution's own
-- overrides alike - keeps reading it, under the module it actually belongs to.
-- ============================================================================

update roles
set permission_ids = array_append(permission_ids, 'achievement.view')
where 'people.view' = any(permission_ids)
  and not ('achievement.view' = any(permission_ids));
