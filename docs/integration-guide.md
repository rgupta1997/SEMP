# Sportagon Mail Service — Integration Guide

Everything needed to send mail from another service through the Sportagon Mail Service. This document is self-contained: no access to the mail-service repository is assumed or required.

You POST a mail task; you get a `202` and a job id back immediately. The service owns rendering, sending, retrying, bounce handling and the audit trail — your service never imports an email SDK.

> **One live source of truth.** The schemas in this document were generated from the service's own validation schemas and verified on 2026-08-27. If this document and `GET /templates` ever disagree, **`GET /templates` is right** — it returns the exact JSON Schema used to validate your request. It is an ordinary authenticated HTTP call; assert against it in CI rather than trusting a copied table to stay current.

---

## Contents

1. [What the service guarantees](#what-the-service-guarantees)
2. [Authentication](#authentication)
3. [Endpoints](#endpoints)
4. [Sending mail](#sending-mail)
5. [Job lifecycle and status](#job-lifecycle-and-status)
6. [Response shapes](#response-shapes)
7. [Errors](#errors)
8. [Templates](#templates)
9. [Idempotency, scheduling, priority](#idempotency-scheduling-priority)
10. [Suppressions](#suppressions)
11. [Webhooks](#webhooks)
12. [Client examples](#client-examples)
13. [Data model](#data-model)
14. [Configuration reference](#configuration-reference)
15. [Troubleshooting](#troubleshooting)
16. [Requesting changes](#requesting-changes)

---

## What the service guarantees

**Mail is not lost.** Every accepted message is a row in Postgres before the `202` returns. A provider outage delays mail; it does not drop it.

**Delivery is asynchronous.** A `202` means *accepted and durable*, not *delivered*. Nothing about the recipient's mailbox is known at that point. If your flow needs to react to the outcome, poll `GET /mail/:id` or ask the mail team to forward provider events to you.

**Retries are automatic.** Backoff runs 30s → 2m → 8m → 32m → 2h with ±20% jitter, so a recovering provider is not hit by a synchronised stampede. Each provider adapter classifies its own failures: a `550 no such mailbox` fails immediately, a timeout or `429` is retried. Retrying permanent bounces wastes attempts and damages sender reputation, so the service does not.

**Providers fail over.** When configured with a chain (e.g. `smtp,ses`), a failure on one provider immediately tries the next *within the same attempt*.

**Crashes recover.** A job left mid-send past the lock timeout is reclaimed and retried.

**Sending scales horizontally.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so each is claimed by exactly one worker no matter how many run.

**Rendering happens at send time, not accept time.** A template fix applies to mail that is already queued.

**Template props are validated when you POST.** A bad payload is a `422` on the spot, not a silent failure in a worker an hour later.

What it does **not** do today: marketing campaigns or list management, inbound email parsing, per-caller rate limiting, and open/click tracking (the webhook ingest exists, but tracking must be enabled provider-side).

---

## Authentication

Every route except `/health` and `/webhooks/*` requires a credential. Two are accepted.

### API key — for backend services

```bash
-H 'x-api-key: <secret>'
```

The header carries **only the secret**. Keys are provisioned by the mail team as `callerName:secret` pairs, so if you are told your key is `booking-api:s3cr3t-one`, the value you send is `s3cr3t-one`.

Your caller name is recorded on every job you create (`callerId` in responses). That gives per-service attribution in the mail service's logs, scopes your idempotency keys to you, and lets your key be rotated without touching any other service's.

Keys are compared in constant time against every configured key, so a wrong key leaks nothing through response timing.

### Supabase service role — for edge functions

```bash
-H 'Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>'
```

Available when the mail service has been configured with the same service role key. Such callers are recorded as `supabase`.

This compares against the configured key itself rather than decoding the JWT and trusting its `role` claim — an unverified claim is forgeable by anyone. It therefore works with both legacy JWT keys and newer opaque `sb_secret_…` keys.

### Getting a key

Ask the mail team for a caller name and secret. Store the secret in your service's secret manager, never in source. You need exactly two values to integrate:

```env
MAIL_SERVICE_URL=http://mail-service:3000
MAIL_SERVICE_API_KEY=<your secret>
```

---

## Endpoints

| Method | Route | Purpose | Success |
|---|---|---|---|
| `POST` | `/mail` | Queue one message | `202` (`200` on idempotent replay) |
| `POST` | `/mail/batch` | Queue up to 500 messages in one transaction | `202` |
| `GET` | `/mail/:id` | Status + event timeline | `200` |
| `POST` | `/mail/:id/cancel` | Cancel while still `queued` | `200` |
| `GET` | `/templates` | Every template + JSON Schema of its props | `200` |
| `POST` | `/templates/:key/preview` | Render without sending | `200` |
| `GET` | `/suppressions` | List the do-not-mail list (`?limit=&offset=`) | `200` |
| `POST` | `/suppressions` | Add an address | `201` |
| `DELETE` | `/suppressions/:address` | Remove an address | `200` |
| `POST` | `/webhooks/ses` | SNS bounce/complaint ingest (no auth; signature-verified) | `200` |
| `POST` | `/internal/dispatch` | Drain the queue on demand | `200` |
| `GET` | `/health` | Liveness (dependency-free) | `200` |
| `GET` | `/health/ready` | Readiness (checks the database) | `200` / `503` |

---

## Sending mail

`POST /mail`. A message is **either** template-driven **or** raw — never both, never neither. Either mistake is a `422`.

### Template-driven

```jsonc
{
  "to": "player@example.com",
  "template": "booking-confirmed",
  "data": {
    "customerName": "Navneet",
    "facilityName": "Akash Arena",
    "courtName": "Court 2",
    "bookingDate": "Tue, 13 Aug 2026",
    "timeRange": "6:00 PM - 7:00 PM",
    "amount": 600
  },
  "idempotencyKey": "booking-10294-confirmed"
}
```

The subject comes from the template — do not send one.

### Raw

```jsonc
{
  "to": [{ "email": "player@example.com", "name": "Navneet" }],
  "subject": "Your receipt",
  "html": "<h1>Thanks!</h1>",
  "text": "Thanks!",
  "attachments": [{ "filename": "receipt.pdf", "content": "<base64>" }]
}
```

`subject` is **required** for raw sends. Supply `text` alongside `html` wherever you can — multipart mail measurably improves deliverability, and templates always send both.

### Fields

| Field | Type | Notes |
|---|---|---|
| `to` | address \| address[] | Required |
| `cc`, `bcc` | address \| address[] | Optional |
| `replyTo` | email | Optional |
| `from` | `{ email?, name? }` | Optional; defaults to the service's configured sender |
| `template` | string (≤100) | Mutually exclusive with `html`/`text` |
| `data` | object | Template props, validated against that template's schema |
| `subject` | string (≤998) | Required for raw sends; ignored for templates |
| `html`, `text` | string | Raw body |
| `attachments` | array (≤20) | See below |
| `sendAt` | ISO 8601 datetime | Hold until this time |
| `idempotencyKey` | string (≤255) | Scoped to your caller name |
| `metadata` | object | Free-form; stored on the job and returned in status |
| `priority` | int 1–9 | Lower runs first. Default 5 |
| `maxAttempts` | int 1–20 | Default 5 |

**Addresses** may be a bare string or an object, singular or in a list — all four forms are accepted and normalise to a list:

```jsonc
"to": "a@b.com"
"to": { "email": "a@b.com", "name": "Navneet" }
"to": ["a@b.com", { "email": "c@d.com", "name": "Akash" }]
```

A display name is quoted and escaped when it reaches the header, so a name containing a comma or quote cannot break out of it.

**Attachments** carry either `content` (base64) or `url` (fetched at send time) — exactly one, never both. Default cap is 10 MB per attachment, and a URL fetch times out after 10s. `filename` may not contain `/`, `\`, or be `..`.

### Batch

`POST /mail/batch` queues many personalised messages in one transaction. `defaults` are merged into each message, and `data` is merged key-by-key rather than replaced, so shared props can live in `defaults`:

```jsonc
{
  "defaults": {
    "template": "booking-reminder",
    "replyTo": "support@sportagon.com",
    "data": { "facilityName": "Akash Arena" }
  },
  "messages": [
    { "to": "p1@example.com", "data": { "customerName": "Player One", "courtName": "Court 1",
                                        "bookingDate": "Thu, 28 Aug 2026", "timeRange": "7:00 PM - 8:00 PM" } },
    { "to": "p2@example.com", "data": { "customerName": "Player Two", "courtName": "Court 3",
                                        "bookingDate": "Fri, 29 Aug 2026", "timeRange": "6:00 PM - 7:00 PM" } }
  ]
}
```

Response:

```jsonc
{
  "batchId": "3f2b8c14-…",
  "acceptedCount": 2,
  "rejectedCount": 0,
  "accepted": [{ "id": "9c1f…", "to": [{ "email": "p1@example.com" }], "status": "queued" }],
  "rejected": []
}
```

An individual message can be rejected without failing the batch, so **always check `rejectedCount`** — a `202` does not mean every message was accepted.

Maximum 500 messages per batch (`MAX_BATCH_SIZE`). The whole request must also fit the body limit (15 MB by default, 5 MB when the service runs on Lambda), which matters if messages carry attachments.

---

## Job lifecycle and status

```
POST /mail ──▶ validate ──▶ INSERT (status=queued) ──▶ 202
                                  │
                      pg_notify ──┤ (wakes an idle worker immediately)
                                  ▼
   claim (FOR UPDATE SKIP LOCKED) ──▶ suppression check ──▶ render
        ──▶ resolve attachments ──▶ send (provider chain) ──▶ sent
                                          │
                                 failure ─┴─▶ retryable? backoff : failed
```

### Statuses

There are exactly six:

| Status | Meaning | Terminal |
|---|---|---|
| `queued` | Waiting to be claimed. Also the status of a scheduled job | no |
| `sending` | Claimed by a worker | no |
| `sent` | Handed to a provider successfully | yes |
| `failed` | Terminal failure, or attempts exhausted | yes |
| `cancelled` | Cancelled before send | yes |
| `suppressed` | Every recipient is on the do-not-mail list | yes |

> **There is no `scheduled` status and no `delivered` status.** A job with a future `sendAt` sits in `queued` with a future `scheduledAt`. Delivery confirmation arrives as an *event*, not a status — `sent` is the last status a successful job reaches. Do not write a state machine that waits for `delivered`.

### Event types

The timeline on `GET /mail/:id` uses a wider vocabulary than the status field:

`queued` · `sending` · `sent` · `delivered` · `bounced` · `complained` · `opened` · `clicked` · `failed` · `cancelled` · `suppressed`

`delivered`, `bounced`, `complained`, `opened` and `clicked` arrive from provider webhooks after the send. Open and click events require tracking to be enabled provider-side and are absent otherwise.

### Cancelling

`POST /mail/:id/cancel` succeeds only while the job is `queued`. Anything else is a `409` carrying the current status:

```jsonc
{ "error": { "code": "CONFLICT", "message": "Mail is 'sent' and can no longer be cancelled",
             "details": { "status": "sent" } } }
```

Cancellation is inherently racy against a worker claiming the job. Treat the `409` as a normal outcome, not an error to alert on.

---

## Response shapes

### Job

Returned by `POST /mail`, and by `GET /mail/:id` with an added `events` array. Ids are uuids.

```jsonc
{
  "id": "9c1f8e6a-3d21-4f7b-9a55-1c0e2b7d8f44",
  "status": "queued",
  "callerId": "booking-api",
  "template": "booking-confirmed",
  "subject": null,                  // set for raw sends; templates derive it at render time
  "to": [{ "email": "player@example.com" }],
  "cc": undefined,                  // omitted entirely when empty
  "bcc": undefined,
  "scheduledAt": "2026-08-27T10:00:00.000Z",
  "nextAttemptAt": "2026-08-27T10:00:00.000Z",
  "attempts": 0,
  "maxAttempts": 5,
  "provider": null,
  "providerMessageId": null,
  "lastError": null,
  "batchId": null,
  "metadata": { "bookingId": "10294" },
  "idempotencyKey": "booking-10294-confirmed",
  "attachmentCount": 0,
  "createdAt": "2026-08-27T10:00:00.000Z",
  "updatedAt": "2026-08-27T10:00:00.000Z",
  "deduplicated": false             // POST /mail only
}
```

The rendered HTML and text bodies are deliberately **not** returned — a status response should not ship a 50 KB email back to the caller. Use the preview endpoint if you need to see rendered output.

### Event

```jsonc
{
  "type": "sent",
  "provider": "smtp",
  "providerMessageId": "<abc@mail>",
  "payload": null,                  // provider-specific detail for webhook events
  "occurredAt": "2026-08-27T10:00:15.000Z"
}
```

Events carry no `id` in the API response. They are returned oldest-first.

---

## Errors

Every error uses one envelope:

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { … } } }
```

| Status | `code` | Cause |
|---|---|---|
| `401` | `MISSING_CREDENTIALS` | No `x-api-key` and no bearer token |
| `401` | `INVALID_API_KEY` | Unrecognised API key |
| `401` | `INVALID_TOKEN` | Bearer token is not the configured service role key |
| `403` | `INVALID_SIGNATURE` | SNS signature verification failed (webhook route only) |
| `404` | `NOT_FOUND` | Unknown job, template or suppression |
| `409` | `CONFLICT` | Cancel attempted on a non-`queued` job |
| `413` | `PAYLOAD_TOO_LARGE` | Body or attachment over the limit |
| `422` | `VALIDATION_ERROR` | Schema violation — see `details.issues` |
| `503` | `WORKER_DISABLED` | `/internal/dispatch` on an API-only instance |

A template-props failure reports field-level detail:

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid data for template 'invitation'",
    "details": {
      "template": "invitation",
      "issues": [{ "path": "acceptUrl", "message": "Invalid URL" }]
    }
  }
}
```

**Retry** on `429`, `5xx` and network timeouts, with backoff. **Do not retry** `400`, `401`, `404`, `409`, `413`, `422` — the request will fail identically.

Always send an `idempotencyKey`. A network timeout cannot tell you whether the mail was queued; with a key, the retry is free and returns the original job.

---

## Templates

Nine templates are available.

| Template | Required props | Subject |
|---|---|---|
| `otp` | `code` | `{code} is your Sportagon verification code` |
| `password-reset` | `resetUrl` | `Reset your password` |
| `welcome` | `name` | `Welcome to Sportagon` |
| `email-verification` | `verifyUrl` | `Confirm your email address` |
| `invitation` | `organizationName`, `role`, `acceptUrl` | `{inviter} invited you to join {org} on Sportagon` |
| `booking-confirmed` | `customerName`, `facilityName`, `courtName`, `bookingDate`, `timeRange` | `Booking confirmed — {facility} on {date}` |
| `booking-cancelled` | same five | `Booking cancelled — {facility} on {date}` |
| `booking-reminder` | same five | `Reminder: your slot at {facility} starts {startsIn}` |
| `generic-notification` | `subject`, `paragraphs` | your `subject` |

### Shared chrome

Every template renders inside one layout, which is what makes nine templates look like one product. You do not control any of it:

- A header carrying the Sportagon logo (or the wordmark when no logo is configured)
- A rounded white card, max 600px wide, on a neutral canvas — the template's heading and body sit inside it
- A footer with "Need help? Contact us at {supportEmail}." and a `© {year} Sportagon` line with the company address

Every send is **multipart** — an HTML part and a plaintext alternative rendered from the same component, so the text version never goes stale. Mail is light-mode only by declaration; it will not invert in a dark-mode client.

Branding (logo, colour, support address, app URL, company address) is service-level configuration, identical for every caller. You cannot override it per message.

Conventions across all of them:

- Props marked **optional** may be omitted; those with a **default** are filled in when omitted.
- Unknown keys in `data` are ignored, not rejected — a typo in an optional prop fails silently, so check `GET /templates`.
- Every string prop rejects the **empty string**. Send `null`/omit the key rather than `""`, which is a `422`.
- Fields named `*Url` must be absolute URLs.
- Dates and times arrive **pre-formatted as display strings**. The calling service owns the booking's timezone; re-deriving it here would risk the email disagreeing with the WhatsApp message for the same booking.
- Money fields are numbers and are always rendered as **Indian rupees** — `600` becomes `₹600`, `599.5` becomes `₹599.50`. There is no currency prop; a non-INR amount will still display a `₹`.

Each template below lists its props, its subject, and — under **Renders** — what the recipient actually sees, including which optional props control which visible elements. The fixed copy is quoted where it commits you to something (a refund window, an arrival time), because that text goes out over your service's name.

### `otp`

One-time verification code.

| Prop | Type | Required | Default |
|---|---|---|---|
| `code` | string, 4–12 chars | ✓ | — |
| `name` | string | | — (renders "Hi,") |
| `ttlMinutes` | positive int | | `10` |
| `purpose` | string | | `"verify your identity"` |

**Subject:** `{code} is your Sportagon verification code`

`purpose` is **free text**, not an enum — it is interpolated into "Use the code below to {purpose}." Any phrase works: `"sign in"`, `"reset your password"`, `"confirm your booking"`.

**Renders**

- Inbox preview: `{code} is your verification code`
- Heading: "Your verification code"
- `Hi {name},` — or plain `Hi,` when `name` is omitted
- "Use the code below to **{purpose}**."
- The code in a panel of its own: 32px monospace, letter-spaced for reading aloud and copying
- "This code expires in **{ttlMinutes}** minutes and can only be used once." (singular/plural handled)
- "If you did not request this code, you can safely ignore this email… Never share this code with anyone."

Pass `ttlMinutes` explicitly to match your own token expiry. Omitting it renders "expires in 10 minutes" regardless of what your service actually enforces — the template has no way to know.

> **If you are replacing a local OTP mailer:** `purpose` reaches the *body* only. The subject is fixed and does not name the errand. If your current mail distinguishes "password reset code" from "email verification code" in the subject — which matters, since an unbidden reset mail is how someone learns their account is being probed — that distinction is lost on migration. Raise it with the mail team rather than working around it.

```jsonc
{ "to": "user@example.com", "template": "otp",
  "data": { "name": "Navneet", "code": "482913", "ttlMinutes": 10, "purpose": "sign in" } }
```

### `password-reset`

Link-based password reset.

| Prop | Type | Required | Default |
|---|---|---|---|
| `resetUrl` | URL | ✓ | — |
| `name` | string | | — |
| `ttlMinutes` | positive int | | `60` |

**Subject:** `Reset your password`

**Renders**

- Inbox preview and heading: "Reset your password"
- `Hi {name},` — or plain `Hi,` when omitted
- "We received a request to reset your password. Click the button below to choose a new one. **This link works only once.**"
- A "Reset password" button, **plus the raw URL underneath** — some clients strip buttons, and cautious recipients want to see where a link goes before clicking
- "This link expires in **{ttlMinutes}** minutes."
- "If you did not request a password reset, no action is needed — your password stays as it is."

The body promises the link is single-use. Make sure your token flow actually enforces that.

Link-based only. For a **code-based** reset, use `otp` with `purpose: "reset your password"` — this template has no code variant.

```jsonc
{ "to": "user@example.com", "template": "password-reset",
  "data": { "name": "Navneet", "resetUrl": "https://sportagon.com/reset?token=…", "ttlMinutes": 60 } }
```

### `welcome`

| Prop | Type | Required | Default |
|---|---|---|---|
| `name` | string | ✓ | — |
| `ctaUrl` | URL | | — (button omitted) |
| `ctaLabel` | string | | `"Explore Sportagon"` |
| `highlights` | string[] (≤5) | | — |

**Subject:** `Welcome to Sportagon`

**Renders**

- Heading: `Welcome to Sportagon, {name}` — `name` is the only required prop and appears in the heading, not as a greeting line
- "Your account is ready. Sportagon helps you find courts, book slots, and keep your game going without the back-and-forth."
- `highlights` → a divider, then one bullet per string (max 5). Omitted entirely when absent
- `ctaUrl` → a button labelled `ctaLabel`. **No `ctaUrl` means no button** — `ctaLabel` alone renders nothing
- "Have a question? Just reply to this email — a real person reads it."

That last line is a commitment: the `replyTo` on this send should reach a monitored inbox.

```jsonc
{ "to": "user@example.com", "template": "welcome",
  "data": { "name": "Navneet", "ctaUrl": "https://sportagon.com/venues", "ctaLabel": "Find a venue",
            "highlights": ["Book courts near you in seconds", "Manage your bookings in one place"] } }
```

### `email-verification`

| Prop | Type | Required | Default |
|---|---|---|---|
| `verifyUrl` | URL | ✓ | — |
| `name` | string | | — |
| `ttlHours` | positive int | | `24` |

**Subject:** `Confirm your email address`

**Renders**

- Inbox preview and heading: "Confirm your email address"
- `Hi {name},` — or plain `Hi,` when omitted
- "Confirm this address to finish setting up your Sportagon account and secure it for password recovery."
- A "Confirm email address" button, **plus the raw URL underneath**
- "This link expires in **{ttlHours}** hours."
- "If you did not create an account, you can safely ignore this email."

Note this takes `ttlHours`, while `otp` and `password-reset` take `ttlMinutes`. Sending `ttlMinutes` here is silently ignored and the mail says 24 hours.

```jsonc
{ "to": "user@example.com", "template": "email-verification",
  "data": { "name": "Navneet", "verifyUrl": "https://sportagon.com/verify?token=…", "ttlHours": 24 } }
```

### `invitation`

Invitation to join an organisation.

| Prop | Type | Required | Default |
|---|---|---|---|
| `organizationName` | string | ✓ | — |
| `role` | string | ✓ | — |
| `acceptUrl` | URL | ✓ | — |
| `inviteeName` | string | | — (renders "Hi,") |
| `inviterName` | string | | — |
| `ttlDays` | positive int | | `7` |
| `message` | string (≤1000) | | — |

**Subject:** `{inviterName} invited you to join {organizationName} on Sportagon`, or `You've been invited to join {organizationName} on Sportagon` when `inviterName` is omitted.

**Renders**

- Inbox preview: `Join {organizationName} on Sportagon as {role}`
- Heading: `You've been invited to join {organizationName}`
- `Hi {inviteeName},` — or plain `Hi,` when omitted
- "**{inviterName}** has invited you to join **{organizationName}** on Sportagon as **{role}**." — becomes "You have been invited…" without `inviterName`
- `message` → the note in italics and quotation marks, above the details
- A details table: **Organisation**, **Role**, and **Invited by** (the last row only when `inviterName` is present)
- An "Accept the invitation" button, **plus the raw URL underneath**
- "This invitation expires in **{ttlDays}** days."
- "If you were not expecting this invitation you can safely ignore this email — no account is created until you accept."

The recipient of this mail has by definition never used the product, so who invited them, to what, and as what appear in the subject and again in the body — an unexplained "click here" from an unfamiliar brand is indistinguishable from phishing. **Send `inviterName` whenever you have it:** it changes the subject line, adds the "Invited by" row, and is the single biggest difference between this reading as an invitation and reading as spam.

`inviteeName` is optional because an invite is addressed to an email address that has no account yet. `role` is a human-readable label ("Coach", "Facility admin"), not an internal role enum — it is shown to the recipient verbatim.

The closing line promises no account exists until they accept. If your flow pre-creates a user row on invite, that sentence is inaccurate for you — raise it rather than shipping it.

```jsonc
{ "to": "coach@example.com", "template": "invitation",
  "data": { "inviterName": "Akash", "organizationName": "Akash Arena", "role": "Coach",
            "acceptUrl": "https://sportagon.com/invites/accept?token=…", "ttlDays": 7 } }
```

### `booking-confirmed`

| Prop | Type | Required | Default |
|---|---|---|---|
| `customerName` | string | ✓ | — |
| `facilityName` | string | ✓ | — |
| `courtName` | string | ✓ | — |
| `bookingDate` | string (pre-formatted) | ✓ | — |
| `timeRange` | string (pre-formatted) | ✓ | — |
| `amount` | number ≥ 0 | | — |
| `amountNote` | string | | — |
| `bookingId` | string | | — |
| `manageUrl` | URL | | — |

**Subject:** `Booking confirmed — {facilityName} on {bookingDate}`

**Renders**

- Inbox preview: `Your booking at {facilityName} is confirmed`
- Heading: "Your booking is confirmed"
- `Hi {customerName},` then "You are all set. Here are your booking details — we have saved your slot at {facilityName}."
- A details table with fixed labels: **Venue**, **Court**, **Date**, **Time**, then optionally **Amount** and **Booking ID**
- `manageUrl` → a "View booking" button
- "**Please arrive 10 minutes early.** Need to make a change? Contact the venue or reply to this email."

> **`amountNote` is appended to the Amount row, not rendered on its own.** With both, the row reads `₹600 · ₹500 booking + ₹100 add-ons`. **Sending `amountNote` without `amount` renders nothing at all** — the whole row is gated on `amount`. This validates fine and fails silently.

Two commitments in the fixed copy: the 10-minutes-early instruction, and "contact the venue or reply to this email" — so `replyTo` should reach someone.

The five required fields deliberately mirror the AiSensy WhatsApp campaign parameters, so one caller payload can drive both channels.

```jsonc
{ "to": "player@example.com", "template": "booking-confirmed",
  "data": { "customerName": "Navneet", "facilityName": "Akash Sports Arena", "courtName": "Court 2",
            "bookingDate": "Tue, 13 Aug 2026", "timeRange": "6:00 PM - 7:00 PM",
            "amount": 600, "amountNote": "₹500 booking + ₹100 add-ons",
            "bookingId": "BK-10294", "manageUrl": "https://sportagon.com/bookings/BK-10294" } }
```

### `booking-cancelled`

Same five required fields as `booking-confirmed`, plus:

| Prop | Type | Required | Default |
|---|---|---|---|
| `reason` | string | | `"Not specified"` |
| `refundAmount` | number ≥ 0 | | — |
| `bookingId` | string | | — |
| `rebookUrl` | URL | | — |

**Subject:** `Booking cancelled — {facilityName} on {bookingDate}`

**Renders**

- Inbox preview: `Your booking at {facilityName} was cancelled`
- Heading: "Your booking was cancelled"
- `Hi {customerName},` then "This booking has been cancelled. The slot is no longer reserved for you."
- A details table: **Venue**, **Court**, **Date**, **Time**, **Reason**, then optionally **Booking ID**
- `refundAmount` → "A refund of **₹{refundAmount}** is on its way and typically reaches your account within **5–7 business days**."
- `rebookUrl` → a "Book another slot" button
- "If you did not expect this cancellation, please get in touch and we will look into it."

> **The refund sentence is gated on `refundAmount` being greater than zero.** Sending `0` renders no refund text at all — which is usually what you want for a non-refundable cancellation, but means you cannot use `0` to say "no refund is due" explicitly. Put that in `reason` instead.

`reason` is shown to the customer verbatim in the table, so write it for them, not for your logs — "Requested by customer", not `USER_CANCELLED`. Omitting it renders "Not specified".

The 5–7 business day refund window is fixed copy. If your payment provider is slower than that, raise it before using this template.

```jsonc
{ "to": "player@example.com", "template": "booking-cancelled",
  "data": { "customerName": "Navneet", "facilityName": "Akash Sports Arena", "courtName": "Court 2",
            "bookingDate": "Tue, 13 Aug 2026", "timeRange": "6:00 PM - 7:00 PM",
            "reason": "Requested by customer", "refundAmount": 600,
            "bookingId": "BK-10294", "rebookUrl": "https://sportagon.com/venues" } }
```

### `booking-reminder`

Same five required fields as `booking-confirmed`, plus:

| Prop | Type | Required | Default |
|---|---|---|---|
| `startsIn` | string | | `"soon"` |
| `address` | string | | — |
| `mapUrl` | URL | | — |
| `bookingId` | string | | — |

**Subject:** `Reminder: your slot at {facilityName} starts {startsIn}`

**Renders**

- Inbox preview: `Your slot at {facilityName} starts {startsIn}`
- Heading: `Your game starts {startsIn}`
- `Hi {customerName},` then "A quick reminder about your upcoming slot at {facilityName}."
- A details table: **Venue**, **Court**, **Date**, **Time**, then optionally **Address** and **Booking ID**
- `mapUrl` → a "Get directions" button
- "Arrive 10 minutes early so you can start on time. See you on the court."

`startsIn` is a human phrase — `"in 2 hours"`, `"tomorrow"` — and it lands in the **subject and the heading**, so it must read naturally after "starts". Write `"in 2 hours"`, not `"2 hours"`. It defaults to `"soon"`, which is safe but vague.

Because `startsIn` is baked in at render time and rendering happens at send time, a reminder scheduled for two hours before the slot should say `"in 2 hours"` — the phrase and the `sendAt` have to agree, and nothing checks that they do.

Designed to be queued with `sendAt` in the same call that confirms the booking: enqueue the reminder for two hours before the slot and forget about it.

```jsonc
{ "to": "player@example.com", "template": "booking-reminder",
  "sendAt": "2026-08-13T12:30:00Z",
  "data": { "customerName": "Navneet", "facilityName": "Akash Sports Arena", "courtName": "Court 2",
            "bookingDate": "Tue, 13 Aug 2026", "timeRange": "6:00 PM - 7:00 PM", "startsIn": "in 2 hours",
            "address": "12 MG Road, Bengaluru", "mapUrl": "https://maps.google.com/?q=…",
            "bookingId": "BK-10294" } }
```

### `generic-notification`

Branded escape hatch — send well-structured mail without waiting for a bespoke template.

| Prop | Type | Required | Default |
|---|---|---|---|
| `subject` | string | ✓ | — |
| `paragraphs` | string[] (≥1) | ✓ | — |
| `heading` | string | | falls back to `subject` |
| `greeting` | string | | — |
| `details` | `{label,value}[]` (≤10) | | — (renders a label/value table) |
| `ctaUrl` | URL | | — (button omitted) |
| `ctaLabel` | string | | `"View details"` |
| `footnote` | string | | — |
| `previewText` | string | | falls back to `subject` |

**Subject:** whatever you pass as `subject`.

**Renders**

- Inbox preview: `previewText`, falling back to `subject`
- Heading: `heading`, falling back to `subject`
- `greeting` → its own paragraph at the top (write the whole line, e.g. `"Hi Navneet,"` — the template does not add a comma or a name)
- One paragraph per string in `paragraphs`
- `details` → a label/value table, same styling as the booking templates
- `ctaUrl` → a button labelled `ctaLabel`. **No `ctaUrl` means no button**
- `footnote` → small muted text at the bottom, above the standard footer

Unlike every other template, this one has **no fixed body copy** — everything the recipient reads comes from you, so it is also the only template where a typo ships without review. Note `details` values must be **strings**: send `"₹7,200"` and `"12"`, not numbers, and format currency yourself since the rupee helper does not apply here.

Request a dedicated template once a message becomes recurring — a bespoke template gets validation, a stable subject, and design review that a hand-assembled notification does not.

```jsonc
{
  "to": "user@example.com",
  "template": "generic-notification",
  "data": {
    "subject": "Your monthly summary is ready",
    "greeting": "Hi Navneet,",
    "paragraphs": ["Here is a quick look at your activity for July."],
    "details": [{ "label": "Sessions", "value": "12" }, { "label": "Venues", "value": "3" }],
    "ctaUrl": "https://sportagon.com/activity",
    "ctaLabel": "View full summary"
  }
}
```

### Discovering templates at runtime

```bash
curl http://mail-service:3000/templates -H 'x-api-key: <secret>'
```

```jsonc
{
  "templates": [
    {
      "key": "invitation",
      "description": "Invitation to join an organisation, naming the inviter, the organisation and the role.",
      "schema": { "type": "object", "properties": { … }, "required": ["organizationName", "role", "acceptUrl"] }
    }
  ]
}
```

`schema` is a standard JSON Schema generated from the same validator that runs on your request, so it cannot drift from what the endpoint accepts. Feed it to `ajv` (or your language's equivalent), or snapshot it in CI to catch a breaking template change before production does.

### Previewing

Render without sending — the fastest way to check what a payload produces:

```bash
curl -X POST 'http://mail-service:3000/templates/invitation/preview?format=html' \
  -H 'x-api-key: <secret>' -H 'content-type: application/json' \
  -d '{"data":{"inviterName":"Akash","organizationName":"Akash Arena","role":"Coach",
       "acceptUrl":"https://sportagon.com/invites/accept?token=t"}}' > preview.html
```

Without `?format=html` it returns `{ subject, html, text }` as JSON. The preview endpoint validates props exactly as a real send would, so it doubles as a payload check in CI without sending mail to anyone.

---

## Idempotency, scheduling, priority

### Idempotency

Pass `idempotencyKey` and a repeated call returns the original job with `200` and `"deduplicated": true` instead of queueing a second mail.

Keys are scoped to your caller name — two services can both use `welcome-1` without colliding. A concurrent race between two identical requests resolves to one job, not two.

Derive the key from the **event**, not the clock:

```
✓ booking-10294-confirmed          ✗ welcome-1724750400
✓ invite-8f21c9                    ✗ otp-{uuid4()}
```

A timestamp- or random-derived key defeats the mechanism entirely, because the retry generates a new one.

Where the same event can legitimately mail twice — a reminder resent by an operator, an OTP reissued on request — put the distinguishing fact in the key (`otp-signin-{tokenId}`), not a random value.

### Scheduling

```jsonc
{ "sendAt": "2026-08-28T09:00:00Z" }
```

The job stays `queued` with `scheduledAt` in the future and is not claimed until then. A `sendAt` in the past is treated as now, not rejected. Cancel it any time before it is claimed.

### Priority

`priority` is 1–9, lower first; default 5.

| Range | Use for |
|---|---|
| 1–2 | OTP, security alerts — anything a user is actively waiting on |
| 3–5 | Transactional: confirmations, receipts, invitations |
| 6–9 | Bulk: digests, reminders, anything tolerant of delay |

Priority orders the claim query. It does not preempt a job already sending, and it does not jump a scheduled job ahead of its `sendAt`.

---

## Suppressions

Hard bounces and complaints from provider webhooks automatically add the address to a do-not-mail list. Suppressed recipients are dropped at send time; if *every* recipient of a job is suppressed the job ends as `suppressed` rather than `failed`.

This is a shared, service-wide list — an address suppressed by one caller is suppressed for all of them. That is deliberate: sender reputation is shared too.

```bash
# List
curl 'http://mail-service:3000/suppressions?limit=50&offset=0' -H 'x-api-key: <secret>'

# Add — reason: hard_bounce | complaint | manual | unsubscribe   (default manual)
curl -X POST http://mail-service:3000/suppressions -H 'x-api-key: <secret>' \
  -H 'content-type: application/json' \
  -d '{"address":"user@example.com","reason":"unsubscribe"}'

# Remove
curl -X DELETE http://mail-service:3000/suppressions/user@example.com -H 'x-api-key: <secret>'
```

`limit` is 1–200 (default 50). `source` defaults to `api:<yourCallerName>`, so manual suppressions stay attributable. An optional `expiresAt` makes a suppression temporary — use it for a soft bounce a customer says they have fixed. Matching is case-insensitive.

Add a suppression yourself whenever a user opts out or complains through a channel the mail service cannot see, such as a support call.

---

## Webhooks

`POST /webhooks/ses` ingests SNS bounce and complaint notifications from Amazon SES. The mail team configures the SNS topic and attaches it to the SES configuration set; there is nothing for a calling service to do.

The route is unauthenticated by design — SNS cannot present an API key — but every message is verified against Amazon's signing certificate, so a forged bounce is rejected with `403 INVALID_SIGNATURE`. That verification matters because this endpoint can suppress addresses, and suppressing a competitor's customers would otherwise be trivial. An optional shared secret (`?secret=…` or an `x-webhook-secret` header) can gate it further; the signature check is enforced either way.

If your service needs to react to bounces — flagging an invalid address on a user record, for example — ask the mail team to fan events out to you. Polling `GET /mail/:id` works for a specific message but is not a delivery-event feed.

---

## Client examples

### curl

```bash
curl -X POST http://mail-service:3000/mail \
  -H 'x-api-key: <secret>' \
  -H 'content-type: application/json' \
  -d '{
    "to": "player@example.com",
    "template": "otp",
    "data": { "code": "482913", "ttlMinutes": 10, "purpose": "sign in" },
    "priority": 1,
    "idempotencyKey": "otp-signin-9c1f8e6a"
  }'
```

### TypeScript

```typescript
const MAIL_URL = process.env.MAIL_SERVICE_URL!;
const MAIL_KEY = process.env.MAIL_SERVICE_API_KEY!;

type Address = string | { email: string; name?: string };

interface SendMail {
  to: Address | Address[];
  template?: string;
  data?: Record<string, unknown>;
  subject?: string;
  html?: string;
  text?: string;
  cc?: Address | Address[];
  bcc?: Address | Address[];
  replyTo?: string;
  from?: { email?: string; name?: string };
  attachments?: Array<{ filename: string; contentType?: string; content?: string; url?: string }>;
  sendAt?: string;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

interface MailJob {
  id: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'suppressed';
  attempts: number;
  lastError: string | null;
  deduplicated: boolean;
}

export async function sendMail(body: SendMail): Promise<MailJob> {
  const res = await fetch(`${MAIL_URL}/mail`, {
    method: 'POST',
    headers: { 'x-api-key': MAIL_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await res.json();

  if (!res.ok) {
    // 422 carries details.issues[]; 409 carries details.status.
    const err = payload.error ?? {};
    throw new Error(`mail-service ${res.status} ${err.code}: ${err.message}`);
  }

  return payload as MailJob;
}

// Invitation — name the inviter so the mail does not read as phishing.
await sendMail({
  to: 'coach@example.com',
  template: 'invitation',
  data: {
    inviterName: 'Akash',
    organizationName: 'Akash Arena',
    role: 'Coach',
    acceptUrl: `https://sportagon.com/invites/accept?token=${token}`,
    ttlDays: 7,
  },
  idempotencyKey: `invite-${inviteId}`,
});
```

### Python

```python
import os, requests

MAIL_URL = os.environ["MAIL_SERVICE_URL"]
MAIL_KEY = os.environ["MAIL_SERVICE_API_KEY"]

def send_mail(**body):
    res = requests.post(
        f"{MAIL_URL}/mail",
        json=body,
        headers={"x-api-key": MAIL_KEY, "content-type": "application/json"},
        timeout=10,
    )
    payload = res.json()
    if not res.ok:
        err = payload.get("error", {})
        raise RuntimeError(f"mail-service {res.status_code} {err.get('code')}: {err.get('message')}")
    return payload

job = send_mail(
    to={"email": "player@example.com", "name": "Navneet"},
    template="booking-confirmed",
    data={
        "customerName": "Navneet",
        "facilityName": "Akash Arena",
        "courtName": "Court 2",
        "bookingDate": "Tue, 13 Aug 2026",   # pre-formatted by the caller
        "timeRange": "6:00 PM - 7:00 PM",
        "amount": 600,
    },
    idempotencyKey="booking-10294-confirmed",
    metadata={"bookingId": "10294"},
)

print(job["id"], job["status"], job["deduplicated"])
```

### Checking status

```python
job = requests.get(
    f"{MAIL_URL}/mail/{job_id}",
    headers={"x-api-key": MAIL_KEY},
    timeout=10,
).json()

print(job["status"], job["attempts"], job["lastError"])
for event in job["events"]:
    print(event["occurredAt"], event["type"], event["provider"])
```

### Validating payloads in CI

Assert against the live schema rather than against this document:

```typescript
const { templates } = await fetch(`${MAIL_URL}/templates`, {
  headers: { 'x-api-key': MAIL_KEY },
}).then((r) => r.json());

const invitation = templates.find((t: { key: string }) => t.key === 'invitation');

// Either validate your outgoing payload against it with ajv, or snapshot
// invitation.schema so a breaking template change fails your build, not prod.
expect(invitation.schema).toMatchSnapshot();
```

Or send nothing at all and let the service validate for you:

```bash
curl -X POST http://mail-service:3000/templates/invitation/preview \
  -H 'x-api-key: <secret>' -H 'content-type: application/json' \
  -d "{\"data\": $YOUR_PAYLOAD}" -o /dev/null -w '%{http_code}\n'
# 200 = payload valid, 422 = it would have been rejected
```

---

## Data model

Useful if you have read access to a replica for analytics or monitoring. You do not need this to integrate.

**`mail_jobs`** — the queue and the audit log. Every accepted mail has a row, forever.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `idempotency_key` | text | Unique per `(caller_id, idempotency_key)` |
| `caller_id` | text | Which service sent it |
| `template_key`, `template_data` | text, jsonb | Source of truth; rendered at send time |
| `subject`, `html_body`, `text_body` | text | Raw sends, plus the rendered snapshot when enabled |
| `to_addresses`, `cc_addresses`, `bcc_addresses` | jsonb | Arrays of `{email, name?}` |
| `reply_to`, `from_address`, `from_name` | text | |
| `attachments` | jsonb | |
| `status` | text | Constrained to the six statuses |
| `priority` | smallint | Default 5 |
| `scheduled_at`, `next_attempt_at` | timestamptz | |
| `attempts`, `max_attempts` | integer | |
| `locked_at`, `locked_by` | timestamptz, text | Crash recovery |
| `provider`, `provider_message_id`, `last_error` | text | |
| `batch_id` | uuid | |
| `metadata` | jsonb | Whatever you sent |
| `created_at`, `updated_at` | timestamptz | |

Note the address columns are `to_addresses` / `cc_addresses` / `bcc_addresses`, not `to` / `cc` / `bcc` — the API field names and the column names differ.

**`mail_events`** — append-only timeline, one row per state change, cascade-deleted with the job. Columns: `id`, `mail_job_id`, `type`, `provider`, `provider_message_id`, `payload` (jsonb, provider detail for webhook events), `occurred_at`, `created_at`.

**`mail_suppressions`** — the do-not-mail list. Columns: `address` (citext primary key, so matching is case-insensitive), `reason`, `source`, `expires_at` (NULL = permanent), `created_at`.

---

## Configuration reference

You need only `MAIL_SERVICE_URL` and `MAIL_SERVICE_API_KEY` on your side. The rest is listed so you can reason about limits and behaviour, and so whoever operates the service has one place to look.

### Limits that affect callers

| Setting | Default | Effect |
|---|---|---|
| `MAX_BATCH_SIZE` | 500 | Max `messages` per batch request |
| `MAX_ATTACHMENT_BYTES` | 10485760 (10 MB) | Per-attachment cap |
| `ATTACHMENT_FETCH_TIMEOUT_MS` | 10000 | Timeout when fetching an attachment `url` |
| `JSON_BODY_LIMIT` | `15mb` | Whole-request cap; set to `5mb` on Lambda, whose hard limit is 6 MB |
| `MAIL_MAX_ATTEMPTS` | 5 | Default `maxAttempts` |
| `LOCK_TIMEOUT_MS` | 300000 | A job stuck in `sending` longer than this is reclaimed |

### Service configuration

```env
# Runtime
NODE_ENV=production
ROLE=all                    # api | worker | all
PORT=3000
LOG_LEVEL=info              # debug | info | warn | error
JSON_BODY_LIMIT=15mb

# Database — plain Postgres
DATABASE_URL=postgres://user:pass@host:5432/mail_service
DB_POOL_MAX=5
DB_SSL=true
MIGRATE_ON_BOOT=false

# Inbound auth — comma-separated callerName:secret
MAIL_API_KEYS=booking-api:secret1,admin-console:secret2
SUPABASE_SERVICE_ROLE_KEY=

# Sending — ordered failover chain: console | smtp | ses
MAIL_PROVIDERS=smtp
MAIL_FROM_ADDRESS=no-reply@sportagon.com
MAIL_FROM_NAME=Sportagon
MAIL_REPLY_TO=

# SMTP — works with Gmail/Workspace, Zoho, SES SMTP, Brevo, Mailgun, Postmark…
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

# Amazon SES — omit keys to use the default AWS credential chain (IAM role)
AWS_REGION=ap-south-1
SES_REGION=                 # only if the SES identity lives outside AWS_REGION
SES_ACCESS_KEY_ID=          # static creds under non-reserved names, needed on Lambda
SES_SECRET_ACCESS_KEY=
SES_CONFIGURATION_SET=      # required for bounce/complaint events to reach the webhook
SES_WEBHOOK_SECRET=         # optional extra gate; SNS signature check is always enforced

# Queue / worker
MAIL_POLL_INTERVAL_MS=2000
MAIL_BATCH_SIZE=10
MAIL_MAX_ATTEMPTS=5
LOCK_TIMEOUT_MS=300000
MAX_BATCH_SIZE=500
MAX_ATTACHMENT_BYTES=10485760
ATTACHMENT_FETCH_TIMEOUT_MS=10000
STORE_RENDERED_HTML=false   # keeps rendered HTML on every job row; bloats the table

# Branding — used by every template
BRAND_NAME=Sportagon
BRAND_LOGO_URL=
BRAND_COLOR=#16a34a
APP_BASE_URL=https://sportagon.com
SUPPORT_EMAIL=support@sportagon.com
COMPANY_ADDRESS=
```

`ROLE=all` runs the API and the worker in one process. Split with `ROLE=api` and `ROLE=worker` to scale them independently — same image, different variable. A worker-only instance still serves `/health` so orchestrators do not restart it.

`MAIL_PROVIDERS=console` prints mail to stdout instead of sending it, which is the safe default for a sandbox environment.

---

## Troubleshooting

**`401 MISSING_CREDENTIALS`** — no credential reached the service. Check the header name is exactly `x-api-key`.

**`401 INVALID_API_KEY`** — the value must be the **secret only**, not `callerName:secret`. If your key was issued as `booking-api:s3cr3t`, you send `s3cr3t`.

**`422` on a template send** — read `details.issues`; each entry has `path` and `message`. Confirm the shape against `GET /templates`, not against a copied table. Common causes: a `*Url` field that is not absolute, a missing required prop, a string where a number belongs, or a typo in an optional prop name (silently ignored, so the mail sends without it).

**`422` complaining about `template`** — you sent both `template` and `html`/`text`, or neither. It is one or the other.

**Mail accepted but never arrives** — fetch `GET /mail/:id` and read the job:

| Symptom | Meaning |
|---|---|
| `attempts` climbing, `lastError` set | The provider is rejecting it — `lastError` has the reason |
| `attempts: 0`, `scheduledAt` in the future | Working as intended; it is scheduled |
| `attempts: 0`, `scheduledAt` in the past | Nothing is draining the queue — tell the mail team |
| `status: "suppressed"` | Every recipient is on the do-not-mail list |
| `status: "sent"` | The provider accepted it; the problem is downstream (spam folder, recipient-side filtering) |

**Status is `sent` but the user says nothing arrived** — `sent` means a provider accepted the message, not that it reached an inbox. Check the `delivered` and `bounced` events on the timeline, then the recipient's spam folder.

**Duplicate mail** — a missing or clock-derived `idempotencyKey`. Derive it from the event.

**`409` on cancel** — the worker claimed the job first. Expected; not an error condition.

**`503` on `/health/ready`** — the mail service cannot reach its database. The response body names the failing check.

**Nothing arrives in a sandbox environment** — sandboxes usually run with `MAIL_PROVIDERS=console` (mail is logged, not sent) or point at a catch-all inbox. Confirm which with the mail team before debugging further.

---

## Requesting changes

**A new template.** Templates live in the mail service's repository and are code-reviewed there by design — there is no admin UI, and that is deliberate, since an email is a piece of the product's voice. Open a request with the mail team including: the trigger, the exact props you can supply, a draft subject line, and what the recipient should do next. Adding one is a small change on their side, and you get validation, JSON Schema docs, a preview endpoint and a render test for free.

**A change to an existing template.** Templates are shared. A change ships to every caller at once, and because rendering happens at send time it also affects mail already queued. Say which callers you know depend on it.

**A new API key**, a rotation, or bounce-event fan-out to your service — same route.

Use `generic-notification` while you wait. It is designed exactly for that gap.

---

*Verified against the running service on 2026-08-27. Where this document and `GET /templates` disagree, the endpoint is authoritative.*
