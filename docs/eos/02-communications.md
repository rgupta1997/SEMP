# Module 02 — Communications

> **PRD:** none of its own. Required by FR-AUTH-3, FR-AUTH-4, FR-AUTH-6, FR-CRT-2,
> FR-EVD-9 and the NFR "invitation tokens expiring and single-use".
> **Blocked by:** nothing — the email service already exists and needs wiring
> **Blocks:** [01 Identity](01-identity-tenancy-workspace.md) *(soft — small integration, not a build)*, [07 Certificates](07-achievements-certificates.md) *(soft — delivery)*
> **Size:** **S**
> **Runtime:** API on **AWS Lambda** + API Gateway HTTP API (`apps/api/src/lambda.ts`, `serverless-http`); Render retired. No long-lived process; synchronous responses capped at the 15s function timeout. See [`DEPLOYMENT.md`](../../DEPLOYMENT.md).

---

## 1. Scope

Two separate tracks, deliberately kept apart:

| Track | What | Owner | Size |
| --- | --- | --- | --- |
| **2a · Email integration** | Wire the SEMP API to the **existing Lambda-hosted email service**. We render branded HTML; it delivers. | This module | **S** |
| **2b · Notification service** | The in-house notification service — type registry, composable audience rules, watermark, Realtime transport. | [`docs/notification-service-plan.md`](../notification-service-plan.md) — **its own track, with its own plan** | — |

This doc owns **2a in full** and states only what the EOS modules need **from** 2b. It
does not restate or supersede the notification service plan.

> **Revision note.** An earlier draft of this doc scoped a full in-house email stack —
> provider selection, an outbox with retry, bounce webhooks, DNS reputation. That is all
> **out of scope**: the email Lambda owns transport, retries and DNS. What remains is a
> typed client, five templates, and rate limiting. Module size dropped **M → S**, and
> module 02 is no longer a hard blocker on Phase 1.

---

## 2. What we have today

### 2.1 The API cannot send email — but the capability exists next door

There is no mail dependency in any `package.json`, and
[`config/env.ts`](../../apps/api/src/config/env.ts) declares only six variables:

```ts
DATABASE_URL, JWT_SECRET, PORT, WEB_ORIGIN,
SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME
```

No email service URL, no credentials. **The Lambda email service is built but has never
been wired to this project** — that is the entire gap on the email side.

### 2.2 In-app notifications work today

Three tables (`20260607010000_notifications.sql`, extended by `20260623000000` and
`20260626000000`), one write helper `createNotification()` in
[`audience.ts`](../../apps/api/src/modules/notifications/audience.ts), and one read-time
visibility check. **Eight call sites** build notifications directly:
`notifications.routes.ts`, `championships.routes.ts`, `organizations.routes.ts` (×3),
`fixtures.routes.ts`, `invitations.routes.ts`, `enrollment.routes.ts`.

Targeting is a fixed 3-value enum (`all`, `organizations_captains`, `org_admins`) plus a
`target_user_id` bypass. The bell polls `unread-count` every 30 seconds.

This is functional and none of the EOS modules are blocked by its current shape.

### 2.3 The three invitation mechanisms, none of which invite anybody

| Mechanism | Table / route | How the recipient finds out today |
| --- | --- | --- |
| Team join token | `teams.invite_token`, `GET /teams/by-token/:token` + `/join` | Someone pastes the link into WhatsApp by hand |
| Championship → org invitation | `championship_invitations`, [`invitations.routes.ts`](../../apps/api/src/modules/enrollment/invitations.routes.ts) | Appears in the org's Invitations tab **at next login** |
| User invitation by mobile | `user_invitations`, [`user-invitations.service.ts`](../../apps/api/src/modules/iam/user-invitations.service.ts) | Applied lazily by `applyUserInvitations` **at next login** |

The third is the clearest illustration: you invite someone by phone number, the row sits
`pending`, and it activates only if that person independently signs up and their phone
matches. **The invitation is a trap waiting to be sprung, not a message.**

Provisioned accounts return their temp password in the API response
(`poc_credentials`) purely so an admin can relay it out-of-band. Once 2a lands, that
whole pattern can be replaced with a real invitation link.

---

## 3. What's pending

### 2a — Email integration

| # | Gap | P |
| --- | --- | --- |
| G1 | No email client; no service URL or credentials in env | P0 |
| G2 | No HTML rendering / branded layout | P0 |
| G3 | No templates (reset, OTP, invite, enrolment decision, certificate issued) | P0 |
| G4 | No send log — no answer to "did the invite go out?" | P1 |
| G5 | No rate limiting on the send-triggering public endpoints | P0 |
| G6 | No local/dev sink — devs would hit the real service from a laptop | P0 |
| G7 | Suppression/bounce ownership unconfirmed — see §5 | P1 |

