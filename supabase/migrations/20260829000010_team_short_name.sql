-- ============================================================================
-- Every squad gets a short name, and it is the squad's own
--
-- A results list on a phone has room for about twelve characters per side.
-- "Northfield Institute of Technology B.Tech 2024" is not a name you can put in a
-- scoreboard row, so the phone view had been horizontally scrolling instead - which
-- is how a match list ends up wider than the device it is read on.
--
-- The chip beside each side was already inventing an abbreviation at render time:
--     (org_unit.name || organizations.short_name || teams.name)
--       .replace(/[^a-zA-Z0-9]/g,'').slice(0,3).toUpperCase()
--
-- Derived abbreviations are wrong in the way that matters here. "B.Tech 2023" and
-- "B.Tech 2024" both slice to "BTE"; two campuses called "Bengaluru" and "Bengal"
-- both give "BEN". On a scoreboard the abbreviation IS the identity of the side, and
-- two sides that abbreviate the same are a result nobody can read.
--
-- So it is stored, entered by whoever creates the squad, and required at creation.
-- They know that their two B.Tech squads are BT23 and BT24; a slice never will.
--
-- NULLABLE IN THE DATABASE, REQUIRED BY THE API. 136 squads already exist and a NOT
-- NULL column would need a value invented for every one of them - which is exactly
-- the derived abbreviation this exists to replace. Existing squads are backfilled
-- with a best guess and can be corrected; new ones cannot be created without one.
-- ============================================================================

alter table teams add column if not exists short_name varchar(12);

-- A best guess for what is already there, and only where it is empty.
--
-- Initials of each word for a multi-word name ("B.Tech 2023" -> "BT2023" -> "BT23"),
-- otherwise the first characters. Deliberately unremarkable: it is a starting point
-- somebody will correct on the squad's own screen, not an answer.
update teams
set short_name = upper(
  left(
    regexp_replace(
      -- Initials + any digits, which is what makes a year-suffixed batch name
      -- distinguishable: "B.Tech 2023" keeps the 2023.
      array_to_string(
        array(
          select case when w ~ '^[0-9]+$' then w else left(w, 1) end
          from unnest(regexp_split_to_array(regexp_replace(name, '[^a-zA-Z0-9 ]', ' ', 'g'), '\s+')) as w
          where w <> ''
        ), ''
      ),
      '\s', '', 'g'
    ), 6)
)
where short_name is null or btrim(short_name) = '';

-- Anything the guess could not produce a value for (a name of only punctuation)
-- falls back to the first characters of the name so no row is left blank.
update teams
set short_name = upper(left(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 6))
where short_name is null or btrim(short_name) = '';

-- Last resort, so the column is never empty on an existing row.
update teams set short_name = 'TEAM' where short_name is null or btrim(short_name) = '';

comment on column teams.short_name is
  'Scoreboard abbreviation, entered by the creator. Required by the API on create; nullable here only because 136 rows predate it.';

-- The phone results view reads it for every fixture on screen; the index is for the
-- uniqueness check the API does within an organisation.
create index if not exists idx_teams_short_name on teams (organization_id, upper(short_name));
