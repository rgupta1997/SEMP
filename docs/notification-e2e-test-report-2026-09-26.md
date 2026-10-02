# Notification delivery — end-to-end test report

**Date:** 2026-09-26 · **Plan:** [notification-e2e-test-plan.md](notification-e2e-test-plan.md)
**Run by:** Claude (Opus 5), driven from the repo working tree at `1d5e5b8`

---

## 1. Verdict

**Do not ship to production yet — two blockers, both fixable, neither in the transport.**

The AppSync transport itself is **sound and proven end to end**. Every hop from
`notify()` through SQS, the publisher Lambda, AppSync Events, the Lambda authorizer and
into a live browser works, at measured latencies between 0.6s and 2.9s. The per-user
isolation that replaced Supabase RLS holds against all twelve hostile cases.

What blocks release is not the migration's new code but two things the cutover left
behind:

- **D1 (P0):** a stale `CHECK` constraint on RDS rejects **54 of 60** notification
  types. Two call sites return **HTTP 500** to the user; the other 43 silently drop the
  notification. One line of SQL fixes it.
- **D2 (P1):** the documented rollback (`REALTIME_TRANSPORT=off`) **cannot be
  executed** — the env schema refuses to boot in production with it. There is currently
  no working rollback for the realtime transport.

Fix D1 and D2 and the remaining items are ordinary follow-ups.

## 2. Environment under test

| | |
|---|---|
| Stack | `semp-uat` (CloudFormation `UPDATE_COMPLETE`, last updated 2026-09-25) |
| Region / account | ap-south-1 / 506491559903 |
| API | `https://o30gqya1sg.execute-api.ap-south-1.amazonaws.com` (Lambda `semp-uat`, `NODE_ENV=production`) |
| Web | `https://semp-uat.netlify.app` — verified built against the UAT API |
| Database | RDS `semp-prod`, PostgreSQL 17.7, port 5462 |
| AppSync Event API | `semp-uat-events` (`vbdsnowrvjdfjjfwleqocvygou`), namespace `notifications` |
| Queue / DLQ | `semp-uat-realtime` / `semp-uat-realtime-dlq` |
| Publisher / authorizer | `semp-uat-realtime-publisher` / `semp-uat-realtime-authorizer`, nodejs22.x |
| Test account | `admin@semp.local` (super admin) |
| Repo | `1d5e5b8`, branch `security/phase0-nodeenv-and-sam-iac` |

**Not the live beta.** `semp-api` (the live BETA Lambda) still points at **Supabase
BETA**, not RDS. Nothing in this run touched it or its users.

## 3. Correction to the plan's starting assumption

The plan opened by saying the publisher had never been invoked and therefore "the
evidence says the break is at hop 2 (API → SQS)", and that the authorizer's log activity
meant a browser had subscribed successfully.

**Both readings were wrong, and the run disproved them:**

- Hop 2 was never broken. The publisher had never run because **no notification had ever
  been created on this database** — the newest row predating this run was
  `2026-08-31`, carried in from the Supabase dump. Nobody had exercised the feature on
  RDS at all.
- The authorizer's entire log history was **one manual deny test** from 2026-09-24
  (`channel: /notifications/user/someone-else`). No browser had ever subscribed. The
  first successful subscribe in this stack's history happened during this run, at
  **13:34:20Z**.

The distinction matters: the system was untested, not broken.

## 4. Coverage matrix, by case

All times UTC on 2026-09-26.

