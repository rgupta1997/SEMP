-- Keep the EOS- brand on the new Sportagon IDs: EOS-STG0001, EOS-AEO0001.
--
-- Same allocator as 20260928000000 (which is applied and so not edited); only the
-- string it builds changes. Matches EOS_ID_BRAND in @semp/shared. The counters are
-- untouched, so any bare STG0001-style ID issued in between keeps its number and
-- the next one simply carries the brand.

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
      candidate := 'EOS-' || pfx || case when n < 10000 then lpad(n::text, 4, '0') else n::text end;
      if not exists (select 1 from users where sportagon_id = candidate) then
        ids := ids || candidate;
      end if;
    end loop;
  end loop;
  return ids;
end $$;
