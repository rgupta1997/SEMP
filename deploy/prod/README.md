# Production

**Nothing here yet, and nothing in this repo deploys production today.**

`events.sportagon.in` is served by a frontend that calls
`https://www.events-api.sportagon.in`. That API is not the beta Lambda — beta's CORS
list does not include `events.sportagon.in`, so it could not answer those requests —
and it is not the `semp-uat` stack, which did not exist when this was written. Whatever
serves it is outside this folder's knowledge; establish that before planning a cutover.

## When production does move onto SAM

It should be a third `--config-env` against the same `infra/semp-api.yaml`, following
the pattern `[uat.*]` establishes:

```toml
[prod.deploy.parameters]
stack_name        = "semp-prod-api"
confirm_changeset = true
parameter_overrides = [
  "FunctionName=semp-prod",
  # ...
]
```

`FunctionName` derives every resource name, so a prod stack coexists with beta and UAT
without collision — the same property that made UAT deployable without deleting
anything.

## Decide before that day

- **Which database.** `semp-infra` holds one RDS instance, and UAT already points at
  it. Production sharing a database with UAT is a decision, not a default.
- **`JWT_SECRET` sharing.** Everything importing `semp-infra`'s `AppSecret` shares it.
  A UAT-issued session token would be valid against production. That is tolerable while
  UAT is the only consumer; it is not once production joins. A separate `AppSecret`, or
  a separate infra stack, is the fix.
- **The two background jobs.** `modules/demos` and `modules/reports` respond and *then*
  do work, which Lambda's freeze-on-response breaks. Still open — `infra/README.md`
  blocker 3.
- **Render.** It can no longer boot this branch in production (the realtime guard), and
  is being retired in favour of Lambda.
