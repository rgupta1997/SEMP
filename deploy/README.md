# Deployments

One entry point per environment. Run the `deploy.sh` in the matching folder — do not
invoke the underlying tooling directly unless you know which environment it targets,
because that is exactly the mistake this layout exists to prevent.

| Environment | Serves | Database | Mechanism | Folder |
|---|---|---|---|---|
| **Production** | `events.sportagon.in` → `www.events-api.sportagon.in` | *(not managed here)* | *(not managed here)* | [`prod/`](prod/) — placeholder |
| **Beta** | `sportagon-eos.netlify.app` + deploy previews | Supabase project `iwxgd…` | `apps/api/scripts/deploy-lambda.sh` (raw AWS CLI, unmanaged) | [`beta/`](beta/) |
| **UAT** | *(no frontend yet)* | RDS `semp-prod` — **real migrated production data** | AWS SAM, stack `semp-uat` | [`uat/`](uat/) |

## What is deliberately NOT duplicated

**The CloudFormation template.** `infra/semp-api.yaml` is ~750 lines and is deployed
once per environment through SAM's `--config-env`, with `FunctionName` deriving every
resource name. Copying it per folder would give three files that drift apart silently,
and the first symptom would be an environment missing a fix everyone assumed it had.
The folders hold *configuration and entry points*; the template stays shared.

**`apps/api/scripts/deploy-lambda.sh`** also stays where it is. `beta/deploy.sh` wraps
it rather than moving it, because `deploy-lambda.mjs` locates it as a sibling,
`package.json` exposes it as `deploy:lambda`, and the script resolves `dist-lambda.zip`
from its own parent directory. Relocating a live deploy path to tidy a folder is a poor
trade; the wrapper gives the same clarity for none of the risk.

## Things that have bitten before

- **Beta is not a leftover.** `infra/README.md` blocker 8 used to describe beta's
  Lambda, HTTP API, IAM role and log group as abandoned artifacts to delete before the
  SAM stack could deploy. They carry ~21.8k invocations per fortnight. Nothing needs
  deleting — the name collision is avoided by `FunctionName`, not by a teardown.
- **UAT writes to real data.** It points at the RDS instance holding production data
  migrated off Supabase. No stack runs migrations, so writes are additive rows, but a
  snapshot is the restore point and exists.
