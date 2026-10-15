-- The intra-org contingent keys that RDS never got.
--
-- RDS was restored from a Supabase dump taken before 20260827000000_intra_org_championships
-- had rebuilt its unique indexes. 002_sync_schema_to_prisma brought the org_unit_id
-- COLUMNS across, but Prisma cannot see expression indexes, so the three keys below
-- stayed the old organisation-only ones. Found 2026-10-16 on UAT: an intra Event
-- Setup apply (WNS, 55 batches of one organisation) failed with
--   Unique constraint failed on (championship_id, tournament_discipline_id, organization_id)
-- because every squad of an intra event belongs to the same organisation. The same
-- gap in standings would collapse an intra results table to one row per draw.
--
-- Each key gets the contingent (org_unit_id, null coalesced to the nil UUID so the
-- inter-org rows keep their duplicate protection - null <> null). Bodies are the
-- Supabase migration's own. Replayable: every step is IF EXISTS / a lookup.
--
-- STATUS: NOT APPLIED. Written 2026-10-16.

-- 1. Drop any unique index or constraint on EXACTLY the old organisation-only key,
--    whatever it is called (a dump can carry a constraint where Supabase has an index).
do $$
declare r record;
begin
  for r in
    select c.relname as idx, con.conname as con, t.relname as tbl
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    left join pg_constraint con on con.conindid = i.indexrelid
    where i.indisunique
      and t.relname in ('team_entries', 'standings', 'championship_organizations')
      and i.indexprs is null            -- plain column keys only: the new ones are expressions
      and (
        (t.relname = 'team_entries' and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(i.indkey) k join pg_attribute a on a.attrelid = t.oid and a.attnum = k
        ) = array['championship_id', 'organization_id', 'tournament_discipline_id'])
        or (t.relname = 'standings' and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(i.indkey) k join pg_attribute a on a.attrelid = t.oid and a.attnum = k
        ) in (array['championship_id', 'organization_id', 'scope_type'],
              array['championship_id', 'organization_id', 'scope_id', 'scope_type']))
        or (t.relname = 'championship_organizations' and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(i.indkey) k join pg_attribute a on a.attrelid = t.oid and a.attnum = k
        ) = array['championship_id', 'organization_id'])
      )
  loop
    if r.con is not null then
      execute format('alter table %I drop constraint %I', r.tbl, r.con);
      raise notice 'dropped constraint %.%', r.tbl, r.con;
    else
      execute format('drop index %I', r.idx);
      raise notice 'dropped index %', r.idx;
    end if;
  end loop;
end $$;

-- 2. The contingent keys (verbatim from the Supabase migration).
alter table championship_organizations
  drop constraint if exists event_institutions_event_id_institution_id_key;

create unique index if not exists uq_championship_entrants
  on championship_organizations (
    championship_id,
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop index if exists uq_standings_scope_org;
create unique index uq_standings_scope_org
  on standings (
    championship_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

drop index if exists uq_team_entries_org_draw;
create unique index uq_team_entries_org_draw
  on team_entries (
    championship_id,
    tournament_discipline_id,
    organization_id,
    coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where tournament_discipline_id is not null;
