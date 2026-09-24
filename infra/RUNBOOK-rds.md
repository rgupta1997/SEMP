# Runbook: bring RDS up

Gets `semp-infra` deployed and the SEMP schema loaded onto it.

Steps run **0-6, 8, 10, 9** - step 7 (application secrets) is deliberately deferred to
the API cutover; see the note there. Step 2 can be skipped if 1e already confirmed the
engine version. **Does not** deploy the
API — `semp-api` has three hard blockers listed in [README.md](README.md), and none of
them is fixed by this runbook.

Region is `ap-south-1` throughout. Budget ~45 min, most of it waiting on step 6.
Cost once running: roughly **$32/month** (db.t4g.small + 50 GB gp3 + 2 secrets).

---

## 0. Prerequisites

```bash
aws --version                    # v2
aws sts get-caller-identity      # confirm the RIGHT account before anything else
psql --version                   # must be >= 17 - see below
pg_dump --version                # must be >= 17 - this is the one that blocks step 9
jq --version
```

**The client version is a hard requirement, not a nicety.** `pg_dump` refuses to run
against a server newer than itself ("aborting because of server version mismatch"), and
both Supabase and this RDS instance are PostgreSQL 17. A v15 client connects fine with
`psql` (you get a version warning and everything in step 8 works) and then fails
outright at step 9, after you have already paid for the instance.

macOS with Postgres.app often has only v15. `libpq` is the client-only package - it
installs `psql`/`pg_dump` without a second server:

```bash
brew install libpq
"$(brew --prefix libpq)"/bin/pg_dump --version   # confirm >= 17
```

Homebrew keeps `libpq` keg-only, so prefer putting it FIRST on PATH for the dump work
rather than `brew link --force libpq`, which permanently shadows Postgres.app's binaries
for every other project on the machine:

```bash
export PATH="$(brew --prefix libpq)/bin:$PATH"
psql --version && pg_dump --version
```


Your IAM principal needs `cloudformation:*`, `rds:*`, `ec2:Describe*` +
`ec2:*SecurityGroup*`, `secretsmanager:*`, and `s3:*` on the SAM artifact bucket.

`resolve_s3 = true` in `samconfig.toml` means SAM creates a **third** stack,
`aws-sam-cli-managed-default`, to hold that bucket. Expected — if you would rather own
it, replace `resolve_s3` with an explicit `s3_bucket`.

---

## 1. Find the VPC and subnets

Six checks. Each one is a first-deploy failure that has actually happened to somebody,
and all six are cheap read-only calls.

```bash
export AWS_REGION=ap-south-1
aws sts get-caller-identity --query '[Account,Arn]' --output text   # the RIGHT account?
```

### 1a. The default VPC

```bash
aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[].[VpcId,CidrBlock,State]' --output table
```

**Empty output means there is no default VPC** — some tightened accounts delete it, and
that invalidates the no-VPC premise this whole design rests on. Recreate it (this also
makes an internet gateway, a route table, and a public subnet per AZ):

```bash
aws ec2 create-default-vpc
```

Then:

```bash
export VPC=vpc-0abc...
```

### 1b. Its subnets

```bash
aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC \
  --query 'Subnets[].[SubnetId,AvailabilityZone,AvailableIpAddressCount,MapPublicIpOnLaunch]' \
  --output table
```

Pick **two in different AZs**. A `DBSubnetGroup` requires two even though this instance
is Single-AZ, and one AZ is the most common first-deploy failure. Both need a healthy
`AvailableIpAddressCount` (a handful is enough, but zero fails).

```bash
export SUB_A=subnet-0aaa...
export SUB_B=subnet-0bbb...
```

### 1c. DNS attributes — both must be `True`

`PubliclyAccessible: true` silently produces an instance with no resolvable endpoint if
either is off.

Note the case mismatch, which is easy to get wrong: the `--attribute` value is
lowercase-first (`enableDnsSupport`) but the RESPONSE field is PascalCase
(`EnableDnsSupport`). Querying `enableDnsSupport.Value` returns null, and
`--output text` prints that as `None` - which reads exactly like a real answer and is
not one. Always confirm you see `True` or `False`; `None` means the query is wrong.