| Case | What it proves | Status | Evidence |
|---|---|---|---|
| L0.notifications | Channel contract, coalescer, resolver units | **PASS** | 28/28 vitest |
| L0.api | API units incl. authorizer's 38-case hostile table | **PASS** | 732 passed, 10 skipped — *only with `DATABASE_URL` set*, see D5 |
| L0.web | Client realtime + architecture guards | **PARTIAL** | 79 passed; `component-safety.test.ts` cannot load, see D6 |
| L0.ports | S7 — realtime port actually registered | **PASS** | `server.ports.test.ts` asserts `ports.realtime === notificationRealtimePort` |
| L1.1 | Schema parity on RDS | **FAIL** | `audience` is jsonb ✓, `notification_cursors` exists ✓, but `notifications_type_check` survives — **D1** |
| L1.2 | S8 — recipient resolution correct | **PASS** | Real resolver vs SQL, exact match on all 6 rule kinds (below) |
| L1.3 | Feed + watermark read path | **PASS** | unread-count 144 → 145 → 146; feed 50 rows; empty cursor reads as all-unread |
| L1.4 | S3 — mint shape + credential separation | **PASS** | endpoint matches Amplify's regex; channel canonical; TTL 900s; realtime token → `/auth/me` = **401** |
| L2.1 | API accepts and writes | **PASS** | `POST /api/notifications` → 201 in 444ms at 13:29:39.7 |
| L2.2 / L2.3 | S2/S7 — API enqueues to SQS | **PASS** | `NumberOfMessagesSent=1`; publisher START 13:29:40 (<1s); no `enqueue rejected` line |
| L2.4 | Queue → publisher wiring in isolation | **PASS** | Hand-sent message consumed, publisher ran, queue drained |
| L3.1 / L3.2 | S9 — publisher → AppSync, SigV4 + IAM | **PASS** | Cold start 638ms; **no** `[realtime-publisher]` error ⇒ AppSync returned 2xx; DLQ stayed 0 |
| L3.3 | Failure-mode triage | **N/A** | No failure modes occurred |
| L3.4 | Poison handling | **PASS** | `{"v":99}` → `discarding unreadable message`, not retried, DLQ stayed 0 |
| L3.4b | DLQ redrive | **NOT RUN** | DLQ never received a message; nothing to redrive |
| L4.self | Own channel allowed | **PASS** | ACK; authorizer logged no deny |
| L4.other | Cross-user subscribe | **PASS** (refused) | `denied {"operation":"EVENT_SUBSCRIBE","channel":"/notifications/user/0000…001"}` |
| L4.wildcard | S5 — `/notifications/*` | **PASS** (refused) | `denied … "channel":"/notifications/*"` |
| L4.wildcard2 | `/notifications/user/*` | **PASS** (refused) | `denied … "channel":"/notifications/user/*"` |
| L4.traversal | `…/<me>/../<them>` | **PASS** (refused) | Rejected before the authorizer (AppSync channel-format validation) |
| L4.nsroot | `/notifications` | **PASS** (refused) | `denied … "channel":"/notifications"` |
| L4.trailing | Own channel + trailing slash | **PASS** (allowed, correctly) | See §5 — AppSync normalises it; verified not a leak |
| L4.otherTrail | Other's channel + trailing slash | **PASS** (refused) | Authorizer received the path **already normalised**, then denied on equality |
| L4.case | Uppercased channel | **PASS** (refused) | Rejected |
| L4.session | API session token as realtime token | **PASS** (refused) | Wrong `aud` |
| L4.garbage / L4.none | Malformed / empty token | **PASS** (refused) | Both denied |
| L4.ttl | S4 — authorizer TTL < token TTL | **PASS** | 300s < 900s |
| L4.expired | Expired token | **NOT RUN** | Would need a 15-minute hold; `L4.garbage`/`L4.session` cover the verify path, and `authorize.test.ts` covers expiry as a unit |
| L4.publish | Browser attempts publish | **NOT RUN** | Publish is AWS_IAM-only on the namespace; unverified from the client side |
| L5.1 | Browser subscribes | **PASS** | 13:34:20 — two authorizer invocations, no deny. First ever in this stack |
| L5.2 / L5.3 | Live delivery to a browser | **PASS** | Ping 13:35:33.3 → refetch 13:35:34.75 = **~1.4s** |
| L5.4 | Broadcast to a large audience | **NOT RUN** | Substituted by L7.1 with 200 synthetic recipients, to avoid writing to real users' feeds |
| L5.5 | Ping drives a refetch | **PASS** | `/notifications/unread-count` fires per ping (2 calls ~13ms apart) |
| L5.6 | **Rollback works** | **FAIL** | `REALTIME_TRANSPORT=off` + `NODE_ENV=production` fails env validation — **D2** |
| L5.7 | Sign-out tears down the subscription | **NOT RUN** | Would have destroyed the L6.1 idle tab; deferred |
| L5.8 *(added)* | **Fully natural end-to-end** | **PASS** | App-resolved audience, no hand-addressed ping: trigger 14:00:49.3 → refetch 14:00:52.2 = **~2.9s**; 2 delivery rows written by `notify()` |
| L5.poll | 2-minute fallback poll | **PASS** | Observed live at 13:37:52, 13:39:52, 13:41:53, 13:43:53, 13:45:54 |
| L6.1 | **S6 — 25-minute idle tab** | **PASS** | Tab idle since 13:34:20; ping 13:59:32.3 → refetch 13:59:32.9 = **0.6s** |
| L6.refresh | Token-refresh cycle fires | **PASS** | Client re-minted at **13:47:16** = 12m56s after connect (900s TTL − 120s buffer); authorizer re-authorized, no deny |
| L6.2 | Sleep / resume | **NOT RUN** | Needs the physical machine suspended |
| L6.3 | Network drop and recovery | **NOT RUN** | Not exercised |
| L6.4 | Cold-start latency | **PARTIAL** | Publisher init 115.7ms (total 638ms); authorizer init 414–526ms. Both well inside AppSync's 10s ceiling. Not measured from a ≥30-minute cold state |
| L7.1 | Volume / chunking | **PASS** | 200 recipients in **2381ms** warm, no 429s, DLQ empty — but see **D3** |

