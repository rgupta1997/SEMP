-- Per-match rules, without a format of their own.
--
-- A fixture could already be PINNED to a saved format (`scoring_format_id`), but that
-- column holds an id - so "make this one match 12-minute halves" meant creating and
-- naming a whole format, and every such tweak left another row on the organiser's
-- format shelf. Worse, pinning severs inheritance: re-point the draw's format later
-- and the tweaked match no longer follows it.
--
-- This holds ONLY what was changed. The ladder resolves a format as it always did
-- (frozen > fixture > round > stage > draw > sport default) and these patch the
-- result, so a match with a 12-minute half still inherits everything else and still
-- follows the draw when the draw moves.
--
-- Shape (every key optional, absent = inherit):
--   { "periodMinutes": 12, "extraTimeMinutes": 6, "drawsAllowed": false }
--
-- periodMinutes is PER PERIOD, not the match total - the format stores one whole-match
-- number and divides it down, which is the arithmetic an organiser should never be
-- asked to do in their head.

alter table fixtures
  add column if not exists format_overrides jsonb;

comment on column fixtures.format_overrides is
  'Per-match patch applied on top of the resolved scoring format. Only the keys that were changed; null/absent means inherit. Keys: periodMinutes, extraTimeMinutes, drawsAllowed.';

-- Anything stored here must be an object, so the loader can spread it without
-- type-checking every read. A scalar or an array would be a silent no-op at best.
alter table fixtures
  drop constraint if exists fixtures_format_overrides_is_object;

alter table fixtures
  add constraint fixtures_format_overrides_is_object
  check (format_overrides is null or jsonb_typeof(format_overrides) = 'object');
