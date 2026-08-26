-- ============================================================================
-- The institution hosting an event could not manage it
--
-- 20260825000080 seeded the six organisation roles, and 20260825000090 gave the
-- senior three the competition permissions - scoring, locking, assigning
-- officials. All three of those are about a MATCH. None of them is about the
-- event, and `event.manage` was granted to nobody at all.
--
-- The effect: an institution's owner could reverse a locked result but could not
-- open the event's Setup, because managing an event was answered only by an
-- Organiser row on that event. Whoever happened to be named Organiser held the
-- event personally - and took it with them when they left.
--
-- `event.manage` is now the switch that says "this role runs our events", read by
-- the guard on every championship mutation (manage-access.ts) and by the nav. It
-- is granted here to the three roles the breakdown calls top-level, and because
-- it is a permission rather than a hard-coded role list, an institution can move
-- it on its own Roles & Permissions screen: give it to a role they defined
-- themselves, or take it off Sports Admin.
--
-- `event.approve` travels with it. Approving the organisations entering your own
-- event is part of running it, not a separate office, and leaving it out would
-- mean the person who may configure the event may not let anybody into it.
--
-- Only the PLATFORM rows (organization_id is null) are touched. An institution
-- that has already taken its own copy of one of these roles has made a decision
-- about it, and overwriting that decision here is exactly what owning a copy is
-- supposed to prevent.
-- ============================================================================

update roles
set permission_ids = array(
  select distinct unnest(permission_ids || array['event.manage', 'event.approve'])
)
where organization_id is null
  and code in ('owner', 'org_admin', 'sports_admin');
