-- ============================================================================
-- Templates become content, not code
--
-- The four built-in templates lived in a TypeScript const. That meant a new shape
-- needed a deploy, no institution could keep "our annual meet", and a format name had
-- to match the catalogue character-for-character or applying threw.
--
-- The replacement inverts the flow: nothing ships pre-made. An organiser sets a
-- championship up once, the product offers to remember that shape, and from then on it
-- is theirs to reuse. A template is therefore always a description of something that
-- actually worked - which is a far better source of templates than a guess made at
-- build time.
--
-- `shape` is a snapshot, deliberately denormalised to NAMES rather than ids:
--
--   { "type": "inter_programme", "scheme": "medal",
--     "draws": [ { "sport": "Football", "format": "Knockout", "disciplines": [] } ] }
--
-- Ids would rot - a template is meant to outlive the championship it came from, and a
-- discipline can be deleted. Names are matched against the catalogue at apply time and
-- anything unmatched is reported rather than invented, exactly as before.
-- ============================================================================

create table if not exists championship_templates (
  id                      uuid primary key default gen_random_uuid(),
  name                    varchar not null,
  description             text,
  -- Who may reuse it. An organisation makes it the sports office's asset and it
  -- survives the person leaving; null keeps it personal to its creator.
  organization_id         uuid references organizations(id) on delete cascade,
  created_by              uuid not null references users(id) on delete cascade,
  -- What it was captured from, for provenance. Nulled rather than cascading if that
  -- championship is later deleted: the template is still perfectly usable.
  source_championship_id  uuid references championships(id) on delete set null,
  shape                   jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_championship_templates_org on championship_templates (organization_id, name);
create index if not exists idx_championship_templates_creator on championship_templates (created_by, created_at desc);

-- One name per owner, so "Annual Meet" saved twice updates rather than duplicates.
-- Two partial indexes because a null organization_id must not collide with itself
-- across different creators.
create unique index if not exists uq_championship_templates_org_name
  on championship_templates (organization_id, lower(name)) where organization_id is not null;
create unique index if not exists uq_championship_templates_personal_name
  on championship_templates (created_by, lower(name)) where organization_id is null;
