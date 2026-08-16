-- Reports become staff-only by default (J5-E1/E2/E3).
--
-- `org_member` shipped with `report.view`, which meant every student at every
-- institution could open the participation, performance and diversity tabs the moment
-- those tabs existed. The figures are aggregate and suppressed below a cohort of five,
-- so this was never an exposure - but J5 is leadership reporting, and "who are we not
-- reaching" is a conversation an institution should choose to open, not one that is
-- open by default on the day the feature ships.
--
-- Owners, admins and captains keep it: they are the staff audience the reports are for.
--
-- ONLY the untouched default is changed. An institution that has already edited its own
-- copy of the role has made a decision, and a migration that silently reversed it would
-- be worse than the default it is fixing - so the update is keyed on the exact grant
-- list this role has always shipped with. Anything else is left exactly as it is.

update roles
   set permission_ids = '{people.view}'
 where code = 'org_member'
   and permission_ids @> '{people.view,report.view}'
   and permission_ids <@ '{people.view,report.view}';

-- An institution that wants it back grants it from its own Roles screen in one click;
-- that path is already exercised by the permission engine's tests.
