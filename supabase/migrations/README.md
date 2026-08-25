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
