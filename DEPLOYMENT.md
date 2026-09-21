# Deploying SEMP - API on Render, Web on Netlify

> **This describes the CURRENT deploy, which is being replaced.**
>
> The AWS target (Lambda + API Gateway + RDS, provisioned with SAM) lives in
> [`infra/README.md`](infra/README.md). Render remains the serving deployment and the
> rollback path for as long as `DATABASE_URL` points at Supabase; delete this file in
> the same change that shuts Render down.
>
> Two things below are now wrong rather than merely dated:
> - The env-var list in step 2 stops at three. `NODE_ENV` is **required** and has no
>   default (`apps/api/src/config/env.schema.ts`), and setting it to `production`
>   activates guards that refuse to boot without `MAIL_TRANSPORT=http`, `MAIL_API_URL`,
>   `MAIL_API_KEY` and a `JWT_SECRET` of 32+ characters. `render.yaml` now declares all
>   of them; the values marked `sync: false` still have to be filled in.
> - "No `binaryTargets` needed" under **Notes & gotchas** is true of Render only,
>   which runs `prisma generate` on its own Linux at build time. It is false for
>   Lambda, whose artifact is built here and needs an explicit engine target -
>   `prisma/schema.prisma` now sets `binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]`.

The backend (Express + Prisma, run with `tsx`) deploys to **Render**; the frontend
(Vite static build) deploys to **Netlify**. Both deploy from a Git repo, so step 0
is getting this onto GitHub. Config files are already committed:
`render.yaml`, `netlify.toml`, `apps/web/public/_redirects`, `.node-version`.

## 0. Prerequisites
- A **Postgres database** with the SEMP schema (your Supabase project). Have its
  connection string ready.
- A **GitHub** account.

## 1. Push to GitHub
This folder isn't a git repo yet:
```bash
git init
git add .
git commit -m "SEMP app"
git branch -M main
git remote add origin https://github.com/<you>/semp.git
git push -u origin main
```
`.env`, `node_modules/` and `dist/` are git-ignored, so no secrets are pushed.

## 2. Backend → Render
Easiest path uses the committed `render.yaml`:
1. Render → **New +** → **Blueprint** → connect the repo → Apply.
2. It creates the `semp-api` web service. Fill the env vars it asks for:
   - `DATABASE_URL` - your Supabase connection string. Use the **transaction pooler**:
     `postgresql://postgres.[REF]:[PW]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5`
     - `:6543` + `pgbouncer=true` → transaction mode (multiplexes many clients).
     - `connection_limit=5` caps Prisma's own pool so overlapping redeploys stay in budget.
     - **Do not** use the **session pooler** (`:5432` on the `...pooler.supabase.com` host):
       its 15-slot pool is exhausted by Prisma's connection pool and you'll hit
       `EMAXCONNSESSION: max clients reached in session mode`.
     - The **direct** connection (`db.[REF].supabase.co:5432`) is for local
       `prisma db pull` introspection and one-off seeds, not the running service.
   - `WEB_ORIGIN` - leave blank for now; set it in step 4.
   - `JWT_SECRET` - generated automatically.
3. First deploy runs `npm install --include=dev && prisma generate`, then
   `npm run start` (= `tsx src/main.ts`). When live, note the URL, e.g.
   `https://semp-api.onrender.com`. Check `https://…/health` returns `{"ok":true}`.

> Prefer manual setup? Create a **Web Service** with Build
> `npm install --include=dev && npm run prisma:generate --workspace @semp/api`,
> Start `npm run start --workspace @semp/api`, Health check path `/health`, and add
> the same env vars.

## 3. Frontend → Netlify

**The site root is the marketing site, not the app.** One Netlify site builds
both and `tools/assemble-site.mjs` merges them:

```
/          landing-page-v2   (the marketing site)
/app/      apps/web          (the product)
```

The app used to be at the root. Every URL prefix it owned there is 301'd to
`/app` by the generated `dist/_redirects` — including `/verify`, which is printed
as a QR code on issued certificates and cannot be reissued. That prefix list is
in `tools/assemble-site.mjs`; keep it in step with the top-level routes in
`apps/web/src/App.tsx`.

1. Netlify → **Add new site** → **Import from Git** → pick the repo. The committed
   `netlify.toml` sets the build command and the publish dir (`dist`).
2. Site settings → **Environment variables** → add:
   - `VITE_API_URL` = the API origin. **No trailing slash, no `/api`** — both
     clients append `/api` themselves. **Both builds read it**: `apps/web` for
     every call, and the marketing site for the "Book a demo" form. It is baked
     in at build time, so changing it needs a redeploy, not just a save.
     Leave it unset and the demo form refuses to submit rather than silently
     dropping leads.
3. Deploy. Note the site URL, e.g. `https://your-app.netlify.app`.
4. Before trusting it, check the assembled output locally:
   ```bash
   npm run build:site && node tools/verify-site.mjs
   ```
   That serves `dist/` with the real redirect rules and loads the marketing
   pages, the app, and each legacy/public URL in a real browser.

## 4. Wire them together (CORS)
1. Back in Render → `semp-api` → Environment → set `WEB_ORIGIN` to your Netlify URL
   (e.g. `https://your-app.netlify.app`). Save → it redeploys.
   - `WEB_ORIGIN` accepts a comma-separated list if you add a custom domain later.
2. If you changed `VITE_API_URL` after the first Netlify build, trigger a redeploy
   (it's baked in at build time).

## 5. Verify
- Open the Netlify URL → log in (e.g. `admin@semp.local` / `admin123`).
- DevTools → Network: requests go to `https://…onrender.com/api/...` and succeed (no CORS errors).

## Notes & gotchas
- **Free-tier cold start:** Render's free instance sleeps after inactivity; the first
  request after idle takes ~30–60s. Upgrade the plan to avoid it.
- **`VITE_API_URL` is build-time.** Changing it requires a Netlify redeploy, not just a save.
- **Prisma engine** is generated on Render's Linux during build, so it matches runtime - no `binaryTargets` needed *for Render*. The Lambda artifact is built locally and does need one; see `apps/api/prisma/schema.prisma`.
- **Schema/migrations:** Render does **not** run migrations. Apply DB schema changes to
  Supabase yourself (this repo's `supabase/migrations`), then `prisma generate` picks them up on the next deploy.
- **Seeding a fresh DB:** run the seed once against the production DB, e.g. locally with
  `DATABASE_URL=<prod> npm run seed --workspace @semp/api` (or from a Render one-off shell).
