# SEMP infrastructure (AWS SAM)

Two stacks, deliberately separate:

| Stack | Holds | Cadence |
|---|---|---|
| `semp-infra` | RDS PostgreSQL, its security group and parameter group, two Secrets Manager secrets | Rarely, with a human reading the changeset |
| `semp-api` / `semp-uat` | Lambda functions (API, AppSync authorizer, notification publisher), API Gateway HTTP API, AppSync Event API + channel namespace, SQS queue + DLQ, alarms, log groups, execution roles | Every push |

One template, deployed once per environment via `--config-env`. `FunctionName` derives
every resource name, so `semp-uat` and a future `semp-api` coexist without collision.

`semp-api` imports exactly two values from `semp-infra` (the secret ARNs) and nothing
else, so an app deploy cannot reach the database's own resources.

> The retain policies on the database are seatbelts, not the wall. **The wall is an
> IAM boundary on the CI deploy role, scoped to `stack/semp-api/*` only.** That role
> does not exist yet — there is no `.github/` in this repo.

## Deployment state

Verified against account `506491559903` / `ap-south-1` on 2026-09-22:

| | State |
|---|---|
| `semp-infra` | **DEPLOYED** — `CREATE_COMPLETE`. RDS `semp-prod` (postgres 17.7) is `available` on port 5462; both secrets exist |
| `semp-api` | **NOT deployed** — this is the stack holding the Lambda, HTTP API, AppSync Event API, SQS queue and publisher |

Two things are true and easy to miss:

- ⚠️ **The `semp-api` Lambda and its HTTP API are the live BETA environment** — not
  leftovers, whatever blocker 8 below used to claim. Do not delete them. The name
  collision they cause is avoided with `FunctionName=semp-uat`, not with a teardown.
- **`AppSecret` is not ready.** `MAIL_API_KEY` is still **empty**, and production
  refuses to boot without it (`MAIL_TRANSPORT=http` requires it). The secret also still
  carries a `SUPABASE_JWT_SECRET` key: removing it from this template does nothing on
  its own, because `GenerateSecretString` is consulted only at CREATE. It goes away
  when you run the `put-secret-value` in RUNBOOK-rds.md step 7, which now writes two
  keys instead of three.

Work through **Before you deploy** below before the first `semp-api` deploy.

## Commands

**Bringing RDS up for the first time: follow [RUNBOOK-rds.md](RUNBOOK-rds.md).** It is
the ordered version of this section, including the schema load and the two guardrails
CloudFormation cannot set. The commands below are the reference once that is done.

Run from this directory.

```bash
sam validate --config-env infra
sam validate --config-env api
```

```bash
# All three parameters together: a CLI --parameter-overrides REPLACES the config
# file's list rather than merging with it. -4 because AdminCidr is IPv4-only.
sam deploy --config-env infra --parameter-overrides \
  "VpcId=vpc-0295723a4b343412c" \
  "SubnetIds=subnet-0ac9c6a2778f3c7ce,subnet-0fc4c1b851b823704" \
  "AdminCidr=$(curl -4 -s https://ifconfig.me)/32"
```

```bash
sam build --config-env api && sam deploy --config-env api
```

There is no `[default]` config section on purpose: a bare `sam deploy` fails with
"Missing option --stack-name" rather than guessing which stack you meant, and one of
these two owns the production database.

## Before you deploy

**Hard blockers — these are separate workstreams, not config:**

1. **Schema provisioning.** There is no path to get the schema onto RDS.
   `supabase/migrations/` holds 72 files that will not replay against plain
   Postgres 17 — one grants a policy `to authenticated` and calls `auth.uid()`,
   another does `alter publication supabase_realtime add table`. Neither the role,
   the function, nor the publication exists on RDS. Take a `pg_dump --schema-only`
   from Supabase, strip those artifacts, and land it as a baseline.
   **Both of those artifacts are now removed for you** by
   `supabase/migrations/20260922000000_retire_supabase_realtime.sql` — apply it to
   Supabase *before* taking the dump and neither one is in it. That turns an
   easy-to-forget manual strip into a no-op; forgetting it aborts the load under
   `ON_ERROR_STOP=1` and creates nothing at all.
   *Neither stack should run migrations.* A CloudFormation custom-resource migration
   Lambda is the tempting wrong answer: it makes every app deploy able to touch
   schema, which is the coupling the two-stack split exists to prevent.

