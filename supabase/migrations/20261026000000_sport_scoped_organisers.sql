-- Sport-scoped organisers. An Organiser row may be limited to some of the event's
-- sports: they see the whole event but act only on those sports. The list holds
-- catalogue sports.id values, so a sport keeps its organiser across tournaments.
--
-- EMPTY MEANS ALL SPORTS - the overall organiser. Every existing row is therefore
-- unchanged, and nothing needs backfilling.
--
-- user_invitations carries the same list so an invited organiser lands with the
-- scope they were invited to.
-- RDS twin: infra/rds-migrations/027_sport_scoped_organisers.sql.

alter table user_championship_roles add column if not exists sport_ids uuid[] not null default '{}';
alter table user_invitations add column if not exists sport_ids uuid[] not null default '{}';
