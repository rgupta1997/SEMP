# Notification delivery — end-to-end test plan (RDS + AppSync Events)

Status: proposed, not yet executed.
Scope: the live notification path only — `notify()` → RDS row → SQS → publisher Lambda →
AppSync Events → browser bell. Email fan-out and the rest of the RDS migration are
touched only where they share a hop.
Environment under test: **`semp-uat`** (ap-south-1, account 506491559903).
Deliverable at the end: **`docs/notification-e2e-test-report-<YYYY-MM-DD>.md`** — see §10.

---

## 1. What is actually being tested

```
  notify()                             packages/notifications/src/server/notify.ts
    │  writes the row                  → RDS  (notifications, notification_reads,
    │                                          notification_cursors)
    │  resolveUserIds(rule)            → who gets it  (audience is now JSONB)
    ▼
  NotificationRealtimePort.publish()   apps/api/src/modules/realtime/notification-realtime.ts
    │  gated on REALTIME_TRANSPORT === 'appsync'
    │  buildFanoutMessages()           chunks recipients at 200/message
    ▼
  enqueueFanout()                      hand-signed SendMessageBatch, 2s timeout
    ▼
  SQS  semp-uat-realtime               (+ DLQ semp-uat-realtime-dlq)
    ▼
  semp-uat-realtime-publisher          handleBatch(): one SigV4 POST per recipient
    │                                  → https://lac6llg2…appsync-api.ap-south-1.amazonaws.com/event
    │                                  body { channel: /notifications/user/<uid>, events: ["…"] }
    ▼
  AppSync Event API  semp-uat-events   namespace `notifications`, publish = AWS_IAM
    │  subscribe = AWS_LAMBDA  →  semp-uat-realtime-authorizer
    │                              verifies HS256 (HKDF-derived key, aud+iss)
    │                              then EXACT equality on the channel string
    ▼
  browser: lib/realtime.ts → lib/realtime-appsync.ts (Amplify events.connect)
    │  receives a PING (no content)
    ▼
  invalidate unread-count + feed → GET /notifications, /notifications/unread-count
    │
    └─ fallback if any of the above is dead: 2-minute poll (UNREAD_POLL_MS)
```

Two properties of this design drive the whole plan:

- **Delivery is a ping, not a payload.** So "the bell rang" is only half a pass; the
  refetch that follows must also return the right row from RDS. A test that asserts on
  the WebSocket frame alone proves nothing a user would notice.
- **Every hop fails silently.** `notify()` swallows realtime errors by design so a
  queue outage cannot fail the HTTP request that caused the notification. There is no
  user-visible error state anywhere on this path — the only symptom of a total failure
  is "the bell updates after 2 minutes instead of instantly", which nobody reports as a
  bug. Testing therefore has to be **per-hop and instrumented**, not end-to-end-only.

---

## 2. Current state (verified 2026-09-26, not assumed)

| Fact | Evidence |
|---|---|
| `semp-uat` stack `UPDATE_COMPLETE`, last updated 2026-09-25 | `describe-stacks` |
| AppSync Event API `semp-uat-events` exists (`vbdsnowrvjdfjjfwleqocvygou`) | `appsync list-apis` |
| Queue + DLQ exist, **both empty** (0 messages) | `sqs get-queue-attributes` |
| API Lambda `semp-uat` has `REALTIME_TRANSPORT=appsync` + all three companions set | `lambda get-function-configuration` |
| Authorizer log group holds ~1 KB → it **has** been invoked | `logs describe-log-groups` |
| **Publisher log group holds 0 bytes → it has NEVER been invoked** | same |
| **No alarms are deployed** — `AlarmEmail` is empty, so `HasAlarmEmail` is false | `describe-stack-resources`, stack Parameters |
| `AuthorizerResultTtlSeconds=300` vs `REALTIME_TOKEN_TTL_SECONDS=900` | stack Parameters + Lambda env |
| Unit layer is green: 28 tests in `@semp/notifications`, 142 in the API's realtime/notifications/config suites | ran both |
| `apps/web/.env` `VITE_API_URL` points at the UAT stack | file |
| Local dev has **no** `REALTIME_TRANSPORT` set → defaults to `off` | `apps/api/.env`, `env.schema.ts:109` |
| Local dev has **no** `DATABASE_URL` — every candidate line is commented out | root `.env`, `apps/api/.env` |
| UAT `MAIL_API_URL` is `https://mail.invalid` — email fan-out is deliberately dead there | Lambda env |