**Totals:** 31 PASS · 2 FAIL · 2 PARTIAL · 8 NOT RUN · 1 N/A

### L1.2 detail — resolver vs SQL ground truth

The real `resolveUserIds()` was run against RDS and compared against hand-written SQL:

| Rule | Resolver | SQL | |
|---|---|---|---|
| `everyone` (Test Championship) | 1 | 1 | ✓ |
| `everyone` (Pickleball) | 19 | 19 (0 organisers + 3 officials + 16 team members) | ✓ |
| `role: organiser` (Pickleball) | 3 | 3 | ✓ |
| `role: captain` (Pickleball) | 0 | 0 (only Participant ×16, Organiser ×3 assigned) | ✓ |
| `org_admins` | 2 | 2 (owner + admin, correctly excluding `member`) | ✓ |
| `direct_user` | 1 | 1 | ✓ |
| `compose` (2 rules) | 2 | 2 | ✓ |

Note: `roles.code` is NULL for every row on RDS, and resolution works only because
`roleWhereByCode()` falls back to matching by `name`. That fallback is deliberate and
documented, but it is load-bearing here — see R6.

## 5. The one finding that was NOT a defect

`L4.trailing` initially failed: subscribing to `/notifications/user/<me>/` was
**allowed**, where the plan expected a refusal, and the authorizer does exact string
equality.

It is not a hole. **AppSync normalises the trailing slash before invoking the
authorizer.** Two pieces of evidence:

1. The same trick against another user's channel is **refused**.
2. The authorizer log for that attempt shows the channel arriving **already stripped**:
   `denied {"operation":"EVENT_SUBSCRIBE","channel":"/notifications/user/0306fe21-…"}` —
   no trailing slash.

So the equality check is intact and a user can only ever reach their own channel. The
plan's expectation was wrong, not the system; `tools/realtime-probe.mjs` has been
corrected and now also asserts the decisive `L4.otherTrail` case.

## 6. Silent-failure coverage (S1–S10)

The table that matters — whether the *risks* were addressed, not whether commands ran.