```bash
aws ec2 describe-vpc-attribute --vpc-id $VPC --attribute enableDnsSupport \
  --query 'EnableDnsSupport.Value' --output text
aws ec2 describe-vpc-attribute --vpc-id $VPC --attribute enableDnsHostnames \
  --query 'EnableDnsHostnames.Value' --output text
```

Or as one loop, carrying both spellings (works in bash and zsh):

```bash
for pair in enableDnsSupport:EnableDnsSupport enableDnsHostnames:EnableDnsHostnames; do
  attr="${pair%%:*}"; key="${pair##*:}"
  printf '%-20s = %s\n' "$attr" \
    "$(aws ec2 describe-vpc-attribute --vpc-id $VPC --attribute "$attr" --query "$key.Value" --output text)"
done
```

### 1d. Are those subnets actually PUBLIC?

`MapPublicIpOnLaunch` is **not** the test — the test is a `0.0.0.0/0` route to an
internet gateway. A subnet without one gives you an instance that looks fine in the
console and is unreachable. In a genuine default VPC this passes; in a rebuilt one it
often does not.

```bash
for S in $SUB_A $SUB_B; do
  RT=$(aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=$S \
        --query 'RouteTables[0].RouteTableId' --output text)
  # No explicit association means the subnet uses the VPC's MAIN route table.
  if [ "$RT" = "None" ] || [ -z "$RT" ]; then
    RT=$(aws ec2 describe-route-tables \
          --filters Name=vpc-id,Values=$VPC Name=association.main,Values=true \
          --query 'RouteTables[0].RouteTableId' --output text)
  fi
  echo "--- $S uses $RT"
  aws ec2 describe-route-tables --route-table-ids $RT \
    --query 'RouteTables[0].Routes[].[DestinationCidrBlock,GatewayId,NatGatewayId]' --output table
done
```

You are looking for a row reading `0.0.0.0/0` with an `igw-...` gateway. A `nat-...`
there instead means the subnet is private.

### 1e. Is `db.t4g.small` orderable in those AZs?

Instance classes are not available in every AZ, and the failure arrives 10 minutes into
step 5 rather than up front.

```bash
aws rds describe-orderable-db-instance-options \
  --engine postgres --engine-version 17.7 --db-instance-class db.t4g.small \
  --query 'OrderableDBInstanceOptions[].AvailabilityZones[].Name' --output text | tr '\t' '\n' | sort -u
```

Both of your chosen AZs must appear. If one does not, pick a different subnet in 1b.

### 1f. Name collisions

`scripts/deploy-lambda.sh` created unmanaged resources, and — more subtly — the secrets
in this template carry `DeletionPolicy: Retain`. **If you ever deploy, delete the stack,
and redeploy, the secrets survive and the second deploy fails "already exists".**

```bash
aws rds describe-db-instances --db-instance-identifier semp-prod \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>&1 | tail -1

# --include-planned-deletion is REQUIRED, not optional. list-secrets EXCLUDES secrets
# scheduled for deletion by DEFAULT - which is exactly the collision this check exists
# to find, since a secret in its recovery window still holds the name.
#
# length() rather than a table: an empty result set prints NOTHING under
# `--output table`, so a clean check and a command that silently did not run look
# identical. This always prints a number.
aws secretsmanager list-secrets --include-planned-deletion \
  --query "length(SecretList[?starts_with(Name,'semp/')])" --output text

# Only if that printed something other than 0:
aws secretsmanager list-secrets --include-planned-deletion \
  --query "SecretList[?starts_with(Name,'semp/')].[Name,DeletedDate]" --output table
```

`DBInstanceNotFound` and `0` are what you want. A secret that is listed
with a `DeletedDate` is in its 7–30 day recovery window and **still holds the name** —
either restore it (`restore-secret`) and reuse it, or release the name outright:

```bash
aws secretsmanager delete-secret --secret-id semp/infra/db-master --force-delete-without-recovery
```