**The headline: the fan-out has never run.** An empty publisher log group with an
empty queue means either nothing has ever enqueued, or every enqueue failed before
reaching SQS. The authorizer *has* run, so somebody has subscribed successfully — the
browser half is further along than the server half. Hop 2 (API → SQS) is the first
place to look, and §5 L2 is the test that decides it.

Everything below is written to survive that being wrong: each layer proves one hop
independently, so the plan works whether the break is at hop 2 or nowhere.

---

## 3. Do this before writing a single test

These are not tests; they are the instruments without which the tests are
uninterpretable — and without which the §10 report has no evidence to cite.

1. **Deploy the alarms.** Redeploy `semp-uat` with `AlarmEmail=<your address>` and
   confirm the SNS subscription. Right now a fan-out can die completely with no
   signal anywhere. The DLQ alarm, queue-age alarm and authorizer-error alarm already
   exist in `infra/semp-api.yaml:719-792`; they are just conditioned off.
2. **Open three log tails** in separate terminals and leave them running for the whole
   session, redirected to files so the report can quote them.
   ```bash
   aws logs tail /aws/lambda/semp-uat --region ap-south-1 --follow --filter-pattern '[notifications]' | tee evidence/api.log
   ```
   ```bash
   aws logs tail /aws/lambda/semp-uat-realtime-publisher --region ap-south-1 --follow | tee evidence/publisher.log
   ```
   ```bash
   aws logs tail /aws/lambda/semp-uat-realtime-authorizer --region ap-south-1 --follow | tee evidence/authorizer.log
   ```
3. **Pin the environment facts** into your shell so no command below is ambiguous:
   ```bash
   export REGION=ap-south-1 STACK=semp-uat
   export API=https://o30gqya1sg.execute-api.ap-south-1.amazonaws.com
   export QUEUE=https://sqs.ap-south-1.amazonaws.com/506491559903/semp-uat-realtime
   export DLQ=https://sqs.ap-south-1.amazonaws.com/506491559903/semp-uat-realtime-dlq
   export APPSYNC_HTTP=lac6llg2unfiflqikhfesiqyju.appsync-api.ap-south-1.amazonaws.com
   ```
4. **Decide the lane.** Two are viable and they answer different questions:
   - **UAT lane (primary).** Real Lambda, real IAM, real AppSync. This is the only lane
     that can prove SigV4 signing and the execution-role policies, which are the two
     things most likely to be wrong and cannot be simulated. Use it for L2–L6.
   - **Local-API lane (secondary).** `npm run dev:api` against RDS, with
     `REALTIME_TRANSPORT=appsync` and the three `APPSYNC_*` values copied from the
     UAT Lambda, plus AWS credentials in the shell. It publishes into the *same* UAT
     AppSync API, so a locally-triggered notification lands in a browser subscribed to
     UAT. Far faster to iterate on `notify()` call sites. Requires setting
     `DATABASE_URL`/`DIRECT_URL` to RDS first — both are currently commented out.

   Do **not** use `semp-api` for any of this. Per `infra/README.md`, that Lambda and
   its HTTP API are the live BETA environment.

---

## 4. The silent-failure inventory

This is the test oracle **and the coverage checklist the report in §10 is scored
against**. Each row is a failure that produces **no error anywhere** — drawn from a
hazard the source already documents.