| Risk | Covered by | Status | Exposure if uncovered |
|---|---|---|---|
| S1 channel mismatch between the three consumers | L5.8, L6.1 | **COVERED** | Publish succeeds, nobody subscribed, bell never rings, no error anywhere |
| S2 `SendMessageBatch` 200 with a `Failed` list | L2.2 | **COVERED** | Enqueue reads as success; no message exists |
| S3 wrong endpoint shape | L1.4 | **COVERED** | Amplify assumes a custom domain; connection never opens, unexplained |
| S4 authorizer TTL ≥ token TTL | L4.ttl | **COVERED** | Expired token keeps working for the rest of the cache window |
| S5 wildcard subscribe | L4.wildcard, L4.wildcard2 | **COVERED** | One user receives every user's notifications |
| S6 token-expiry death at ~15 min | **L6.1 + L6.refresh** | **COVERED** | Bell silently degrades to the 2-minute poll on every long-lived tab |
| S7 port imported but not registered | L0.ports, L2.2 | **COVERED** | Nothing ever enqueues |
| S8 recipient resolution wrong after JSONB conversion | L1.2 | **COVERED** | Correct ping about the wrong thing |
| S9 publisher 403 from AppSync | L3.1 | **COVERED** | Not retried, no DLQ entry, no alarm — one log line only |
| S10 ping arrives, refetch returns nothing | L5.8 | **COVERED** | Badge blips and reverts |

All ten are covered. **But note S6's and S9's shared premise:** both are detectable only
because log tails were watched by hand during this run. In steady state **no alarm
exists to catch either** — see D4.

## 7. Defects

### D1 — P0 · Stale `notifications_type_check` rejects 54 of 60 notification types

`infra/rds-migrations/` never dropped the CHECK constraint that the notification-service
design replaced with an application-level registry. On RDS it still allows only:

```
manual, event_lifecycle, enrollment_approved, org_join_request,
org_join_approved, org_join_declined
```

The registry defines **60** types. Proven directly:

```
ERROR: new row for relation "notifications" violates check constraint "notifications_type_check"
DETAIL: Failing row contains (…, match_scheduled, probe, …)
```

**Blast radius**, from classifying all 48 `notify()` call sites:

| | Count | Consequence |
|---|---|---|
| Guarded by try/catch, blocked type | 43 | Notification **silently dropped**; business action succeeds |
| **Unguarded, blocked type** | **2** | **HTTP 500 returned to the user** |
| Unguarded, allowed type | 3 | Fine |

The two that 500:

- `billing/billing.routes.ts:286` → `plan_upgrade_requested` — a user requesting a plan
  upgrade gets a 500.
- `iam/user-invitations.routes.ts:154` → `org_invitation` — inviting a user to an
  organization gets a 500.

**Fix** — one line, exactly what `docs/notification-service-plan.md` §4 specified:

```sql
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
```

> I was not able to execute this, including inside a rolled-back transaction: the
> sandbox blocked the DDL as a shared-resource change. **The fix is therefore
> recommended but unverified by execution.** Apply it and re-run L1.1 and a notification
> of a previously-blocked type.

This also explains why `notification_deliveries` was empty and the publisher had never
run: barring the six allowed types, the feature could not write a row at all.

### D2 — P1 · The documented rollback cannot be executed

`infra/README.md` blocker 2 states the rollback is to set `REALTIME_TRANSPORT=off`,
redeploy, and accept a 2-minute delay — "after the RDS cutover there is no other
rollback".

`config/env.schema.ts:211` refuses to boot when `NODE_ENV=production` and
`REALTIME_TRANSPORT !== 'appsync'`. The UAT Lambda runs `NODE_ENV=production`. Verified
by running the **real schema against the real UAT environment map**:

```
REALTIME_TRANSPORT=appsync   (NODE_ENV=production)   boots: YES
REALTIME_TRANSPORT=off       (NODE_ENV=production)   boots: NO - API REFUSES TO START
```

It is also asserted as intended behaviour by `env.schema.test.ts:149`. So the two
documents contradict each other, and **the consequence is that there is no rollback**:
applying the documented mitigation during an AppSync incident takes the whole API down
instead of degrading the bell.

> I deliberately did **not** flip the live UAT variable to prove this, since it would
> have taken the shared stack offline. The static proof above is conclusive.

**Decide which is true**, then make the other match: either relax the guard to allow a
deliberate `off` in production (e.g. a `REALTIME_ROLLBACK=1` escape hatch), or correct
`infra/README.md` and define a real rollback.

