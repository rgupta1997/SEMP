-- Custom disciplines belong to the event that created them.
--
-- An organiser creating "Veterans 40+ Singles" for their event used to add it to the
-- platform catalogue every organiser sees. championship_id null = the catalogue;
-- set = that event's own discipline, offered only inside it. Idempotent.

alter table disciplines
  add column if not exists championship_id uuid references championships(id) on delete cascade;

-- "The catalogue plus this event's own" is the read every setup screen makes.
create index if not exists idx_disciplines_championship on disciplines(championship_id);
