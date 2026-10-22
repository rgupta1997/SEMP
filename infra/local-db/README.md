# Local database (Docker + Postgres 17)

A throwaway Postgres on `127.0.0.1:5433` whose schema is built by replaying the same SQL
history RDS went through, so it matches UAT/prod (not beta/Supabase).

```bash
npm run db:up          # start container, build schema on first run (idempotent after)
npm run db:seed        # global catalog (sports, disciplines, roles) + admin@semp.local / admin123
npm run dev:api:local  # API on :4000 against the local DB (ignores DB/mail/realtime settings in apps/api/.env)
npm run dev:web        # web on :5173; apps/web/.env.local points it at localhost:4000
```

Other commands: `npm run db:psql`, `npm run db:down` (keeps data), `npm run db:reset` (wipes and rebuilds).
Connection string: `postgresql://semp:semp@127.0.0.1:5433/semp`.

## How the schema is built

1. `baseline-33-tables.sql` - original prod schema, structure only (cut from `semp-prod-full.rds.sql`).
2. `infra/rds-migrations/001-005` - run directly (the ledger does not exist until 005).
3. `infra/rds-migrations/apply.sh --apply` - 006 onward, recorded in `rds_migrations`.

A new RDS migration needs no change here: `npm run db:up` applies anything pending.

## Known differences from RDS
- No data, no users beyond the seeded admin.
- `prisma migrate diff` shows only index-level differences plus `event_setups` (not modelled in Prisma).
- Never run `prisma db push` against this either, for the same reason as RDS (it strips partial indexes/functions).
- `apps/api/.env` is untouched; `infra/local-db/local.env` is loaded ahead of it by the `*:local` scripts.