### 1g. Record the values

This prints the exact lines for step 3:

```bash
printf 'parameter_overrides = [\n  "VpcId=%s",\n  "SubnetIds=%s,%s",\n]\n' "$VPC" "$SUB_A" "$SUB_B"
```

Sanity check first — a subnet from a different VPC produces a confusing CloudFormation
error rather than a clear one:

```bash
aws ec2 describe-subnets --subnet-ids $SUB_A $SUB_B \
  --query 'Subnets[].[SubnetId,VpcId,AvailabilityZone]' --output table
```

Both rows must show `$VPC`, and the two AZs must differ.

## 2. Confirm the engine version still exists

```bash
aws rds describe-db-engine-versions --engine postgres --region ap-south-1 \
  --query 'DBEngineVersions[?starts_with(EngineVersion, `17.`)].EngineVersion' --output text
```

`samconfig.toml` defaults to `17.7`. If it is not in that list, pass a version that is
via `EngineVersion=` in step 4. **The major must stay 17** — it has to match
`supabase/config.toml`'s `major_version = 17`, or the dump in step 9 will not restore.

---

## 3. Fill in samconfig.toml

Edit `[infra.deploy.parameters].parameter_overrides` with the ids from step 1:

```toml
parameter_overrides = [
  "VpcId=vpc-0abc...",
  "SubnetIds=subnet-0aaa...,subnet-0bbb...",
]
```

Leave the `[api.deploy.parameters]` placeholders alone — they are not needed yet.

`AdminCidr` is deliberately **not** in this file. It is your home IP, so it goes on the
command line.

---

## 4. Dry-run the changeset

```bash
cd infra

# --parameter-overrides on the CLI REPLACES samconfig.toml's parameter_overrides
# wholesale - it does NOT merge. Passing only AdminCidr wipes VpcId/SubnetIds and the
# changeset fails with "Parameters: [VpcId, SubnetIds] must have values". So all three
# go on the command line together.
#
# -4 forces IPv4: ifconfig.me returns IPv6 on a dual-stack network, and AdminCidr is
# IPv4-only (the SG rule uses CidrIp, and an IPv6 /32 is a huge range, not one host).
MYIP=$(curl -4 -s https://ifconfig.me)
echo "AdminCidr will be ${MYIP}/32"
case "$MYIP" in
  *.*.*.*) ;;
  *) echo "NOT an IPv4 address - do not deploy with this. Find your IPv4 another way." >&2 ;;
esac

sam deploy --config-env infra --no-execute-changeset \
  --parameter-overrides \
    "VpcId=vpc-0295723a4b343412c" \
    "SubnetIds=subnet-0ac9c6a2778f3c7ce,subnet-0fc4c1b851b823704" \
    "AdminCidr=${MYIP}/32"
```

Read the output. On a first deploy every row is `Add`. On any *later* deploy, treat
`Replacement: True` on `DbInstance` as a stop-and-think: `DeletionPolicy: Retain` means
you would end up with two instances and be billed for both.

---

## 5. Deploy

```bash
MYIP=$(curl -4 -s https://ifconfig.me)

sam deploy --config-env infra \
  --parameter-overrides \
    "VpcId=vpc-0295723a4b343412c" \
    "SubnetIds=subnet-0ac9c6a2778f3c7ce,subnet-0fc4c1b851b823704" \
    "AdminCidr=${MYIP}/32"
```

RDS creation takes **10-15 minutes**. `confirm_changeset = true` prompts once.

### If it fails part-way through

`DbInstance`, `DbSecret` and `AppSecret` all carry `DeletionPolicy: Retain`. On a failed
create, CloudFormation rolls back and deletes everything **except those three** - so a
partial failure leaves orphans that then block the retry with "already exists", and the
rollback log will not mention them.

Re-run the 1f collision check before retrying, not after it fails a second time:

```bash
aws rds describe-db-instances --db-instance-identifier semp-prod \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>&1 | tail -1
aws secretsmanager list-secrets --include-planned-deletion \
  --query "length(SecretList[?starts_with(Name,'semp/')])" --output text
```

