-- Issue the Sportagon ID for real.
--
-- 20260825000060 added users.sportagon_id and commented it "issued once at signup,
-- never reissued" - but the only thing that ever issued one was that migration's own
-- one-time backfill. Nothing in the application writes the column: not signup, not the
-- roll import, not an admin adding a player, not the matrix import. Thirteen code paths
-- create a user and none of them mint an ID, so every account created after that
-- migration ran reads "ID pending" on its own profile, forever.
--
-- The fix belongs in the database rather than in those thirteen call sites. An identity
-- the profile screen claims is issued at signup cannot depend on each new insert path
-- remembering to issue it; a trigger makes "every user has one" true by construction.
--
-- Sequence rather than the original hash-of-uuid: hashtext collides, and the unique
-- index turns a collision into a failed signup. The trigger still checks, because the
-- backfilled hash IDs occupy the same 7-digit space the sequence walks through.

create sequence if not exists sportagon_id_seq start with 1000000;

create or replace function issue_sportagon_id() returns trigger
language plpgsql as $$
declare
  candidate varchar(20);
begin
  -- Explicitly supplied (the seed scripts do this) wins: an ID is never reissued,
  -- and that includes not being overwritten on the way in.
  if new.sportagon_id is not null then
    return new;
  end if;
  loop
    candidate := 'EOS-' || lpad(nextval('sportagon_id_seq')::text, 7, '0');
    exit when not exists (select 1 from users where sportagon_id = candidate);
  end loop;
  new.sportagon_id := candidate;
  return new;
end $$;

drop trigger if exists trg_users_sportagon_id on users;
create trigger trg_users_sportagon_id
  before insert on users
  for each row execute function issue_sportagon_id();

-- Everyone who signed up in the gap. Row by row, so the collision check applies.
do $$
declare
  r record;
  candidate varchar(20);
begin
  for r in select id from users where sportagon_id is null loop
    loop
      candidate := 'EOS-' || lpad(nextval('sportagon_id_seq')::text, 7, '0');
      exit when not exists (select 1 from users where sportagon_id = candidate);
    end loop;
    update users set sportagon_id = candidate where id = r.id;
  end loop;
end $$;

comment on function issue_sportagon_id() is
  'Mints users.sportagon_id on insert when not supplied. The column''s "issued at signup" contract lives here, not in the application.';
