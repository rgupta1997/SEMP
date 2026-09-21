# SEMP infrastructure (AWS SAM)

Two stacks, deliberately separate:

| Stack | Holds | Cadence |
|---|---|---|
| `semp-infra` | RDS PostgreSQL, its security group and parameter group, two Secrets Manager secrets | Rarely, with a human reading the changeset |
| `semp-api` | Lambda function, API Gateway HTTP API, log groups, execution role | Every push |

`semp-api` imports exactly two values from `semp-infra` (the secret ARNs) and nothing
else, so an app deploy cannot reach the database's own resources.

> The retain policies on the database are seatbelts, not the wall. **The wall is an
> IAM boundary on the CI deploy role, scoped to `stack/semp-api/*` only.** That role
> does not exist yet — there is no `.github/` in this repo.

## Nothing here has been deployed

These templates are authored and validated but never applied. Before the first
deploy, work through **Before you deploy** below — several items are hard blockers.

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
   *Neither stack should run migrations.* A CloudFormation custom-resource migration
   Lambda is the tempting wrong answer: it makes every app deploy able to touch
   schema, which is the coupling the two-stack split exists to prevent.

2. **Notifications break silently at cutover.** Supabase Realtime reads Supabase's
   own Postgres WAL. Once the database is RDS there is no configuration that keeps it
   working — deliveries write to RDS, browsers stay subscribed to Supabase, and
   nothing arrives with no error anywhere. `SUPABASE_JWT_SECRET` in `AppSecret` stops
   `realtime-token.ts` from throwing; it does not make the feature work.

3. **Two background jobs cannot run on Lambda.** `modules/demos/demos.routes.ts` and
   `modules/reports/impact.routes.ts` both respond and *then* do work
   (`void job()` after `res.json()`). Lambda freezes the container when the response
   returns, so demo seeding (documented at 10–30s, against a 15s timeout) and impact
   reports will hang at `queued` forever.

**Configuration to fill in — every one of these is a `REPLACE_ME` in `samconfig.toml`:**

4. **`SecretsExtensionLayerArn`.** Per-region *and* per-architecture (this stack is
   **arm64**, not x86_64) and version-bumped. Look up the current ap-south-1 ARM64
   ARN for the AWS Parameters and Secrets Lambda Extension. There is no safe default.

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
   `MAIL_API_KEY` / `SUPABASE_JWT_SECRET` **empty**. Set them out of band so no value
   is ever in git, in `samconfig.toml`, or in a changeset:

   ```bash
   aws secretsmanager put-secret-value --secret-id semp/api/app-secrets --region ap-south-1 \
     --secret-string "$(jq -n --arg j "$JWT" --arg m "$MAIL" --arg s "$SUPA" \
        '{JWT_SECRET:$j, MAIL_API_KEY:$m, SUPABASE_JWT_SECRET:$s}')"
   ```

8. **Teardown of the old unmanaged resources.** `scripts/deploy-lambda.sh` created
   resources with the exact names this template wants, and it had no teardown path,
   so CloudFormation will fail with "already exists". A new HTTP API means a new
   `execute-api` URL regardless, so nothing is worth preserving.
   **Check both `ap-south-1` and `us-east-1`** — that script defaulted to us-east-1:
   the `semp-api` function, the `semp-api-gateway` HTTP API, the
   `semp-api-lambda-role` role (detach `AWSLambdaBasicExecutionRole` first), and the
   `/aws/lambda/semp-api` log group.

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
