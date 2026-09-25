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