### D3 — P2 · Publisher batch is within ~21% of its timeout at full load

Measured: 200 recipients = **2381ms**. `handleBatch` iterates records **sequentially**,
and the event-source mapping's `BatchSize` is **10**. So a full batch is 10 × 200 =
**2,000 publishes ≈ 23.8s against a 30s Lambda timeout**.

A timeout returns no `batchItemFailures`, so **all 10 messages redeliver**, retry, and
after 5 receives land in the DLQ — the exact amplification `message.ts` documents
`RECIPIENTS_PER_MESSAGE = 200` to avoid. A cold start or a couple of 429 retries
consumes much of the remaining margin.

**Fix options:** drop `BatchSize` to 2–3, raise the timeout to 60–90s (visibility
timeout is already 180s), or process records concurrently rather than sequentially.

### D4 — P2 · No alarms are deployed

`AlarmEmail` is empty, so `HasAlarmEmail` is false and the DLQ, queue-age and
authorizer-error alarms in `infra/semp-api.yaml:719-792` do not exist. Since `notify()`
swallows realtime failures by design, **nothing would report a broken fan-out.** Every
detection in this report came from a human-watched log tail.

### D5 — P3 · `npm run test` fails without `DATABASE_URL`

Four API test files import `config/env.ts` transitively and abort at collection with a
Zod error. Both `.env` files currently have every `DATABASE_URL` line commented out, so
a fresh clone gets a red suite with 699 passing tests and no explanation. Setting a
placeholder makes all 54 files pass.

### D6 — P3 · A web test cannot run from a path containing a space

`apps/web/src/lib/component-safety.test.ts:31`:

```ts
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
```

`URL.pathname` leaves `%20` encoded, so `walk()` calls `readdirSync` on
`…/Sport%20management/apps/web/src/pages` → `ENOENT`. The repo's actual path contains a
space, so this test never runs here. Use `fileURLToPath(new URL('..', import.meta.url))`.

### D7 — Observation · A super admin's bell never updates live

`getUnreadCountByCursor` has an `isSuper` branch counting **every** notification in the
system, while realtime pings only go to `resolveUserIds()` recipients. A super admin
therefore sees counts for notifications they will never be pinged about, and their badge
updates only on the 2-minute poll.

This appears intentional (the feed is the authoritative renderer) and is not a
disclosure — but it is why L5.3 and L6.1 had to hand-address their pings. **L5.8 exists
precisely to remove that caveat**, and it passed: with the admin made a genuine
recipient, the app resolved 2 recipients and delivered naturally.

### D8 — Security, found in passing (outside this test's scope)

Not notification defects, but found while reading the environment and worth separate
triage:

- **`semp-api` (live BETA) carries `DATABASE_URL` and `JWT_SECRET` as plaintext Lambda
  environment variables**, including the Supabase password — readable by anyone with
  `lambda:GetFunctionConfiguration`. `semp-uat` correctly uses Secrets Manager.
- **RDS `semp-prod` is `PubliclyAccessible: true`** with a security-group ingress of
  `0.0.0.0/0` on port 5462. The rule is annotated "Non-VPC Lambda egress — no narrower
  expression exists", so it is a known trade-off, but it means the database's only
  protection is its password.

## 8. Timings (baseline for the prod cutover)

| Measurement | Value |
|---|---|
| API → SQS enqueue (inside the request) | <1s; `POST /notifications` returned in **444ms** total |
| Hand-addressed ping → browser refetch | **1.45s** |
| Idle-tab (25 min) ping → browser refetch | **0.6s** |
| **Natural end-to-end** (API call → browser refetch) | **2.9s** |
| Publisher, 1 recipient, cold | 638ms (115.7ms init) |
| Publisher, 1–2 recipients, warm | 148–350ms |
| Publisher, 200 recipients, warm | **2381ms** (~84 publishes/s at concurrency 20) |
| Authorizer, cold | 414–526ms init, 2.8–36ms execution |
| Client token refresh | fires at **12m56s** after connect (900s − 120s buffer) |
| Fallback poll interval | 120s, observed exactly |