An orphaned secret is released with
`delete-secret --force-delete-without-recovery` (plain `delete-secret` keeps the name
reserved for 7-30 days). An orphaned `semp-prod` instance has `DeletionProtection: true`,
so it needs `modify-db-instance --no-deletion-protection` before `delete-db-instance`.

### This is where it starts costing money

Roughly **$32/month** from the moment `DbInstance` reaches `available`
(db.t4g.small + 50 GB gp3 + 2 secrets). `DeletionProtection: true` and
`DeletionPolicy: Retain` together mean `sam delete` will NOT stop that meter - see
the orphan cleanup above.

---

## 5b. Resizing, or recreating at a different storage size

`DBInstanceClass` is an in-place modify (reboot, endpoint unchanged) - just change the
parameter and re-deploy. `AllocatedStorage` **can only ever grow**, so lowering it means
destroying and recreating the instance. Trivial while the database is empty; a data
migration once it is not.

**Order matters.** `DbSecurityGroup` does NOT carry `DeletionPolicy: Retain`, and a
security group attached to a live RDS instance cannot be deleted - so `sam delete` fails
on it unless the instance is already gone. Delete the instance FIRST:

```bash
cd infra

# 1. Deletion protection blocks the delete. Applied immediately, no reboot.
aws rds modify-db-instance --db-instance-identifier semp-prod --region ap-south-1 \
  --no-deletion-protection --apply-immediately

# 2. Confirm it actually took before trying to delete
aws rds describe-db-instances --db-instance-identifier semp-prod --region ap-south-1 \
  --query 'DBInstances[0].DeletionProtection'          # must print false

# 3. Delete the instance. --delete-automated-backups matters: retained automated
#    backups outlive the instance and keep billing for the retention period.
aws rds delete-db-instance --db-instance-identifier semp-prod --region ap-south-1 \
  --skip-final-snapshot --delete-automated-backups

# 4. Wait. 5-10 minutes.
aws rds wait db-instance-deleted --db-instance-identifier semp-prod --region ap-south-1

# 5. NOW the stack deletes cleanly - the security group is detached
sam delete --config-env infra

# 6. The two secrets are Retain, so they survive and would block the redeploy.
#    Plain delete-secret keeps the NAME reserved for 7-30 days; force is required.
aws secretsmanager delete-secret --secret-id semp/infra/db-master --region ap-south-1 \
  --force-delete-without-recovery
aws secretsmanager delete-secret --secret-id semp/api/app-secrets --region ap-south-1 \
  --force-delete-without-recovery

# 7. Verify clean before redeploying - expect DBInstanceNotFound and 0
aws rds describe-db-instances --db-instance-identifier semp-prod --region ap-south-1 \
  --query 'DBInstances[0].DBInstanceStatus' --output text 2>&1 | tail -1
aws secretsmanager list-secrets --include-planned-deletion --region ap-south-1 \
  --query "length(SecretList[?starts_with(Name,'semp/')])" --output text
```

Then redeploy (step 5) with the new sizing, and **re-run step 8** - a recreated instance
has a new endpoint AND a new generated password, so any exported `PG*` variables are
stale and `psql` will fail in a way that looks like a network problem.

---

## 6. Read the outputs

```bash
aws cloudformation describe-stacks --stack-name semp-infra --region ap-south-1 \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

You want `DbEndpointAddress` and `DbPortOut`. **The port is 5462, not 5432** — that is
deliberate (it removes essentially all commodity internet scanning, which only targets
5432). Every connection string from here on needs it.

---

## 7. Fill in the application secrets — DEFER THIS

> **Not needed to get RDS running.** `AppSecret` is read only by
> `apps/api/src/lambda.ts`, and `semp-api` cannot deploy until the three blockers in
> README.md clear. Doing it now buys nothing and forces the irreversible `JWT_SECRET`
> decision earlier than necessary.
>
> **Go to step 8, then 10, then 9.** Come back here as part of the API cutover.
> Verify the current connect first (step 8), because a wrong `AdminCidr` looks like a
> hang and is much easier to diagnose before anything else is in flight.

CloudFormation generated a 64-character `JWT_SECRET` and created `MAIL_API_KEY`
**empty**. `put-secret-value` replaces the whole JSON document, so read the generated
value back first or you will destroy it:

```bash
GEN=$(aws secretsmanager get-secret-value --secret-id semp/api/app-secrets \
        --region ap-south-1 --query SecretString --output text | jq -r .JWT_SECRET)