### From 2b, what EOS needs

| # | Need | Where it bites |
| --- | --- | --- |
| G8 | `notify()` seam stays stable while call sites are migrated | Every module adding a notification |
| G9 | New notification types without a migration | [06](06-verification-pipeline.md) lock, [07](07-achievements-certificates.md) certificate issued, [04](04-people-and-player-records.md) verification outcome |

---

## 4. What we could do — 2a Email integration

### 4.1 Contract

We render, it delivers:

```ts
POST {EMAIL_SERVICE_URL}/send
Authorization: Bearer {EMAIL_SERVICE_KEY}

{ to: string | string[], subject: string, html: string, text: string,
  reply_to?: string, tags?: Record<string,string> }

→ 202 { message_id: string }
```

`tags` carries `{ template: 'password-reset', org: '<slug>' }` so delivery can be traced
on the service side without us duplicating its logs.

**Our side of the line**

| We own | The service owns |
| --- | --- |
| Rendering branded HTML + plaintext | Transport to the provider |
| Template content and variables | Retries and backoff |
| Deciding *who* gets mailed and *when* | DNS: SPF / DKIM / DMARC, sending reputation |
| Rate limiting the public trigger endpoints | Bounce and complaint handling *(to confirm — §5)* |
| A call log for support | Provider credentials |

### 4.2 The client

```
apps/api/src/modules/comms/
  email.client.ts        ← the HTTP call, timeout, error mapping, dev sink
  email.log.ts           ← thin send log
  templates/
    layout.ts            ← branded shell: org logo, colours, footer
    password-reset.ts
    otp.ts
    invitation.ts
    enrollment-decision.ts
    certificate-issued.ts
```

```ts
export async function sendEmail(msg: EmailMessage): Promise<{ messageId: string | null }>;
```

Two env additions to [`config/env.ts`](../../apps/api/src/config/env.ts):

```ts
EMAIL_SERVICE_URL: z.string().url().optional(),
EMAIL_SERVICE_KEY: z.string().optional(),
```

Optional, not required — the API must still boot without them (dev, CI, and the seed
scripts all run without email). When absent, the client falls back to the console sink
(§4.5) and logs a warning once at startup rather than per send.

**Failure semantics.** The service owns retries, so a non-2xx from it is either a bad
request (our bug) or the service being down. Neither should fail the user's action:
approving an enrolment must succeed even if the notification email doesn't. So
`sendEmail` **never throws into a route** — it logs and returns `{ messageId: null }`.
The one exception is password reset and OTP, where the email *is* the product of the
request: there, surface a real error so the user retries rather than waiting for mail
that will never arrive.

### 4.3 Rendering (G2, G3)

Five templates, each a plain TS function returning `{ subject, html, text }`, composed
over a shared `layout()` that injects org branding from `organizations.logo_url` and
`settings.brand` ([01 §4.1](01-identity-tenancy-workspace.md)).

**Recommend plain template literals over a rendering library.** For five
transactional emails, `@react-email/render` or MJML adds a dependency, a build step and
a mental model for output that is fundamentally a table-based HTML shell written once.
Revisit if the template count passes ~15 or if non-developers need to edit them.

Constraints that matter for deliverability and are easy to get wrong:

- **Always send a plaintext part.** Not optional — HTML-only materially increases spam
  scoring.
- Inline all CSS; no `<style>` blocks, no external stylesheets.
- Table-based layout, max ~600px. Institutional mail clients are not modern browsers.
- No remote images beyond the org logo, and always with `alt` text.

| Template | Trigger | Module |
| --- | --- | --- |
| `password-reset` | `POST /auth/forgot-password` | [01](01-identity-tenancy-workspace.md) |
| `otp` | `POST /auth/otp/request` | [01](01-identity-tenancy-workspace.md) |
| `invitation` | user / org / championship invite created | [01](01-identity-tenancy-workspace.md), [09](09-championship-core-deltas.md) |
| `enrollment-decision` | `PATCH /championship-organizations/:id` | [09](09-championship-core-deltas.md) |
| `certificate-issued` | certificate batch completes | [07](07-achievements-certificates.md) |

### 4.4 Send log (G4)

Not an outbox — the service owns retry state, so duplicating it would be a second source
of truth that drifts. A flat log answers the only question we actually get asked
("did it go out?"):

