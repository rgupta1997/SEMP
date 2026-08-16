# Deploying SEMP — API on AWS Lambda, Web on Netlify

The backend (Express + Prisma) deploys to **AWS Lambda** behind an **API Gateway HTTP
API**; the frontend (Vite static build) deploys to **Netlify**.

> **Render is retired.** The API previously ran as a long-lived Render web service. It
> now runs on Lambda (proven on staging). `render.yaml` is stale and pending removal —
> do not deploy from it.

Committed config: `netlify.toml`, `apps/web/public/_redirects`, `.node-version`,
`apps/api/scripts/build-lambda.mjs`, `apps/api/scripts/deploy-lambda.sh`.

---

## 0. Prerequisites

- A **Postgres database** with the SEMP schema (the Supabase project). Connection string
  ready.
- **AWS CLI v2**, configured for the target account (`aws configure`, or exported creds).
- **Node 20** locally — the bundle targets `node20` and the function runs `nodejs20.x`.
- `apps/api/.env` containing `DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN` (the deploy
  script reads these, and prefers anything you export in the shell over the file).

---

## 1. Backend → AWS Lambda

### 1.1 Generate the Prisma client with the Lambda engine

```bash
npm run prisma:generate --workspace @semp/api
```

`prisma/schema.prisma` declares `binaryTargets = ["native", "rhel-openssl-3.0.x"]`.
`native` is for local dev; **`rhel-openssl-3.0.x` is the engine Lambda's `nodejs20.x`
runtime (Amazon Linux 2023, x86_64) needs**. The build fails loudly if that binary is
missing, rather than shipping a broken bundle.

> `prisma generate` fails while the API dev server is running — stop it first.

### 1.2 Build the bundle

```bash
npm run build:lambda --workspace @semp/api
```

`scripts/build-lambda.mjs`:
- esbuilds `src/lambda.ts` → `dist-lambda/index.mjs` (ESM, `node20`, bundled)
- keeps `@prisma/client` / `.prisma/client` **external** and copies the real packages in
  — Prisma resolves its query-engine binary at runtime and does not bundle cleanly
- **trims every query-engine binary except `rhel-openssl-3.0.x`** to keep the zip small
- prints the uncompressed size, then zips to `apps/api/dist-lambda.zip`

Handler setting: **`index.handler`**.

### 1.3 Deploy

```bash
npm run deploy:lambda --workspace @semp/api
```

Safe to re-run — it creates each resource only if missing, otherwise updates it. It
provisions:

| Resource | Default name | Notes |
| --- | --- | --- |
| IAM role | `semp-api-lambda-role` | `AWSLambdaBasicExecutionRole` only — CloudWatch Logs, no VPC |
| Lambda function | `semp-api` | `nodejs20.x`, x86_64, **512 MB**, **15s timeout** |
| HTTP API | `semp-api-gateway` | API Gateway v2, `$default` route → the function, auto-deploy `$default` stage |
| Resource policy | — | Grants API Gateway permission to invoke |

Overridable via env before running: `FUNCTION_NAME`, `API_NAME`, `ROLE_NAME`,
`AWS_REGION` (default `us-east-1`), `MEMORY_MB`, `TIMEOUT_SEC`,
`RESERVED_CONCURRENCY`, `LAMBDA_DB_CONNECTION_LIMIT`.

On success it prints the invoke URL. Check `curl <endpoint>/health` returns
`{"ok":true}`. The frontend's API base is `<endpoint>/api`.

### 1.4 Database connection settings — read this before changing anything

Use the Supabase **transaction pooler**:

```
postgresql://postgres.[REF]:[PW]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

- `:6543` + `pgbouncer=true` → transaction mode, which multiplexes many clients.
- **`connection_limit=1`.** The deploy script rewrites whatever is in your `.env` to
  `LAMBDA_DB_CONNECTION_LIMIT` (default **1**) before setting it on the function. Each
  Lambda container handles one request at a time, so it never needs more than one
  connection — and scaling out containers must not multiply connection demand against
  the shared pooler.
- **Reserved concurrency defaults to 10.** Worst-case added load is therefore
  `RESERVED_CONCURRENCY × LAMBDA_DB_CONNECTION_LIMIT` = 10 connections. A traffic spike
  gets a clean retryable 429 instead of exhausting the pooler.
  - AWS requires ≥10 concurrency left unreserved account-wide. If the account limit is
    too low (new accounts often start at 10 total), the script **skips reserving and
    warns** rather than failing the deploy. Raise it via Service Quotas.
- **Do not** use the session pooler (`:5432` on the `pooler.supabase.com` host) — its
  15-slot pool is exhausted by Prisma's pool and you get
  `EMAXCONNSESSION: max clients reached in session mode`.
- The **direct** connection (`db.[REF].supabase.co:5432`) is for local `prisma db pull`
  introspection and one-off migrations/seeds, **not** the running service.

### 1.5 Runtime environment variables

Only three matter to `apps/api/src/config/env.ts` on Lambda:

| Var | Notes |
| --- | --- |
| `DATABASE_URL` | Rewritten to `connection_limit=1` by the deploy script |
| `JWT_SECRET` | — |
| `WEB_ORIGIN` | Comma-separated list accepted; set to the Netlify URL (§3) |

`PORT` is ignored — API Gateway owns the socket. `SEED_ADMIN_*` have safe defaults.

---

## 2. What Lambda changes about how the app behaves

These are architectural consequences, not deployment trivia.

- **No long-lived process.** Anything that would have been an interval worker on Render
  has nowhere to run. Background jobs need SQS → worker Lambda, or an EventBridge
  scheduled trigger. See `docs/eos/07-achievements-certificates.md` §4.6.
- **Synchronous responses are capped at the function timeout — currently 15 seconds**
  (API Gateway's own hard ceiling is 29s, so the function timeout is the binding
  constraint). Long operations (certificate batches, report exports) must be
  asynchronous jobs, not request/response.
- **Cold starts.** The Prisma client and engine binary dominate. `buildApp(prisma)` runs
  at module scope in `src/lambda.ts` so it is built once per warm container and reused.
  Keep the bundle small — that is why the build trims unused engine binaries.
- **Per-container connection budget of 1.** Any code assuming a shared pool across
  concurrent work in one process is wrong here.

---

## 3. Frontend → Netlify

1. Netlify → **Add new site** → **Import from Git** → pick the repo. The committed
   `netlify.toml` sets the build command, publish dir (`apps/web/dist`) and the SPA
   redirect.
2. Site settings → **Environment variables**:
   - `VITE_API_URL` = the API Gateway invoke URL from §1.3.
     **No trailing slash, no `/api`** — the client appends `/api` itself.
3. Deploy. Note the site URL, e.g. `https://your-app.netlify.app`.

---

## 4. Wire them together (CORS)

Set `WEB_ORIGIN` to the Netlify URL and redeploy the function:

```bash
WEB_ORIGIN=https://your-app.netlify.app npm run deploy:lambda --workspace @semp/api
```

An exported value wins over `apps/api/.env`, so this is the one-liner for changing it.

`VITE_API_URL` is **build-time** — changing it requires a Netlify redeploy, not just a
save.

---

## 5. Verify

- `curl <endpoint>/health` → `{"ok":true}`
- Open the Netlify URL → log in.
- DevTools → Network: requests hit `https://<api-id>.execute-api.<region>.amazonaws.com/api/...`
  and succeed with no CORS errors.
- CloudWatch Logs → `/aws/lambda/semp-api` for errors.

---

## 6. Notes & gotchas

- **Schema/migrations are never run by the deploy.** Apply SQL migrations from
  `supabase/migrations` to Supabase yourself over the **direct** connection, then
  re-run `prisma:generate` and redeploy so the client matches. Prisma is
  **introspection-only** here (`prisma db pull`) — never `prisma migrate`.
- **Redeploy after any schema change**, because the generated client is baked into the
  zip.
- **`prisma generate` fails if the API dev server is running.**
- **Git Bash on Windows:** `deploy-lambda.mjs` exists only to launch the `.sh` reliably
  from npm on win32, and the script converts POSIX paths with `cygpath` because
  `aws.exe` cannot read them. Run it via `npm run deploy:lambda`, not by invoking the
  shell script directly, unless you are on Linux/macOS.
- **Bundle size** is printed by the build. If it grows sharply, check whether a new
  dependency pulled in something large — cold start scales with it. Heavy,
  request-path-irrelevant dependencies (e.g. a PDF renderer) belong in a **separate
  worker Lambda**, not the API bundle.
- **Seeding a fresh DB:** run locally against the target,
  `DATABASE_URL=<prod> npx tsx apps/api/scripts/bootstrap-catalog.ts`.
  (The README's `npm run seed` / `npm run smoke` scripts **do not exist** — stale docs.)
