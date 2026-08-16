# Module 07 — Achievements & Certificates

> **PRD:** §6.9 FR-ACH-1/2/3 (organisation achievements, feed, claims & validation) ·
> §6.10 FR-CRT-1…5 (templates, auto-generation, queue & register, QR verification,
> numbering) · FR-PRO-4 (verified credentials on a profile)
> **Blocked by:** [06 Verification](06-verification-pipeline.md) *(hard)*, [02 Communications](02-communications.md) *(soft — delivery)*, [03 Audit](03-rbac-module-access-audit.md) *(soft)*
> **Blocks:** [08 Reports](08-reports-impact-exports.md) *(soft — medal counts)*
> **Size:** **L**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

Two related outputs of a locked result:

1. **Achievements** — the durable record that someone won something: medals, records,
   selections, honours. Auto-derived from locked results, plus externally-claimed
   achievements that need admin validation.
2. **Certificates** — the printable, verifiable artefact. Templates, batch generation,
   immutable numbering, QR verification.

The PRD frames certificates as the automation win (*"≥95% of certificates issued via
auto-generation"* is a success metric). It is also the most visible thing an institution
gets out of the product — a student's certificate is the artefact that leaves the
building.

---

## 2. What we have today

### 2.1 Achievements — a thin, free-text approximation

The entire achievements feature is `fixture_awards`
(`20260617020000_fixture_awards.sql`):

```
fixture_awards(id, fixture_id, recipient_user_id, award_name varchar(120), created_at)
```

Written by officials in the match console's `AwardsPanel` via
`PATCH /fixtures/:id/awards`, which is a **replace-all** operation:

```ts
await prisma.$transaction([
  prisma.fixture_awards.deleteMany({ where: { fixture_id: fixtureId } }),
  prisma.fixture_awards.createMany({ data: awards.map(...) }),
]);
```

Read back by `GET /me/achievements`
([`me.routes.ts`](../../apps/api/src/modules/iam/me.routes.ts)) and rendered by
[`ParticipantAchievementsPage.tsx`](../../apps/web/src/pages/participant/ParticipantAchievementsPage.tsx)
with [`AchievementRow.tsx`](../../apps/web/src/components/participant/AchievementRow.tsx),
grouped and counted client-side.

What that means in practice:

- `award_name` is **free text**. "Player of the Match", "player of the match", "POTM"
  and "Man of the Match" are four different achievements. Nothing is countable.
- **Medals are not achievements.** Winning a championship final produces a
  `winner_team_id` on a fixture and a standings row — it produces *no achievement record
  at all*. The PRD's "medals won" KPI has no source.
- Awards can be silently rewritten (replace-all, no lock — see
  [06](06-verification-pipeline.md)).
- There is **no organisation-level achievements view** (FR-ACH-1) — no Hall of Fame, no
  team achievements, no share cards.
- There are **no claims and no validation queue** (FR-ACH-3).

The medal *display* that exists —
[`StandingsMedalTable.tsx`](../../apps/web/src/components/StandingsMedalTable.tsx) and
the `medal` standings scheme — computes gold/silver/bronze **per organisation for a
points table**, on the fly. It is a leaderboard, not a record.

### 2.2 Certificates — nothing at all

Verified by exhaustive search: the strings `certificate`, `qr`, `qrcode` appear nowhere
in `apps/`, `packages/` or `supabase/` except TLS configuration in
`supabase/config.toml`. There is no `jspdf`, `pdfkit`, `puppeteer`, `@react-pdf/renderer`
or any image/PDF generation dependency in any `package.json`.

Not partially built. Not stubbed. **Absent.**

### 2.3 What is reusable

Three existing pieces materially reduce the cost:

| Existing | Reuse for |
| --- | --- |
| [`share-token.ts`](../../apps/api/src/modules/public/share-token.ts) — HMAC-signed stateless tokens | QR verification URLs (FR-CRT-4) |
| [`public.routes.ts`](../../apps/api/src/modules/public/public.routes.ts) + [`PublicChampionshipPage.tsx`](../../apps/web/src/pages/public/PublicChampionshipPage.tsx) — unauthenticated route + shell-less page pattern | The public certificate verification page |
| [`demo-seeder.service.ts`](../../apps/api/src/modules/demos/demo-seeder.service.ts) — long-running job with `status` + `manifest` + progress states | The certificate generation queue (FR-CRT-3) |

The demo-sandbox module in particular is a working precedent for "kick off a batch job,
track its status, show progress in a platform UI" — which is exactly FR-CRT-3.

---

## 3. What's pending

| # | Gap | PRD | P |
| --- | --- | --- | --- |
| G1 | No structured achievement records | FR-ACH-2 | P0 |
| G2 | Medals/placements from results are never recorded | FR-ACH-1/2 | P0 |
| G3 | Award names are unnormalised free text | — | P1 |
| G4 | No organisation achievements page | FR-ACH-1 | P1 |
| G5 | No share-card generation | FR-ACH-1 | P1 |
| G6 | No claims model or validation queue | FR-ACH-3 | P1 |
| G7 | No certificate templates | FR-CRT-1 | P0 |
| G8 | No certificate generation | FR-CRT-2 | P0 |
| G9 | No queue / issued register | FR-CRT-3 | P0 |
| G10 | No numbering scheme | FR-CRT-5 | P0 |
| G11 | No QR verification page | FR-CRT-4 | P1 |
| G12 | No credentials list on the player profile | FR-PRO-4 | P1 |
| G13 | No revocation path when a result is corrected | §9 | P0 |

---

## 4. What we could do

### 4.1 Achievements: a typed record written at lock

```sql
create table if not exists achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete restrict,     -- individual
  team_id uuid references teams(id) on delete set null,     -- team achievement
  organization_id uuid,                                     -- FK-less: survives org deletion
  championship_id uuid,
  fixture_id uuid,
  sport_id uuid,
  kind text not null check (kind in ('medal','placement','record','selection','honour','award')),
  medal text check (medal is null or medal in ('gold','silver','bronze')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_on date not null,
  source text not null default 'locked_result'
    check (source in ('locked_result','validated_claim','migrated')),
  lock_version int,                                          -- from module 06
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_achievements_user on achievements (user_id, occurred_on desc);
create index if not exists idx_achievements_org  on achievements (organization_id, occurred_on desc);
```

Exactly one of `user_id` / `team_id` is set — team achievements fan out to individual
achievements for squad members at write time, so a player's profile shows "Runner-up,
Inter-College Football" without a join through team history that may later change.

`deriveAchievements(tx, fixture)` — step 5 of the
[lock transaction](06-verification-pipeline.md#43-the-lock-transaction--the-actual-spine)
— produces:

| Fixture situation | Achievement |
| --- | --- |
| Final, winner decided | `medal='gold'` for winner squad, `silver` for runner-up |
| Third-place playoff | `medal='bronze'` |
| Knockout elimination round | `kind='placement'`, e.g. "Semi-finalist" — reuse `STANDINGS_PLACEMENT` |
| Ranking event, `live_state.eventRanking` | medals by finishing place per competitor |
| `fixture_awards` rows | `kind='award'` with the normalised name |

Note the placement vocabulary already exists —
`STANDINGS_PLACEMENT = ['winner','runner_up','third_place','fourth_place',
'semi_finalist','quarter_finalist']` in
[`enums.ts`](../../packages/shared/src/enums.ts). Reuse it rather than inventing a
second vocabulary.

**Normalising award names (G3):** add a seeded `award_types` catalogue (Player of the
Match, MVP, Top Scorer, Best Bowler, Fair Play…) and change `AwardsPanel` to a select
with an "Other" free-text fallback. Existing free-text rows stay as `kind='award'` with
no type. Without this, FR-RPT-3's "top performers" and FR-PRO-3's "MVP awards" cannot be
computed.

### 4.2 Claims & validation (FR-ACH-3)

External achievements — a zonal selection, a state record — have no fixture to derive
from. Same table, `source='validated_claim'`, plus a claim row:

```sql
create table if not exists achievement_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null, title text not null, occurred_on date not null,
  evidence_url text, note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz, rejection_note text,
  achievement_id uuid,                      -- set on approval
  created_at timestamptz not null default now()
);
```

Approval writes the `achievements` row inside a transaction and audits it. The pending
count feeds the org dashboard's "Validate" CTA
([01](01-identity-tenancy-workspace.md), FR-DASH-2).

This mirrors `championship_organizations` and `organization_members` pending-approval
patterns exactly — same shape, same review columns, same notification treatment. Copy
[`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) rather than
designing something new.

### 4.3 Certificates: data model

```sql
create table if not exists certificate_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('winner','runner_up','participation','special')),
  name text not null,
  layout jsonb not null default '{}'::jsonb,      -- fields, positions, fonts, background
  background_url text,
  signatories jsonb not null default '[]'::jsonb, -- [{ name, title, signature_url }]
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_no text not null,                   -- CERT-IIMB-2026-0001
  organization_id uuid not null references organizations(id) on delete restrict,
  template_id uuid references certificate_templates(id) on delete set null,
  user_id uuid references users(id) on delete restrict,
  team_id uuid references teams(id) on delete set null,
  championship_id uuid,
  achievement_id uuid,
  lock_version int,                               -- which version of the result it attests
  status text not null default 'queued'
    check (status in ('queued','generating','issued','failed','revoked')),
  issued_at timestamptz,
  revoked_at timestamptz, revocation_reason text,
  file_url text,
  verify_token text not null,                     -- HMAC, embedded in the QR
  payload jsonb not null default '{}'::jsonb,     -- frozen snapshot: name, result, date
  error text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_certificate_no on certificates (certificate_no);
create index if not exists idx_certificates_org_status on certificates (organization_id, status);
create index if not exists idx_certificates_user on certificates (user_id, issued_at desc);
```

Two decisions worth defending:

**`payload` is a frozen snapshot.** The certificate must render identically in five
years even if the player renames themselves, the team is deleted, or the championship
is renamed. Store what was printed. This is also what the verification page displays —
never a live join.

**`certificate_no` is unique globally**, not per org, even though it embeds the org
code. A globally unique number means a verification URL needs no org context and a
collision is impossible by construction.

### 4.4 Numbering (FR-CRT-5)

Format: `CERT-{ORGCODE}-{YYYY}-{NNNNN}` — e.g. `CERT-IIMB-2026-00042`.

Generation must be **gapless and race-free**. Two viable approaches:

| Approach | Assessment |
| --- | --- |
| Postgres sequence per org-year | Fast, but creating sequences dynamically is awkward and they leak on rollback (gaps) |
| **Counter row with `SELECT … FOR UPDATE`** | One `certificate_counters(organization_id, year, next_no)` row, locked inside the issuing transaction. Gapless, simple, and batch sizes here are hundreds not millions. **Recommended.** |

Numbers are allocated at **issue** time, not queue time — a failed generation must not
burn a number.

### 4.5 Rendering

The one genuinely new technical capability. Options:

| Option | For | Against |
| --- | --- | --- |
| **`@react-pdf/renderer`** | Pure JS, no browser, deploys anywhere including Lambda, layout in JSX (familiar), small | Own layout engine — not HTML/CSS; complex designs need learning |
| Puppeteer / Playwright HTML→PDF | Full CSS, designers can build templates in HTML, pixel-accurate | ~300MB Chromium; painful on Lambda; heavy memory per render |
| `pdfkit` | Tiny, fast | Imperative drawing; every template is code |
| Server-side SVG → PDF | Elegant for certificate-shaped output | Font embedding is fiddly |

**Recommendation: `@react-pdf/renderer`.** Certificates are a constrained layout —
background image, a few positioned text fields, a QR, signatures. That is precisely its
sweet spot, it keeps the deployment story simple (relevant given the existing
`build-lambda.mjs` path), and it avoids adding a headless browser to the API image.

Reconsider Puppeteer only if the requirement becomes "designers author arbitrary HTML
templates".

QR generation: `qrcode` (npm), rendered to a data URI and embedded. Tiny dependency.

Storage: Supabase Storage bucket, private, served through a signed URL. Do not store
PDFs in Postgres.

### 4.6 The generation queue (FR-CRT-3)

Follow the demo-sandbox precedent exactly — it already solves this problem in this
codebase:

```
POST /api/championships/:id/certificates/generate
  { template_id, scope: 'all_participants' | 'winners' | 'user_ids' }
```

…creates `certificates` rows at `status='queued'` and returns immediately. A worker
picks them up, moves to `generating`, renders, allocates the number, uploads, sets
`issued`, and notifies the recipient via [02](02-communications.md). Failures set
`failed` with an `error` string and are retryable.

The register (FR-CRT-3's table of Player / Type / Event / Cert no. / Status) is a plain
list over the same table.

**Deployment: the API runs on Lambda** (`apps/api/src/lambda.ts` via `serverless-http`,
working on staging; Render is retired). So there is **no long-lived process to run an
interval worker in** — the queue has to be event-driven.

**Recommend SQS → worker Lambda**, one message per certificate:

```
POST /certificates/generate   → insert rows at 'queued', enqueue one SQS message each, return 202
SQS event source mapping      → worker Lambda: render → allocate number → upload → 'issued'
DLQ after N attempts          → row set to 'failed' with the error surfaced in the register
```

Why per-certificate rather than per-batch:

- **No timeout risk.** The function times out at **15s** (`TIMEOUT_SEC` in
  `deploy-lambda.sh`), inside API Gateway's 29s ceiling; a 300-certificate
  batch cannot be done inline. One render per invocation is comfortably inside any limit.
- **Retries and DLQ come free** from SQS, so the `attempts`/backoff logic doesn't need
  writing.
- **It parallelises**, which is the whole reason a batch of 300 finishes in seconds.

Two consequences of parallel workers worth planning for:

1. **The `certificate_counters` `SELECT … FOR UPDATE` lock (§4.4) stops being
   theoretical.** Concurrent workers will contend on it. That is precisely why the
   counter-row approach was chosen over a naive `max(no)+1` — but set the worker
   Lambda's **reserved concurrency** (e.g. 10) so contention stays bounded.
2. **Connection pressure.** Runtime already uses the Supabase transaction pooler
   (`:6543`, `connection_limit=5`). Concurrent worker Lambdas each hold connections;
   the reserved-concurrency cap is what keeps that within budget.

*Alternative if SQS is unwanted infrastructure:* an EventBridge scheduled rule invoking
a drain Lambda every minute. Simpler to set up, but adds up to a minute of latency and
you hand-roll retry. Prefer SQS.

[8c](08-reports-impact-exports.md)'s export queue has the identical shape — **build this
once and let exports reuse it.**

### 4.7 QR verification (FR-CRT-4)

```
GET /api/public/certificates/:token     → unauthenticated
/verify/:token                          → public page, no shell
```

Reuse [`share-token.ts`](../../apps/api/src/modules/public/share-token.ts)'s HMAC
signing directly. The page shows exactly what the PRD lists — player, event, result,
certificate number, issuing organisation — from the frozen `payload`, plus issue date
and a clear **revoked** state if applicable.

Design note: this page is the product's most-seen surface by non-users (recruiters,
parents, other institutions checking a claim). It should be the best-looking page in the
product and should carry a discreet "Verified by Sportagon EOS" mark.

### 4.8 Revocation (G13)

When [06](06-verification-pipeline.md) unlocks and corrects a result, every certificate
carrying that `lock_version` must be revoked in the same transaction:

```
status → 'revoked', revocation_reason = 'Result amended', revoked_at = now()
```

The verification page then shows *"This certificate was superseded by a corrected
result on <date>"* rather than 404-ing — an honest audit outcome, not a disappearance.
The corrected result queues a replacement certificate with a new number.

This is the requirement that makes `lock_version` on both tables worth carrying.

### 4.9 Share cards (FR-ACH-1)

Branded PNG for social sharing. Same renderer, image output instead of PDF, generated
on demand and cached. **P1, and the last thing to build** — it is the most visible and
the least load-bearing.

---

## 5. Data model changes

| Change | Notes |
| --- | --- |
| **new** `achievements` | §4.1 |
| **new** `achievement_claims` | §4.2 |
| **new** `award_types` | Seeded catalogue; normalises `fixture_awards.award_name` |
| **new** `certificate_templates` | §4.3 |
| **new** `certificates` | §4.3 |
| **new** `certificate_counters` | `(organization_id, year, next_no)` |

Two migrations: `…_achievements.sql`, `…_certificates.sql`. The achievements half can
land with [06](06-verification-pipeline.md); certificates can follow independently.

---

## 6. API surface

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/organizations/:id/achievements` | `people.view` | FR-ACH-1/2 |
| `GET` | `/api/people/:userId/achievements` | self or shared org | FR-PRO-4 |
| `POST` | `/api/achievement-claims` | authed | FR-ACH-3 submit |
| `GET` | `/api/organizations/:id/achievement-claims` | `achievement.validate` | Queue |
| `POST` | `/api/achievement-claims/:id/approve` · `/reject` | `achievement.validate` | FR-ACH-3 |
| `GET/POST/PATCH/DELETE` | `/api/organizations/:id/certificate-templates` | `certificate.issue` | FR-CRT-1 |
| `POST` | `/api/championships/:id/certificates/generate` | `certificate.issue` | FR-CRT-2 |
| `GET` | `/api/organizations/:id/certificates` | `certificate.issue` | FR-CRT-3 register |
| `GET` | `/api/certificates/:id/download` | owner or `certificate.issue` | Signed URL |
| `POST` | `/api/certificates/:id/revoke` | `certificate.issue` | G13 |
| `GET` | `/api/public/certificates/:token` | **public** | FR-CRT-4 |
| `POST` | `/api/achievements/:id/share-card` | authed | FR-ACH-1 |

---

## 7. UI surface

| Page | Path | Notes |
| --- | --- | --- |
| Org achievements / Hall of Fame | `/org/:orgId/achievements` | KPI strip, team + individual media cards, share action |
| Achievement feed | same page, tab | Reverse-chronological, verified only |
| Claims queue | `/org/:orgId/achievements/claims` | Copy [`ApprovalsPage.tsx`](../../apps/web/src/pages/organiser/ApprovalsPage.tsx) |
| Submit a claim | participant profile | Simple form + evidence URL |
| Template gallery | `/org/:orgId/certificates/templates` | Cards with issued counts (FR-CRT-1) |
| Generate batch | modal from a championship | Scope picker + preview |
| Issued register | `/org/:orgId/certificates` | Table with status chips (FR-CRT-3) |
| **Public verification** | `/verify/:token` | No shell. The product's shop window. |
| Credentials on profile | `/org/:orgId/people/:userId` | FR-PRO-4, from [04](04-people-and-player-records.md) |

---

## 8. Dependencies

**Blocked by**

- [06](06-verification-pipeline.md) — **hard.** Achievements derive from the lock
  transaction; certificates generate "from verified results". Building either before 06
  means building on mutable data and rewriting the trigger later.
- [02](02-communications.md) — soft and small. Certificates that nobody is told about
  satisfy the letter of FR-CRT-2 and none of its value; the `certificate-issued` template
  is one of 02's five.
- [03](03-rbac-module-access-audit.md) — soft. `certificate.issue`,
  `achievement.validate` permissions; issuance and revocation must be audited.

**Blocks (soft)**

- [08](08-reports-impact-exports.md) — "medals won" KPIs and "medals by sport" read from
  `achievements`. Without it, 08 must recompute medals from fixtures every time.

**Recommended split:** **7a Achievements** (with 06, small) and **7b Certificates**
(independent, larger). 7a unblocks 08's medal metrics much earlier than 7b would.

---

## 9. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **PDF rendering is new capability** | No one on the codebase has built this here. Budget a spike: render one template end-to-end with a QR before committing to the template model. Everything else in this module is CRUD. |
| Template design ambition | It is easy to drift into building a WYSIWYG certificate designer. **Don't.** Ship 3–4 fixed layouts with configurable text, logo, background and signatories. Revisit only on real demand. |
| Signatory images | Signature images are sensitive — an uploaded signature that renders on hundreds of certificates is a forgery vector if the bucket is public. Private bucket, signed URLs, and never expose the raw asset. |
| Storage costs and lifecycle | Certificates are permanent by design. Thousands of PDFs per institution per year. Confirm the Supabase Storage plan and set a bucket policy before the first batch. |
| Number gaps | Allocation at issue time inside the transaction avoids gaps on failure. Get this right first time — a gap in a "unique immutable numbering scheme" is a support conversation with a registrar. |
| Revocation UX | A revoked certificate that a student has already printed and submitted somewhere is a real-world problem. Make the verification page's revoked state clear and dated, and notify the holder. |
| **Queue infrastructure on Lambda** | The API is Lambda-only now, so the generation queue needs SQS (or EventBridge) rather than an in-process worker — new infrastructure, IAM and local-dev story. §4.6. Shared with [8c](08-reports-impact-exports.md), so cost it once. |
| Renderer size in a Lambda bundle | `@react-pdf/renderer` plus embedded fonts and background images inflates the deploy artifact and cold-start time. Check the packaged size during the §10 spike, and consider a **separate worker Lambda** from the API so the request path isn't slowed by a dependency it never uses. |

**Open question:** [00-index §7](00-index.md#7-open-questions-for-the-prd-author) item 6
— are signatories configured per organisation, per template, or per event? Affects the
template model. Current assumption: per template, defaulted from org settings.

---

## 10. Effort

### 7a — Achievements

| Workstream | Size |
| --- | --- |
| `achievements` table + `deriveAchievements()` inside 06's lock transaction | **M** |
| `award_types` catalogue + AwardsPanel select + backfill strategy | **S** |
| Claims model, queue, approve/reject, notifications | **M** |
| Org achievements page + feed | **M** |
| Share cards | **M** *(P1, defer)* |
| **7a total** | **M** |

### 7b — Certificates

| Workstream | Size |
| --- | --- |
| **Rendering spike** — one template + QR end-to-end | **S** *(do this first)* |
| Schema: templates, certificates, counters | **S** |
| Numbering with `FOR UPDATE` counter | **S** |
| Renderer + 4 seeded layouts + branding/signatories | **L** |
| Generation queue + worker + retry + storage upload | **M** |
| Template gallery + generate-batch UI + issued register | **M** |
| Public verification page | **S** |
| Revocation wired to 06's unlock | **S** |
| **7b total** | **L** |

| | |
| --- | --- |
| **Module total** | **L** |
