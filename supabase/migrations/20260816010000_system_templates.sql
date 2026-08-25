-- ============================================================================
-- The built-in templates move out of TypeScript and into this table
--
-- The previous migration made templates user content. This one moves the four that
-- shipped in `packages/shared/src/championship-templates.ts` into the same table as
-- SYSTEM rows, so there is exactly one place a template can live and exactly one code
-- path that reads one. Everybody sees the system rows; a saved template belongs to the
-- person or the organisation that saved it.
--
-- System rows are `is_system = true` with no `created_by` and no `organization_id` -
-- hence created_by becomes nullable. Nobody owns them, so nobody can delete them
-- (enforced in the service, and the FK can no longer take one away when a user is
-- deleted, which is the real reason the column has to be nullable rather than pointing
-- at some platform account).
--
-- "Start from scratch" is deliberately NOT a row. It is the absence of a template, and
-- making it a row would mean an apply call that walks the whole resolver to do nothing.
-- The wizard renders it as its own card next to the list.
-- ============================================================================

alter table championship_templates
  alter column created_by drop not null;

alter table championship_templates
  add column if not exists is_system boolean not null default false;

-- Ownership must be exactly one of: system, organisation, person.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'championship_templates_ownership') then
    alter table championship_templates add constraint championship_templates_ownership
      check (
        (is_system and created_by is null and organization_id is null)
        or (not is_system and created_by is not null)
      );
  end if;
end $$;

-- The personal-name index assumed created_by was present; system rows need their own.
create unique index if not exists uq_championship_templates_system_name
  on championship_templates (lower(name)) where is_system;

create index if not exists idx_championship_templates_system
  on championship_templates (is_system) where is_system;

-- ---------------------------------------------------------------------------
-- The four built-ins, as data.
--
-- `shape` is the same name-based snapshot a captured template produces, so a system
-- row and a user row are indistinguishable to the applier. Idempotent on the name:
-- re-running will not duplicate, and will not overwrite an edit made in the platform
-- screen either - these are seeds, not managed content.
-- ---------------------------------------------------------------------------
insert into championship_templates (name, description, is_system, shape)
select v.name, v.description, true, v.shape::jsonb
from (values
  (
    'Multi-sport meet',
    'Several sports across a few days, scored on a medal tally. The shape of an annual inter-college or inter-programme championship.',
    $json${
      "type": "multi_sport", "scheme": "medal",
      "draws": [
        { "sport": "Athletics",    "format": "Knockout", "disciplines": [] },
        { "sport": "Badminton",    "format": "Knockout", "disciplines": ["Men's Singles", "Women's Singles"] },
        { "sport": "Basketball",   "format": "Knockout", "disciplines": [] },
        { "sport": "Football",     "format": "Knockout", "disciplines": [] },
        { "sport": "Table Tennis", "format": "Knockout", "disciplines": ["Men's Singles", "Women's Singles"] },
        { "sport": "Volleyball",   "format": "Knockout", "disciplines": [] }
      ]
    }$json$
  ),
  (
    'League tournament',
    'One sport, everybody plays everybody, table decides it. Points for a win, a draw and a loss.',
    $json${
      "type": "single_sport", "scheme": "league_points",
      "draws": [ { "sport": "Football", "format": "Round Robin", "disciplines": [] } ]
    }$json$
  ),
  (
    'Knockout cup',
    'One sport, single elimination, straight to a final. The quickest thing to run.',
    $json${
      "type": "single_sport", "scheme": "placement",
      "draws": [ { "sport": "Cricket", "format": "Knockout", "disciplines": [] } ]
    }$json$
  )
) as v(name, description, shape)
where not exists (
  select 1 from championship_templates t where t.is_system and lower(t.name) = lower(v.name)
);
