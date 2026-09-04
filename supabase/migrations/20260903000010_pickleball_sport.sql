-- ============================================================================
-- Pickleball joins the sports catalogue
--
-- A P0 sport that was absent from every layer: not in the `sports` table, not in
-- the web engine's DEFS, not in tie-templates.ts, and not in any migration. A
-- pickleball draw could not be created at all, and `sportDef('pickleball')` fell
-- through to the generic default - "Period, best of 2, +1 button".
--
-- The racquet kernel ships eight pickleball formats (USAP side-out 11/15/21, MLP
-- rally 21, corporate rally 15 cap 17, pool 11 sudden death, 10-minute time cap,
-- college best-of-3 to 11), so the only thing missing is the catalogue row and the
-- disciplines to enter people into.
--
-- The discipline set mirrors Badminton and Table Tennis exactly - same names, same
-- entry_type / squad sizes / display_order - so the setup UI, squad validation and
-- tie templates all behave identically for it.
--
-- Idempotent: safe to re-run, and a no-op if somebody adds the sport by hand first.
-- ============================================================================

insert into sports (name, icon)
select 'Pickleball', '🥒'
where not exists (select 1 from sports where lower(name) = 'pickleball');

insert into disciplines (sport_id, name, entry_type, squad_min, squad_max, display_order)
select s.id, d.name, d.entry_type, d.squad_min, d.squad_max, d.display_order
from sports s
cross join (values
  ('Whole sport',      'team',       1, 15, 0),
  ('Mixed',            'team',       1, 15, 0),
  ('Men''s Singles',   'individual', 1, 1,  1),
  ('Women''s Singles', 'individual', 1, 1,  2),
  ('Men''s Doubles',   'doubles',    2, 2,  3),
  ('Women''s Doubles', 'doubles',    2, 2,  4),
  ('Mixed Doubles',    'doubles',    2, 2,  5)
) as d(name, entry_type, squad_min, squad_max, display_order)
where lower(s.name) = 'pickleball'
  and not exists (
    select 1 from disciplines x where x.sport_id = s.id and x.name = d.name
  );
