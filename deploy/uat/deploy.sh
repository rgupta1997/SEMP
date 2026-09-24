#!/usr/bin/env bash
# Deploy UAT - CloudFormation stack `semp-uat` in ap-south-1.
#
#   Lambda semp-uat, its HTTP API, the AppSync Event API semp-uat-events, the
#   notification queue + DLQ, and the authorizer and publisher Lambdas. Every name
#   derives from FunctionName=semp-uat, so nothing collides with beta or production.
#
# Points at the RDS instance in the semp-infra stack, which holds REAL PRODUCTION DATA
# migrated off Supabase. No stack runs migrations (infra/README.md blocker 1), so this
# only ever adds rows - but it is not a scratch database. A snapshot is the restore
# point.
#
# confirm_changeset is true for this environment: every changeset gets read by a human
# before it applies.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infra" && pwd)"
cd "$INFRA_DIR"

echo "== validating =="
sam validate --config-env uat --lint

echo "== building (three functions: api, authorizer, publisher) =="
sam build --config-env uat

echo "== deploying stack semp-uat =="
sam deploy --config-env uat "$@"
