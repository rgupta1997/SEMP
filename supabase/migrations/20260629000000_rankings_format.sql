-- A "Rankings" tournament format for measured / ranking sports (powerlifting, swimming,
-- athletics): there are no head-to-head matches - every competitor performs and the
-- final standings come from the ranking event. Fixture generation produces a single
-- team-less event fixture (see fixtures/domain/generators/ranking.ts); scoring uses the
-- multi-competitor event console, whose org points feed championship standings.
insert into tournament_formats (name, description)
values ('Rankings', 'Ranking event - all competitors perform; standings by highest total/points. No head-to-head matches.')
on conflict (name) do nothing;
