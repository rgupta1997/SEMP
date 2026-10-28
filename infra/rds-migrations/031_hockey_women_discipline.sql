-- Hockey Women catalogue discipline - the RDS twin of
-- supabase/migrations/20261028000010_hockey_women_discipline.sql.
--
-- STATUS: NOT APPLIED. Written 2026-10-28.
--
-- A Women discipline mirroring Men (team, squad 1-15). Does nothing where the Hockey
-- sport row is missing. Data only, idempotent.

insert into disciplines (sport_id, name, entry_type, squad_min, squad_max, display_order)
select s.id, 'Women', 'team', 1, 15,
       coalesce((select m.display_order from disciplines m
                  where m.sport_id = s.id and m.name = 'Men' and m.championship_id is null limit 1), 0) + 1
  from sports s
 where lower(s.name) = 'hockey'
   and not exists (
     select 1 from disciplines x
      where x.sport_id = s.id and x.name = 'Women' and x.championship_id is null
   );
