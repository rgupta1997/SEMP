# UAT

**DEPLOYED** — `semp-uat`, ap-south-1, 2026-09-24.

| Output | Value |
|---|---|
| API | `https://o30gqya1sg.execute-api.ap-south-1.amazonaws.com` |
| AppSync HTTP | `lac6llg2unfiflqikhfesiqyju.appsync-api.ap-south-1.amazonaws.com` |
| AppSync WS | `lac6llg2unfiflqikhfesiqyju.appsync-realtime-api.ap-south-1.amazonaws.com` |
| AppSync API id | `vbdsnowrvjdfjjfwleqocvygou` |
| Queue / DLQ | `semp-uat-realtime` / `semp-uat-realtime-dlq` |

Verified after deploy: `/health` returns `{"ok":true}`; a login attempt reaches the
database and returns 401; CORS returns `access-control-allow-origin:
https://events.sportagon.in`; AppSync is `AWS_LAMBDA` for connect and subscribe and
**`AWS_IAM` for publish**; the event-source mapping is `Enabled` with `BatchSize 10`,
a **zero** batching window and `ReportBatchItemFailures`; and the authorizer, invoked
with a forged token aimed at another user's channel, returned `{"isAuthorized":false}`.

The mint endpoint will hand the browser
`https://lac6llg2unfiflqikhfesiqyju.appsync-api.ap-south-1.amazonaws.com/event`, whose
api-id segment is exactly 26 characters and which matches Amplify's
`getRealtimeEndpointUrl()` pattern — so Amplify derives the right `wss://` URL, and it
agrees with the stack's own `RealtimeWsEndpoint` output.

> ### The first deploy shipped broken, and why
>
> All three functions came back with an **identical `CodeSha256`** and failed at init
> with `Runtime.ImportModuleError: Cannot find module 'index'`.
>
> `samconfig.toml`'s deploy sections set `template_file = "semp-api.yaml"`. That
> overrides `sam deploy`'s default of `.aws-sam/build/template.yaml` — the built
> template, the only one whose `CodeUri` points at each function's own artifact
> directory. SAM therefore re-read the source template, saw `CodeUri: ../apps/api` on
> all three, and zipped the source tree: one 24 MB archive with no `index.mjs` at its
> root, handed to every function.
>
> It hides well. `sam build` succeeds, the artifacts under `.aws-sam/build` are
> correct — they are simply never used. `sam validate` cannot see it. Only a real
> deploy does, which is why it survived until the first one. Fixed by pointing the
> deploy sections at the built template; `[api.deploy]` had the same bug and is fixed
> too.

| | |
|---|---|
| Stack | `semp-uat` (CloudFormation, via AWS SAM) |
| Template | `infra/semp-api.yaml` — shared with every other environment |
| Config | `infra/samconfig.toml`, `[uat.*]` sections |
| Region | ap-south-1 |
| Database | RDS `semp-prod` from the `semp-infra` stack — **real migrated production data** |

## What it creates

All eleven names were verified free in ap-south-1 before the first deploy:

| Resource | Name |
|---|---|
| Lambda (API) | `semp-uat` |
| AppSync Event API | `semp-uat-events` |
| Channel namespace | `notifications` |
| Queue / DLQ | `semp-uat-realtime`, `semp-uat-realtime-dlq` |
| Authorizer / publisher | `semp-uat-realtime-authorizer`, `semp-uat-realtime-publisher` |
| Log groups | `/aws/lambda/semp-uat`, `/aws/http-api/semp-uat`, and one per function |

Every one derives from `FunctionName=semp-uat`. That parameter is the whole reason no
teardown of beta is needed.

## Deploy

```bash
./deploy.sh
```

Validates, builds all three functions, then deploys. `confirm_changeset` is **true**
here — you will be shown the changeset and asked before anything applies.

## Open before the first deploy

1. **`MAIL_API_KEY` is empty in `AppSecret`** — the only remaining blocker. The
   template sets `NODE_ENV=production` and `MAIL_TRANSPORT=http`, and the schema
   refuses to boot without the key. Any non-empty value works while mail is sinkholed
   (see 2). Populate it with `put-secret-value` (RUNBOOK-rds.md step 7), which now
   writes two keys — that is also what drops the stale `SUPABASE_JWT_SECRET`.

2. ✅ **Email is sinkholed — resolved.** `MailApiUrl` points at `https://mail.invalid`
   (RFC 2606 reserved, guaranteed never to resolve), so no mail can reach the real
   recipients living in the migrated production data. A snapshot can undo a write; it
   cannot unsend an email.

   Consequences, both fine:
   - Notification email fails and is logged. `emailRecipients` in `notify.ts` already
     treats that as non-fatal — the feed row is written and is the primary channel.
   - **OTP sign-in will not work**: `signin.routes.ts` discards the token when delivery
     fails, so no code arrives. Use `POST /auth/login` (email + bcrypt, no mail) for
     UAT testing.
   - The AppSync realtime path, which is what UAT exists to exercise, is untouched.

   `MAIL_API_KEY` must still be non-empty for the schema to boot, but its value is
   irrelevant while the URL never resolves. To send real mail later, swap the one line
   in `infra/samconfig.toml`.

3. **Is the RDS schema loaded?** Unverified. It decides whether the API can serve
   anything once deployed.

4. **Shared `JWT_SECRET`.** UAT imports `semp-infra`'s `AppSecret`, so it shares the
   secret with anything else that later uses that stack. Harmless today; worth
   remembering when production moves onto SAM.