| # | Failure | Symptom | Caught by |
|---|---|---|---|
| S1 | Channel string disagreement between API, publisher and authorizer | Publish returns 200; nobody is subscribed; bell never rings | L3 + L5 |
| S2 | `SendMessageBatch` returns 200 with a non-empty `Failed` list | Enqueue "succeeds", no message exists | L2 (log line `[notifications] realtime enqueue rejected`) |
| S3 | Endpoint not of the form `https://<26 chars>.appsync-api.<region>.amazonaws.com/event` | Amplify assumes a custom domain, connection never opens, no explanation | L1 assertion on the mint response |
| S4 | Authorizer TTL ≥ token TTL | An expired token keeps working for the rest of the cache window | L4 (config assertion: 300 < 900 today — re-check after any param change) |
| S5 | Wildcard subscribe (`/notifications/*`) accepted | One user receives every user's notifications | L4 negative tests |
| S6 | Amplify captures the token at connect; AppSync closes the socket on authorizer-TTL expiry | Bell dies at ~minute 15 of an open tab. **Every smoke test finishes inside 15 minutes, which is exactly how this reaches production** | L6 — the long-tab test, non-negotiable |
| S7 | `notificationRealtimePort` imported but never registered by `buildApp()` | Nothing enqueues, ever. The mail port next door spent months in this state | L2, plus `http/server.ports.test.ts` |
| S8 | Recipient resolution wrong after the audience → JSONB conversion | Right notification, wrong or empty recipient set | L1 |
| S9 | Publisher gets 403 from AppSync (IAM policy / SigV4 wrong) | Not retried by design; one log line, no DLQ entry, no alarm | L3 + publisher log tail |
| S10 | Ping arrives but the refetch returns nothing (visibility rule differs from fan-out rule) | Badge blips and reverts | L5 |

---

## 5. Test layers

Run them in order. Each one is a gate: a failure at L*n* makes L*n+1* uninterpretable.
Every numbered case below carries an ID (`L2.3`, `L4.wildcard`, …) — **record the
outcome of each one as you go**; §10 is assembled from exactly that list, and a case
whose result was not written down at the time is a case the report must mark
`NOT RUN`, not one you reconstruct from memory afterwards.

### L0 — Static and unit (≈2 min, already green)

```bash
npm run test --workspace @semp/notifications
npx vitest run --root apps/api src/modules/realtime src/modules/notifications src/config
npm run test --workspace @semp/web
```

Covers the channel contract, the authorizer's hostile-channel table (38 cases),
token minting and shape, env-schema refusals, and the client refetch coalescer.
**170 of these pass today.** Treat L0 as a regression gate, not as evidence the system
works — nothing here touches AWS or a database.

Add before moving on: a test asserting `buildApp()` registers
`notificationRealtimePort` (S7), if `http/server.ports.test.ts` does not already
cover the realtime port as well as the mail port.

### L1 — Data layer on RDS (≈30 min)

The hop nothing else can compensate for: if the row or its recipients are wrong, a
perfectly working transport delivers a correct ping about the wrong thing.

- **L1.1 Schema parity.** Confirm against RDS directly, not against `schema.prisma`:
  ```sql
  \d notifications            -- audience must be jsonb
  \d notification_cursors     -- must exist, PK user_id
  select audience->>'kind', count(*) from notifications group by 1;
  ```
  Every row must have a non-null `kind` that the resolver knows. A row with
  `audience = null` or an unknown `kind` is a migration miss from
  `infra/rds-migrations/001_notifications_audience_to_jsonb.sql`.
  Cross-check `infra/rds-repair-20260926.sql` (currently untracked) has been applied —
  per prior experience, `prisma db push` against RDS strips partial indexes, functions
  and triggers silently.
- **L1.2 Recipient resolution.** For one notification of each major audience kind
  (`everyone`, `role`, `org_admins`, `team_members`, `direct_user`), compare
  `resolveUserIds()` output against a hand-written SQL query for the same population.
  Mismatch here is S8 and is invisible downstream.
