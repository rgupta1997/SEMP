# Migration folder — how this got here, and the rule

This folder was reconciled on 2026-08-25 when the EOS work (`wave_4_5_surface_artefacts`)
and the Notification Service v2 work (merged to `main` as PR #14) were brought onto one
branch. Both lineages had run independently against **different databases**, so the folder
had three colliding timestamps and no single correct order.

## What the folder now contains — 59 files

| Range | Count | Status against the EOS database |
|---|---|---|
| `20260605…` → `20260723…` | 27 | Applied. Common to both lineages, byte-identical. |
| `20260815…` → `20260818…` | 28 | Applied. The EOS waves. |
| `20260627000000_fixture_events` | (1 of the 27) | **Written, never applied.** Says so in its own header. |
| `20260825000000…000030` | 4 | **Pending.** Notification Service v2. |

## The rule: never re-date an applied migration

The three collisions were resolved by moving the **unapplied** files, never the applied
ones. Notification Service v2's four migrations were re-dated from `20260811`/`20260815`/
`20260816` to `20260825000000`–`20260825000030` so they sort after everything that is
already live.

This is not cosmetic. A migration that has already run is history — renumbering it makes
the folder disagree with every database that ran it. The v2 files had not run against this
database, so they were free to move.

If you add a migration, date it later than `20260825000030`.

## Before applying the v2 batch

`20260825000000_notification_service_v2.sql` converts `notifications.audience` from
`varchar` to `jsonb`, rewriting every existing row into an `AudienceRule`. It has only ever
run against a database with no EOS data in it.

Its `CASE` handles `'all'`, `'org_admins'` and `'organizations_captains'` — exactly the set
the EOS `notifications_audience_check` constraint allows. The hazard is the `ELSE`, which
produces `{"kind":"everyone","championshipId": championship_id}`; if that column is null the
rule resolves to nobody and the notification silently disappears.

A row only reaches the `ELSE` if it has **no** `target_user_id` (the first branch, which
takes precedence over everything) and does not satisfy one of the three audience branches.
So the check has to exclude direct-user rows:

```sql
select count(*) from notifications
where target_user_id is null
  and championship_id is null
  and not (audience::text = 'org_admins' and organization_id is not null);
```

**Verified 2026-08-25 against the live EOS database: this returns 0.** The conversion is
safe here. For the record, the 567 rows distribute as:

| audience | championship_id | organization_id | target_user_id | rows | converts to |
|---|---|---|---|---|---|
| `all` | set | null | set | 372 | `direct_user` |
| `all` | null | set | set | 124 | `direct_user` |
| `organizations_captains` | set | null | null | 26 | `role` / captain |
| `all` | set | null | null | 24 | `everyone` |
| `org_admins` | set | set | null | 20 | `org_admins` |
| `org_admins` | null | set | null | 3 | `org_admins` |
| `all` | null | null | set | 1 | `direct_user` |

The 125 rows with a null `championship_id` and `audience = 'all'` look alarming and are
fine — every one carries a `target_user_id`, so the first branch claims them before the
`'all'` branch is ever evaluated. A naive count that ignores that precedence reports a
false positive; the query above is the one to trust.

---

## Applied 2026-09-08 — `20260904000000_fixture_completed_at`

Arrived with PR #21 (`EOS-sprint-2-continues`) and was applied by hand against the EOS
database after the merge:

```
npx tsx scripts/apply-migration.ts ../../supabase/migrations/20260904000000_fixture_completed_at.sql
```

All three statements succeeded. Verified afterwards against `information_schema` /
`pg_indexes`: `fixtures.completed_at` exists as nullable `timestamp with time zone`, and
the partial index `idx_fixtures_autolock_due` is present. `apps/api/prisma/schema.prisma`
already carried the column from the PR, so no `prisma db pull` was needed.

**The status table above is stale** — it describes 59 files and the folder now holds 89.
The 30 files added since the 2026-08-25 reconciliation have not been re-audited here; this
entry vouches only for the one migration it names.

---

## Applied 2026-09-08 — `20260908000000_demo_request_details`

Adds `city`, `event_date`, `sport_count`, `participant_count` and `source` to
`demo_requests`, so the marketing site's "Book a demo" form has somewhere to put
the five answers it collects beyond name / email / phone / organisation / type.

Applied with the same runner; all seven statements succeeded. Verified by
submitting the real form in a browser against the real API and reading the row
back — every column landed, including `event_date` as typed ("mid-January, TBC")
and both counts as integers.

Note `event_date` is **text, not date**, on purpose: the form accepts prose. And
`idx_demo_requests_participants` is a partial index, which Prisma cannot express,
so it is deliberately absent from `schema.prisma` — see the comment there.

---

## Applied 2026-09-21 — `20260913000000_demo_request_marketing_consent`

Adds `marketing_consent boolean not null default false` to `demo_requests`, the
separate marketing opt-in that must not be bundled into the enquiry-contact
consent every submission already carries.

Arrived on `main` with the marketing-consent checkbox commit and was applied by
hand after the pull:

```
npx tsx scripts/apply-migration.ts ../../supabase/migrations/20260913000000_demo_request_marketing_consent.sql
```

Both statements succeeded; verified against `information_schema` (`boolean`,
`not null`, default `false`) and by a typed read through the generated client.

**This was blocking the deployed API.** `schema.prisma` already carried the
field from the same commit, so the Lambda bundle shipped a Prisma client that
knew about a column the database did not have. No `prisma db pull` was needed
afterwards, for the same reason.

### Drift audit run at the same time

The whole database was introspected into a throwaway schema and diffed against
`prisma/schema.prisma`. Everything differed only in field ORDER (introspection
emits ordinal order; the committed file is hand-ordered) except one real
difference, which turned out to be a second unapplied migration — see below.

The diff is definitive only for what Prisma models: columns, types, defaults and
non-partial indexes. Partial indexes, check constraints, RLS policies, functions
and triggers are invisible to it and were not audited.

---

## Applied 2026-09-21 — `20260903000000_personal_plan_elite_default`

Found by that drift audit rather than by the pull: `users.personal_plan`
defaulted to `free` in the database and `max` in the committed schema, which is
exactly this migration having never run.

Applied with the same runner after confirming the intent. Both statements
succeeded. Before / after:

| | default | distribution |
|---|---|---|
| before | `free` | `free=1695  max=2  pro=1` |
| after | `max` | `max=1698` |

`organizations.plan` was re-checked afterwards and is still `free`, which the
migration header requires — institutions ARE charged, only the personal ladder
moves.

The UPDATE overwrites the column in place and nothing else remembers what was
there, so the prior state is recorded here: one account held `pro`, two were
already on `max`, and the remaining 1,695 were `free`. If personal plans are
ever sold for real, there was exactly one account already paying for something.

Re-running the introspection diff afterwards leaves ONLY field-ordering
differences, so `schema.prisma` and the database now agree on every column,
type, default and non-partial index. No `db pull` and no `prisma generate` were
needed: the committed schema already described the post-migration state.

---

## Renamed 2026-09-25 — two more timestamp collisions

`supabase db push` against a fresh project failed on `schema_migrations_pkey`:
two more pairs of files shared a version. Same cause as the 2026-08-25
reconciliation, same fix — only the unapplied file in each pair moved:

- `20260903000000_racquet_scoring_and_stats.sql` → `20260903000001` (its own
  header already said PENDING APPLY — never ran anywhere).
- `20260904000000_career_stats_tier.sql` → `20260904000001` (never logged as
  applied above).

`20260904000000_fixture_completed_at.sql` kept its version — it's the one
applied 2026-09-08 per this file, so per the rule above it wasn't free to move.

If you add a migration, date it later than `20260917000000`.

---

## Applied 2026-09-28 — `20260928000000_sportagon_id_prefixes`

Sportagon IDs become three letters + a per-prefix counter: `STG0001` for self
sign-up and every other path, the creating organisation's initials (`AEO0001`)
for People → Add people / Bulk upload and Team → Paste list. Adds
`sportagon_id_counters` and `next_sportagon_ids(prefix, count)`, and switches the
`trg_users_sportagon_id` trigger from `EOS-` to `STG`. Existing IDs untouched.

Applied with the same runner; all four statements succeeded. Verified in a
rolled-back transaction: trigger attached, `AEO` and `STG` count independently,
a plain insert gets `STG`, the number grows past `9999` to `10000`, and a
non-letter prefix is refused. Counter table left empty afterwards.

## Applied 2026-09-28 — `20260928000001_sportagon_id_eos_brand`

Keeps the `EOS-` brand: IDs are now `EOS-STG0001` / `EOS-AEO0001`. Redefines
`next_sportagon_ids()` only; counters untouched. Verified the same way, in a
rolled-back transaction. One real account ("Aman knights", created minutes
earlier) was issued a bare `STG0001` in the gap between the two migrations; it
was renamed to `EOS-STG0001` by hand so every new-style ID carries the brand.

## Applied 2026-09-28 — `20260928000002_platform_settings`

Adds `platform_settings` and seeds `plans_enforced = false`: until real payments
exist, every organisation and person resolves to the top tier and the Billing tab
is hidden. Saved plans and subscriptions are untouched; a super admin turns plans
back on from Platform → Plans & Billing. Verified afterwards: the row reads
`false`, and a `free` organisation ("Aman admin org") resolves to `max`.

## Applied 2026-09-28 — `20260925000000_fixture_format_overrides`

Arrived with main (per-match rule overrides) and was never applied here. The
committed Prisma client selects `fixtures.format_overrides`, so once it was
regenerated every fixtures read failed with P2022 and Schedule and Results were
empty for every event. Applied with the same runner; all four statements
succeeded, and the championship fixtures list reads again. The other migrations
from that merge (`certificate_categories`, `racquet_scoring_and_stats`,
`career_stats_tier`) were checked and are already in the database.

## Applied 2026-09-28 — `20260928000003_championship_archive`

Adds `championships.archived_at` / `archived_by` and a partial index for the purge.
An event with results (completed, a played or locked match, an issued certificate)
can only be archived; archived events leave every list and are permanently deleted
90 days after `archived_at` unless retrieved. The purge runs lazily from the lists
that show archived events, plus `POST /championships/purge-archived` (super admin).
Certificates are detached, not deleted, so they keep verifying; players'
achievements, timeline and career stats are kept. Verified read-only afterwards:
"Aman Multisport event" resolves to archive-only, "Intra Bengaluru event" to delete.

## Applied 2026-09-29 — `20260929000000_organization_archive`

Adds `organizations.archived_at` / `archived_by` (partial index) and
`championships.archived_with_org`. An organisation with any event footprint can only
be archived - no automatic purge - and archiving is blocked while it hosts a live event
or has a team in someone else's unfinished one. Events archived with their
organisation carry `archived_with_org`, are skipped by the 90-day event purge, and
come back when the organisation is retrieved. Verified read-only afterwards: every
"Aman …" organisation resolves to archive-only with the expected blockers, and none
is archived.

## Applied 2026-10-04 — `20261004000000_rubber_lineups_head_to_head`

Adds `player_match_stats.opponent_user_ids uuid[]` (GIN index) for head-to-head
records, and `career_stats.position` with a `'position'` grain for the singles /
doubles split; `uq_career_stats_grain` widened to include it. Checked first that the
grain check was named `career_stats_grain_check`. Applied with the same runner; all
seven statements succeeded. Verified afterwards: both columns present, the grain check
allows `'position'`, and both indexes exist as written. No data changed.

## Applied 2026-10-05 — `20261005000000_event_scoped_disciplines`

Adds `disciplines.championship_id` (nullable, cascades with the event) and an index.
Null = the platform catalogue; set = a custom discipline of that event only, offered
in no other event's setup. Applied with the same runner; both statements succeeded.
Verified afterwards: the column exists and all 154 existing disciplines are untouched
(every one still null, i.e. in the catalogue).

## Applied 2026-10-05 — `20261005000001_pair_serve_receive_points`

Adds `racquet_match_lines.pair_service_points_played` and `pair_return_points_played`
(integer, default 0): a doubles player's pair totals beside their now-personal serve /
receive points. Applied with the same runner; both statements succeeded. Existing rows
read 0 until their fixture is locked again.

## Applied 2026-10-05 — `20261005000002_expedite_stats`

Adds six integer counters (default 0) to `racquet_match_lines` for the table tennis
expedite tiles: `expedite_matches`, `expedite_wins`, `expedite_points_played`,
`expedite_points_won`, `expedite_return_wins`, `expedite_return_losses`. Applied with
the same runner; all six statements succeeded.

## Applied 2026-10-05 — `20261005000003_clutch_stats`

Adds nine integer counters (default 0) to `racquet_match_lines` for pressure stats:
game / match points played, won, faced and saved, and `comeback_games`. Applied with
the same runner; all nine statements succeeded.

## Applied 2026-10-05 — `20261005000004_side_out_stats`

Adds three integer counters (default 0) to `racquet_match_lines` for side-out scoring:
`side_outs_won`, `service_turns`, `service_turn_points`. Applied with the same runner;
all three statements succeeded.

## Applied 2026-10-05 — `20261005000005_side_out_pct_pickles`

Adds `service_turns_faced` (the denominator of side-out %) and `pickles` (pickleball
games won to 0) to `racquet_match_lines`, integer default 0. Applied with the same
runner; both statements succeeded.

## Applied 2026-10-07 — `20261007000001_tennis_service_games`

Adds `service_games_played`, `service_games_won`, `return_games_played` and
`return_games_won` to `racquet_match_lines`, integer default 0, for tennis holds and breaks
(tie-breaks not counted). Applied with the same runner; all four statements succeeded.

## Applied 2026-10-07 — `20261007000000_tennis_serve_stats`

Adds `serve_points_tracked`, `first_serve_points_won`, `second_serve_points_played` and
`second_serve_points_won` to `racquet_match_lines`, integer default 0, for tennis first /
second serve figures (counted only in matches where the scorer recorded serves). Applied
with the same runner; all four statements succeeded.

## Applied 2026-10-05 — `20261005000006_pair_points_won`

Adds `pair_service_points_won` and `pair_return_points_won` to `racquet_match_lines`,
integer default 0, beside the existing pair played counts. Applied with the same
runner; both statements succeeded.

## Applied 2026-10-09 — `20261009000000_fixture_half_point_scores`

Widens `fixtures.home_score` / `away_score` from integer to double precision so chess can
store halves (½-½ games, 2½-1½ team matches). Every existing value stays a whole number;
no data changes. Applied with the same runner, and the column type was read back as
`double precision`. Prisma's `fixtures.home_score/away_score` are `Float?` to match - the
API must not deploy against a database without this migration.

Applied to the **dev** Supabase database only. **Not applied to prod** (the RDS
database) - that needs the owner's go-ahead before the API deploys there.

## Applied 2026-10-09 (dev only) — `20261009000004_tennis_love_holds_bagels`

Adds `love_holds`, `bagels` and `won_from_set_down` to `racquet_match_lines` (integer,
default 0). Tie-break / set / games / deciding-set win % are derived from counters already
stored and need no columns. Applied with the same runner; all three statements succeeded.

## Applied 2026-10-09 (dev only) — `20261009000003_break_points_faced`

Adds `racquet_match_lines.break_points_faced` (integer, default 0): break points against
a player on their own serve, so "break points saved %" can be worked out. Two attempts
failed intermittently (the API was running); the third succeeded and the column was
read back as present.

## Applied 2026-10-09 (dev only) — `20261009000002_draw_scoring_preset_key`

Adds `tournament_disciplines.scoring_preset_key varchar(60)`. A draw's default format
could only be a saved row (`scoring_format_id`), so choosing any BUILT-IN preset saved
null and every match played the sport default - in every sport. The preset's key is
stored here instead; a saved format still wins. The first attempt failed on a lock (the
API was running); the re-run succeeded.

## Applied 2026-10-09 (dev only) — `20261009000001_chess_game_stats`

Adds sixteen integer counters (default 0) to `board_match_lines` for chess per game:
games, wins/draws/losses, points (doubled) and points available, the same split by white
and black, and wins by checkmate / resignation / time plus draws by agreement. Applied to
the dev Supabase database with the same runner; all sixteen statements succeeded. **Not
applied to prod** - pending the owner's go-ahead.

## Applied 2026-10-12 — `20261011000000_supabase_realtime_where_supabase`

Applied to the beta/local Supabase project (`iwxgd…`) with `apply-migration.ts --direct`.
The policy and publication membership were already present beforehand, so this was a
confirming no-op; `20260922000000_retire_supabase_realtime` was deliberately NOT run here
(it would switch beta's live bell off). Not ported to `infra/rds-migrations/` - it is
Supabase-only; the 10-04 → 10-09 batch is, as `011_scoring_stats_oct04_to_oct09.sql`.

Restores Supabase Realtime for notifications on Supabase databases only: RLS on
`notification_deliveries` with the "own deliveries" SELECT policy, and the table back in
the `supabase_realtime` publication. Needed by deploys with `REALTIME_TRANSPORT=supabase`
(beta). Guarded on the publication, the `authenticated` role and `auth.uid()` existing,
so it is a no-op on RDS. Before an RDS baseline dump taken FROM a Supabase database,
re-run `20260922000000_retire_supabase_realtime.sql` first. On dev the policy and
publication were already present (the retire migration had never run there), so this
just recreated the same policy.

---

## Applied 2026-10-10 — the whole 2026-10-04 → 2026-10-09 batch (15 files)

After PR #28 merged to `main`, the database `apps/api/.env` points at was checked column
by column and turned out to be missing **everything dated 2026-10-04 or later**. It had
every migration up to and including `20260929000000_organization_archive`; the entries
above claiming the 10-04 → 10-09 files were applied were written against a different
database, so they do not vouch for this one.

Applied in filename order with the usual runner, each file on its own:

```
npx tsx scripts/apply-migration.ts ../../supabase/migrations/<file>.sql
```

| File | Statements |
|---|---|
| `20261004000000_rubber_lineups_head_to_head` | 7 |
| `20261005000000_event_scoped_disciplines` | 2 |
| `20261005000001_pair_serve_receive_points` | 2 |
| `20261005000002_expedite_stats` | 6 |
| `20261005000003_clutch_stats` | 9 |
| `20261005000004_side_out_stats` | 3 |
| `20261005000005_side_out_pct_pickles` | 2 |
| `20261005000006_pair_points_won` | 2 |
| `20261007000000_tennis_serve_stats` | 4 |
| `20261007000001_tennis_service_games` | 4 |
| `20261009000000_fixture_half_point_scores` | 1 |
| `20261009000001_chess_game_stats` | 16 |
| `20261009000002_draw_scoring_preset_key` | 1 |
| `20261009000003_break_points_faced` | 1 |
| `20261009000004_tennis_love_holds_bagels` | 3 |

All 63 statements succeeded, with the API still running on :4000 — no lock retries were
needed this time. Verified afterwards against `information_schema` / `pg_indexes`:
`fixtures.home_score` and `away_score` now read `double precision`, all 16 chess counters
are on `board_match_lines`, `tournament_disciplines.scoring_preset_key` exists, the racquet
counters are present, and `idx_pms_opponents`, `uq_career_stats_grain` and
`idx_disciplines_championship` all exist.

No `db pull` and no `prisma generate`: `schema.prisma` already described the
post-migration state (it came with the same PRs), which is also why the API was selecting
columns this database did not have until now.

**Still not applied to prod** (the RDS database) — that remains pending the owner's
go-ahead, as the 10-09 entries above say.

---

## Applied 2026-10-12 (dev only) — `20261012000000_carrom_line_stats`

Adds twelve integer counters (default 0) to `board_match_lines` for carrom matches scored
on the board-by-board console: games won/lost, points scored/conceded, best board, slams,
fouls, boards broken and won on the break, and deciding games. Real boards keep
`units_won` / `units_lost`; `queens` now means queens covered. RDS twin:
`infra/rds-migrations/012_carrom_line_stats.sql` (not applied). Applied to dev statement by
statement; all twelve columns were read back as present. **Not applied to prod.**

---

## Applied 2026-10-14 (dev only) — `20261014000000_query_path_indexes`

Index-only output of the 2026-10-14 database audit; no column, table or data change.
Adds indexes matching what the app actually queries (phone sign-in, OTP issue/verify,
the auto-lock sweep), an index on each of the 52 foreign keys that had none, and drops
27 indexes that were left prefixes of another index plus three nothing used
(`idx_users_phone_last10` - replaced by `_any`, `idx_auth_tokens_phone`, `idx_pms_stats`).
Sets `fixtures` fillfactor to 80. Every statement skips itself if its object is missing,
and a redundant index is dropped only if its covering index exists in that database.
Applied with `apply-migration.ts` (3 statements). Read back: 0 unindexed foreign keys,
349 public indexes, and EXPLAIN shows the four target queries on their new indexes.
RDS twin: `infra/rds-migrations/015_query_path_indexes.sql` (not applied). **Not applied to prod.**

---

## Applied 2026-10-23 — the 2026-10-12 → 2026-10-21 batch (10 files), Supabase `iwxgd…`

Checked `information_schema` first: `20261014000000_query_path_indexes` and
`20261015120000_event_setups` were already present; everything else was missing
(including `20261012000000_carrom_line_stats`, which the entry above records as applied
to "dev" - it was not on this database). Applied in filename order with
`apply-migration.ts --direct`, each file on its own:

`20261012000000_carrom_line_stats`, `20261013000000_basketball_shot_attempts`,
`20261013010000_net_points_lost`, `20261016000000_shootout_kicks`,
`20261018000000_championship_host_cities`, `20261020000000_award_system`,
`20261020000010_award_certificates`, `20261020000020_award_achievement_source`,
`20261021000000_team_members_left_at`, `20261021010000_members_start_verified`.

Read back: every new column present, `award_type_sports` and `championship_awards` exist,
`achievements_source_check` admits `organiser_award`, and 0 active members remain
unverified (371 were flipped to verified by the last file).

---

## Applied 2026-10-26 — `20261026000000_sport_scoped_organisers`, Supabase `iwxgd…`

Applied with `apply-migration.ts` (2 statements). Read back from `information_schema`:
`sport_ids uuid[] default '{}'` on both `user_championship_roles` and `user_invitations`;
0 organiser rows limited to sports, so every existing organiser stays overall.
RDS twin: `infra/rds-migrations/027_sport_scoped_organisers.sql` (not applied).
