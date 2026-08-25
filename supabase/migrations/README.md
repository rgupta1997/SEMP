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

Its `CASE` handles `'all'`, `'org_admins'` and `'organizations_captains'` — which is exactly
the set the EOS `notifications_audience_check` constraint allows, so no row can fall through
to the `ELSE`. One edge remains: the `'all'` branch requires `championship_id is not null`,
and an org-scoped row would not have one. Run this first and expect `0`:

```sql
select count(*) from notifications
where audience::text = 'all' and championship_id is null;
```

If it returns anything, those rows need a rule of their own before the conversion runs —
the `ELSE` would give them `{"kind":"everyone","championshipId":null}`, which resolves to
nobody.