aws secretsmanager put-secret-value --secret-id semp/api/app-secrets --region ap-south-1 \
  --secret-string "$(jq -n \
      --arg j "$GEN" \
      --arg m "<MAIL_API_KEY from apps/api/.env>" \
      '{JWT_SECRET:$j, MAIL_API_KEY:$m}')"
```

> **This generated `JWT_SECRET` is a rotation, and rotation is destructive beyond
> sign-outs.** That key also signs certificate signatures (stored on the row and
> re-derived at verification) and public share links, so switching to it makes every
> already-issued certificate read as forged and breaks every distributed share link.
> Decide before cutover whether to re-sign existing certificate rows. Do **not** carry
> the old value forward instead — it is `dev-secret-change-me`, and
> `env.schema.ts` now refuses to boot on it in production.

---

## 8. Connect

> **Shortcut for any new shell:** `source infra/rds-env.sh` does everything in this
> section - exports all six `PG*` variables from Secrets Manager (nothing stored in the
> repo), derives `SUPA` from the root `.env` with the pooler-port and query-parameter
> fixes already applied, and defines `pgsupa()`. It prints both connections with
> passwords masked so you can confirm the targets before running anything.
>
> The manual steps below are what it automates, kept for when the AWS CLI is not
> available or you need a different secret.

```bash
SEC=$(aws secretsmanager get-secret-value --secret-id semp/infra/db-master \
        --region ap-south-1 --query SecretString --output text)
export PGHOST=$(jq -r .host     <<<"$SEC")
export PGPORT=$(jq -r .port     <<<"$SEC")
export PGUSER=$(jq -r .username <<<"$SEC")
export PGPASSWORD=$(jq -r .password <<<"$SEC")
export PGDATABASE=semp
export PGSSLMODE=require

psql -c 'select version();'
```

If this hangs, it is the security group: `AdminCidr` was your IP at deploy time and
home IPs move. Re-run step 5 with the current one.

Confirm TLS is actually mandatory — this **must fail**:

```bash
PGSSLMODE=disable psql -c 'select 1;'    # expect: no encryption / server does not support SSL
```

---

## 9. Load the schema

This is the step with no pre-existing path. **Do not replay `supabase/migrations/`** —
72 files, and two of them cannot work on RDS: one grants a policy `to authenticated` and
calls `auth.uid()`, the other does `alter publication supabase_realtime add table`.
Neither the role, the function, nor the publication exists here.

Take the current state as a baseline instead.

> **First, apply `20260922000000_retire_supabase_realtime.sql` to Supabase.** It drops
> the Realtime policy and publication membership that the Supabase-only artifacts come
> from, so the dump below simply does not contain them and step 9b has one less thing
> to strip. Both are dead code either way — live notifications run on AppSync Events
> now — but doing it here means the *schema* is clean rather than the *dump* being
> cleaned, which is one fewer step to forget at 2am. If you skip it, 9b still works.

**First, isolate the Supabase commands from your RDS environment.** By step 8 this shell
has `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE` all pointing at
RDS, and those are defaults for every libpq tool. A `pg_dump` whose connection string
does not override all of them either reads from the WRONG SERVER or fails
authenticating with the wrong password - and a dump that silently came from the empty
RDS restores without complaining about anything.

Use a FUNCTION, not a variable: zsh does not word-split parameter expansions, so
`$PGENV_CLEAN psql ...` fails with `command not found: env -u PGHOST -u ...`. A function
behaves identically in bash and zsh.

```bash
pgsupa() { env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE "$@"; }
```

Every Supabase-side command below is prefixed with it. The RDS-side `psql` calls keep
using the exported variables as before.

**Then the connection string** - the **session pooler on :5432**, not the transaction
pooler:

```bash
SUPA='postgresql://postgres.<REF>:<URL-ENCODED-PW>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres'
```

Three things about it, each of which fails differently if you get it wrong:

- **Port 5432, the SESSION pooler.** Not `:6543`. The transaction pooler multiplexes
  statements across backends, and `pg_dump` needs one session for the life of the dump
  (it holds a transaction snapshot so the schema it reads is self-consistent).
- **No query parameters.** `?pgbouncer=true&connection_limit=5` are *Prisma* settings,
  not libpq ones, and libpq rejects unrecognised keywords outright -
  `invalid URI query parameter`. Copying `DATABASE_URL` straight out of `.env` is
  exactly how this happens.
- **URL-encode the password**: `/` -> `%2F`, `@` -> `%40`, `#` -> `%23`. Unencoded, you
  get a misleading `P1013 invalid port number` from Prisma-adjacent tooling.

