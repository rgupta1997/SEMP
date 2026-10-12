-- Pickleball has a catalogue row and no disciplines, so nobody can be entered into it.
--
-- STATUS: NOT APPLIED. Written 2026-10-03.
--
-- 20260903000010_pickleball_sport adds the sport AND its disciplines. On this
-- database the sport exists - with icon 🏓, not the 🥒 the migration inserts - and
-- has zero disciplines. So somebody added the row by hand and the migration never
-- ran: its first INSERT is guarded by `where not exists (... lower(name) =
-- 'pickleball')`, which the hand-added row satisfies, and its second INSERT, the
-- one that matters, never happened.
--
-- The effect is the half-state neither the migration nor the hand-edit intended:
-- Pickleball appears in the sports list and cannot be used, because an entry is
-- made into a discipline and it has none.
--
-- The icon is left alone. 🏓 is somebody's decision, it is also Table Tennis's
-- icon, and this file is about entry being possible at all - swapping it to 🥒 as
-- a side effect would be an unrelated change to a thing a person chose.
--
-- ---------------------------------------------------------------------------
-- ONE ROW FROM THE SOURCE MIGRATION IS DELIBERATELY NOT COPIED
-- ---------------------------------------------------------------------------
-- The source inserts seven disciplines. This file inserts six. The omitted one is
--
--     ('Whole sport', 'team', 1, 15, 0)
--
-- and it is a defect in that migration rather than a difference of opinion.
-- "Whole sport" is not a discipline in this product, it is the ABSENCE of one:
--
--   SportsTab.tsx:201   const WHOLE = '__whole__'      a client-side sentinel
--   SportsTab.tsx:341   <Tile id={WHOLE} title="Whole sport" ...>  rendered
--                       unconditionally, before the real disciplines are mapped
--   MatchConsolePage.tsx:495  "null discipline_id = Whole sport"
--
-- So a real row by that name puts TWO identical "Whole sport" tiles in the Add
-- Discipline modal, and choosing the wrong one writes a discipline_id where every
-- reader expects null. Confirmed against the data: no sport on this database has
-- such a row, and no other migration has ever created one - 20260903000010 is the
-- only file in all 99 that mentions the string.
--
-- "Women's Doubles" IS copied, though Badminton and Table Tennis here lack it. It
-- is a real competition category, it collides with nothing, and omitting it would
-- be me editing the catalogue rather than repairing it. That leaves Pickleball
-- with six where its racquet siblings have five - the source migration's claim to
-- "mirror Badminton and Table Tennis exactly" was already untrue of this database
-- before I touched it, and squaring that up is a catalogue decision for a human.
--
-- Replayable: the not-exists guard is the source migration's own, so this is a
-- no-op if the disciplines arrive by any other route first.

INSERT INTO disciplines (sport_id, name, entry_type, squad_min, squad_max, display_order)
SELECT s.id, d.name, d.entry_type, d.squad_min, d.squad_max, d.display_order
FROM sports s
CROSS JOIN (VALUES
  ('Mixed',            'team',       1, 15, 0),
  ('Men''s Singles',   'individual', 1, 1,  1),
  ('Women''s Singles', 'individual', 1, 1,  2),
  ('Men''s Doubles',   'doubles',    2, 2,  3),
  ('Women''s Doubles', 'doubles',    2, 2,  4),
  ('Mixed Doubles',    'doubles',    2, 2,  5)
) AS d(name, entry_type, squad_min, squad_max, display_order)
WHERE lower(s.name) = 'pickleball'
  AND NOT EXISTS (
    SELECT 1 FROM disciplines x WHERE x.sport_id = s.id AND x.name = d.name
  );

-- Verification. Expect Pickleball 6, and no 'Whole sport' row anywhere:
--
--   SELECT s.name, count(d.*) FROM sports s LEFT JOIN disciplines d ON d.sport_id = s.id
--    WHERE lower(s.name) IN ('pickleball','badminton','table tennis') GROUP BY s.name;
--
--   SELECT count(*) FROM disciplines WHERE name = 'Whole sport';   -- expect 0
