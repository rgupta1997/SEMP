-- A draw's default format can be a BUILT-IN preset. Built-ins have no scoring_formats
-- row and so no id, and scoring_format_id was the only place a draw default lived - so
-- choosing "Best of 3 games" (or any built-in but the first) saved null and every match
-- played the sport default. The preset's key is stored here instead; a saved format in
-- scoring_format_id still wins over it. Nullable, no default. Idempotent.

alter table tournament_disciplines add column if not exists scoring_preset_key varchar(60);