**Prove it before dumping.** A wrong string that still connects produces an empty dump
that restores cleanly and tells you nothing:

```bash
pgsupa psql "$SUPA" -c "select current_database(), inet_server_addr();"
pgsupa psql "$SUPA" -c "select count(*) from information_schema.tables where table_schema='public';"
```

Expect database `postgres`. **Record that count** - it is the baseline for 9e, and the
only correct one. Do NOT compare it against `grep -c '^model ' apps/api/prisma/schema.prisma`:
that file is introspected output and can lag the database, so a mismatch there tells you
about Prisma drift, not about the dump. Source-vs-target is the check that matters.

A count of `0`, or a database named `semp`, means you are talking to the wrong server.

> **A `pg_dump` newer than both servers is fine** (18 client, 17 source, 17 target), but
> if a restore ever fails on unexpected syntax, the version gap is the first thing to
> suspect - re-dump with a client matching the target major.

> **Take ONE full dump, not a schema dump and a data dump.** Splitting them looks
> tidier and costs you three things:
>
> 1. **Skew.** The two dumps are taken at different moments. If the source schema
>    changes in between - and across a multi-day migration it will - the data dump
>    references columns the schema dump never created, and the load dies partway with
>    `column "X" of relation "Y" does not exist`. Nothing warns you; the schema restore
>    reports complete success.
> 2. **Circular foreign keys.** `pg_dump --data-only` does not order rows FK-safely, and
>    this schema has cycles (`users` <-> `organizations`, and `org_units` self-referencing).
>    pg_dump warns about it and suggests exactly this fix.
> 3. **Trigger suppression.** A full dump adds constraints and indexes AFTER the data, so
>    `session_replication_role` / `--disable-triggers` are not needed - which matters on
>    RDS, where the master user is not a true superuser.
>
> The three exclusions below are line-anchored, so they apply to a full dump unchanged.

**9a. Dump schema and data together.**

```bash
pgsupa pg_dump --no-owner --no-privileges \
  --no-publications --no-subscriptions --schema=public "$SUPA" > semp-full.sql
wc -l semp-full.sql
```

<details>
<summary>The older split-dump commands, kept for reference</summary>

**9a-alt. Dump the schema only.** `--no-publications` drops the Realtime publication for you:

```bash
pg_dump --schema-only --no-owner --no-privileges \
        --no-publications --no-subscriptions \
        --schema=public "$SUPA" > semp-schema.sql
```

**9b. Strip the Supabase-only artifacts.** If you applied
`20260922000000_retire_supabase_realtime.sql` first (see the note under step 9), the RLS
policy is already gone and only the two schema statements below remain — expect a
**2-line** difference rather than 3. Otherwise the policy survives a dump because it is
real state, so find and delete it by hand:

```bash
grep -n -iE "auth\.uid|authenticated|anon|service_role|supabase" semp-schema.sql
```

