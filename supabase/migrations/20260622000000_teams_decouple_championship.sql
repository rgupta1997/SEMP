-- ============================================================================
-- Decouple team creation from championship assignment
--   An organization can now create a team as a standalone asset (just name +
--   sport + org) and assign it to a championship + season + discipline draw
--   later. So championship_id and championship_organization_id become nullable
--   (tournament_discipline_id already was).
--
--   Championship-scoped reads all filter by championship_id, so unassigned teams
--   (NULL championship) are naturally excluded from championship views. The
--   uq_teams_institution_event_discipline unique index is partial
--   (WHERE tournament_discipline_id IS NOT NULL) so standalone teams are
--   unconstrained; once assigned, the one-team-per-discipline rule still applies.
--
--   Purely additive (relaxes NOT NULL); no data is changed. Idempotent.
-- ============================================================================

alter table teams alter column championship_id drop not null;
alter table teams alter column championship_organization_id drop not null;
