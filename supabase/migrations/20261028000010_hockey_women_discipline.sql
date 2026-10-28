-- Hockey: a Women catalogue discipline, the twin of Men (team, squad 1-15).
-- RDS twin: infra/rds-migrations/031_hockey_women_discipline.sql.
-- Five-a-side needs no discipline of its own: Men or Women with a five-a-side format
-- preset and an event squad max. Data only, idempotent.

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