**Three** statements have to go, and only the first is obvious:

```bash
grep -vE '^CREATE SCHEMA public;$|^COMMENT ON SCHEMA public IS|^CREATE POLICY "Users can receive their own notification deliveries"' \
  semp-schema.sql > semp-schema.rds.sql

wc -l semp-schema.sql semp-schema.rds.sql   # expect a 3-line difference
diff semp-schema.sql semp-schema.rds.sql    # confirm ONLY those three
```

1. **`CREATE POLICY ... USING (user_id = auth.uid())`** - references a role
   (`authenticated`) and a function (`auth.uid()`) that do not exist on RDS. With
   Realtime gone the table needs no policy, and Prisma connects as owner and bypasses
   RLS regardless.
2. **`CREATE SCHEMA public;`** - `pg_dump --schema=public` emits this, and the target
   database already has a `public` schema, so it aborts with
   `ERROR: schema "public" already exists`. Under `ON_ERROR_STOP=1` that happens at
   line 26 and **nothing at all gets created** - which looks alarming and is actually
   the desired behaviour.
3. **`COMMENT ON SCHEMA public IS 'standard public schema';`** - purely cosmetic (it is
   already the default comment) and requires ownership of the schema, which the RDS
   master user holds only indirectly via `pg_database_owner`. Removed to eliminate a
   second possible abort rather than because it is known to fail.

Keep the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` lines - all 71 of them. Those are
standard Postgres, they restore cleanly, and with no policies attached and the app
connecting as owner they are inert. Keeping them preserves parity with the source.

Any `GRANT ... TO authenticated`/`anon` lines can be deleted too — or, if you would
rather not edit the dump, create the roles as no-login and let the grants land harmlessly:

```sql
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
```

**9c. Restore.** `pgcrypto` is what `gen_random_uuid()` needs:

```bash
psql -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
psql -v ON_ERROR_STOP=1 -f semp-schema.sql
```

`ON_ERROR_STOP=1` matters — without it psql reports success having skipped failures.

**9d. Data.**

```bash
pg_dump --data-only --disable-triggers --schema=public "$SUPA" > semp-data.sql
psql -v ON_ERROR_STOP=1 -f semp-data.sql
```

**9e. Verify against the source.** Use the script, not ad-hoc queries:

```bash
SUPA='postgresql://postgres.<REF>:<PW>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' \
  bash infra/verify-migration.sh
echo "exit=$?"
```

Six exhaustive comparisons - columns, constraints, indexes, per-table row counts,
sequences, and total bytea payload size - between the source and the target. Exit 0
only if every one is identical.

Why a script rather than spot-checks: in this migration the checks that caught real
problems were the exhaustive ones (849 columns caught a four-day-stale schema dump),
not the row counts anyone would think to sample. Three tables looking right proves
almost nothing about 71.

**Sequences are the one to care about most.** If `last_value` lags the data, the first
INSERT after cutover collides on a primary key - and that surfaces days later as a
duplicate-key error nobody connects back to the migration. A full `pg_dump` emits
`setval()`, so it should be right; this is what proves it was.

Reference figures from the 2026-09-08 run, for comparison at cutover: 849 columns,
446 constraints, 314 indexes, 71 tables, 4 sequences, 1 bytea column.

### Known drift as of 2026-09-09 (expected, non-blocking)

`verify-migration.sh` reports MISMATCH on `columns` and `indexes`. This is real drift,
not a tooling problem, and it is expected: Supabase keeps taking migrations while this
work proceeds. Two of them landed after the 2026-09-08 dump -
`20260908000000_demo_request_details.sql` and `20260904000000_fixture_completed_at.sql`
(both on `origin/main`, not on the `security/phase0-nodeenv-and-sam-iac` branch):

- 6 columns: `demo_requests.{city,event_date,participant_count,source,sport_count}`,
  `fixtures.completed_at` - **all nullable**, so Prisma inserts that omit them succeed
- 2 indexes: `idx_demo_requests_participants`, `idx_fixtures_autolock_due` -
  performance only

Nothing here blocks development against RDS. **Do not re-dump to chase it** - the fix
is a fresh dump, and any dump goes stale again within days while the team is shipping.
Re-dump ONCE, at the cutover write freeze, and expect these figures to have moved.

Note also that a dump captures Supabase's LIVE state, so which git branch you are on is
irrelevant to the data migration - migration files are never replayed.

---

## 10. Guardrails before you rely on it

```bash
# Deletion protection actually on
aws rds describe-db-instances --db-instance-identifier semp-prod --region ap-south-1 \
  --query 'DBInstances[0].[DeletionProtection,BackupRetentionPeriod,StorageEncrypted,PubliclyAccessible]'
