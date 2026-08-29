-- ============================================================================
-- Inviting a CAMPUS to an internal championship
--
-- The organiser of an internal championship names which of their own campuses or
-- batches are taking part. Each invited campus's administrator then builds squads
-- and enters them.
--
-- This is an INVITATION, not an entrant row. The distinction is the whole point:
-- an earlier design gave `championship_organizations` an `org_unit_id`, which put
-- a per-campus participation record between the championship and its squads and
-- was rejected. An invitation says "you are asked to take part"; the squad is
-- still the thing that competes, and it still hangs off the single host entry the
-- championship was created with. Accepting an invitation creates nothing.
--
-- `championship_invitations` already carries status / invited_by / accepted_by /
-- responded_at, which is exactly the shape this needs, so it gains one nullable
-- column rather than a new table.
-- ============================================================================

alter table championship_invitations add column if not exists org_unit_id uuid
  references org_units(id) on delete cascade;

create index if not exists idx_championship_invitations_unit
  on championship_invitations(org_unit_id);

-- One live invitation per campus per championship.
--
-- Partial on `pending` so a withdrawn or declined invitation can be re-issued
-- without tripping the constraint, and coalescing null to the nil UUID so the
-- ORGANISATION invitations that already exist keep their own uniqueness instead
-- of silently losing it to null <> null - the same trap as uq_championship_entrants
-- in 20260827000000, and worth repeating rather than rediscovering.
create unique index if not exists uq_championship_invite_target
  on championship_invitations (
    championship_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

-- `org_name` is NOT NULL and is the human label an invitation was addressed to.
-- For a campus invitation it holds the campus's name, which is what every existing
-- reader already prints - so nothing downstream has to learn a new field to render
-- an invited campus.
comment on column championship_invitations.org_unit_id is
  'Set when the invitation is addressed to a campus or batch of the host organisation, for an internal championship. Null for the organisation invitations used by open championships.';
-- Inviting a campus IS entering it.
--
-- There is nobody outside the organisation to negotiate with, so an "accept" step
-- would be the host asking its own campus for permission - a queue of rubber stamps
-- that only ever delays the squad being built. Campus invitations are therefore
-- created already accepted, and the screens say "In" rather than "Invited".
--
-- The uniqueness has to follow. It was partial on `status = 'pending'`, so once
-- invitations start life accepted it would guard nothing and the same campus could
-- be added twice. Widened to cover both live states; a withdrawn or declined row
-- still frees the slot for a re-invite.
drop index if exists uq_championship_invite_target;

create unique index uq_championship_invite_target
  on championship_invitations (
    championship_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('pending', 'accepted');
