-- ============================================================================
-- J2-E7 · The scorecard state machine - the product's spine
--
-- Until now a result could be re-written an unlimited number of times, by any
-- organiser or the assigned official, with no record of what changed or who changed
-- it. Every "verified", "permanent" and "system of record" claim in the PRD resolves
-- to the three states this migration adds:
--
--        record score            submit               lock
--   draft ─────────────▶ draft ─────────▶ submitted ─────────▶ locked
--     ▲                                       │                   │
--     └──────────── unlock (audited, reason) ─┴───────────────────┘
--
-- `scorecard_status` is deliberately separate from `fixtures.status`
-- (scheduled/live/completed/...): one describes where the *match* is, the other how
-- far the *paperwork* has got. A walkover is completed with a draft scorecard; a
-- locked scorecard stays locked whatever happens to the fixture afterwards.
--
-- `lock_version` increments on each unlock → relock, so downstream artefacts
-- (lifetime entries, achievements, certificates) can be matched to the version of
-- the result they were generated from. Cheap now; essential the first time a
-- corrected result has to invalidate a printed certificate.
--
-- BACKFILL, DELIBERATELY NONE: every existing fixture - including completed ones -
-- stays 'draft'. Marking historical results as locked would make the Verified badge
-- mean "we assumed", and it would be the first lie the audit trail tells.
-- ============================================================================

alter table fixtures
  add column if not exists scorecard_status varchar not null default 'draft',
  add column if not exists submitted_at     timestamptz,
  add column if not exists submitted_by     uuid references users(id) on delete set null,
  add column if not exists locked_at        timestamptz,
  add column if not exists locked_by        uuid references users(id) on delete set null,
  add column if not exists lock_version     integer not null default 0;

alter table fixtures
  drop constraint if exists fixtures_scorecard_status_check;
alter table fixtures
  add constraint fixtures_scorecard_status_check
  check (scorecard_status in ('draft', 'submitted', 'locked'));

-- The organiser's lock queue reads "everything submitted in this draw"; the results
-- page reads every card in a draw with its state.
create index if not exists idx_fixtures_scorecard_status
  on fixtures (tournament_discipline_id, scorecard_status);