## 9. Not covered, and what that leaves open

- **L5.7 sign-out teardown** — not run (it would have destroyed the idle tab mid-test).
  Leaves open: whether a notification for a previous session can reach a new one. The
  unit suite covers `realtimeAuthChanged` dropping the grant; the live path is unproven.
- **L6.2 sleep/resume and L6.3 network drop** — not run. Leaves open the most common
  real-world interruptions. L6.1 proves the scheduled reconnect; it does not prove
  recovery from an *unplanned* disconnect.
- **L4.expired and L4.publish** — not run. Expiry is unit-tested; a client-side publish
  attempt is unverified against the live namespace.
- **L5.4 real broadcast** — substituted with 200 synthetic recipients to avoid writing
  into real users' feeds. Publisher behaviour is proven; a real large audience's
  *resolution* is not.
- **D1's fix is unverified by execution** — the DDL was blocked as a shared-resource
  change.
- **Environment gaps:** UAT has no working mail transport (`MAIL_API_URL` is
  `https://mail.invalid`, so every `[notifications] email fan-out failed` line in these
  logs is expected and unrelated); the dataset is 818 users and 6 championships, far
  smaller than production will be; and there is no concurrent production traffic.
- **Load beyond 200 recipients in one message was not tested** — D3's 2,000-publish
  worst case is an *extrapolation* from the 200-recipient measurement, not an
  observation.

## 10. Recommendations before the prod cutover

**Must:**

1. **Drop `notifications_type_check`** (D1), then re-run L1.1 and send one
   previously-blocked type end to end. Add a migration so the next environment cannot
   repeat it.
2. **Resolve the rollback contradiction** (D2). Until then, accept explicitly that there
   is no rollback for the realtime transport.
3. **Deploy the alarms** with a real `AlarmEmail` and confirm the SNS subscription (D4).
   Without them nothing detects S6 or S9 in steady state.

**Should:**

4. **Reduce the publisher's `BatchSize` or raise its timeout** (D3) before any audience
   approaching 2,000 recipients exists.
5. **Run L5.7, L6.2 and L6.3** — the three interruption cases, all cheap once
   `tools/realtime-probe.mjs` is wired into CI (`--wait` already supports the long hold).
6. **Populate `roles.code`.** Resolution currently depends on `roleWhereByCode()`'s
   name-matching fallback; a renamed role silently empties an audience.
7. **Triage D8 separately** — the live beta's plaintext secrets are unrelated to this
   migration but are a live exposure today.

## 11. Test data created

Four notification rows in RDS `semp-prod`, all titled `E2E probe *`:

| id | title | created |
|---|---|---|
| `d763cb01-d072-4a9b-8d78-bd627cca5ca8` | E2E probe L2.1 | 13:29:39 |
| `5ccc4d5d-bcb2-47a5-8ebb-50d0385a5cdb` | E2E probe L5.3 | 13:35:32 |
| `5b420a86-f249-4e0a-b151-452f1d7f1594` | E2E probe L6.1 long tab | 13:59:30 |
| `4f149e5e-7e6e-48c7-b75b-41fa53254ee8` | E2E probe L5.8 natural | 14:00:50 |

Removable with:

```sql
DELETE FROM notifications WHERE title LIKE 'E2E probe%';
```

Also created and **already reverted**: `admin@semp.local` was briefly made an official on
"Test Championship" for L5.8, then removed (the app soft-deletes, so the row remains with
`is_active = false`). No other data was modified.

## 12. Artifacts

- `tools/realtime-probe.mjs` — the harness from the plan's §6. `--negative` runs the
  12-case hostile-channel table; `--wait <ms>` holds a subscription open for the
  long-tab case; results append to `evidence/results.jsonl`.
- Evidence ledger and raw logs: session scratchpad under `evidence/`.

## 13. Deltas since the last run

Baseline — this is the first execution of this plan, and the first time the notification
fan-out has ever run in this stack.
