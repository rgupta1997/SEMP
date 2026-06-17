# Deploying SEMP — API on Render, Web on Netlify

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
   - `DATABASE_URL` — your Supabase connection string. Use the **transaction pooler**:
     `postgresql://postgres.[REF]:[PW]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5`
     - `:6543` + `pgbouncer=true` → transaction mode (multiplexes many clients).
     - `connection_limit=5` caps Prisma's own pool so overlapping redeploys stay in budget.
     - **Do not** use the **session pooler** (`:5432` on the `...pooler.supabase.com` host):
       its 15-slot pool is exhausted by Prisma's connection pool and you'll hit
       `EMAXCONNSESSION: max clients reached in session mode`.
     - The **direct** connection (`db.[REF].supabase.co:5432`) is for local
       `prisma db pull` introspection and one-off seeds, not the running service.
   - `WEB_ORIGIN` — leave blank for now; set it in step 4.
   - `JWT_SECRET` — generated automatically.
3. First deploy runs `npm install --include=dev && prisma generate`, then
   `npm run start` (= `tsx src/main.ts`). When live, note the URL, e.g.
   `https://semp-api.onrender.com`. Check `https://…/health` returns `{"ok":true}`.

> Prefer manual setup? Create a **Web Service** with Build
> `npm install --include=dev && npm run prisma:generate --workspace @semp/api`,
> Start `npm run start --workspace @semp/api`, Health check path `/health`, and add
> the same env vars.

## 3. Frontend → Netlify
1. Netlify → **Add new site** → **Import from Git** → pick the repo. The committed
   `netlify.toml` sets the build command, publish dir (`apps/web/dist`) and SPA
   redirect automatically.
2. Site settings → **Environment variables** → add:
   - `VITE_API_URL` = your Render URL from step 2 (e.g. `https://semp-api.onrender.com`).
     **No trailing slash, no `/api`** — the client appends `/api` itself.
3. Deploy. Note the site URL, e.g. `https://your-app.netlify.app`.

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
- **Prisma engine** is generated on Render's Linux during build, so it matches runtime — no `binaryTargets` needed.
- **Schema/migrations:** Render does **not** run migrations. Apply DB schema changes to
  Supabase yourself (this repo's `supabase/migrations`), then `prisma generate` picks them up on the next deploy.
- **Seeding a fresh DB:** run the seed once against the production DB, e.g. locally with
  `DATABASE_URL=<prod> npm run seed --workspace @semp/api` (or from a Render one-off shell).