- **L1.3 Read path.** `GET /notifications` and `GET /notifications/unread-count` for two
  users with deliberately different scopes. Then `POST /notifications/mark-seen` and
  re-check the count. The watermark query (`created_at > last_seen_at`) replaced an
  anti-join; a missing `notification_cursors` row must read as "everything unread",
  not as an error or zero.
- **L1.4 Mint shape (S3).** Sign in against `$API`, then:
  ```bash
  curl -s -X POST "$API/api/notifications/realtime-token" -H "Authorization: Bearer $JWT" | jq
  ```
  Assert, exactly: `endpoint` matches
  `^https://\w{26}\.\w+-api\.ap-south-1\.amazonaws\.com/event$`, `region` is
  `ap-south-1`, `channel` is `/notifications/user/<your uuid>`, and `expires_at` is
  ~900s ahead. Also assert the token is **rejected** by `/auth/me` — it must not be a
  working session token (that is the entire reason for the derived key).

### L2 — API → SQS (≈20 min) ← *start here if you only have an hour*

This is where the evidence says the break is.

- **L2.1** Trigger exactly one notification with a **known, small** audience — a direct
  notification to yourself is ideal (`POST /api/notifications` or any single-recipient
  workflow such as an org join request).
- **L2.2** Within 60s, read the queue:
  ```bash
  aws sqs get-queue-attributes --queue-url "$QUEUE" --region $REGION \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
  ```
  and the sent-message metric:
  ```bash
  aws cloudwatch get-metric-statistics --namespace AWS/SQS --metric-name NumberOfMessagesSent \
    --dimensions Name=QueueName,Value=semp-uat-realtime --region $REGION \
    --start-time $(date -u -v-15M +%FT%TZ) --end-time $(date -u +%FT%TZ) \
    --period 60 --statistics Sum
  ```
- **L2.3 Pass:** `NumberOfMessagesSent` ≥ 1. **Fail modes and what they mean:**
  - Metric stays 0 **and** the API log shows nothing → the port is not registered
    (S7), or `REALTIME_TRANSPORT` is not read as `appsync` at send time.
  - API log shows `[notifications] realtime enqueue rejected …` → S2; read the
    rejected entry ids.
  - API log shows a thrown/timed-out SQS call → the 2s timeout, or the execution
    role lacks `sqs:SendMessage`. Check the role's policy rather than guessing.
- **L2.4 Isolate signing from wiring.** Send one message by hand and see whether the
  publisher wakes up:
  ```bash
  aws sqs send-message --queue-url "$QUEUE" --region $REGION --message-body \
    '{"v":1,"notificationId":"<real uuid>","userIds":["<your uuid>"],"event":{"v":1,"kind":"notification","notificationId":"<real uuid>","type":"manual"}}'
  ```
  If the publisher runs on the hand-sent message but not on the app-triggered one,
  the fault is unambiguously in the API's enqueue, not in the queue or publisher.

### L3 — SQS → publisher → AppSync (≈20 min)

- **L3.1** With the hand-sent message from L2.4 in flight, watch the publisher tail. A
  cold start plus one publish should appear within seconds.
- **L3.2 Pass:** publisher log shows an invocation and **no** `[realtime-publisher]`
  error line; queue returns to 0; DLQ stays 0.
- **L3.3 Fail modes:**
  - `403 publishing to user … - not retrying` → S9. The execution role's
    `appsync:EventPublish` resource ARN, or the SigV4 service name/region, is wrong.
    This is deliberately not retried, so it will never reach the DLQ — the log line
    is the only signal, which is why the tail is mandatory.
  - `discarding unreadable message …` → the message version or shape is wrong
    (check `REALTIME_MESSAGE_VERSION` on both sides).
  - Messages accumulate in the DLQ → the publisher is erroring before `handleBatch`,
    typically a bad handler path or a missing env var.
- **L3.4 Poison and redrive.** Send a deliberately malformed body (`{"v":99}`). Assert
  it is *discarded with a log line and not retried* — the documented behaviour. Then
  redrive the DLQ (`aws sqs start-message-move-task`) and confirm the ping being
  idempotent means a duplicate causes only a redundant refetch.

