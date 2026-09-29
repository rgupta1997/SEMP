-- Sportagon IDs become three letters + a per-prefix counter.
--
--   self sign-up and every other path   STG0001, STG0002, ...
--   created by an organisation          AEO0001 (initials of "Aman enterprise org")
--
-- The API picks the letters (orgIdPrefix in @semp/shared) and supplies the ID; the
-- trigger still mints one for any insert that does not, so "every user has an ID"
-- stays true by construction. Existing EOS-xxxxxxx IDs are never reissued.
--
-- Four digits, then it simply grows: STG9999 is followed by STG10000.

create table if not exists sportagon_id_counters (
  prefix     varchar(3) primary key,
  last_value integer not null default 0
);

-- Hands out p_count unused IDs for one prefix. The upsert row-locks the prefix's
-- counter, so concurrent sign-ups can never be given the same number, and a whole
-- roll import takes one round trip instead of one per person.
create or replace function next_sportagon_ids(p_prefix text, p_count integer)
returns text[]
language plpgsql as $$
declare
  pfx       text := upper(p_prefix);
  ids       text[] := '{}';
  need      integer;
  hi        integer;
  n         integer;
  candidate text;
begin
  if pfx !~ '^[A-Z]{3}$' then
    raise exception 'A Sportagon ID prefix is three letters, not "%"', p_prefix;
  end if;
  loop
    need := p_count - coalesce(array_length(ids, 1), 0);
    exit when need <= 0;
    insert into sportagon_id_counters as c (prefix, last_value) values (pfx, need)
    on conflict (prefix) do update set last_value = c.last_value + excluded.last_value
    returning last_value into hi;
    for n in (hi - need + 1)..hi loop
      -- lpad would TRUNCATE 10000 to "1000", so only pad below four digits.
      candidate := pfx || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
      -- Seed scripts may have supplied IDs in this space; step past them.
      if not exists (select 1 from users where sportagon_id = candidate) then
        ids := ids || candidate;
      end if;
    end loop;
  end loop;
  return ids;
end $$;

-- Same trigger as 20260829000000, now minting STG instead of EOS-.
create or replace function issue_sportagon_id() returns trigger
language plpgsql as $$
begin
  if new.sportagon_id is null then
    new.sportagon_id := (next_sportagon_ids('STG', 1))[1];
  end if;
  return new;
end $$;

comment on function next_sportagon_ids(text, integer) is
  'Allocates p_count unused Sportagon IDs for a 3-letter prefix from sportagon_id_counters.';