```

Expect `[true, 14, true, true]`.

Two things the template cannot do for you:

```bash
# EnableCloudwatchLogsExports creates this OUTSIDE CloudFormation, retention "never expire"
aws logs put-retention-policy --region ap-south-1 \
  --log-group-name /aws/rds/instance/semp-prod/postgresql --retention-in-days 14
```

Two alarms, and neither is optional:

**`FreeStorageSpace`** - required because `MaxAllocatedStorage` defaults to 0, i.e.
storage autoscaling is OFF. That is the right default (autoscaling silently grows past
the free-tier allowance and starts billing with nothing failing), but it converts a
full disk from an invoice into an OUTAGE. 4 GiB on a 20 GiB volume is 20% free:

```bash
aws cloudwatch put-metric-alarm --region ap-south-1 \
  --alarm-name semp-prod-low-storage \
  --namespace AWS/RDS --metric-name FreeStorageSpace \
  --dimensions Name=DBInstanceIdentifier,Value=semp-prod \
  --statistic Minimum --period 300 --evaluation-periods 2 \
  --threshold 4000000000 --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching
```

**`CPUCreditBalance`**, not `CPUUtilization`. t4g classes are burstable: credit
exhaustion presents as a sustained slowdown across every query, which looks nothing
like a CPU spike and is very easy to misdiagnose.

```bash
aws cloudwatch put-metric-alarm --region ap-south-1 \
  --alarm-name semp-prod-cpu-credits \
  --namespace AWS/RDS --metric-name CPUCreditBalance \
  --dimensions Name=DBInstanceIdentifier,Value=semp-prod \
  --statistic Minimum --period 300 --evaluation-periods 2 \
  --threshold 30 --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching
```

> Both alarms above have **no `--alarm-actions`**, so they will go to ALARM and tell
> nobody. An alarm with no action is decoration. Create an SNS topic, subscribe an
> address, confirm the subscription, and add `--alarm-actions <topic-arn>` to both.

---

## 11. Point something at it

The API is **not** ready to deploy (three gates in README.md). To exercise the new
database from your machine meanwhile, put this in `apps/api/.env` — note the port and
`sslmode`:

```
DATABASE_URL="postgresql://semp_admin:<URL-ENCODED-PW>@<HOST>:5462/semp?sslmode=require"
DIRECT_URL="postgresql://semp_admin:<URL-ENCODED-PW>@<HOST>:5462/semp?sslmode=require"
```

`DIRECT_URL` is referenced by `schema.prisma` and set nowhere in the repo, so
`prisma db pull` currently runs against an undefined value — set it before introspecting.

```bash
npm run prisma:generate --workspace @semp/api
npm run dev:api
curl -s localhost:4000/health
```

Then stop the dev server before regenerating again: on Windows a running `tsx watch`
holds the engine DLL and `prisma generate` fails with `EPERM`.

---

## What this runbook deliberately does not do

- **Deploy `semp-api`.** Schema provisioning is now done and the Realtime replacement
  has landed (AppSync Events); the two fire-and-forget background jobs are still open.
  See README.md.
- **Run migrations from a stack.** A CloudFormation custom-resource migration Lambda is
  the tempting wrong answer: it makes every app deploy able to touch schema, which is
  exactly the coupling the two-stack split exists to prevent.
- **Decommission Supabase.** Keep it read-only for at least a week. It is the rollback.