2. ~~**Notifications break silently at cutover.**~~ **RESOLVED — replaced by AppSync
   Events.** Supabase Realtime read Supabase's own Postgres WAL, so no configuration
   could have kept it working once the database was RDS. It is gone: `notify()` now
   enqueues to SQS, a publisher Lambda fans out one event per recipient, and a Lambda
   authorizer enforces per-user isolation where the RLS policy used to
   (`apps/api/src/modules/realtime/`). `SUPABASE_JWT_SECRET` no longer exists
   anywhere.

   Two things to know rather than to do:
   - The bell also polls every 2 minutes (`useUnreadCount`). That is not belt and
     braces, it is **the rollback**: set `REALTIME_TRANSPORT=off` and redeploy and the
     feature degrades to a 2-minute delay instead of dying. After the RDS cutover
     there is no other rollback, because the old transport cannot work at all.
   - `AlarmEmail` is optional but effectively required. `notify()` swallows realtime
     failures by design so a queue outage cannot fail the request that triggered a
     notification — which means the DLQ and queue-age alarms are the only things that
     would ever tell you the fan-out is broken.

3. **Two background jobs cannot run on Lambda.** `modules/demos/demos.routes.ts` and
   `modules/reports/impact.routes.ts` both respond and *then* do work
   (`void job()` after `res.json()`). Lambda freezes the container when the response
   returns, so demo seeding (documented at 10–30s, against a 15s timeout) and impact
   reports will hang at `queued` forever.

**Configuration to fill in — every one of these is a `REPLACE_ME` in `samconfig.toml`:**

4. ~~**`SecretsExtensionLayerArn`.**~~ **No longer needed — resolved automatically.**
   AWS publishes the current extension ARN as a public SSM parameter, one path per
   architecture, correct in every region, and `semp-api.yaml` resolves
   `/aws/service/aws-parameters-and-secrets-lambda-extension/arm64/latest` at deploy
   time.

   This used to say "there is no safe default", which was exactly backwards:
   hardcoding was the unsafe option. The AWS docs table lists ap-south-1 arm64 at
   version **111** while the account actually serves **137**, so anyone pasting from
   the docs would have pinned a stale layer. Pass the parameter explicitly only to
   reproduce a past build byte-for-byte.

5. **`VpcId` / `SubnetIds`.** Needs ≥2 subnets in **different** AZs — a
   `DBSubnetGroup` requires two even for a Single-AZ instance, and this is the most
   common first-deploy failure. `PubliclyAccessible: true` also requires the VPC to
   have `enableDnsSupport` and `enableDnsHostnames`; the default VPC has both, and a
   tightened account that deleted its default VPC invalidates the whole no-VPC premise.

   ```bash
   aws ec2 describe-subnets --region ap-south-1 \
     --filters Name=default-for-az,Values=true \
     --query 'Subnets[].[SubnetId,AvailabilityZone,VpcId]' --output table
   ```

6. **`EngineVersion`.** Defaults to `17.7`. Confirm it still exists — `17.4` and
   below are already deprecated and cannot be used to create new instances.

7. **`AppSecret` values.** CloudFormation generates `JWT_SECRET` and creates
   `MAIL_API_KEY` **empty**. Set it out of band so no value is ever in git, in
   `samconfig.toml`, or in a changeset:

   ```bash
   aws secretsmanager put-secret-value --secret-id semp/api/app-secrets --region ap-south-1 \
     --secret-string "$(jq -n --arg j "$JWT" --arg m "$MAIL" \
        '{JWT_SECRET:$j, MAIL_API_KEY:$m}')"
   ```

   No third key: realtime tokens are signed with a key **derived** from `JWT_SECRET`
   via HKDF (`modules/realtime/token-key.ts`), so there is nothing extra to provision.
   That derivation is a security boundary, not a convenience — `parseAuth` verifies
   session tokens with `jwt.verify(token, JWT_SECRET)` and checks no audience, so a
   realtime token signed with the raw secret would also be a working API session.

   **`JWT_SECRET` now signs five things, not four.** Rotating it additionally signs
   out every live notification subscription, on top of the certificate and share-link
   consequences noted below. Subscriptions recover on their own within one token
   lifetime; certificates do not.

