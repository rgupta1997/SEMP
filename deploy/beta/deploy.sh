#!/usr/bin/env bash
# Deploy BETA.
#
#   Lambda semp-api + HTTP API semp-api-gateway, ap-south-1, both UNMANAGED (created
#   by raw AWS CLI calls, not CloudFormation). Database is Supabase project iwxgd...,
#   CORS allows sportagon-eos.netlify.app and its deploy previews.
#
# This is a wrapper, not the implementation: the real script is
# apps/api/scripts/deploy-lambda.sh and it stays there because deploy-lambda.mjs
# locates it as a sibling and it resolves dist-lambda.zip from its own parent.
#
# ---------------------------------------------------------------------------
# ⚠️  READ apps/api/scripts/deploy-lambda.sh's header before the first deploy of
#     this branch. An EXISTING function keeps its environment, and beta's carries
#     only DATABASE_URL, JWT_SECRET and WEB_ORIGIN - while this branch made
#     NODE_ENV mandatory with no default. Shipping code alone is a cold-start
#     crash until NODE_ENV=development, MAIL_TRANSPORT=console and
#     REALTIME_TRANSPORT=off are set on the function.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "== building the Lambda bundle =="
npm run build:lambda --workspace @semp/api --prefix "$REPO_ROOT"

echo "== deploying to BETA (semp-api, ap-south-1) =="
bash "$REPO_ROOT/apps/api/scripts/deploy-lambda.sh" "$@"