### L4 — Authorizer and isolation (≈30 min) — **security gate**

The authorizer replaced the RLS policy. It is the only thing between per-user channels
and a cross-account leak, so this layer is not optional even though L0 already covers
`authorize()` exhaustively as a pure function. What L0 cannot prove is that AppSync is
actually *calling* it with the values the tests assume.

With a real subscriber connected (L5's browser, or the probe script in §6):

| ID | Attempt | Expected |
|---|---|---|
| L4.self | Subscribe to your own `/notifications/user/<you>` with a fresh token | ACK; authorizer log shows `isAuthorized: true` |
| L4.other | Subscribe to `/notifications/user/<another user>` | Refused |
| L4.wildcard | Subscribe to `/notifications/*` (wildcard, sent verbatim) | Refused — S5 |
| L4.traversal | Subscribe to `/notifications/user/<you>/../<them>` | Refused |
| L4.wrongsub | Subscribe with a token minted for a different user | Refused |
| L4.session | Subscribe with an **API session token** instead of a realtime token | Refused (wrong `aud`) |
| L4.expired | Subscribe with an expired token | Refused |
| L4.publish | Publish from a browser client (auth mode `lambda`) | Refused — publish is IAM-only |
| L4.ttl | `AuthorizerResultTtlSeconds` (300) strictly below `REALTIME_TOKEN_TTL_SECONDS` (900) | Holds — S4. Re-assert after any parameter change; CloudFormation cannot express this constraint |

### L5 — Browser end-to-end (≈45 min) — **the acceptance test**

Two browser profiles, two different users, both signed into the UAT web build.

- **L5.1** Confirm each tab opened a WebSocket to
  `lac6llg2…appsync-realtime-api.ap-south-1.amazonaws.com` (DevTools → Network → WS)
  and that the authorizer log shows two `EVENT_SUBSCRIBE` authorizations.
- **L5.2** Trigger a notification for **user A only**, from a third session.
- **L5.3 Pass:** A's bell badge increments within ~2 seconds, *and* opening the drawer
  shows the correct row with correct title/body from the refetch. B's badge does not
  move (S10 + isolation).
- **L5.4 Broadcast.** Repeat for a championship-wide audience: both bells move, and the
  fan-out is one SQS message per 200 recipients — confirm the message count matches
  `ceil(recipients/200)`.
- **L5.5 Prove the refetch, not just the ping.** In DevTools, confirm `GET /notifications`
  and `/notifications/unread-count` fire on receipt. Multiple rapid notifications
  must coalesce into a bounded number of refetches (the coalescer is unit-tested; this
  confirms it is wired).
- **L5.6 Prove the fallback.** Set `REALTIME_TRANSPORT=off` on the UAT Lambda, trigger a
  notification, and confirm the bell still updates — within 2 minutes, not instantly.
  Set it back. This is the documented rollback and, after the RDS cutover, the only
  one there is; it must be exercised, not assumed.
- **L5.7 Session change.** Sign out and back in, and confirm the subscription is torn
  down and rebuilt (`realtimeAuthChanged` drops the grant). A notification for the
  previous user must not arrive in the new session.

### L6 — Time-dependent behaviour (≈40 min, mostly waiting) — **do not skip**

Everything above completes in under fifteen minutes, which is precisely why S6 —
the most likely production failure on this path — survives a full clean test run.

- **L6.1 Long tab.** Open a tab, leave it **25+ minutes** untouched, then trigger a
  notification. **Pass:** it still arrives instantly. Fail means the reconnect cycle
  in `lib/realtime.ts` is not firing, and the bell silently degrades to the 2-minute
  poll after ~15 minutes for every real user.
  While waiting, watch the authorizer tail: you should see a re-authorization at
  roughly the 13-minute mark (token TTL 900s minus the 120s refresh buffer), and each
  AppSync authorizer-cache expiry at 300s.
- **L6.2 Sleep/resume.** Sleep the laptop for 20 minutes, wake it, trigger a
  notification. Same expectation.
- **L6.3 Network drop.** Kill Wi-Fi for 60s, restore, trigger. Reconnect must use
  backoff and recover without a page reload.
- **L6.4 Cold start.** Leave everything idle ≥30 minutes so the publisher and authorizer
  Lambdas are cold, then trigger. Measure end-to-end latency; a cold authorizer
  inside AppSync's 10s ceiling and the client's 10s subscribe-ACK race is the risk.

### L7 — Volume (≈20 min, optional but cheap)

**L7.1** Trigger one notification with the largest realistic audience available in UAT
(a championship-wide broadcast). Assert: messages sent = `ceil(n/200)`; publisher
concurrency 20 holds; no 429s in the publisher log (it retries once on 429/5xx with
jitter — one or two is fine, a wall of them means the fan-out needs rate limiting);
queue age stays near zero; DLQ empty.

---

## 6. Harness worth building (≈half a day, pays for itself immediately)

Manual browser testing cannot be repeated on every deploy, L6 in particular is
unbearable by hand, and a hand-written report is only as good as what someone
remembered to note. Build `tools/realtime-probe.mjs`:

1. Sign in against `$API` as a given user, mint a realtime token.
2. Subscribe with Amplify's events client **in Node**, using the exact same
   `connectChannel` path the browser takes (import it, do not reimplement — a
   reimplementation would not catch S1 or S3, which are the failures it exists to
   catch).
3. Trigger a notification via the API.
4. Assert a ping arrives within N seconds, then assert `GET /notifications` contains
   the matching id.
5. Exit non-zero with which hop failed.
6. **Append a result line to `evidence/results.jsonl`** —
   `{caseId, status, startedAt, durationMs, detail, evidenceRef}` — so §10's report is
   generated rather than transcribed.

With that, L2/L3/L5's happy path becomes one command, L4's negative table becomes a
loop over channel strings, L6.1 becomes `--wait 25m` in CI, and the report becomes
`node tools/render-test-report.mjs evidence/results.jsonl`.

---

## 7. Suggested order and timeboxes

| | Layer | Time | Gate |
|---|---|---|---|
| 1 | §3 instruments (alarms + three log tails) | 20 min | Nothing below is interpretable without it |
| 2 | L0 unit | 2 min | Green today |
| 3 | **L2 API → SQS** | 20 min | The evidence says the break is here |
| 4 | L3 publisher → AppSync | 20 min | |
| 5 | L1 data layer | 30 min | Can run in parallel with 3–4 |
| 6 | L4 authorizer/isolation | 30 min | **Security gate — blocks release** |
| 7 | L5 browser E2E | 45 min | **Acceptance** |
| 8 | L6 time-dependent | 40 min | **Blocks release** — this is the one that reaches production otherwise |
| 9 | L7 volume | 20 min | Optional |
| 10 | §10 report | 30 min | The deliverable |

Roughly one focused day, plus half a day if the probe harness is built first — which
is the better trade if this will be re-tested on the beta and prod cutovers, since
everything except L5 and L6.2 then becomes scriptable, and the report becomes a
generated artifact rather than a writing task.

## 8. Release criteria

- L0–L5 pass, L6.1 and L6.2 pass.
- The DLQ alarm, queue-age alarm and authorizer-error alarm are deployed and the SNS
  subscription is confirmed.
- The `REALTIME_TRANSPORT=off` rollback has been exercised at least once (L5.6), not
  merely documented.
- Every cross-user subscribe attempt in L4 was refused, with the refusals visible in
  the authorizer log.
- §10's report exists, every case has a status, and every `FAIL` has either a fix or a
  recorded accepted-risk decision with a name against it.

## 9. Known context that affects reading results

- **UAT `MAIL_API_URL` is `https://mail.invalid`.** Email fan-out will fail on every
  notification in this environment. `notify()` swallows that by design, and it is
  unrelated to realtime — expect the `[notifications] email fan-out failed …` line and
  do not chase it. Note it in the report's out-of-scope section so the next reader
  does not chase it either.
- **`semp-api` is live BETA, not a leftover.** Do not point tests or teardown at it.
- **Local dev is realtime-off by default** (`REALTIME_TRANSPORT` unset), and currently
  has no `DATABASE_URL` at all. A local run that shows no live delivery is the
  configured behaviour, not a bug.
- **Two background jobs cannot run on Lambda** (`demos.routes.ts`,
  `impact.routes.ts` — both `void job()` after `res.json()`). If a test path triggers
  a notification through either, it will hang at `queued`; use a different trigger.

---

## 10. The report (the deliverable)

Write to `docs/notification-e2e-test-report-<YYYY-MM-DD>.md`, with raw logs and
metric dumps under `evidence/`. It is a record, not a summary: someone deciding
whether to cut over prod must be able to read it **and see what was not tested**, which
is the half that a green-tick table normally hides.

Rules that make it worth keeping:

- **Every case ID in §5 appears exactly once**, with a status from:
  `PASS` / `FAIL` / `BLOCKED` (a prior gate failed) / `NOT RUN` (with the reason) /
  `N/A` (with why it cannot apply here). No case may be omitted — omission is how a
  skipped test becomes an assumed pass.
- **Every `PASS` cites evidence**: a log excerpt with its timestamp, a metric value, a
  screenshot, or a probe exit code. A `PASS` with no evidence is recorded as `NOT RUN`.
- **Every `FAIL` names the hop**, quotes the actual output, and links a fix or an
  explicit accepted-risk decision with a person's name and date against it.
- **State the environment and build**: stack name, git SHA, Lambda version, web build,
  RDS instance, and the date. A report that does not say what it tested ages into
  a claim nobody can check.

### Required sections

1. **Verdict** — one line: ship / do not ship / ship with named caveats, against §8.
2. **Environment and build under test** — as above.
3. **Coverage matrix, by case** — the full §5 list:

   | Case | What it proves | Status | Evidence | Notes |
   |---|---|---|---|---|
   | L2.3 | API enqueues to SQS | PASS | `evidence/api.log:41`, `NumberOfMessagesSent=1 @14:02` | cold start 1.8s |

4. **Silent-failure coverage (S1–S10)** — the more important table, because it is the
   one that says whether the *risks* were addressed rather than whether commands were
   run:

   | Risk | Covered by | Status | If uncovered, the exposure |
   |---|---|---|---|
   | S6 token-expiry death at ~15 min | L6.1 | PASS | Bell silently degrades to 2-min poll for every long-lived tab |

   Any S-row that ends `NOT COVERED` is a release decision, not a footnote — list it
   again under §10.6.
5. **Defects found** — one entry each: hop, symptom, root cause if known, severity,
   fix or ticket. Include defects found *outside* the notification path (the RDS
   migration is young; L1 is likely to turn some up) rather than discarding them.
6. **Not covered, and what that leaves open** — explicitly: anything `NOT RUN` or
   `N/A`; risks with no test at all; environment gaps (UAT has no real mail transport,
   a smaller dataset than prod, and no production traffic); and load beyond L7's
   largest available audience. This section is the reason the report exists.
7. **Timings** — end-to-end latency observed (warm and cold), publisher duration, and
   fan-out size vs. message count. These become the baseline the prod cutover is
   compared against.
8. **Deltas since the last run** — once there is more than one report, what changed:
   newly passing, newly failing, newly covered. On the first run, say "baseline".
9. **Recommendations before the prod cutover** — ordered, each tied to a case or risk
   ID above, separating "must" from "should".

### Generating it

If the §6 harness exists, the mechanical parts (sections 3, 7 and the PASS evidence
refs) render from `evidence/results.jsonl`; sections 1, 5, 6 and 9 are written by hand
because they are judgements, not measurements. If it does not, keep a running
`evidence/results.jsonl` by hand as each case completes — appending one line per case
at the moment you observe it, which is also what keeps §10's "every case appears
exactly once" rule honest.