8. ⚠️ **DO NOT tear down the `semp-api` resources. They are the live BETA
   environment.**

   This item used to say `scripts/deploy-lambda.sh` had left abandoned resources with
   no teardown path and "nothing is worth preserving", and to delete the `semp-api`
   function, the `semp-api-gateway` HTTP API, the `semp-api-lambda-role` role and the
   `/aws/lambda/semp-api` log group. **Following that instruction today deletes beta.**

   Measured in ap-south-1 on 2026-09-22: the `semp-api` function had taken ~21,800
   invocations in the preceding 14 days and had been updated two days earlier. Its
   `DATABASE_URL` points at the Supabase pooler for project `iwxgd...` and its
   `WEB_ORIGIN` is `sportagon-eos.netlify.app` plus two deploy previews — which is
   also how you can tell it is not production, since `events.sportagon.in` is absent
   from that CORS list and so the production frontend could not call it.

   There are three deployments in play, and only the first is this repo's concern:

   | | Where | Database |
   |---|---|---|
   | Production | `events.sportagon.in` → `www.events-api.sportagon.in` | not this stack |
   | Beta | unmanaged `semp-api` Lambda + `semp-api-gateway` | Supabase `iwxgd...` |
   | UAT | `semp-uat` stack (see `samconfig.toml`) | RDS `semp-prod` |

   **Nothing needs deleting.** The collision was only ever over the *name* `semp-api`,
   and `FunctionName=semp-uat` sidesteps it: every name the stack claims derives from
   that parameter. All eleven were verified free before the first deploy.

   `us-east-1` is genuinely clean, despite that script defaulting there.

## Verified against the live AWS schema

- **`AWS::AppSync::Api` exists in ap-south-1** (`describe-type`, LIVE, default version).
  The `RealtimeApi` resource's `EventConfig` validates against that published schema:
  all four required members present, `AWS_LAMBDA`/`AWS_IAM` are legal `AuthenticationType`
  values, `LogConfig` carries both of its required fields, and `Name` ("semp-api-events")
  is inside the 50-character limit and matches the permitted pattern.
- **`AuthorizerResultTtlInSeconds` has a hard ceiling of 3600**, which is now declared as
  `MaxValue` on the parameter so a bad value is rejected while the changeset is built
  rather than part-way through creating the API.
- **The create handler needs `iam:PassRole`** (plus `appsync:CreateApi`, `GetApi`,
  `TagResource`). Worth knowing when the CI deploy role is finally written — an
  AppSync API that passes a CloudWatch logs role cannot be created without it.

## Verified locally

- Both templates pass `sam validate --lint`.
- `sam build --config-env api` succeeds, producing a 31 MB artifact: a single
  inlined `index.mjs` (no stray chunks), one arm64 Prisma engine, mode `755` preserved.
- `serverless-http` v3 handles API Gateway **payload format 2.0** correctly for
  method, path, JSON body and query string — the mismatch that otherwise 500s every route.

## Not verified — needs a real deploy

- Whether the Secrets extension answers on `localhost:2773` with the layer ARN you pin.
- Whether the Prisma engine's mode bit survives SAM's *upload* zip (it survives the
  build directory; the Makefile re-applies `chmod 755` as a guard).
- Cold-start duration at `MemorySize: 1024` versus 512. Cold start here is Prisma
  engine spawn plus building ~40 routers, both CPU-bound, and Lambda scales vCPU with
  memory — so the larger size often costs *less*. Worth one measurement.

## Operational notes

- **Rotating `JWT_SECRET` is destructive beyond sign-outs.** It also signs
  certificate signatures (stored on the row and re-derived on verification) and
  public share links, so rotation makes already-issued certificates read as forged
  and breaks every distributed share link. Decide whether to re-sign existing
  certificate rows in the same window. The real fix is separate `CERT_SIGNING_SECRET`
  / `SHARE_SECRET` values so session-key rotation stops being a data-integrity event.
- **`rds.force_ssl` is a static parameter.** If you ever change it, CloudFormation
  reports `UPDATE_COMPLETE` while the running instance keeps the old setting until
  rebooted. Do not trust a green stack.
- **`SecretTargetAttachment` writes the endpoint into the secret at attachment time.**
  If the instance is renamed or replaced, `host` goes stale silently. Any infra
  changeset showing `Replacement: True` on `DbInstance` requires forcing an
  attachment update.
- **`EnableCloudwatchLogsExports` creates `/aws/rds/instance/semp-prod/postgresql`
  outside CloudFormation** with Never-expire retention. Set a retention period by
  hand or it accrues cost forever.
- **`db.t4g.small` runs on CPU credits.** Alarm on `CPUCreditBalance`, not
  `CPUUtilization` — credit exhaustion presents as a mysterious global slowdown.
- **`sslmode=require` does not verify the server certificate** in Prisma's client.
  On a publicly reachable database that is the weakest of the compensating controls.
  Next step: bundle the ap-south-1 RDS CA and move to `sslmode=verify-full`.
- **`ReservedConcurrency=0` means omit.** A literal value hard-fails the stack on an
  account whose total Lambda quota is 10, because AWS requires 10 unreserved. The old
  bash script detected that and skipped; CloudFormation cannot.
- **`VITE_API_URL` is build-time.** After the first `semp-api` deploy, read
  `ApiEndpoint` from the stack outputs, set it in the frontend host, and **rebuild**
  the frontend — saving the variable is not enough.