```sql
create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  template_id text not null,
  subject text not null,
  status text not null check (status in ('sent','failed','skipped')),
  provider_message_id text,
  error text,
  user_id uuid,                      -- FK-less, matching house style
  organization_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_email_log_to on email_log (lower(to_address), created_at desc);
```

**Never store a token, password or OTP code in this table** — log the template id and
the recipient, never the payload. A support tool that leaks reset links is worse than no
support tool.

`skipped` records the dev-sink and no-credentials cases so a missing send is
distinguishable from a failed one.

### 4.5 Dev sink (G6)

`EMAIL_SERVICE_URL` unset → the client writes the rendered subject and a URL-extracted
link to stdout and inserts a `skipped` log row. Non-negotiable: without it, the first
developer to run the seed script mails real people.

Worth adding a `/platform/email-log` preview so rendered templates can be eyeballed
without sending — cheap, and it is how template bugs get caught.

### 4.6 Abuse protection (G5)

`POST /auth/forgot-password` and `POST /auth/otp/request` are unauthenticated and cause
sends. They are the abuse surface, and this stays our responsibility regardless of who
delivers:

- Per-IP **and** per-address rate limits, applied at the router
- Identical, constant-time responses whether or not the address exists — never confirm
  account existence
- A global daily send cap with an alarm, so a loop can't burn the shared service's
  reputation for every other project using it
- OTP: 6 digits, 10-minute expiry, single-use, max 5 verification attempts per code

The daily cap matters more than usual here: the email Lambda is presumably **shared
infrastructure**, so a runaway loop in SEMP damages deliverability for whatever else
uses it.

---

## 5. Open item: who owns suppression?

The one part of the boundary not settled. Under "delivery only", the service owns
transport, retries and DNS — but **bounce and complaint handling was not explicitly
assigned**, and it has to live somewhere:

| If the service owns it | If we own it |
| --- | --- |
| Nothing further to build. It refuses sends to known-bad addresses and we treat that as a normal response. | We need an `email_suppressions` table, a webhook or polling path to learn about bounces, and a check before every send. Adds **S** to this module. |

**Recommend confirming with whoever owns the Lambda before Phase 0 starts.** The failure
mode if nobody owns it is silent: we keep mailing dead addresses, the shared service's
bounce rate climbs, and deliverability degrades for every project behind it — noticed
months later, and hard to attribute.

Related: **unsubscribe.** Transactional mail (password reset, invitation) legitimately
has no unsubscribe. But `certificate-issued` and `enrollment-decision` sit closer to
notification mail. Recommend a `users.notification_prefs` global toggle honoured on our
side before calling the service — small, and it keeps the decision with us where the
user relationship lives.

---

## 6. What EOS needs from 2b (the notification service)

[`docs/notification-service-plan.md`](../notification-service-plan.md) is the plan for
that track: a `packages/notifications` package with a type registry, composable audience
rules (replacing the fixed 3-value enum), a `notification_cursors` watermark, and
**Supabase Realtime as transport — currently under POC.**

That plan flagged the Realtime piece as the one unproven part:

> *"SEMP auth is a custom JWT … not Supabase Auth. To get RLS-scoped Realtime working
> with our own auth, the API needs to mint a short-lived Supabase-compatible JWT …
> spike this first, it's the one part of this plan not already proven out in our
> codebase."*

That spike is the POC in flight. **Nothing in the EOS modules depends on its outcome** —
if Realtime doesn't work out, the 30-second poll stays and every module in this doc set
behaves identically.

> **One premise in that plan has shifted and is worth re-reading before the POC
> concludes.** It was written against the Render deployment and says: *"Ship independent
> of any AWS work — this runs fine against the current Render-deployed API today"*, with
> *"AWS AppSync … a separate, later track **tied to the Lambda migration**"*. **That
> migration has since happened** — the API is Lambda-only and proven on staging. So the
> AppSync-vs-Realtime decision the plan deliberately deferred has arrived early, and the
> POC is now choosing between two live options rather than validating the only one
> available. The plan's own conclusion still holds either way: transport is swappable
> without touching the registry or the rule engine.

What the EOS modules do need, and should be treated as the contract between the tracks:

1. **A stable write seam.** Whether it is `createNotification()` today or `notify()`
   after migration, EOS modules call one function. New call sites will be added by
   [04](04-people-and-player-records.md) (verification outcome),
   [06](06-verification-pipeline.md) (result locked),
   [07](07-achievements-certificates.md) (certificate issued, claim validated). Those
   should be written against whichever seam exists when they are built, and migrated
   with the other eight.
2. **New types without a migration.** The registry in the plan solves this. Until it
   lands, each new EOS notification type needs a `CHECK` constraint widened — three
   small migrations, which is tolerable but worth knowing about.
