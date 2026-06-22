-- ============================================================================
-- Championship invitations → direct-to-organization
--   The host now invites an institution by picking it from the master
--   organization list and sending the request straight to that org - no POC
--   mobile number. The invited org's owners/admins see it on login (matched by
--   organization membership, not by a typed phone number) and accept it.
--
--   `organization_id` is therefore set at invite time (it was previously only
--   resolved on accept). `poc_mobile` is kept for historical rows but is no
--   longer collected, so it becomes nullable and its index is dropped in favour
--   of an organization_id index.
--
-- Idempotent so it can be re-applied safely.
-- ============================================================================

alter table championship_invitations alter column poc_mobile drop not null;

drop index if exists idx_championship_invitations_mobile;
create index if not exists idx_championship_invitations_organization
  on championship_invitations (organization_id);

comment on table championship_invitations is 'Host invitations to a specific organization (picked from the master list); the org''s owners/admins see them on login and accepting creates a pending championship_organizations enrollment.';