3. **Eventual email fan-out.** The plan's `resolveUserIds(prisma, rule)` already
   anticipates "future push/email". When 2b is ready to own dispatch, it consumes
   `sendEmail()` from 2a unchanged.

**Decided for now: the API calls `sendEmail()` directly wherever it needs to**, including
from notification call sites. That decouples auth work from the 2b timeline entirely.
The cost is that "notification sent" and "email sent" are two calls at the same site
until 2b unifies them — acceptable, and easy to collapse later because both go through
one function.

---

## 7. Data model changes

| Change | Notes |
| --- | --- |
| **new** `email_log` | §4.4 |
| `+ notification_prefs jsonb` on `users` | Global unsubscribe, default `{}` |
| **new** `email_suppressions` | **Only if §5 lands on our side** |

One small migration: `…_email_log.sql`.

*(The `notification_cursors` table and the `audience`/`type` constraint changes belong to
2b and are specified in its own plan.)*

---

## 8. API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/platform/email-log` | super admin | Support: did it send? |
| `GET` | `/api/platform/email-log/:id/preview` | super admin | Render a template without sending |
| `GET` | `/api/unsubscribe/:token` | public | Global opt-out of non-transactional mail |

No public send endpoint. `sendEmail()` is called internally only.

---

## 9. UI surface

| Surface | Where |
| --- | --- |
| Email log | `/platform/email-log` — mirrors the [`PlatformFeedbackPage.tsx`](../../apps/web/src/pages/platform/PlatformFeedbackPage.tsx) triage pattern |
| Notification preferences | A section on the profile page; global toggle only for v1 |
| Unsubscribe confirmation | Public, no shell — same treatment as [`PublicChampionshipPage.tsx`](../../apps/web/src/pages/public/PublicChampionshipPage.tsx) |

---

## 10. Dependencies

**Blocked by:** nothing. The service exists; this is wiring.

**Blocks (soft, and much more weakly than previously assessed)**

- [01](01-identity-tenancy-workspace.md) — FR-AUTH-3/4/6 need `sendEmail()`. Since 2a is
  an **S** and has no upstream dependency, both can sit in Phase 0 and 01's auth work is
  never actually waiting.
- [07](07-achievements-certificates.md) — certificate delivery.

**Parallel, not blocking:** 2b. Its Realtime POC can succeed or fail without affecting
any module in this doc set.

---

## 11. Risks & open questions

| Risk | Assessment |
| --- | --- |
| **Suppression ownership unassigned** (§5) | The one real open item. Silent failure mode, degrades shared infrastructure, discovered late. Confirm before Phase 0. |
| **Shared service blast radius** | A send loop in SEMP damages deliverability for every other project behind that Lambda. The global daily cap is not optional. |
| Institutional mail filters | University gateways are aggressive. Test against a real `.ac.in` inbox early — and note that if deliverability is poor, the fix is on the service's side (DNS, reputation), not ours. Know who to escalate to. |
| Contract drift | We depend on a service owned elsewhere. Pin the request shape in a typed client with a zod-validated response, so a contract change fails loudly at one place rather than silently at five. |
| Rendering quality | Email HTML is genuinely hostile. Budget time to test the layout in Outlook and Gmail specifically; do not assume a browser-correct template renders. |
| PII in logs | `email_log` must never contain tokens, passwords or OTP codes. |

**Open questions**

1. **Does the email Lambda handle bounces and suppression, or do we?** (§5 — blocks
   nothing, but decides whether this module is S or S+.)
2. What is the actual request/response contract and auth mechanism? Assumed
   `POST /send` with a bearer key above — confirm and correct.
3. Is there a rate limit or quota on the service we should respect from our side?
4. Does it support scheduled or delayed sends? Relevant later for match reminders; not
   needed for the five templates here.

---

## 12. Effort

### 2a — Email integration

| Workstream | Size |
| --- | --- |
| `email.client.ts` + env vars + typed contract + failure semantics | **S** |
| Dev sink + startup warning + template preview | **S** |
| Shared branded layout + 5 templates with plaintext parts | **S** |
| `email_log` + platform log UI | **S** |
| Rate limiting + daily cap + enumeration-safe responses | **S** |
| Global unsubscribe toggle | **S** |
| Suppression handling | **S** *(only if §5 lands on our side)* |
| **2a total** | **S** |

### 2b — Notification service

Sized in [`docs/notification-service-plan.md`](../notification-service-plan.md), not
here. Its Realtime transport is under POC and is not on any EOS critical path.

| | |
| --- | --- |
| **Module total** | **S** |
